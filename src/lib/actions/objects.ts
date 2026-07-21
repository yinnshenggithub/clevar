"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireAuth, canManageWorkspace } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { cleanupAssociations } from "@/lib/associations";
import { camelKey } from "@/lib/utils";
import { FIELD_TYPES, isRelationType, hasChoices, supportsDefault } from "@/lib/custom-objects";
import { getObjectMeta, isCoreToken } from "@/lib/objects-registry";
import { readValues, missingRequired } from "@/lib/field-values";
import { renameFieldValues, cascadeObjectSlug } from "@/lib/object-rename";

/** Revalidate every page that renders an object's records/fields after a field change. */
function revalidateForToken(token: string): void {
  revalidatePath("/app/settings/fields");
  if (isCoreToken(token)) {
    const listPath: Record<string, string> = {
      contact: "/app/contacts",
      company: "/app/companies",
      deal: "/app/deals",
      task: "/app/tasks",
      note: "/app/contacts",
    };
    if (listPath[token]) revalidatePath(listPath[token]);
  } else {
    revalidatePath(`/app/objects/${token}`);
    revalidatePath(`/app/o/${token}`);
  }
}

export interface FormState {
  error?: string;
}

function keyFromLabel(label: string): string {
  return camelKey(label) || `field${Date.now().toString(36)}`;
}

const RESERVED_SLUGS = ["contact", "company", "deal", "task", "note"];

