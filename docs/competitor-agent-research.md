# Competitor AI-Agent Teardown — Intercom Fin · Zendesk · respond.io

Recovered + synthesized from a 106-agent deep-research sweep (2026-06-27): 24 sources → 116 extracted claims → 69 upheld / 6 refuted under adversarial verification. Focus: how the three leading support/sales AI-agent products structure **operator instructions, tone, actions, escalation, and grounding/abstention** — to benchmark and prioritize Clevar's Agent Studio. Companion to [agent-rag-security-research.md](agent-rag-security-research.md). Sources are official help/docs unless noted.

Per IP rule ([never-disclose-engine-origins]): this is competitive benchmarking only — these are external products to learn from, not engines Clevar derives from.

---

## Intercom Fin

**Configuration model — Guidance (the prompt system).**
- "Guidance" = natural-language instructions in **five categories**: Communication Style (tone/terminology), Context & Clarification, Content & Sources, Spam, Other (policies/rules). (*Provide Fin with specific guidance*)
- Hard limits: **≤2,500 chars per piece, ≤100 pieces live** workspace-wide. Too many rules degrade quality/speed/accuracy and create conflicts; emphasize critical rules with CAPS (NEVER, IMPORTANT). (*Guidance*; *Guidance best practices*)
- Each rule must be **atomic** (one objective), **conditional** (if/when/then), second-person command, contradiction-free. **Rules are evaluated independently every turn and cannot chain or trigger one another.** (*Guidance best practices*)
- Built-in **AI writing assistant** reviews guidance for ambiguity, redundancy, contradiction, clarity, and unsupported actions, and suggests rewrites. (*Guidance*) — *Clevar parallel: the Optimize button.*
- **Critical limitation:** Guidance is evaluated **BEFORE** Fin searches content, so "if you don't know, escalate" **doesn't work** — Fin hasn't yet determined it lacks an answer. Abstention-on-uncertainty can't be a pre-search instruction. (*Guidance best practices*)
- Guidance **can't take actions** except hand-over-to-team — no routing to specific inboxes, tagging, or attribute updates; those need **Workflows / Escalation Rules / Procedures**. Clear separation between prompt and gated action systems. (*Guidance*)
- Multi-step processes → **Procedures** (separate construct), not Guidance. (*Guidance best practices*)

**Tone & length — discrete presets, not free text.**
- Tone = one of **5 named presets** (Friendly, Neutral, Matter-of-fact, Professional, Humorous), each a fixed character description. **Emojis only under Humorous/Friendly.** (*Customize tone & length*)
- Length = **3 discrete settings** (Concise ≈30% shorter, Standard, Thorough ≈30% longer). Thorough yields ~**+2% resolution** over Concise. Length governs answers only, not greetings/clarifications. (*Customize tone & length*)
- Best practice: use the length *setting* as default; only add Guidance for stricter/channel-specific limits (e.g. <1,000 chars for social). (*Guidance best practices*)

**Grounding & abstention — confidence-based.**
- RAG over past conversations, help articles, PDFs, HTML/URLs, plus data/integrations. **Validation check** confirms the response is grounded before sending. (*The Fin AI Engine*; *Knowledge sources*)
- When confidence is low → **abstain**: share context, express uncertainty, ask to clarify, or partial answer. When safety params fail → say it can't answer + **escalate**. Also compares generated response against the original query. (*Why Fin may not answer*; *The Fin AI Engine*)
- Explicit handoff guardrail: if a customer asks for a human **before** posing a question, Fin escalates immediately without attempting an answer. (*Why Fin may not answer*)
- Content guidance is **soft prioritization** — Fin combines a "preferred" source with others it deems relevant, and may **override** "Don't use [article]" if it judges that article the best match. (*Guidance*)
- Freshness asymmetry: native Intercom articles/snippets ingest **near-instantly**; external URLs refresh **weekly**. Accuracy is curated **reactively** (fix the source → answer updates); no proactive audit documented. Macros aren't usable by Fin. (*Knowledge sources*)
- Multilingual: answers grounded in the KB language; without real-time translation a language mismatch causes total abstention; with it, Fin translates the question into the KB language. (*Why Fin may not answer*)

