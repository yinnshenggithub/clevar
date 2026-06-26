import "server-only";
import { withTenant } from "./tenant";

const PERIOD_MS = 30 * 24 * 60 * 60 * 1000; // 30-day billing period

export interface CreditStatus {
  used: number;
  limit: number;
  remaining: number;
}

/** Reads (and lazily creates / monthly-resets) a workspace's credit balance. */
export async function getCredits(workspaceId: string): Promise<CreditStatus> {
  return withTenant(workspaceId, async (tx) => {
    let c = await tx.workspaceCredits.findUnique({ where: { workspaceId } });
    if (!c) {
      c = await tx.workspaceCredits.create({ data: { workspaceId } });
    } else if (Date.now() - c.periodStart.getTime() > PERIOD_MS) {
      c = await tx.workspaceCredits.update({
        where: { workspaceId },
        data: { used: 0, periodStart: new Date() },
      });
    }
    return { used: c.used, limit: c.monthlyLimit, remaining: Math.max(0, c.monthlyLimit - c.used) };
  });
}

/** 1 credit per 1,000 tokens (in + out), minimum 1 per reply. */
export function creditsForTokens(totalTokens: number): number {
  return Math.max(1, Math.ceil((totalTokens || 0) / 1000));
}

export async function debitCredits(
  workspaceId: string,
  credits: number,
  meta: { agentId?: string; conversationId?: string; tokensIn?: number; tokensOut?: number },
): Promise<void> {
  await withTenant(workspaceId, async (tx) => {
    await tx.workspaceCredits.update({
      where: { workspaceId },
      data: { used: { increment: credits } },
    });
    await tx.aiUsage.create({
      data: {
        workspaceId,
        agentId: meta.agentId ?? null,
        conversationId: meta.conversationId ?? null,
        credits,
        tokensIn: meta.tokensIn ?? 0,
        tokensOut: meta.tokensOut ?? 0,
      },
    });
  });
}
