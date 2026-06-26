import "server-only";
import { createHmac } from "crypto";
import { prisma } from "./prisma";

export const WEBHOOK_EVENTS = [
  "contact.created",
  "company.created",
  "deal.created",
  "deal.stage_changed",
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

async function deliver(url: string, secret: string, event: string, payload: string): Promise<void> {
  try {
    const sig = createHmac("sha256", secret).update(payload).digest("hex");
    await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-clevar-event": event,
        "x-clevar-signature": `sha256=${sig}`,
      },
      body: payload,
      signal: AbortSignal.timeout(5000),
    });
  } catch (e) {
    console.error("webhook delivery failed", url, e);
  }
}

/** Best-effort fan-out of an event to every enabled webhook subscribed to it. */
export async function dispatchWebhooks(
  workspaceId: string,
  event: WebhookEvent,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    const hooks = await prisma.webhook.findMany({
      where: { workspaceId, enabled: true, events: { has: event } },
    });
    if (hooks.length === 0) return;
    const payload = JSON.stringify({ event, data, at: new Date().toISOString() });
    await Promise.all(hooks.map((h) => deliver(h.url, h.secret, event, payload)));
  } catch (e) {
    console.error("dispatchWebhooks failed", e);
  }
}
