"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireAuth, canManageWorkspace } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { slugify } from "@/lib/utils";
import { FIELD_TYPES } from "@/lib/custom-objects";

export interface FormState {
  error?: string;
}

function keyFromLabel(label: string): string {
  return (
    slugify(label).replace(/-/g, "_").replace(/^[^a-z]+/, "") || `field_${Date.now().toString(36)}`
  );
}

// ── Object definitions ─────────────────────────────────────────────────────

const objectSchema = z.object({
  nameSingular: z.string().min(1, "Singular name required").max(60),
  namePlural: z.string().min(1, "Plural name required").max(60),
});

export async function createObjectDefinition(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireAuth();
  if (!canManageWorkspace(ctx.role)) return { error: "Only owners and admins can manage objects." };
  const parsed = objectSchema.safeParse({
    nameSingular: formData.get("nameSingular"),
    namePlural: formData.get("namePlural"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const slug = slugify(parsed.data.namePlural) || `object-${Date.now().toString(36)}`;
  try {
    await withTenant(ctx.workspaceId, (tx) =>
      tx.objectDefinition.create({
        data: {
          workspaceId: ctx.workspaceId,
          nameSingular: parsed.data.nameSingular,
          namePlural: parsed.data.namePlural,
          slug,
        },
      }),
    );
  } catch (e) {
    console.error("createObjectDefinition failed", e);
    return { error: "Could not create the object (name may already exist)." };
  }
  revalidatePath("/app/objects");
  redirect(`/app/objects/${slug}`);
}

export async function deleteObjectDefinition(id: string): Promise<void> {
  const ctx = await requireAuth();
  if (!canManageWorkspace(ctx.role)) return;
  await withTenant(ctx.workspaceId, (tx) => tx.objectDefinition.delete({ where: { id } }));
  revalidatePath("/app/objects");
  redirect("/app/objects");
}

// ── Fields ──────────────────────────────────────────────────────────────────

export async function addField(objectDefinitionId: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireAuth();
  if (!canManageWorkspace(ctx.role)) return { error: "Only owners and admins can manage fields." };

  const label = String(formData.get("label") ?? "").trim();
  const type = String(formData.get("type") ?? "");
  if (!label) return { error: "Field label is required." };
  if (!FIELD_TYPES.includes(type as never)) return { error: "Invalid field type." };

  let options: Record<string, unknown> = {};
  if (type === "select") {
    const choices = String(formData.get("choices") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (choices.length === 0) return { error: "Add at least one choice for a select field." };
    options = { choices };
  } else if (type === "relation") {
    const target = String(formData.get("relationTarget") ?? "").trim();
    if (!target) return { error: "Choose what this relation links to." };
    options = { target };
  }

  try {
    await withTenant(ctx.workspaceId, async (tx) => {
      const def = await tx.objectDefinition.findFirst({ where: { id: objectDefinitionId } });
      if (!def) throw new Error("OBJECT_NOT_FOUND");
      const count = await tx.customFieldDef.count({ where: { objectDefinitionId } });
      await tx.customFieldDef.create({
        data: {
          workspaceId: ctx.workspaceId,
          objectDefinitionId,
          key: keyFromLabel(label),
          label,
          type,
          options: options as Prisma.InputJsonValue,
          position: count,
        },
      });
      revalidatePath(`/app/objects/${def.slug}`);
    });
  } catch (e) {
    console.error("addField failed", e);
    return { error: "Could not add the field (key may already exist)." };
  }
  return {};
}

export async function deleteField(fieldId: string, slug: string): Promise<void> {
  const ctx = await requireAuth();
  if (!canManageWorkspace(ctx.role)) return;
  await withTenant(ctx.workspaceId, (tx) => tx.customFieldDef.deleteMany({ where: { id: fieldId } }));
  revalidatePath(`/app/objects/${slug}`);
}

// ── Records ───────────────────────────────────────────────────────────────

function readValues(
  fields: { key: string; type: string }[],
  formData: FormData,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.type === "relations") {
      values[f.key] = formData.getAll(f.key).map(String).filter(Boolean);
      continue;
    }
    const raw = formData.get(f.key);
    if (f.type === "boolean") {
      values[f.key] = raw === "on";
    } else if (f.type === "number") {
      const n = Number(raw);
      values[f.key] = raw === null || raw === "" || Number.isNaN(n) ? null : n;
    } else {
      const s = raw == null ? "" : String(raw).trim();
      values[f.key] = s || null;
    }
  }
  return values;
}

export async function createRecord(slug: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireAuth();
  try {
    await withTenant(ctx.workspaceId, async (tx) => {
      const def = await tx.objectDefinition.findFirst({ where: { slug }, include: { fields: true } });
      if (!def) throw new Error("OBJECT_NOT_FOUND");
      await tx.customRecord.create({
        data: {
          workspaceId: ctx.workspaceId,
          objectDefinitionId: def.id,
          values: readValues(def.fields, formData) as Prisma.InputJsonValue,
        },
      });
    });
  } catch (e) {
    console.error("createRecord failed", e);
    return { error: "Could not save the record." };
  }
  revalidatePath(`/app/o/${slug}`);
  redirect(`/app/o/${slug}`);
}

export async function updateRecord(slug: string, id: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireAuth();
  try {
    await withTenant(ctx.workspaceId, async (tx) => {
      const def = await tx.objectDefinition.findFirst({ where: { slug }, include: { fields: true } });
      if (!def) throw new Error("OBJECT_NOT_FOUND");
      await tx.customRecord.update({
        where: { id },
        data: { values: readValues(def.fields, formData) as Prisma.InputJsonValue },
      });
    });
  } catch (e) {
    console.error("updateRecord failed", e);
    return { error: "Could not update the record." };
  }
  revalidatePath(`/app/o/${slug}`);
  redirect(`/app/o/${slug}`);
}

export async function deleteRecord(slug: string, id: string): Promise<void> {
  const ctx = await requireAuth();
  await withTenant(ctx.workspaceId, (tx) => tx.customRecord.update({ where: { id }, data: { deletedAt: new Date() } }));
  revalidatePath(`/app/o/${slug}`);
  redirect(`/app/o/${slug}`);
}
