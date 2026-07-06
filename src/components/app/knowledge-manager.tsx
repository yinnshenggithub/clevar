"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, FileText, FileUp, Globe, Link2, Loader2, RefreshCw, Trash2, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  addTextSource,
  addFileSource,
  addUrlSource,
  attachSource,
  detachSource,
  deleteSource,
  resyncSource,
  type DocState,
} from "@/lib/actions/knowledge";

export interface KnowledgeSourceRow {
  id: string;
  type: string; // text | file | url | site
  title: string;
  status: string; // pending | processing | ready | failed
  error: string | null;
  chunkCount: number;
  lastSyncedAt: string | null;
  usedBy: number;
}

const TYPE_META: Record<string, { label: string; Icon: typeof Globe }> = {
  url: { label: "Page", Icon: Globe },
  site: { label: "Website", Icon: Globe },
  file: { label: "File", Icon: FileText },
  text: { label: "Text", Icon: Type },
};

function StatusBadge({ status, error }: { status: string; error: string | null }) {
  if (status === "ready")
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-700 dark:text-emerald-300">
        <CheckCircle2 className="h-3 w-3" /> Ready
      </span>
    );
  if (status === "failed")
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-xs text-destructive"
        title={error ?? undefined}
      >
        <AlertTriangle className="h-3 w-3" /> Failed
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-xs text-amber-700 dark:text-amber-300">
      <Loader2 className="h-3 w-3 animate-spin motion-reduce:animate-none" /> Processing
    </span>
  );
}

