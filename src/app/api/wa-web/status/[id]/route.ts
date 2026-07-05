import { getAuthContext, canManageWorkspace } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { chatIdToPhone, getGatewayQr, getGatewaySession, waWebConfigured } from "@/lib/wa-web";

export const runtime = "nodejs";

/**
 * Poll endpoint for the connect wizard: live session status straight from the
 * gateway (webhooks lag a poll cycle), plus the current QR while pairing.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getAuthContext();
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 });
  // The QR in this response links a device to the workspace's WhatsApp account
  // — only roles that may manage channels can see it.
  if (!canManageWorkspace(ctx.role)) return Response.json({ error: "Forbidden" }, { status: 403 });

  const channel = await prisma.waWebChannel.findFirst({ where: { id, workspaceId: ctx.workspaceId } });
  if (!channel) return Response.json({ error: "Not found" }, { status: 404 });
  if (!waWebConfigured()) {
    return Response.json({ status: channel.status, qr: null, phoneNumber: channel.phoneNumber });
  }

  let status = channel.status;
  let phoneNumber = channel.phoneNumber;
  let qr: string | null = null;

  try {
    const live = await getGatewaySession(channel.sessionName);
    if (live) {
      status = live.status;
      if (live.status === "scan_qr") qr = await getGatewayQr(channel.sessionName);
      if (live.status === "working" && live.meId) phoneNumber = chatIdToPhone(live.meId) ?? phoneNumber;
      // Keep the row in sync so the channels page renders fresh state on reload.
      if (status !== channel.status || phoneNumber !== channel.phoneNumber) {
        await prisma.waWebChannel.update({
          where: { id: channel.id },
          data: { status, phoneNumber, lastSeenAt: new Date() },
        });
      }
    }
  } catch (e) {
    console.error("wa-web status poll failed", e);
  }

  return Response.json({ status, qr, phoneNumber });
}
