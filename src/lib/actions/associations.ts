"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuth, canManageWorkspace } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { resolveEndpoints, listAssociableObjects } from "@/lib/associations";

export interface FormState {
  error?: string;
}

const SETTINGS = "/app/settings/associations";

function detailPath(objectType: string, id: string): string {
  if (objectType === "contact") return `/app/contacts/${id}`;
  if (objectType === "company") return `/app/companies/${id}`;
  if (objectType === "deal") return `/app/deals/${id}`;
  return `/app/o/${objectType}/${id}`;
}

// ── Association types (owner/admin only) ─────────────────────────────────────

const createSchema = z.object({
  fromObject: z.string().min(1, "Pick a from-object").max(64),
  toObject: z.string().min(1, "Pick a to-object").max(64),
  label: z.string().min(1, "Label is required").max(60),
  inverseLabel: z.string().min(1, "Inverse label is required").max(60),
  cardinality: z.enum(["one_to_one", "one_to_many", "many_to_many"]),
});

export async function createAssociationType(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireAuth();
  if (!canManageWorkspace(ctx.role)) return { error: "Only owners and admins can manage association types." };
  const parsed = createSchema.safeParse({
    fromObject: formData.get("fromObject"),
    toObject: formData.get("toObject"),
    label: formData.get("label"),
    inverseLabel: formData.get("inverseLabel"),
    cardinality: formData.get("cardinality"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const v = parsed.data;

  try {
    await withTenant(ctx.workspaceId, async (tx) => {
      const valid = new Set((await listAssociableObjects(tx)).map((o) => o.value));
      if (!valid.has(v.fromObject) || !valid.has(v.toObject)) throw new Error("BAD_OBJECT");
      await tx.associationType.create({
        data: {
          workspaceId: ctx.workspaceId,
          fromObject: v.fromObject,
          toObject: v.toObject,
          label: v.label,
          inverseLabel: v.inverseLabel,
          cardinality: v.cardinality,
        },
      });
    });
  } catch (e) {
    if (e instanceof Error && e.message === "BAD_OBJECT") return { error: "Unknown object type." };
    console.error("createAssociationType failed", e);
    return { error: "Could not create (a matching type may already exist)." };
  }
  revalidatePath(SETTINGS);
  return {};
}

export async function updateAssociationType(id: string, formData: FormData): Promise<void> {
  const ctx = await requireAuth();
  if (!canManageWorkspace(ctx.role)) return;
  const label = String(formData.get("label") ?? "").trim().slice(0, 60);
  const inverseLabel = String(formData.get("inverseLabel") ?? "").trim().slice(0, 60);
  if (!label || !inverseLabel) return;
  await withTenant(ctx.workspaceId, (tx) => tx.associationType.update({ where: { id }, data: { label, inverseLabel } }));
  revalidatePath(SETTINGS);
}

export async function deleteAssociationType(id: string): Promise<void> {
  const ctx = await requireAuth();
  if (!canManageWorkspace(ctx.role)) return;
  await withTenant(ctx.workspaceId, (tx) => tx.associationType.deleteMany({ where: { id } }));
  revalidatePath(SETTINGS);
}

// ── Edges (any member) ───────────────────────────────────────────────────────

export async function addAssociation(recordType: string, recordId: string, formData: FormData): Promise<void> {
  const ctx = await requireAuth();
  const associationTypeId = String(formData.get("associationTypeId") ?? "").trim();
  const otherId = String(formData.get("otherId") ?? "").trim();
  if (!associationTypeId || !otherId) return;

  let otherType = "";
  try {
    await withTenant(ctx.workspaceId, async (tx) => {
      const type = await tx.associationType.findFirst({ where: { id: associationTypeId } });
      if (!type) throw new Error("NO_TYPE");

      // Normalize to a directed from → to edge.
      let from: { t: string; id: string };
      let to: { t: string; id: string };
      if (recordType === type.fromObject) {
        from = { t: type.fromObject, id: recordId };
        to = { t: type.toObject, id: otherId };
      } else if (recordType === type.toObject) {
        from = { t: type.fromObject, id: otherId };
        to = { t: recordType, id: recordId };
      } else {
        throw new Error("BAD_DIRECTION");
      }
      otherType = recordType === type.fromObject ? type.toObject : type.fromObject;

      // Both endpoints must exist.
      const resolved = await resolveEndpoints(tx, [
        { objectType: from.t, recordId: from.id },
        { objectType: to.t, recordId: to.id },
      ]);
      const fromOk = resolved.get(`${from.t}:${from.id}`)?.exists;
      const toOk = resolved.get(`${to.t}:${to.id}`)?.exists;
      if (!fromOk || !toOk) throw new Error("MISSING_ENDPOINT");

      // Cardinality enforcement (silent no-op on violation, like addContactToCompany).
      if (type.cardinality === "one_to_many") {
        const claimed = await tx.recordAssociation.findFirst({
          where: { associationTypeId, toType: to.t, toId: to.id },
        });
        if (claimed) throw new Error("CARDINALITY");
      } else if (type.cardinality === "one_to_one") {
        const claimed = await tx.recordAssociation.findFirst({
          where: {
            associationTypeId,
            OR: [
              { fromType: from.t, fromId: from.id },
              { toType: to.t, toId: to.id },
            ],
          },
        });
        if (claimed) throw new Error("CARDINALITY");
      }

      await tx.recordAssociation.create({
        data: {
          workspaceId: ctx.workspaceId,
          associationTypeId,
          fromType: from.t,
          fromId: from.id,
          toType: to.t,
          toId: to.id,
          createdById: ctx.userId,
        },
      });
    });
  } catch (e) {
    // Duplicate / cardinality / missing endpoint → quiet no-op (panel just won't add it).
    if (!(e instanceof Error && ["NO_TYPE", "BAD_DIRECTION", "MISSING_ENDPOINT", "CARDINALITY"].includes(e.message))) {
      console.error("addAssociation failed", e);
    }
  }
  revalidatePath(detailPath(recordType, recordId));
  if (otherType) revalidatePath(detailPath(otherType, otherId));
}

export async function removeAssociation(edgeId: string, revalidateType: string, revalidateId: string): Promise<void> {
  const ctx = await requireAuth();
  let other: { t: string; id: string } | null = null;
  await withTenant(ctx.workspaceId, async (tx) => {
    const edge = await tx.recordAssociation.findFirst({ where: { id: edgeId } });
    if (!edge) return;
    other =
      edge.fromType === revalidateType && edge.fromId === revalidateId
        ? { t: edge.toType, id: edge.toId }
        : { t: edge.fromType, id: edge.fromId };
    await tx.recordAssociation.deleteMany({ where: { id: edgeId } });
  });
  revalidatePath(detailPath(revalidateType, revalidateId));
  if (other) revalidatePath(detailPath((other as { t: string; id: string }).t, (other as { t: string; id: string }).id));
}