**Actions — Tasks, Procedures, Data connectors.**
- **Fin Tasks**: trigger via Title + Description (Description states when NOT to fire) refined with positive/negative example questions. Instructions are step-based, **start each with a verb**. Gated by **channel + audience** (AND/OR attribute rules). Actions include Escalate-to-team, Add-tag, and **identity verification via emailed OTP** before acting. Validated pre-deploy via **Simulations** (success criteria) + Preview; draft/live versioning. (*How to set up Fin Tasks*)
- **Data connectors** (external-data actions): Fin picks which connector by **name + description** (naming = routing lever). Auto-trigger from the question, or gate to Workflow/Procedure/Macro. Typed inputs (Text/Number/Decimal/Bool) with operator fallback values for nulls. **15 s timeout** (30 s in Procedures), dev-hub permission, audience rules, 14-day logs, phased rollout, draft/live versions. (*Data connectors*)

---

## Zendesk — agentic AI ("generative procedures")

**Configuration model — describe policy, don't script trees.**
- Operators describe business policies in **natural language**; the AI autonomously runs the conversation. "Generative procedures" replace rigid decision-tree flows. (*About AI agents with agentic AI*)
- Procedures = numbered sequential steps with conditional **IF/THEN** logic + NL instructions. Actions/APIs invoked via **inline syntax** (`action /updateOrderNumber`, `Trigger API /checkOrderStatus`); session variables templated into responses (`{{orderStatus}}`). (*Examples of generative procedures*)
- Authoring best practices: **imperative, simple, direct** steps ("Check if…", "Ask the customer…", "Escalate if…"); **one action per step** (decompose complex processes); explicit If/then per branch; **consistent terminology** for entities (anti-ambiguity); explicit error-handling/escalation for missing/contradictory data; emphasize mandatory steps via CAPS/formatting. (*Best practices for generative procedures*)
- Tone/persona steered **inline** via NL behavioral instructions in steps (e.g. "express empathy, thank the customer") — no separate persona control. (*Examples of generative procedures*)

**Actions — Make API call step.**
- Declared action: HTTPS endpoint + one of **5 methods** (GET/POST/PUT/PATCH/DELETE), optional headers, body. (*Make API call step*)
- **Auth must use pre-created API connections, not headers** (headers-for-auth forbidden) — action gated behind a managed connection. (*Make API call step*)
- Inject conversation variables into URL path/query (not domain); skip invalid/empty. Responses parsed back into variables: **≤12 vars/step, first 280 chars each**. **10 s timeout**, explicit **Success/Failure branches** (4xx/5xx or null var → Failure). External-system integration described to the AI as **API context**, not hand-coded calls. (*Make API call step*; *About agentic AI*)

**Escalation.**
- Two channels: **messaging + email**; strategy defines which queries escalate and via which channel. Triggers: can't resolve, or complex/urgent/sensitive. Configured via **escalation blocks** in the dialogue builder. Default route = CRM-integration group, or a designated escalation team. Reaching an empty message block does **not** auto-escalate if other use-cases remain. (*Configuring escalation strategies*)
- Auto-escalate on **out-of-scope** (incl. small-talk + out-of-scope combos); **disambiguates** vague requests by asking before answering; for email, escalates messages bundling multiple procedure requests or mixing a knowledge question with a procedure. (*About agentic AI*)

---

## respond.io — AI Agent

**Configuration model — Instructions + Knowledge Sources.**
- Single **Instructions** field defines role/tone/behavior; **`@`-mention** routing (`@Support Team`). (*Getting Started*)
- Official prompt structure = **four parts: Context, Role & Communication Style, Flow, Boundaries** (Boundaries enumerates what NOT to do — legal/medical/financial advice). Format with markdown headers, point-form, logical step order (**Greet → Ask → Decide → Assign**); **up to 10,000 chars**. (*How to Write Effective AI Agent Prompts*)
- Built-in **Prompt Optimizer** ("Optimize" button) rewrites both general instructions and per-action prompts. (*How to Write Effective AI Agent Prompts*) — *direct analog to Clevar's Optimize.*
- Best practice: define an action in **both** the NL instructions **and** the structured action settings to improve accuracy; control scope via "ask one question at a time / keep replies short." (*How to Write Effective AI Agent Prompts*)

