"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { requireAuth } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { cleanupAssociations } from "@/lib/associations";
import { listFields } from "@/lib/objects-registry";
import { readValues, missingRequired } from "@/lib/field-values";
import { logEventTx } from "@/lib/activity";
import { dispatchWebhooks } from "@/lib/webhooks";
import { runWorkflows } from "@/lib/workflow";
import { normalizePhone, InvalidPhoneError } from "@/lib/phone";

export interface FormState {
  error?: string;
}

const contactSchema = z.object({
  firstName: z.string().max(120).optional(),
  lastName: z.string().max(120).optional(),
  email: z.string().email("Enter a valid email").optional().or(z.literal("")),
  phone: z.string().max(40).optional(),
  phoneRegion: z.string().max(2).optional(),
  jobTitle: z.string().max(160).optional(),
  companyId: z.string().uuid().optional().or(z.literal("")),
  newCompanyName: z.string().max(160).optional(),
});

function readContact(formData: FormData) {
  return contactSchema.safeParse({
    firstName: formData.get("firstName") || undefined,
    lastName: formData.get("lastName") || undefined,
    email: formData.get("email") || "",
    phone: formData.get("phone") || undefined,
    phoneRegion: formData.get("phoneRegion") || undefined,
    jobTitle: formData.get("jobTitle") || undefined,
    companyId: formData.get("companyId") || "",
    newCompanyName: formData.get("newCompanyName") || undefined,
  });
}

type Tx = Parameters<Parameters<typeof withTenant>[1]>[0];

/** Resolves the contact's company: create a new one by name, or validate the picked id. */
async function resolveCompany(
  tx: Tx,
  workspaceId: string,
  v: { companyId?: string; newCompanyName?: string },
): Promise<string | null> {
  const name = v.newCompanyName?.trim();
  if (name) {
    const existing = await tx.company.findFirst({
      where: { name: { equals: name, mode: "insensitive" }, deletedAt: null },
    });
    if (existing) return existing.id;
    const created = await tx.company.create({ data: { workspaceId, name } });
    return created.id;
  }
  if (v.companyId) {
    const c = await tx.company.findFirst({ where: { id: v.companyId, deletedAt: null } });
    if (!c) throw new Error("COMPANY_NOT_FOUND");
    return v.companyId;
  }
  return null;
}