/** Knowledge-base manager: add sources (website / file / text), attach shared ones, track status. */
export function KnowledgeManager({
  agentId,
  sources,
  available,
  canManage,
}: {
  agentId: string;
  sources: KnowledgeSourceRow[];
  /** Workspace sources not yet attached to this agent. */
  available: { id: string; title: string; type: string }[];
  canManage: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"url" | "file" | "text">("url");
  const [pendingAction, startAction] = useTransition();
  const [attachId, setAttachId] = useState("");

  // Crawls and enrichment finish in the background — refresh while any source
  // is still moving so status badges settle without a manual reload.
  const busy = sources.some((s) => s.status === "pending" || s.status === "processing");
  const busyRef = useRef(busy);
  busyRef.current = busy;
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => {
      if (busyRef.current) router.refresh();
    }, 4000);
    return () => clearInterval(t);
  }, [busy, router]);

  const [urlState, urlAction, urlPending] = useActionState<DocState, FormData>(
    (prev, fd) => addUrlSource(agentId, prev, fd),
    {},
  );
  const [fileState, fileAction, filePending] = useActionState<DocState, FormData>(
    (prev, fd) => addFileSource(agentId, prev, fd),
    {},
  );
  const [textState, textAction, textPending] = useActionState<DocState, FormData>(
    (prev, fd) => addTextSource(agentId, prev, fd),
    {},
  );

  return (
    <div className="space-y-4">
      {canManage && (
        <div>
          <div className="mb-3 inline-flex rounded-lg border border-border p-0.5">
            {(
              [
                { key: "url", label: "Website", Icon: Globe },
                { key: "file", label: "File", Icon: FileUp },
                { key: "text", label: "Text", Icon: Type },
              ] as const
            ).map(({ key, label, Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm transition-colors ${
                  tab === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon className="h-3.5 w-3.5" /> {label}
              </button>
            ))}
          </div>

          {tab === "url" && (
            <form action={urlAction} className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="kb-url">Page URL</Label>
                <Input id="kb-url" name="url" type="url" placeholder="https://yourwebsite.com" required className="h-9" />
              </div>
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" name="crawl" className="h-4 w-4 rounded border-border" />
                  Include linked pages on the same site (up to 50)
                </label>
                <div className="flex items-center gap-2 text-sm">
                  <Label htmlFor="kb-recrawl" className="text-sm font-normal">
                    Re-sync
                  </Label>
                  <Select id="kb-recrawl" name="recrawl" defaultValue="" className="h-8 w-28">
                    <option value="">Manual</option>
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                  </Select>
                </div>
              </div>
              <Button type="submit" size="sm" disabled={urlPending} className="gap-2">
                {urlPending ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Globe className="h-4 w-4" />}
                Import website
              </Button>
              {urlState.error && (
                <p role="alert" className="text-sm text-destructive">
                  {urlState.error}
                </p>
              )}
              {urlState.ok && <p className="text-sm text-emerald-600">Added — indexing now.</p>}
            </form>
          )}

          {tab === "file" && (
            <form action={fileAction} className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="kb-file">File (PDF, DOCX, TXT, MD, CSV — max 10 MB)</Label>
                <Input id="kb-file" name="file" type="file" accept=".pdf,.docx,.txt,.md,.markdown,.csv" required className="h-9" />
              </div>
              <Button type="submit" size="sm" disabled={filePending} className="gap-2">
                {filePending ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <FileUp className="h-4 w-4" />}
                Upload
              </Button>
              {fileState.error && (
                <p role="alert" className="text-sm text-destructive">
                  {fileState.error}
                </p>
              )}
              {fileState.ok && <p className="text-sm text-emerald-600">Added — indexing now.</p>}
            </form>
          )}

          {tab === "text" && (
            <form action={textAction} className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="kb-title">Title</Label>
                <Input id="kb-title" name="title" placeholder="Refund policy" required className="h-9" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="kb-content">Content</Label>
                <Textarea id="kb-content" name="content" rows={5} placeholder="Paste the text the agent should know…" required />
              </div>
              <Button type="submit" size="sm" disabled={textPending} className="gap-2">
                {textPending ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" /> : <Type className="h-4 w-4" />}
                Add text
              </Button>
              {textState.error && (
                <p role="alert" className="text-sm text-destructive">
                  {textState.error}
                </p>
              )}
              {textState.ok && <p className="text-sm text-emerald-600">Added — indexing now.</p>}
            </form>
          )}
        </div>
      )}

      <div>
        <h4 className="mb-2 text-sm font-medium">Sources ({sources.length})</h4>
        {sources.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing here yet — add your website or docs. The agent only answers from what you put here.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {sources.map((s) => {
              const meta = TYPE_META[s.type] ?? TYPE_META.text;
              return (
                <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                  <meta.Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-sm" title={s.title}>
                    {s.title}
                  </span>
                  <StatusBadge status={s.status} error={s.error} />
                  <span className="text-xs text-muted-foreground">
                    {s.chunkCount} passages
                    {s.usedBy > 1 ? ` · ${s.usedBy} agents` : ""}
                    {s.lastSyncedAt ? ` · synced ${new Date(s.lastSyncedAt).toLocaleDateString()}` : ""}
                  </span>
                  {canManage && (
                    <span className="flex items-center gap-1">
                      {(s.type === "url" || s.type === "site") && s.status !== "processing" && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          title="Re-sync now"
                          disabled={pendingAction}
                          onClick={() => startAction(() => resyncSource(agentId, s.id))}
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        title="Detach from this agent (the source stays in the workspace)"
                        disabled={pendingAction}
                        onClick={() => startAction(() => detachSource(agentId, s.id))}
                      >
                        <Link2 className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                        title="Delete source"
                        disabled={pendingAction}
                        onClick={() => {
                          if (window.confirm(`Delete "${s.title}"? Agents using it will lose this knowledge.`)) {
                            startAction(() => deleteSource(agentId, s.id));
                          }
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {canManage && available.length > 0 && (
        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1">
            <Label htmlFor="kb-attach">Attach an existing source</Label>
            <Select id="kb-attach" value={attachId} onChange={(e) => setAttachId(e.target.value)} className="h-9">
              <option value="">Choose from this workspace…</option>
              {available.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title} ({TYPE_META[s.type]?.label ?? s.type})
                </option>
              ))}
            </Select>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!attachId || pendingAction}
            onClick={() =>
              startAction(async () => {
                await attachSource(agentId, attachId);
                setAttachId("");
              })
            }
          >
            Attach
          </Button>
        </div>
      )}
    </div>
  );
}