function slugFromName(nameSingular: string): string {
  return camelKey(nameSingular) || `object${Date.now().toString(36)}`;
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
  const slug = slugFromName(parsed.data.nameSingular);
  if (RESERVED_SLUGS.includes(slug)) {
    return { error: "That name is reserved. Choose another." };
  }
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

export async function updateObjectDefinition(id: string, formData: FormData): Promise<void> {
  const ctx = await requireAuth();
  if (!canManageWorkspace(ctx.role)) return;
  const nameSingular = String(formData.get("nameSingular") ?? "").trim();
  const namePlural = String(formData.get("namePlural") ?? "").trim();
  if (!nameSingular || !namePlural) return;
  let finalSlug = "";
  await withTenant(ctx.workspaceId, async (tx) => {
    const def = await tx.objectDefinition.findFirst({ where: { id } });
    if (!def) return;
    // Code (slug) follows the singular name; cascade the rename through every reference.
    const newSlug = slugFromName(nameSingular);
    finalSlug = def.slug;
    if (newSlug !== def.slug && !RESERVED_SLUGS.includes(newSlug)) {
      const clash = await tx.objectDefinition.findFirst({ where: { slug: newSlug, id: { not: id } }, select: { id: true } });
      if (!clash) {
        await cascadeObjectSlug(tx, def.slug, newSlug);
        finalSlug = newSlug;
      }
    }
    await tx.objectDefinition.update({ where: { id }, data: { nameSingular, namePlural } });
  });
  revalidatePath("/app/objects");
  revalidatePath("/app/settings/properties/all");
  if (finalSlug) revalidatePath(`/app/objects/${finalSlug}`);
}

/**
 * One-shot: bring every object slug and custom-field key in the workspace into
 * the canonical camelCase / singular scheme, cascading references and migrating
 * stored record values. Idempotent — already-canonical identifiers are skipped.
 */
export async function normalizeIdentifiers(): Promise<void> {
  const ctx = await requireAuth();
  if (!canManageWorkspace(ctx.role)) return;
  await withTenant(ctx.workspaceId, async (tx) => {
    // Objects first: slug ← camelKey(nameSingular), cascaded through references.
    const defs = await tx.objectDefinition.findMany();
    for (const def of defs) {
      const newSlug = slugFromName(def.nameSingular);
      if (newSlug === def.slug || RESERVED_SLUGS.includes(newSlug)) continue;
      const clash = await tx.objectDefinition.findFirst({ where: { slug: newSlug, id: { not: def.id } }, select: { id: true } });
      if (clash) continue;
      await cascadeObjectSlug(tx, def.slug, newSlug);
    }
    // Then fields (reloaded — object_type may have just changed): key ← camelKey(label).
    const fields = await tx.customFieldDef.findMany();
    for (const f of fields) {
      const newKey = keyFromLabel(f.label);
      if (newKey === f.key) continue;
      const meta = await getObjectMeta(tx, f.objectType);
      if (meta?.reservedKeys.includes(newKey)) continue;
      const clash = await tx.customFieldDef.findFirst({
        where: { objectType: f.objectType, key: newKey, id: { not: f.id } },
        select: { id: true },
      });
      if (clash) continue;
      await renameFieldValues(tx, f.objectType, f.objectDefinitionId, f.key, newKey);
      await tx.customFieldDef.update({ where: { id: f.id }, data: { key: newKey } });
    }
  });
  revalidatePath("/app/settings/properties/all");
  revalidatePath("/app/objects");
}

export async function deleteObjectDefinition(id: string): Promise<void> {
  const ctx = await requireAuth();
  if (!canManageWorkspace(ctx.role)) return;
  await withTenant(ctx.workspaceId, async (tx) => {
    const def = await tx.objectDefinition.findFirst({ where: { id }, select: { slug: true } });
    if (def) {
      await tx.recordAssociation.deleteMany({ where: { OR: [{ fromType: def.slug }, { toType: def.slug }] } });
      await tx.associationType.deleteMany({ where: { OR: [{ fromObject: def.slug }, { toObject: def.slug }] } });
    }
    await tx.objectDefinition.delete({ where: { id } });
  });
  revalidatePath("/app/objects");
  redirect("/app/objects");
}

// ── Fields ──────────────────────────────────────────────────────────────────

/** Parse the field-type-specific `options` block (choices / relation target) from a form. */
function readFieldOptions(
  type: string,
  formData: FormData,
): { options: Record<string, unknown> } | { error: string } {
  if (hasChoices(type)) {
    const choices = String(formData.get("choices") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (choices.length === 0) return { error: "Add at least one choice for this field." };
    return { options: { choices } };
  }
  if (isRelationType(type)) {
    const target = String(formData.get("relationTarget") ?? "").trim();
    if (!target) return { error: "Choose what this relation links to." };
    return { options: { target } };
  }
  return { options: {} };
}

export async function addField(token: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireAuth();
  if (!canManageWorkspace(ctx.role)) return { error: "Only owners and admins can manage fields." };

  const label = String(formData.get("label") ?? "").trim();
  const type = String(formData.get("type") ?? "");
  const required = formData.get("required") === "on";
  const defaultValue = String(formData.get("defaultValue") ?? "").trim() || null;
  if (!label) return { error: "Field label is required." };
  if (!FIELD_TYPES.includes(type as never)) return { error: "Invalid field type." };

  const options = readFieldOptions(type, formData);
  if ("error" in options) return { error: options.error };

  try {
    await withTenant(ctx.workspaceId, async (tx) => {
      const meta = await getObjectMeta(tx, token);
      if (!meta) throw new Error("OBJECT_NOT_FOUND");
      const key = keyFromLabel(label);
      if (meta.reservedKeys.includes(key)) throw new Error("RESERVED_KEY");
      const count = await tx.customFieldDef.count({ where: { objectType: token } });
      await tx.customFieldDef.create({
        data: {
          workspaceId: ctx.workspaceId,
          objectType: token,
          objectDefinitionId: meta.objectDefinitionId ?? null,
          key,
          label,
          type,
          required: isRelationType(type) ? false : required,
          defaultValue: supportsDefault(type) ? defaultValue : null,
          options: options.options as Prisma.InputJsonValue,
          position: count,
        },
      });
    });
  } catch (e) {
    if (e instanceof Error && e.message === "RESERVED_KEY") {
      return { error: "That field name clashes with a built-in field. Pick another label." };
    }
    console.error("addField failed", e);
    return { error: "Could not add the field (a field with that name may already exist)." };
  }
  revalidateForToken(token);
  return {};
}

export async function updateField(fieldId: string, token: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireAuth();
  if (!canManageWorkspace(ctx.role)) return { error: "Only owners and admins can manage fields." };

  const label = String(formData.get("label") ?? "").trim();
  const required = formData.get("required") === "on";
  const defaultValue = String(formData.get("defaultValue") ?? "").trim() || null;
  if (!label) return { error: "Field label is required." };

  try {
    await withTenant(ctx.workspaceId, async (tx) => {
      const field = await tx.customFieldDef.findFirst({ where: { id: fieldId } });
      if (!field) throw new Error("FIELD_NOT_FOUND");
      // Type is immutable post-creation (avoids value migration); re-read options for that type.
      const options = readFieldOptions(field.type, formData);
      if ("error" in options) throw new Error(`OPT:${options.error}`);

      // Code (key) follows the label; if it changes, migrate stored values first.
      const meta = await getObjectMeta(tx, field.objectType);
      const newKey = keyFromLabel(label);
      let key = field.key;
      if (newKey !== field.key) {
        if (meta?.reservedKeys.includes(newKey)) throw new Error("RESERVED_KEY");
        const clash = await tx.customFieldDef.findFirst({
          where: { objectType: field.objectType, key: newKey, id: { not: fieldId } },
          select: { id: true },
        });
        if (clash) throw new Error("DUPLICATE_KEY");
        await renameFieldValues(tx, field.objectType, field.objectDefinitionId, field.key, newKey);
        key = newKey;
      }

      await tx.customFieldDef.update({
        where: { id: fieldId },
        data: {
          key,
          label,
          required: isRelationType(field.type) ? false : required,
          defaultValue: supportsDefault(field.type) ? defaultValue : null,
          options: options.options as Prisma.InputJsonValue,
        },
      });
    });
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("OPT:")) return { error: e.message.slice(4) };
    if (e instanceof Error && e.message === "RESERVED_KEY") return { error: "That name clashes with a built-in field. Pick another." };
    if (e instanceof Error && e.message === "DUPLICATE_KEY") return { error: "Another property on this object already uses that name." };
    console.error("updateField failed", e);
    return { error: "Could not update the field." };
  }
  revalidateForToken(token);
  revalidatePath("/app/settings/properties/all");
  return {};
}

export async function deleteField(fieldId: string, token: string): Promise<void> {
  const ctx = await requireAuth();
  if (!canManageWorkspace(ctx.role)) return;
  await withTenant(ctx.workspaceId, (tx) => tx.customFieldDef.deleteMany({ where: { id: fieldId } }));
  revalidateForToken(token);
}

export async function reorderField(fieldId: string, token: string, direction: "up" | "down"): Promise<void> {
  const ctx = await requireAuth();
  if (!canManageWorkspace(ctx.role)) return;
  await withTenant(ctx.workspaceId, async (tx) => {
    const fields = await tx.customFieldDef.findMany({ where: { objectType: token }, orderBy: { position: "asc" } });
    const i = fields.findIndex((f) => f.id === fieldId);
    if (i === -1) return;
    const j = direction === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= fields.length) return;
    // Swap positions of the two neighbours.
    await tx.customFieldDef.update({ where: { id: fields[i].id }, data: { position: fields[j].position } });
    await tx.customFieldDef.update({ where: { id: fields[j].id }, data: { position: fields[i].position } });
  });
  revalidateForToken(token);
}