**Actions — a real catalog (⚠️ corrects the "only 4 actions" misconception).**
- Full catalog = **~9 actions**: Make HTTP requests, Update tags, Handle Calls, Trigger Workflow, Add comments, Update Contact fields, Update Lifecycle stage, Close conversations (with summaries/notes), Assign to agent/team. (*Using AI Agent Actions*; *AI Agent Actions catalog*)
- **Pre-enabled actions are per-template**, not a fixed four: Receptionist 2 / Support 2 / **Sales 4** — and they're editable. (Verified — this corrects an extracted claim that respond.io ships a fixed 4-action set; that claim was the *Getting Started* default-template view, not the full catalog.)
- Assign/handoff targets: human agents, teams, **or other AI Agents**. Handoff routing supports specific teams, individuals, other agents, **round-robin**, or **"least open conversations."** Manual takeover via a Takeover callout halts the agent + reassigns. (*AI Agent Actions catalog*; *How to Write Effective Prompts*; *Getting Started*)
- Actions can be **chained** by the agent (overview doesn't specify sequencing/gating rules). Can trigger respond.io **Workflows** as a tool. (*Using AI Agent Actions*)

**Grounding & abstention.**
- Operators upload documents/URLs as **Knowledge Sources**. (*Getting Started*)
- ⚠️ Documented limitation: AI **cannot prioritize/rank/choose** among knowledge sources and searches by **keywords inside content** (not by title) — operators must tell it which keywords to search. **However**, respond.io's RAG was upgraded (shipped 2025-07-17) to **semantic/vector retrieval that ranks and uses the top-10** — so "keyword-only" is outdated for retrieval even though the "can't choose source" limitation stands. (*Managing AI Knowledge Sources*; corrected against respond.io blog *How respond.io AI Agents work* + Canny changelog)
- Accuracy best practices: topic-specific sources (don't mix topics in one file), strip branding/footer/disclaimer noise before upload. (*Managing AI Knowledge Sources*)
- KB limits: **20 MB/workspace, ≤100 file sources, 20 MB/file** (1 MB trial), crawl **depth 3** (up to 100 pages). Manual Resync or scheduled auto-sync; processing states (Completed/In Progress/Error/Partially Completed). Excludes Google Sheets, private links, Snippets. (*Managing AI Knowledge Sources*)
- Out-of-scope handling is **prompt-driven escalation**, not a dedicated hallucination detector — agents are told to admit when something isn't in the catalog and hand off. (*Getting Started*)

---

## Cross-cutting patterns (what all three converge on)

1. **Two-layer architecture: prompt/guidance ≠ actions.** Tone/persona/Q&A live in NL instructions; consequential actions live in a **separate gated system** (Fin Workflows/Tasks, Zendesk API-call steps, respond.io structured Actions). Prompt text alone never executes actions.
2. **Atomic, conditional, imperative instructions.** All three prescribe one-objective if/then rules in second-person verbs; all warn that too many rules / vague language degrade accuracy. Fin and respond.io ship **prompt optimizers**.
3. **Structured tone control.** Fin = 5 presets + 3 lengths (discrete knobs, measurable resolution tradeoff). respond.io/Zendesk = inline NL tone.
4. **Abstention + escalation are first-class, but mostly confidence/keyword-driven.** Fin has true confidence-based abstention + pre-send grounding validation (most mature). Zendesk auto-escalates out-of-scope/ambiguous/bundled. respond.io leans on prompt-driven escalation.
5. **Action gating + timeouts + failure branches.** Zendesk: managed connections only, 10 s timeout, Success/Failure branches, ≤12 vars × 280 chars. Fin connectors: 15 s, typed inputs, fallbacks, 14-day logs, draft/live. **Identity verification (OTP) before sensitive Fin Tasks.**
6. **Tool/connector routing by name+description** (Fin Data connectors) — same lesson as the technical sweep: naming is a routing lever.
7. **Validation before deploy** — Fin Simulations (success criteria) + Preview, draft/live versioning. None ship a public faithfulness-metric harness — an opening for Clevar.

### Anti-hallucination consensus (support-specific blogs)
- RAG-only-from-retrieved-content is the primary technique; add a **response-validation layer** (grounding ≠ correctness). (*IrisAgent*)
- **Escalate when confidence < threshold; 0.85** a recommended start. (*IrisAgent*)
- **Cite the specific KB article/section** per answer → faster audit + **~8–12% CSAT lift**; aim for citation coverage on every response. (*IrisAgent*)
- Citation enforcement alone doesn't guarantee accuracy (models fabricate plausible URLs) — pair with verification; use a **retraction fallback**. (*How to Force Claude to Cite Sources*; Zep)
- **CiteGuard**: retrieval-augmented validation lifts citation-attribution +10 pts to **68.1%** (≈ human 69.2%); gains come from a **bigger retrieval action set** (search full text, fetch surrounding context). Note **LLM-as-judge is unreliable for citation verification** (recall as low as 16–17%); ungrounded LLMs fabricate **78–90%** of citations. (*CiteGuard*, arXiv)

---

## Clevar gap analysis & priorities

Clevar already has (per build state): Studio with mode/tone/style/objectives/constraints/temperature/greeting, **if-then rules + handoff** (`agent-rules.ts`, zero-LLM keyword + ask-for-human), **Actions** with per-action enable/guideline + dry-run (close/assign/note/label/update-contact-field live; workflow/calls/http stubbed), **Optimize** button, URL/text/.md ingestion, chunked **lexical** RAG.

**Already at parity or ahead**
- Optimize button = Fin/respond.io prompt optimizers. ✓
- Per-action enable + NL guideline = respond.io's "define in both instructions and settings." ✓
- Zero-LLM keyword/ask-for-human handoff works even with AI off = pragmatic, matches respond.io manual takeover. ✓
- 3-pane inbox + live tester = respond.io editor parity (already noted in build log).

**Clear gaps worth closing (priority order)**
1. **Tone presets + discrete length control** (Fin's 5 tones / 3 lengths with the measurable tradeoff). Clevar has tone presets + style(220/420/750 tok) — close; consider Fin's "emoji only on Friendly/Humorous" determinism and surfacing the resolution/length tradeoff.
2. **Confidence-based abstention + pre-send grounding validation** (Fin's most mature feature; the IrisAgent 0.85 threshold). Clevar's abstention is prompt-instructed only — add a validation pass + confidence gate. (See [agent-rag-security-research.md](agent-rag-security-research.md) §2/§5.)
3. **Per-answer citation** (KB article/section) — CSAT lift + auditability; none of the three nails sentence-level, so this is a differentiation opening.
4. **Action gating maturity**: timeouts, explicit Success/Failure branches, typed inputs/fallbacks for the http/calls actions when un-stubbed (Zendesk/Fin patterns). Add **OTP/identity verification** before sensitive actions (Fin Tasks).
5. **"Guidance is pre-search" trap** — Clevar should make abstention a *post-retrieval* decision, not a pre-search instruction (Fin's documented failure mode).
6. **Procedures/multi-step** construct — both Fin and Zendesk separate single-turn guidance from sequenced procedures. Clevar's workflow canvas could host this; wire agent → workflow (currently a premium stub).
7. **Pre-deploy validation (Simulations)** with success criteria + draft/live versioning for agents — Fin parity, and pairs with the eval harness in the companion doc.

**Caveats carried from refuted claims**
- Don't model respond.io as a 4-action product — it's ~9, per-template defaults. Build Clevar's catalog toward the fuller set (http, tags, calls, trigger-workflow, comments already partly stubbed).
- "Keyword-only KB" is outdated for respond.io retrieval (now semantic top-10) — so lexical-only is *behind* a key competitor; reinforces the hybrid-retrieval priority in the companion doc.
