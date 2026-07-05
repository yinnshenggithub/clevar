import { getAuthContext } from "@/lib/auth";
import { withTenant } from "@/lib/tenant";
import { prisma } from "@/lib/prisma";
import { fetchGatewayMedia, WA_WEB_MEDIA_PREFIX } from "@/lib/wa-web";

export const runtime = "nodejs";

const GRAPH = "https://graph.facebook.com/v21.0";

export async function GET(req: Request, { params }: { params: Promise<{ mediaId: string }> }) {
  const { mediaId: rawId } = await params;
  const mediaId = decodeURIComponent(rawId);
  const ctx = await getAuthContext();
  if (!ctx) return new Response("Unauthorized", { status: 401 });

  // Authorize: the media must belong to a message in the caller's workspace (RLS).
  const owns = await withTenant(ctx.workspaceId, (tx) => tx.message.findFirst({ where: { mediaId } }));
  if (!owns) return new Response("Not found", { status: 404 });

  // Web-linked media is stored by the messaging gateway and streamed through it.
  if (mediaId.startsWith(WA_WEB_MEDIA_PREFIX)) {
    const bin = await fetchGatewayMedia(mediaId);
    if (!bin.ok || !bin.body) return new Response("Media unavailable", { status: 502 });
    return new Response(bin.body, {
      // nosniff + attachment: the mime comes from the sender, so it must never
      // execute in this origin. Embedded <img>/<video>/<audio> still render;
      // navigations (document links) download instead.
      headers: {
        "content-type": owns.mediaMime || bin.headers.get("content-type") || "application/octet-stream",
        "content-disposition": `attachment; filename="${(owns.mediaFilename || "attachment").replace(/[^\w.\- ]/g, "_")}"`,
        "x-content-type-options": "nosniff",
        "cache-control": "private, max-age=300",
      },
    });
  }

  const channel = await prisma.whatsAppChannel.findFirst({ where: { workspaceId: ctx.workspaceId } });
  if (!channel) return new Response("No channel", { status: 404 });

  const metaRes = await fetch(`${GRAPH}/${mediaId}`, {
    headers: { Authorization: `Bearer ${channel.accessToken}` },
  });
  if (!metaRes.ok) return new Response("Media unavailable", { status: 502 });
  const meta = await metaRes.json();
  if (!meta?.url) return new Response("Media unavailable", { status: 502 });

  const bin = await fetch(meta.url, { headers: { Authorization: `Bearer ${channel.accessToken}` } });
  if (!bin.ok || !bin.body) return new Response("Media fetch failed", { status: 502 });

  return new Response(bin.body, {
    headers: {
      "content-type": meta.mime_type || bin.headers.get("content-type") || "application/octet-stream",
      "content-disposition": `attachment; filename="${(owns.mediaFilename || "attachment").replace(/[^\w.\- ]/g, "_")}"`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, max-age=300",
    },
  });
}
