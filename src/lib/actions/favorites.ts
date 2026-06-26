"use server";

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";

/** Toggle a favorite for the current user. Returns the new state. */
export async function toggleFavorite(
  entityType: string,
  entityId: string,
  label: string,
  href: string,
): Promise<void> {
  const ctx = await requireAuth();
  await withTenant(ctx.workspaceId, async (tx) => {
    const existing = await tx.favorite.findFirst({ where: { userId: ctx.userId, entityType, entityId } });
    if (existing) {
      await tx.favorite.delete({ where: { id: existing.id } });
    } else {
      await tx.favorite.create({
        data: { workspaceId: ctx.workspaceId, userId: ctx.userId, entityType, entityId, label: label.slice(0, 120), href },
      });
    }
  });
  revalidatePath("/app", "layout");
}
