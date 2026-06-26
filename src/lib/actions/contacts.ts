"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
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
  });
}

async function assertCompanyInWorkspace(
  tx: Parameters<Parameters<typeof withTenant>[1]>[0],
  companyId: string,
): Promise<boolean> {
  const c = await tx.company.findFirst({ where: { id: companyId, deletedAt: null } });
  return Boolean(c);
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
      if (v.companyId && !(await assertCompanyInWorkspace(tx, v.companyId))) {
        throw new Error("COMPANY_NOT_FOUND");
      }
      return tx.contact.create({
        data: {
          workspaceId: ctx.workspaceId,
          firstName: v.firstName || null,
          lastName: v.lastName || null,
          email: v.email || null,
          phone,
          jobTitle: v.jobTitle || null,
          companyId: v.companyId || null,
        },
      });
    });
    after(() =>
      runWorkflows(ctx.workspaceId, "contact_created", {
        contactId: created.id,
        recordName: [v.firstName, v.lastName].filter(Boolean).join(" ") || v.email || "",
      }).catch((e) => console.error("contact_created workflow failed", e)),
    );
  } catch (e) {
    if (e instanceof Error && e.message === "COMPANY_NOT_FOUND") {
      return { error: "Selected company was not found." };
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

  try {
    await withTenant(ctx.workspaceId, async (tx) => {
      if (v.companyId && !(await assertCompanyInWorkspace(tx, v.companyId))) {
        throw new Error("COMPANY_NOT_FOUND");
      }
      await tx.contact.update({
        where: { id },
        data: {
          firstName: v.firstName || null,
          lastName: v.lastName || null,
          email: v.email || null,
          phone,
          jobTitle: v.jobTitle || null,
          companyId: v.companyId || null,
        },
      });
    });
  } catch (e) {
    if (e instanceof Error && e.message === "COMPANY_NOT_FOUND") {
      return { error: "Selected company was not found." };
    }
    console.error("updateContact failed", e);
    return { error: "Could not update the contact." };
  }

  revalidatePath("/app/contacts");
  revalidatePath(`/app/contacts/${id}`);
  redirect(`/app/contacts/${id}`);
}

export async function deleteContact(id: string): Promise<void> {
  const ctx = await requireAuth();
  await withTenant(ctx.workspaceId, async (tx) => {
    await tx.contact.update({ where: { id }, data: { deletedAt: new Date() } });
  });
  revalidatePath("/app/contacts");
  redirect("/app/contacts");
}