// ── Records ───────────────────────────────────────────────────────────────

export async function createRecord(slug: string, _prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireAuth();
  try {
    await withTenant(ctx.workspaceId, async (tx) => {
      const def = await tx.objectDefinition.findFirst({ where: { slug }, include: { fields: true } });
      if (!def) throw new Error("OBJECT_NOT_FOUND");
      const values = readValues(def.fields, formData, true);
      const missing = missingRequired(def.fields, values);
      if (missing.length > 0) throw new Error(`REQUIRED:${missing.join(", ")}`);
      await tx.customRecord.create({
        data: {
          workspaceId: ctx.workspaceId,
          objectDefinitionId: def.id,
          values: values as Prisma.InputJsonValue,
          createdById: ctx.userId,
          updatedById: ctx.userId,
        },
      });
    });
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("REQUIRED:")) {
      return { error: `Please fill in: ${e.message.slice("REQUIRED:".length)}` };
    }
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
      const values = readValues(def.fields, formData, false);
      const missing = missingRequired(def.fields, values);
      if (missing.length > 0) throw new Error(`REQUIRED:${missing.join(", ")}`);
      await tx.customRecord.update({
        where: { id },
        data: { values: values as Prisma.InputJsonValue, updatedById: ctx.userId },
      });
    });
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("REQUIRED:")) {
      return { error: `Please fill in: ${e.message.slice("REQUIRED:".length)}` };
    }
    console.error("updateRecord failed", e);
    return { error: "Could not update the record." };
  }
  revalidatePath(`/app/o/${slug}`);
  redirect(`/app/o/${slug}`);
}

export async function deleteRecord(slug: string, id: string): Promise<void> {
  const ctx = await requireAuth();
  await withTenant(ctx.workspaceId, async (tx) => {
    await tx.customRecord.update({ where: { id }, data: { deletedAt: new Date() } });
    await cleanupAssociations(tx, slug, id);
  });
  revalidatePath(`/app/o/${slug}`);
  redirect(`/app/o/${slug}`);
}
