"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { cleanupAssociations } from "@/lib/associations";
import { logEventTx } from "@/lib/activity";
import { dispatchWebhooks } from "@/lib/webhooks";

export interface FormState {
  error?: string;
}

const companySchema = z.object({
  name: z.string().min(1, "Company name is required").max(160),
  domain: z.string().max(160).optional(),
  industry: z.string().max(120).optional(),
});

function readCompany(formData: FormData) {
  return companySchema.safeParse({
    name: formData.get("name"),
    domain: formData.get("domain") || undefined,
    industry: formData.get("industry") || undefined,
  });
}

export async function createCompany(_prev: FormState, formData: FormData): Promise<FormState> {
  const ctx = await requireAuth();
  const parsed = readCompany(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const v = parsed.data;

  try {
    const created = await withTenant(ctx.workspaceId, async (tx) => {
      const c = await tx.company.create({
        data: {
          workspaceId: ctx.workspaceId,
          name: v.name,
          domain: v.domain || null,
          industry: v.industry || null,
          createdById: ctx.userId,
          updatedById: ctx.userId,
        },
      });
      await logEventTx(tx, ctx.workspaceId, "COMPANY", c.id, "created", "Company created", ctx.userId);
      return c;
    });
    after(() => dispatchWebhooks(ctx.workspaceId, "company.created", { id: created.id, name: v.name }));
  } catch (e) {
    console.error("createCompany failed", e);
    return { error: "Could not save the company." };
  }

  revalidatePath("/app/companies");
  redirect("/app/companies");
}

export async function updateCompany(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const ctx = await requireAuth();
  const parsed = readCompany(formData);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const v = parsed.data;

  try {
    await withTenant(ctx.workspaceId, async (tx) => {
      await tx.company.update({
        where: { id },
        data: { name: v.name, domain: v.domain || null, industry: v.industry || null, updatedById: ctx.userId },
      });
    });
  } catch (e) {
    console.error("updateCompany failed", e);
    return { error: "Could not update the company." };
  }

  revalidatePath("/app/companies");
  revalidatePath(`/app/companies/${id}`);
  redirect(`/app/companies/${id}`);
}

export async function bulkDeleteCompanies(ids: string[]): Promise<void> {
  const ctx = await requireAuth();
  const clean = ids.filter(Boolean).slice(0, 500);
  if (clean.length === 0) return;
  await withTenant(ctx.workspaceId, (tx) =>
    tx.company.updateMany({ where: { id: { in: clean } }, data: { deletedAt: new Date() } }),
  );
  revalidatePath("/app/companies");
}

export async function deleteCompany(id: string): Promise<void> {
  const ctx = await requireAuth();
  await withTenant(ctx.workspaceId, async (tx) => {
    await tx.company.update({ where: { id }, data: { deletedAt: new Date() } });
    await cleanupAssociations(tx, "company", id);
  });
  revalidatePath("/app/companies");
  redirect("/app/companies");
}

/** Associate an existing contact with this company (sets contact.companyId). */
export async function addContactToCompany(companyId: string, formData: FormData): Promise<void> {
  const ctx = await requireAuth();
  const contactId = String(formData.get("contactId") ?? "");
  if (!contactId) return;
  await withTenant(ctx.workspaceId, (tx) =>
    tx.contact.updateMany({ where: { id: contactId, deletedAt: null }, data: { companyId } }),
  );
  revalidatePath(`/app/companies/${companyId}`);
}

export async function removeContactFromCompany(companyId: string, contactId: string): Promise<void> {
  const ctx = await requireAuth();
  await withTenant(ctx.workspaceId, (tx) =>
    tx.contact.updateMany({ where: { id: contactId, companyId }, data: { companyId: null } }),
  );
  revalidatePath(`/app/companies/${companyId}`);
}
