"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import type { FormState } from "@/lib/actions/agents";
import { MODEL_OPTIONS, DEFAULT_MODEL } from "@/lib/ai-models";
import { TONE_PRESETS, MODE_PRESETS, STYLE_PRESETS } from "@/lib/agent-presets";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";

type Rule = { label: string; trigger: "keyword" | "asks_human"; keywords: string; action: "handoff" | "note"; note: string };

export interface AgentDefaults {
  name?: string | null;
  instructions?: string | null;
  model?: string | null;
  mode?: string | null;
  tone?: string | null;
  responseStyle?: string | null;
  objectives?: string | null;
  constraints?: string | null;
  greeting?: string | null;
  temperature?: number | null;
  handoffEnabled?: boolean | null;
  handoffUserId?: string | null;
  rules?: Rule[] | null;
}

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{children}</h3>
);

export function AgentForm({
  action,
  defaults,
  members = [],
  submitLabel,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  defaults?: AgentDefaults;
  members?: { id: string; name: string }[];
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  const router = useRouter();
  const [temp, setTemp] = useState<number>(defaults?.temperature ?? 0.5);
  const [rules, setRules] = useState<Rule[]>(
    defaults?.rules && defaults.rules.length
      ? defaults.rules
      : [{ label: "", trigger: "asks_human", keywords: "", action: "handoff", note: "" }],
  );
  const updateRule = (i: number, patch: Partial<Rule>) =>
    setRules((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  return (
    <form
      action={(fd) => {
        fd.set("rules", JSON.stringify(rules.filter((r) => r.trigger === "asks_human" || r.keywords.trim())));
        return formAction(fd);
      }}
      className="max-w-2xl space-y-8"
    >
      {/* Identity */}
      <div className="space-y-4">
        <SectionTitle>Identity</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="name">Agent name</Label>
            <Input id="name" name="name" required defaultValue={defaults?.name ?? ""} placeholder="Ava" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="model">Model</Label>
            <Select id="model" name="model" defaultValue={defaults?.model ?? DEFAULT_MODEL}>
              {MODEL_OPTIONS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </Select>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="greeting">Opening greeting (optional)</Label>
          <Input id="greeting" name="greeting" defaultValue={defaults?.greeting ?? ""} placeholder="Hi! I'm Ava — how can I help today?" />
        </div>
      </div>

      {/* Behavior */}
      <div className="space-y-4">
        <SectionTitle>Behavior</SectionTitle>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="mode">Role</Label>
            <Select id="mode" name="mode" defaultValue={defaults?.mode ?? "support"}>
              {MODE_PRESETS.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="tone">Tone</Label>
            <Select id="tone" name="tone" defaultValue={defaults?.tone ?? "friendly"}>
              {TONE_PRESETS.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="responseStyle">Reply length</Label>
            <Select id="responseStyle" name="responseStyle" defaultValue={defaults?.responseStyle ?? "balanced"}>
              {STYLE_PRESETS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </Select>
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="temperature">
            Creativity <span className="text-muted-foreground">({temp.toFixed(1)} — lower is more focused)</span>
          </Label>
          <input
            id="temperature"
            name="temperature"
            type="range"
            min="0"
            max="1"
            step="0.1"
            value={temp}
            onChange={(e) => setTemp(Number(e.target.value))}
            className="w-full accent-primary"
          />
        </div>
      </div>

      {/* Instructions */}
      <div className="space-y-4">
        <SectionTitle>Objectives &amp; rules</SectionTitle>
        <div className="space-y-2">
          <Label htmlFor="objectives">Objectives — what should it achieve?</Label>
          <Textarea id="objectives" name="objectives" rows={3} defaultValue={defaults?.objectives ?? ""} placeholder="Help customers book a demo; answer pricing questions; qualify leads." />
        </div>
        <div className="space-y-2">
          <Label htmlFor="constraints">Constraints — what must it never do?</Label>
          <Textarea id="constraints" name="constraints" rows={3} defaultValue={defaults?.constraints ?? ""} placeholder="Never quote a discount. Never give legal advice. Don't discuss competitors." />
        </div>
        <div className="space-y-2">
          <Label htmlFor="instructions">Extra instructions / context (advanced)</Label>
          <Textarea id="instructions" name="instructions" rows={5} defaultValue={defaults?.instructions ?? ""} placeholder="Anything else the agent should know about your business, products, or style." />
        </div>
      </div>

      {/* Handoff */}
      <div className="space-y-4">
        <SectionTitle>Human handoff</SectionTitle>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="handoffEnabled" defaultChecked={defaults?.handoffEnabled ?? true} className="h-4 w-4" />
          Allow the agent to hand off to a human teammate
        </label>
        <div className="space-y-2">
          <Label htmlFor="handoffUserId">Assign handoffs to</Label>
          <Select id="handoffUserId" name="handoffUserId" defaultValue={defaults?.handoffUserId ?? ""}>
            <option value="">Leave unassigned (just mark pending)</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </Select>
        </div>

        <div className="space-y-2">
          <Label>If-then rules (run on every incoming message — no AI needed)</Label>
          {rules.map((r, i) => (
            <div key={i} className="space-y-2 rounded-lg border border-border p-3">
              <div className="flex items-center gap-2">
                <Select value={r.trigger} className="w-44 shrink-0" onChange={(e) => updateRule(i, { trigger: e.target.value as Rule["trigger"] })}>
                  <option value="asks_human">When asks for a human</option>
                  <option value="keyword">When message contains…</option>
                </Select>
                {r.trigger === "keyword" && (
                  <Input value={r.keywords} onChange={(e) => updateRule(i, { keywords: e.target.value })} placeholder="refund, cancel, complaint" />
                )}
                <button type="button" aria-label="Remove rule" className="text-muted-foreground hover:text-destructive" onClick={() => setRules((rs) => (rs.length > 1 ? rs.filter((_, idx) => idx !== i) : rs))}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <div className="flex items-center gap-2">
                <Select value={r.action} className="w-44 shrink-0" onChange={(e) => updateRule(i, { action: e.target.value as Rule["action"] })}>
                  <option value="handoff">→ Hand off to human</option>
                  <option value="note">→ Add internal note only</option>
                </Select>
                <Input value={r.note} onChange={(e) => updateRule(i, { note: e.target.value })} placeholder="Internal note for the team (optional)" />
              </div>
            </div>
          ))}
          <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => setRules((rs) => [...rs, { label: "", trigger: "keyword", keywords: "", action: "handoff", note: "" }])}>
            <Plus className="h-3.5 w-3.5" /> Add rule
          </Button>
        </div>
      </div>

      {state.error && <p className="text-sm text-destructive">{state.error}</p>}
      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : submitLabel}
        </Button>
        <Button type="button" variant="ghost" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