export async function createContact(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireAuth();
  const parsed = readContact(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const v = parsed.data;

  let phone: string | null;
  try {
    phone = normalizePhone(v.phone, v.phoneRegion);
  } catch (e) {
    if (e instanceof InvalidPhoneError) return { error: "Enter a valid phone number for the selected country." };
    throw e;
  }

  if (!v.firstName && !v.lastName && !v.email) {
    return { error: "Provide at least a name or an email." };
  }

  try {
    const created = await withTenant(ctx.workspaceId, async (tx) => {
      const companyId = await resolveCompany(tx, ctx.workspaceId, v);
      const fieldDefs = await listFields(tx, "contact");
      const customFields = readValues(fieldDefs, formData, true);
      const missing = missingRequired(fieldDefs, customFields);
      if (missing.length > 0) throw new Error(`REQUIRED:${missing.join(", ")}`);
      const c = await tx.contact.create({
        data: {
          workspaceId: ctx.workspaceId,
          firstName: v.firstName || null,
          lastName: v.lastName || null,
          email: v.email || null,
          phone,
          jobTitle: v.jobTitle || null,
          companyId,
          customFields: customFields as Prisma.InputJsonValue,
          createdById: ctx.userId,
          updatedById: ctx.userId,
        },
      });
      await logEventTx(tx, ctx.workspaceId, "CONTACT", c.id, "created", "Contact created", ctx.userId);
      return c;
    });
    after(() =>
      runWorkflows(ctx.workspaceId, "contact_created", {
        contactId: created.id,
        recordName: [v.firstName, v.lastName].filter(Boolean).join(" ") || v.email || "",
      }).catch((e) => console.error("contact_created workflow failed", e)),
    );
    after(() =>
      dispatchWebhooks(ctx.workspaceId, "contact.created", {
        id: created.id,
        firstName: v.firstName || null,
        lastName: v.lastName || null,
        email: v.email || null,
      }),
    );
  } catch (e) {
    if (e instanceof Error && e.message === "COMPANY_NOT_FOUND") {
      return { error: "Selected company was not found." };
    }
    if (e instanceof Error && e.message.startsWith("REQUIRED:")) {
      return { error: `Please fill in: ${e.message.slice("REQUIRED:".length)}` };
    }
    console.error("createContact failed", e);
    return { error: "Could not save the contact." };
  }

  revalidatePath("/app/contacts");
  redirect("/app/contacts");
}

export async function updateContact(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const ctx = await requireAuth();
  const parsed = readContact(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const v = parsed.data;

  let phone: string | null;
  try {
    phone = normalizePhone(v.phone, v.phoneRegion);
  } catch (e) {
    if (e instanceof InvalidPhoneError) return { error: "Enter a valid phone number for the selected country." };
    throw e;
  }

  let changedFields: string[] = [];
  try {
    changedFields = await withTenant(ctx.workspaceId, async (tx) => {
      const companyId = await resolveCompany(tx, ctx.workspaceId, v);
      const existing = await tx.contact.findFirst({
        where: { id },
        select: { customFields: true, firstName: true, lastName: true, email: true, phone: true, jobTitle: true, companyId: true },
      });
      const fieldDefs = await listFields(tx, "contact");
      const cf = readValues(fieldDefs, formData, false);
      const missing = missingRequired(fieldDefs, cf);
      if (missing.length > 0) throw new Error(`REQUIRED:${missing.join(", ")}`);
      const merged = { ...((existing?.customFields as Record<string, unknown>) ?? {}), ...cf };
      const next = { firstName: v.firstName || null, lastName: v.lastName || null, email: v.email || null, phone, jobTitle: v.jobTitle || null, companyId };
      const changed = (["firstName", "lastName", "email", "phone", "jobTitle", "companyId"] as const).filter(
        (k) => (existing?.[k] ?? null) !== next[k],
      );
      await tx.contact.update({
        where: { id },
        data: { ...next, customFields: merged as Prisma.InputJsonValue, updatedById: ctx.userId },
      });
      return [...changed, ...Object.keys(cf)];
    });
    after(() =>
      runWorkflows(ctx.workspaceId, "contact_updated", {
        contactId: id,
        recordName: [v.firstName, v.lastName].filter(Boolean).join(" ") || v.email || "",
        changedFields,
        actorId: ctx.userId,
      }).catch((e) => console.error("contact_updated workflow failed", e)),
    );
  } catch (e) {
    if (e instanceof Error && e.message === "COMPANY_NOT_FOUND") {
      return { error: "Selected company was not found." };
    }
    if (e instanceof Error && e.message.startsWith("REQUIRED:")) {
      return { error: `Please fill in: ${e.message.slice("REQUIRED:".length)}` };
    }
    console.error("updateContact failed", e);
    return { error: "Could not update the contact." };
  }

  revalidatePath("/app/contacts");
  revalidatePath(`/app/contacts/${id}`);
  redirect(`/app/contacts/${id}`);
}

export async function bulkDeleteContacts(ids: string[]): Promise<void> {
  const ctx = await requireAuth();
  const clean = ids.filter(Boolean).slice(0, 500);
  if (clean.length === 0) return;
  await withTenant(ctx.workspaceId, (tx) =>
    tx.contact.updateMany({ where: { id: { in: clean } }, data: { deletedAt: new Date() } }),
  );
  after(() =>
    Promise.all(clean.map((id) => runWorkflows(ctx.workspaceId, "contact_deleted", { contactId: id, actorId: ctx.userId }))).catch(
      (e) => console.error("contact_deleted workflow failed", e),
    ),
  );
  revalidatePath("/app/contacts");
}

export async function deleteContact(id: string): Promise<void> {
  const ctx = await requireAuth();
  await withTenant(ctx.workspaceId, async (tx) => {
    await tx.contact.update({ where: { id }, data: { deletedAt: new Date() } });
    await cleanupAssociations(tx, "contact", id);
  });
  after(() =>
    runWorkflows(ctx.workspaceId, "contact_deleted", { contactId: id, actorId: ctx.userId }).catch((e) =>
      console.error("contact_deleted workflow failed", e),
    ),
  );
  revalidatePath("/app/contacts");
  redirect("/app/contacts");
}

/** Link (or change) a contact's company from the record's aside panel. */
export async function linkContactCompany(contactId: string, formData: FormData): Promise<void> {
  const ctx = await requireAuth();
  const companyId = String(formData.get("targetId") ?? "").trim();
  if (!companyId) return;
  await withTenant(ctx.workspaceId, async (tx) => {
    const company = await tx.company.findFirst({ where: { id: companyId, deletedAt: null }, select: { id: true } });
    if (!company) return;
    await tx.contact.update({ where: { id: contactId }, data: { companyId, updatedById: ctx.userId } });
  });
  after(() =>
    runWorkflows(ctx.workspaceId, "contact_updated", { contactId, changedFields: ["companyId"], actorId: ctx.userId }).catch((e) =>
      console.error("contact_updated workflow failed", e),
    ),
  );
  revalidatePath(`/app/contacts/${contactId}`);
}

/** Link an existing deal to a contact (DealContact join) from the record's aside panel. */
export async function linkContactDeal(contactId: string, formData: FormData): Promise<void> {
  const ctx = await requireAuth();
  const dealId = String(formData.get("targetId") ?? "").trim();
  if (!dealId) return;
  await withTenant(ctx.workspaceId, async (tx) => {
    const deal = await tx.deal.findFirst({ where: { id: dealId, deletedAt: null }, select: { id: true } });
    if (!deal) return;
    await tx.dealContact.createMany({
      data: [{ workspaceId: ctx.workspaceId, dealId, contactId }],
      skipDuplicates: true,
    });
  });
  revalidatePath(`/app/contacts/${contactId}`);
}
