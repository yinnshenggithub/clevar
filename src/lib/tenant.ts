import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";

/**
 * Runs `fn` inside a transaction scoped to a single workspace.
 *
 * Before any query, it binds the `app.workspace_id` GUC (transaction-local, via
 * a parameterized `set_config(..., true)`), which every Row-Level Security
 * policy reads. Even if application code forgets a `where: { workspaceId }`
 * filter, Postgres physically cannot return another tenant's rows. The binding
 * is cleared automatically at COMMIT, so it is safe under connection pooling.
 */
export async function withTenant<T>(
  workspaceId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.workspace_id', ${workspaceId}, true)`;
    return fn(tx);
  });
}
