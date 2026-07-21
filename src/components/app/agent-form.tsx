"use client";

import { useActionState, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Lock } from "lucide-react";
import type { FormState } from "@/lib/actions/agents";
import { MODEL_OPTIONS, DEFAULT_MODEL } from "@/lib/ai-models";
import { TONE_PRESETS, MODE_PRESETS, STYLE_PRESETS } from "@/lib/agent-presets";
import { ACTION_DEFS, type AgentActions } from "@/lib/agent-action-defs";
import { OptimizeButton } from "@/components/app/optimize-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";

type Rule = { label: string; trigger: "keyword" | "asks_human"; keywords: string; action: "handoff" | "note"; note: string };
type Pair = { a: string; b: string };
type HoursConfig = { enabled: boolean; days: number[]; start: string; end: string; tz: string; message: string };
export type HandoffTriggersConfig = {
  askHuman?: boolean;
  cantAnswer?: number;
  hours?: Partial<HoursConfig>;
};

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
  actions?: AgentActions | null;
  grounding?: string | null;
  refusalLine?: string | null;
  languagePolicy?: string | null;
  handoffMessage?: string | null;
  dos?: string[] | null;
  donts?: string[] | null;
  playbook?: { scenario: string; response: string }[] | null;
  examples?: { user: string; assistant: string }[] | null;
  profileFields?: string[] | null;
  intakeFields?: { key: string; required: boolean }[] | null;
  handoffTriggers?: HandoffTriggersConfig | null;
}

const GROUNDING_OPTIONS = [
  { value: "strict", label: "Strict (recommended)", desc: "Answers business questions only from the knowledge base. No knowledge = honest “I don't know” + handoff. Most accurate." },
  { value: "flexible", label: "Flexible", desc: "Prefers the knowledge base, but may add clearly-labeled general knowledge." },
  { value: "open", label: "Open", desc: "No knowledge restriction — persona chatbot. Highest fluency, highest risk of made-up facts." },
] as const;

const PROFILE_FIELD_OPTIONS = [
  { key: "name", label: "Name" },
  { key: "company", label: "Company" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "tags", label: "Tags" },
  { key: "openDeals", label: "Open deals (title + stage)" },
] as const;

const DAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

