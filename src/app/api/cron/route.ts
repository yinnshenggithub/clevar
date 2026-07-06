import { NextResponse } from "next/server";
import { resumeDueRuns, runScheduledTriggers } from "@/lib/workflow";
import { knowledgeMaintenance } from "@/lib/knowledge-ingest";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Workflow scheduler tick. Resumes any due Wait/Drip runs and fires
 * schedule-driven triggers (scheduled / deal_stale / task_reminder).
 *
 * Auth: requires CRON_SECRET to be set. Vercel Cron automatically sends
 * `Authorization: Bearer <CRON_SECRET>`; an external pinger can pass
 * `?secret=<CRON_SECRET>`. Inert (503) until the secret is configured.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET not configured" }, { status: 503 });
  }
  const url = new URL(req.url);
  const auth = req.headers.get("authorization") ?? "";
  const provided = url.searchParams.get("secret") || (auth.startsWith("Bearer ") ? auth.slice(7) : "");
  if (provided !== secret) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const [resumed, scheduled, embedded] = await Promise.all([
    resumeDueRuns(now).catch((e) => {
      console.error("resumeDueRuns failed", e);
      return { resumed: 0 };
    }),
    runScheduledTriggers(now).catch((e) => {
      console.error("runScheduledTriggers failed", e);
      return { fired: 0 };
    }),
    knowledgeMaintenance().catch((e) => {
      console.error("knowledgeMaintenance failed", e);
      return { resumed: 0, recrawled: 0, enrichedSources: 0 };
    }),
  ]);
  return NextResponse.json({ ok: true, ...resumed, ...scheduled, ...embedded, at: now.toISOString() });
}
