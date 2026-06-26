import { getEnabledWidget } from "@/lib/webchat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Serves the embeddable loader script. Customers add:
//   <script src="https://<app>/api/widget/<key>/loader" async></script>
export async function GET(_req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const widget = await getEnabledWidget(key);
  const base = (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");

  if (!widget) {
    return new Response("/* Clevar widget not found or disabled */", {
      headers: { "content-type": "application/javascript; charset=utf-8" },
    });
  }

  const color = widget.color.replace(/[^#a-zA-Z0-9]/g, "") || "#FF7A59";
  const iframeSrc = `${base}/widget/${encodeURIComponent(key)}`;

  const js = `(function(){
  if (window.__clevarWidgetLoaded) return; window.__clevarWidgetLoaded = true;
  var COLOR = ${JSON.stringify(color)};
  var SRC = ${JSON.stringify(iframeSrc)};
  var open = false;
  var btn = document.createElement('button');
  btn.setAttribute('aria-label','Open chat');
  btn.style.cssText = 'position:fixed;bottom:20px;right:20px;width:56px;height:56px;border-radius:50%;border:none;cursor:pointer;z-index:2147483646;box-shadow:0 6px 20px rgba(0,0,0,.25);background:'+COLOR+';color:#fff;font-size:24px;display:flex;align-items:center;justify-content:center;transition:transform .15s;';
  btn.innerHTML = '\\uD83D\\uDCAC';
  var frame = document.createElement('iframe');
  frame.src = SRC;
  frame.setAttribute('title','Chat');
  frame.style.cssText = 'position:fixed;bottom:88px;right:20px;width:380px;height:560px;max-width:calc(100vw - 40px);max-height:calc(100vh - 120px);border:none;border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.3);z-index:2147483646;display:none;background:#fff;';
  function toggle(){ open=!open; frame.style.display = open?'block':'none'; btn.innerHTML = open?'\\u2715':'\\uD83D\\uDCAC'; }
  btn.addEventListener('click', toggle);
  function mount(){ document.body.appendChild(frame); document.body.appendChild(btn); }
  if (document.readyState === 'complete' || document.readyState === 'interactive') mount();
  else document.addEventListener('DOMContentLoaded', mount);
})();`;

  return new Response(js, {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "public, max-age=300",
    },
  });
}