/** Simple add/remove list editor for short one-line entries (do's / don'ts). */
function ListEditor({
  items,
  setItems,
  placeholder,
}: {
  items: string[];
  setItems: (v: string[]) => void;
  placeholder: string;
}) {
  return (
    <div className="space-y-2">
      {items.map((v, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            value={v}
            onChange={(e) => setItems(items.map((x, idx) => (idx === i ? e.target.value : x)))}
            placeholder={placeholder}
          />
          <button
            type="button"
            aria-label="Remove"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => setItems(items.filter((_, idx) => idx !== i))}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => setItems([...items, ""])}>
        <Plus className="h-3.5 w-3.5" /> Add
      </Button>
    </div>
  );
}

/** Two-field row editor (playbook scenario→response, example customer→agent). */
function PairEditor({
  pairs,
  setPairs,
  labelA,
  labelB,
  placeholderA,
  placeholderB,
  addLabel,
}: {
  pairs: Pair[];
  setPairs: (v: Pair[]) => void;
  labelA: string;
  labelB: string;
  placeholderA: string;
  placeholderB: string;
  addLabel: string;
}) {
  return (
    <div className="space-y-2">
      {pairs.map((p, i) => (
        <div key={i} className="space-y-2 rounded-lg border border-border p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              {labelA} → {labelB}
            </span>
            <button
              type="button"
              aria-label="Remove"
              className="text-muted-foreground hover:text-destructive"
              onClick={() => setPairs(pairs.filter((_, idx) => idx !== i))}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          <Input
            value={p.a}
            onChange={(e) => setPairs(pairs.map((x, idx) => (idx === i ? { ...x, a: e.target.value } : x)))}
            placeholder={placeholderA}
          />
          <Textarea
            rows={2}
            value={p.b}
            onChange={(e) => setPairs(pairs.map((x, idx) => (idx === i ? { ...x, b: e.target.value } : x)))}
            placeholder={placeholderB}
          />
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" className="gap-1" onClick={() => setPairs([...pairs, { a: "", b: "" }])}>
        <Plus className="h-3.5 w-3.5" /> {addLabel}
      </Button>
    </div>
  );
}

const SectionTitle = ({ children }: { children: React.ReactNode }) => (
  <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{children}</h3>
);

export function AgentForm({
  action,
  defaults,
  members = [],
  catalog = [],
  submitLabel,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  defaults?: AgentDefaults;
  members?: { id: string; name: string }[];
  catalog?: { qualified: string; label: string }[];
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, {});
  const router = useRouter();
  const [temp, setTemp] = useState<number>(defaults?.temperature ?? 0.5);
  const [instructions, setInstructions] = useState<string>(defaults?.instructions ?? "");
  const [rules, setRules] = useState<Rule[]>(
    defaults?.rules && defaults.rules.length
      ? defaults.rules
      : [{ label: "", trigger: "asks_human", keywords: "", action: "handoff", note: "" }],
  );
  const updateRule = (i: number, patch: Partial<Rule>) =>
    setRules((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const [actions, setActions] = useState<AgentActions>(() => {
    const init: AgentActions = {};
    for (const def of ACTION_DEFS) {
      const d = defaults?.actions?.[def.key];
      init[def.key] = { enabled: Boolean(d?.enabled), guideline: d?.guideline ?? "" };
    }
    return init;
  });
  const setAction = (key: string, patch: Partial<{ enabled: boolean; guideline: string }>) =>
    setActions((a) => ({ ...a, [key]: { ...a[key], ...patch } }));

  const [dos, setDos] = useState<string[]>(defaults?.dos ?? []);
  const [donts, setDonts] = useState<string[]>(defaults?.donts ?? []);
  const [playbook, setPlaybook] = useState<Pair[]>(
    (defaults?.playbook ?? []).map((p) => ({ a: p.scenario, b: p.response })),
  );
  const [examples, setExamples] = useState<Pair[]>(
    (defaults?.examples ?? []).map((p) => ({ a: p.user, b: p.assistant })),
  );
  const [profileFields, setProfileFields] = useState<string[]>(defaults?.profileFields ?? []);
  const [intakeFields, setIntakeFields] = useState<{ key: string; required: boolean }[]>(defaults?.intakeFields ?? []);
  const [intakePick, setIntakePick] = useState<string>("");
  const langDefault = defaults?.languagePolicy ?? "mirror";
  const [langMode, setLangMode] = useState<"mirror" | "fixed">(langDefault.startsWith("fixed:") ? "fixed" : "mirror");
  const [langFixed, setLangFixed] = useState(langDefault.startsWith("fixed:") ? langDefault.slice(6) : "");
  const trigDefaults = defaults?.handoffTriggers ?? {};
  const [askHuman, setAskHuman] = useState(trigDefaults.askHuman !== false);
  const [cantAnswer, setCantAnswer] = useState<number>(trigDefaults.cantAnswer ?? 0);
  const [hours, setHours] = useState<HoursConfig>({
    enabled: Boolean(trigDefaults.hours?.enabled),
    days: trigDefaults.hours?.days ?? [1, 2, 3, 4, 5],
    start: trigDefaults.hours?.start ?? "09:00",
    end: trigDefaults.hours?.end ?? "18:00",
    tz: trigDefaults.hours?.tz ?? "Asia/Kuala_Lumpur",
    message: trigDefaults.hours?.message ?? "",
  });

  return (
    <form
      action={(fd) => {
        fd.set("rules", JSON.stringify(rules.filter((r) => r.trigger === "asks_human" || r.keywords.trim())));
        fd.set("actions", JSON.stringify(actions));
        fd.set("dos", JSON.stringify(dos.map((s) => s.trim()).filter(Boolean)));
        fd.set("donts", JSON.stringify(donts.map((s) => s.trim()).filter(Boolean)));
        fd.set("playbook", JSON.stringify(playbook.map((p) => ({ scenario: p.a.trim(), response: p.b.trim() })).filter((p) => p.scenario && p.response)));
        fd.set("examples", JSON.stringify(examples.map((p) => ({ user: p.a.trim(), assistant: p.b.trim() })).filter((p) => p.user && p.assistant)));
        fd.set("profileFields", JSON.stringify(profileFields));
        fd.set("intakeFields", JSON.stringify(intakeFields));
        fd.set("languagePolicy", langMode === "fixed" && langFixed.trim() ? `fixed:${langFixed.trim()}` : "mirror");
        fd.set(
          "handoffTriggers",
          JSON.stringify({ askHuman, ...(cantAnswer >= 1 ? { cantAnswer } : {}), ...(hours.enabled ? { hours } : {}) }),
        );
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
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="instructions">Extra instructions / context (advanced)</Label>
            <OptimizeButton value={instructions} kind="instructions" onResult={setInstructions} />
          </div>
          <Textarea
            id="instructions"
            name="instructions"
            rows={5}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="Anything else the agent should know about your business, products, or style."
          />
        </div>
      </div>

      {/* Knowledge & accuracy */}
      <div className="space-y-4">
        <div>
          <SectionTitle>Knowledge &amp; accuracy</SectionTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Controls how strictly answers are grounded in the knowledge base below.
          </p>
        </div>
        <div className="space-y-2">
          {GROUNDING_OPTIONS.map((g) => (
            <label key={g.value} className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3">
              <input
                type="radio"
                name="grounding"
                value={g.value}
                defaultChecked={(defaults?.grounding ?? "strict") === g.value}
                className="mt-0.5 h-4 w-4"
              />
              <span>
                <span className="block text-sm font-medium">{g.label}</span>
                <span className="block text-xs text-muted-foreground">{g.desc}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="space-y-2">
          <Label htmlFor="refusalLine">Refusal line — said verbatim for out-of-bounds requests</Label>
          <Input
            id="refusalLine"
            name="refusalLine"
            defaultValue={defaults?.refusalLine ?? ""}
            placeholder="I can't help with that, but I'm happy to answer questions about our products and services."
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="langMode">Reply language</Label>
            <Select id="langMode" value={langMode} onChange={(e) => setLangMode(e.target.value as "mirror" | "fixed")}>
              <option value="mirror">Mirror the customer&apos;s language</option>
              <option value="fixed">Always reply in…</option>
            </Select>
          </div>
          {langMode === "fixed" && (
            <div className="space-y-2">
              <Label htmlFor="langFixed">Language</Label>
              <Input id="langFixed" value={langFixed} onChange={(e) => setLangFixed(e.target.value)} placeholder="English / Malay / 中文" />
            </div>
          )}
        </div>
      </div>

      {/* Do's & don'ts */}
      <div className="space-y-4">
        <div>
          <SectionTitle>Do&apos;s &amp; don&apos;ts</SectionTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Short, specific lines work best — they become numbered rules in the agent&apos;s guardrails.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Always</Label>
            <ListEditor items={dos} setItems={setDos} placeholder="Confirm the order number before troubleshooting" />
          </div>
          <div className="space-y-2">
            <Label>Never</Label>
            <ListEditor items={donts} setItems={setDonts} placeholder="Never speculate about future products" />
          </div>
        </div>
      </div>

      {/* Playbook */}
      <div className="space-y-4">
        <div>
          <SectionTitle>Scenario playbook</SectionTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Canned responses for known situations — “If the customer asks about delivery time” → the exact line to use.
          </p>
        </div>
        <PairEditor
          pairs={playbook}
          setPairs={setPlaybook}
          labelA="If"
          labelB="respond"
          placeholderA="the customer asks about delivery time"
          placeholderB="Standard delivery is 3–5 working days across Malaysia."
          addLabel="Add scenario"
        />
      </div>

      {/* Examples */}
      <div className="space-y-4">
        <div>
          <SectionTitle>Example conversations</SectionTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            4–5 great question→answer pairs teach tone and format better than any instruction.
          </p>
        </div>
        <PairEditor
          pairs={examples}
          setPairs={setExamples}
          labelA="Customer"
          labelB="agent replies"
          placeholderA="Do you ship to Sabah?"
          placeholderB="Yes! East Malaysia delivery takes 5–7 working days."
          addLabel="Add example"
        />
      </div>

      {/* Personalization */}
      <div className="space-y-4">
        <div>
          <SectionTitle>Personalization</SectionTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Checked CRM fields are shown to the AI so it can greet customers by name and reference their account.
            Unchecked fields are never sent to the model.
          </p>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {PROFILE_FIELD_OPTIONS.map((f) => (
            <label key={f.key} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={profileFields.includes(f.key)}
                onChange={(e) =>
                  setProfileFields((cur) => (e.target.checked ? [...cur, f.key] : cur.filter((k) => k !== f.key)))
                }
              />
              {f.label}
            </label>
          ))}
        </div>
      </div>

      {/* Required intake */}
      <div className="space-y-4">
        <div>
          <SectionTitle>Collect properties</SectionTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Details the agent tries to gather in conversation. <strong>Optional</strong> = asked lightly, one at a
            time, dropped if the customer declines (never pushy). <strong>Required</strong> = the agent won&apos;t
            answer other questions until it&apos;s collected. Leave empty to disable.
          </p>
        </div>
        {intakeFields.length > 0 && (
          <ol className="space-y-1">
            {intakeFields.map((f, i) => {
              const label = catalog.find((c) => c.qualified === f.key)?.label ?? f.key;
              return (
                <li key={f.key} className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
                  <span className="text-muted-foreground">{i + 1}.</span>
                  <span className="min-w-0 flex-1 truncate">
                    {label} <code className="ml-1 rounded bg-muted px-1 font-mono text-xs">{f.key}</code>
                  </span>
                  <label className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
                    <input type="checkbox" className="h-3.5 w-3.5" checked={f.required}
                      onChange={(e) => setIntakeFields((cur) => cur.map((x) => (x.key === f.key ? { ...x, required: e.target.checked } : x)))} />
                    Required
                  </label>
                  <button type="button" aria-label="Move up" disabled={i === 0}
                    className="rounded p-1 text-muted-foreground hover:bg-accent disabled:opacity-30"
                    onClick={() => setIntakeFields((cur) => { const a = [...cur]; [a[i - 1], a[i]] = [a[i], a[i - 1]]; return a; })}>↑</button>
                  <button type="button" aria-label="Move down" disabled={i === intakeFields.length - 1}
                    className="rounded p-1 text-muted-foreground hover:bg-accent disabled:opacity-30"
                    onClick={() => setIntakeFields((cur) => { const a = [...cur]; [a[i + 1], a[i]] = [a[i], a[i + 1]]; return a; })}>↓</button>
                  <button type="button" aria-label="Remove"
                    className="rounded p-1 text-destructive hover:bg-accent"
                    onClick={() => setIntakeFields((cur) => cur.filter((x) => x.key !== f.key))}>✕</button>
                </li>
              );
            })}
          </ol>
        )}
        <div className="flex items-center gap-2">
          <select
            value={intakePick}
            onChange={(e) => setIntakePick(e.target.value)}
            className="h-9 flex-1 rounded-md border border-border bg-background px-2 text-sm"
          >
            <option value="">Add a property to collect…</option>
            {catalog
              .filter((c) => !intakeFields.some((f) => f.key === c.qualified))
              .map((c) => (
                <option key={c.qualified} value={c.qualified}>{c.label} — {c.qualified}</option>
              ))}
          </select>
          <Button type="button" variant="outline" size="sm" className="gap-1"
            disabled={!intakePick}
            onClick={() => { if (intakePick) { setIntakeFields((cur) => [...cur, { key: intakePick, required: false }]); setIntakePick(""); } }}>
            <Plus className="h-3.5 w-3.5" /> Add
          </Button>
        </div>
      </div>

      {/* Actions */}
      <div className="space-y-4">
        <div>
          <SectionTitle>Actions</SectionTitle>
          <p className="mt-1 text-sm text-muted-foreground">
            Let the agent take actions during a conversation. Each is only available when enabled; describe in plain
            language when and how the agent should use it.
          </p>
        </div>
        <div className="space-y-3">
          {ACTION_DEFS.map((def) => {
            const a = actions[def.key] ?? { enabled: false, guideline: "" };
            const on = a.enabled && !def.premium;
            return (
              <div key={def.key} className="rounded-lg border border-border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-medium">
                      {def.label}
                      {def.premium && (
                        <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
                          <Lock className="h-3 w-3" /> Premium
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{def.description}</p>
                  </div>
                  <label className="relative inline-flex shrink-0 cursor-pointer items-center">
                    <input
                      type="checkbox"
                      className="peer sr-only"
                      checked={a.enabled}
                      disabled={def.premium}
                      onChange={(e) => setAction(def.key, { enabled: e.target.checked })}
                    />
                    <span className="h-5 w-9 rounded-full bg-input transition-colors peer-checked:bg-primary peer-disabled:opacity-40" />
                    <span className="absolute left-0.5 h-4 w-4 rounded-full bg-white transition-transform peer-checked:translate-x-4" />
                  </label>
                </div>
                {on && (
                  <div className="mt-3 space-y-2">
                    <Textarea
                      rows={2}
                      value={a.guideline}
                      onChange={(e) => setAction(def.key, { guideline: e.target.value })}
                      placeholder={def.placeholder}
                    />
                    <div className="flex justify-end">
                      <OptimizeButton value={a.guideline} kind="guideline" onResult={(t) => setAction(def.key, { guideline: t })} />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
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
          <Label htmlFor="handoffMessage">Takeover message — sent to the customer when handing off</Label>
          <Input
            id="handoffMessage"
            name="handoffMessage"
            defaultValue={defaults?.handoffMessage ?? ""}
            placeholder="Thanks for your patience — I'm bringing in a teammate to help."
          />
        </div>

        <div className="space-y-2">
          <Label>Automatic triggers</Label>
          <div className="space-y-2 rounded-lg border border-border p-3">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4" checked={askHuman} onChange={(e) => setAskHuman(e.target.checked)} />
              Customer explicitly asks for a human (detected in English, Malay &amp; Chinese)
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={cantAnswer >= 1}
                onChange={(e) => setCantAnswer(e.target.checked ? 2 : 0)}
              />
              Agent couldn&apos;t answer
              <Select
                value={String(cantAnswer || 2)}
                disabled={cantAnswer < 1}
                onChange={(e) => setCantAnswer(Number(e.target.value))}
                className="h-8 w-16"
                aria-label="Miss count"
              >
                {[1, 2, 3, 5].map((n) => (
                  <option key={n} value={n}>{n}×</option>
                ))}
              </Select>
              times in a row
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={hours.enabled}
                onChange={(e) => setHours((h) => ({ ...h, enabled: e.target.checked }))}
              />
              Outside business hours
            </label>
            {hours.enabled && (
              <div className="ml-6 space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  {DAY_LABELS.map((d, i) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() =>
                        setHours((h) => ({
                          ...h,
                          // Keep at least one day — an empty schedule would be silently dropped on save.
                          days: h.days.includes(i)
                            ? h.days.length > 1
                              ? h.days.filter((x) => x !== i)
                              : h.days
                            : [...h.days, i].sort(),
                        }))
                      }
                      className={`h-8 w-9 rounded-md border text-xs font-medium ${
                        hours.days.includes(i)
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border text-muted-foreground"
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <Input
                    type="time"
                    value={hours.start}
                    onChange={(e) => setHours((h) => ({ ...h, start: e.target.value }))}
                    className="h-8 w-28"
                    aria-label="Opens at"
                  />
                  to
                  <Input
                    type="time"
                    value={hours.end}
                    onChange={(e) => setHours((h) => ({ ...h, end: e.target.value }))}
                    className="h-8 w-28"
                    aria-label="Closes at"
                  />
                  <Input
                    value={hours.tz}
                    onChange={(e) => setHours((h) => ({ ...h, tz: e.target.value }))}
                    className="h-8 w-44"
                    placeholder="Asia/Kuala_Lumpur"
                    aria-label="Timezone"
                  />
                </div>
                <Input
                  value={hours.message}
                  onChange={(e) => setHours((h) => ({ ...h, message: e.target.value }))}
                  placeholder="After-hours message (optional) — e.g. We're back at 9am and will reply then!"
                />
              </div>
            )}
          </div>
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
