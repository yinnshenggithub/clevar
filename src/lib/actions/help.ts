"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAuth, canManageWorkspace } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { slugify } from "@/lib/utils";

export interface HelpState {
  error?: string;
  ok?: boolean;
}

async function uniqueSlug(workspaceId: string, base: string, table: "article" | "articleCategory", ignoreId?: string): Promise<string> {
  const root = slugify(base) || "item";
  let slug = root;
  let n = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const found =
      table === "article"
        ? await prisma.article.findFirst({ where: { workspaceId, slug, NOT: ignoreId ? { id: ignoreId } : undefined } })
        : await prisma.articleCategory.findFirst({ where: { workspaceId, slug, NOT: ignoreId ? { id: ignoreId } : undefined } });
    if (!found) return slug;
    slug = `${root}-${++n}`;
  }
}

export async function createCategory(_prev: HelpState, formData: FormData): Promise<HelpState> {
  const ctx = await requireAuth();
  if (!canManageWorkspace(ctx.role)) return { error: "Only owners and admins can edit the help center." };
  const name = String(formData.get("name") ?? "").trim().slice(0, 80);
  if (!name) return { error: "Category name is required." };
  const slug = await uniqueSlug(ctx.workspaceId, name, "articleCategory");
  await prisma.articleCategory.create({ data: { workspaceId: ctx.workspaceId, name, slug } });
  revalidatePath("/app/help");
  return { ok: true };
}

export async function deleteCategory(id: string): Promise<void> {
  const ctx = await requireAuth();
  if (!canManageWorkspace(ctx.role)) return;
  await prisma.articleCategory.deleteMany({ where: { id, workspaceId: ctx.workspaceId } });
  revalidatePath("/app/help");
}

const articleSchema = z.object({
  title: z.string().min(1, "Title is required").max(200),
  body: z.string().min(1, "Write some content").max(50000),
  categoryId: z.string().uuid().optional().or(z.literal("")),
  published: z.boolean(),
});

export async function createArticle(_prev: HelpState, formData: FormData): Promise<HelpState> {
  const ctx = await requireAuth();
  if (!canManageWorkspace(ctx.role)) return { error: "Only owners and admins can edit the help center." };
  const parsed = articleSchema.safeParse({
    title: formData.get("title"),
    body: formData.get("body"),
    categoryId: formData.get("categoryId") || "",
    published: formData.get("published") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  const slug = await uniqueSlug(ctx.workspaceId, parsed.data.title, "article");
  const a = await prisma.article.create({
    data: {
      workspaceId: ctx.workspaceId,
      title: parsed.data.title,
      body: parsed.data.body,
      categoryId: parsed.data.categoryId || null,
      published: parsed.data.published,
      slug,
    },
  });
  revalidatePath("/app/help");
  redirect(`/app/help/${a.id}`);
}

export async function updateArticle(id: string, _prev: HelpState, formData: FormData): Promise<HelpState> {
  const ctx = await requireAuth();
  if (!canManageWorkspace(ctx.role)) return { error: "Only owners and admins can edit the help center." };
  const parsed = articleSchema.safeParse({
    title: formData.get("title"),
    body: formData.get("body"),
    categoryId: formData.get("categoryId") || "",
    published: formData.get("published") === "on",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  await prisma.article.updateMany({
    where: { id, workspaceId: ctx.workspaceId },
    data: {
      title: parsed.data.title,
      body: parsed.data.body,
      categoryId: parsed.data.categoryId || null,
      published: parsed.data.published,
    },
  });
  revalidatePath("/app/help");
  revalidatePath(`/app/help/${id}`);
  return { ok: true };
}

export async function deleteArticle(id: string): Promise<void> {
  const ctx = await requireAuth();
  if (!canManageWorkspace(ctx.role)) return;
  await prisma.article.deleteMany({ where: { id, workspaceId: ctx.workspaceId } });
  revalidatePath("/app/help");
  redirect("/app/help");
}

export async function togglePublish(id: string): Promise<void> {
  const ctx = await requireAuth();
  if (!canManageWorkspace(ctx.role)) return;
  const a = await prisma.article.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
  if (!a) return;
  await prisma.article.update({ where: { id }, data: { published: !a.published } });
  revalidatePath("/app/help");
}
