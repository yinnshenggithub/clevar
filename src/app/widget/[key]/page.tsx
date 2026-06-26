import { prisma } from "@/lib/prisma";
import { WidgetChat } from "@/components/app/widget-chat";

export const dynamic = "force-dynamic";

export default async function WidgetPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const widget = await prisma.webWidget.findUnique({ where: { publicKey: key } });

  if (!widget || !widget.enabled) {
    return (
      <div className="flex h-screen items-center justify-center bg-white p-6 text-center text-sm text-slate-500">
        This chat is unavailable.
      </div>
    );
  }

  return (
    <WidgetChat publicKey={key} name={widget.name} color={widget.color} welcome={widget.welcomeMessage} />
  );
}
