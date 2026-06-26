import "server-only";
import type { ObjectType } from "@prisma/client";
import type { withTenant } from "./tenant";

type Tx = Parameters<Parameters<typeof withTenant>[1]>[0];

/**
 * Appends an activity event for a record, inside an existing tenant transaction.
 * Use this within a withTenant() block so the event shares the caller's RLS context.
 */
export async function logEventTx(
  tx: Tx,
  workspaceId: string,
  parentType: ObjectType,
  parentId: string,
  type: string,
  summary: string,
  actorId?: string | null,
): Promise<void> {
  await tx.activityEvent.create({
    data: { workspaceId, parentType, parentId, type, summary, actorId: actorId ?? null },
  });
}
