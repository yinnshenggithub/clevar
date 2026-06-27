# Agent RAG, Action-Reliability & Security — Research Reference

Recovered + synthesized from a 113-agent deep-research sweep (2026-06-27): 30 sources → 144 extracted claims → 63 upheld / 2 refuted under adversarial verification. Topic: best architecture for a production support+sales agent on **Next.js + Vercel AI SDK + Postgres/Neon**, covering (1) reliable instruction-following + tool/action execution and (2) accurate KB-grounded RAG. Companion to [competitor-agent-research.md](competitor-agent-research.md) (Fin/Zendesk/respond.io teardown) and [ai-chatbot-research.md](ai-chatbot-research.md) (prompt/context engineering).

Sources cited inline by short title + publisher. "primary" = official docs / peer-reviewed; "blog" = practitioner write-up.

---

## 1. Retrieval architecture (Postgres-only stack)

**Hybrid (BM25 + vector) beats either alone, and can live entirely inside Postgres.**
- Lexical and vector search have *complementary failure modes*: BM25 nails exact tokens (product codes, error codes, part numbers, proper nouns) but misses synonyms/paraphrase; vector captures concepts but is fuzzy on exact identifiers. Run both, fuse — don't choose. (ParadeDB *Hybrid Search Missing Manual*; Tiger Data *Yes You Can Do Hybrid Search in Postgres*; *Hybrid Search and Re-Ranking in Production RAG*)
- Measured lift: one practitioner went **pure-vector → hybrid+RRF and retrieval precision rose ~62% → ~84%**, near-perfect on exact-match queries. (*Building Hybrid Search for RAG with RRF*)
- Cost of hybrid: roughly **+13 ms P50** (≈12 ms → 25 ms on a small corpus). (*Self-Hosted RAG with pgvector: 2026 Guide*)

**Fuse with Reciprocal Rank Fusion (RRF), not score normalization.**
- Cosine similarity and `ts_rank` are on incompatible scales; RRF fuses on **rank position only**: `sum 1/(k + rank)`, **k = 60** (Cormack et al. 2009). Scale-independent, no normalization needed. (ParadeDB; Tiger Data *pg_textsearch*; *Building Hybrid Search for RAG*)
- Weighted RRF can bias toward lexical or semantic (e.g. 70% weight on BM25 for technical docs), and the same machinery extends to recency/popularity signals via per-signal candidate lists. (ParadeDB)
- Alternative linear fusion: min-max each score to 0–1 then `ALPHA*vec + (1-ALPHA)*bm25`, default **ALPHA ≈ 0.7** (semantic-leaning); lower ALPHA (0.35–0.5) for corpora full of exact identifiers. Optimal alpha is corpus-dependent. (*Stop the Hallucinations*; *Hybrid Search and Re-Ranking*)

**`ts_rank` (what Clevar uses today) is the weak link.**
- Native Postgres FTS ranking scores docs *in isolation* with **no inverse-document-frequency** — common words weigh the same as rare discriminating terms. BM25 adds IDF weighting, term-frequency saturation (anti keyword-stuffing), and document-length normalization. (ParadeDB; Tiger Data *From ts_rank to BM25*)
- `ts_rank` also **scales badly**: one team saw queries go from <1 s to **25–30 s on 800k rows** (I/O-bound). (Tiger Data *pg_textsearch*)
- Upgrade paths inside Postgres: `pg_textsearch` (true BM25, transactional inverted index, but preview keeps the index in-memory, default 64 MB) or ParadeDB; pair with `pgvector` for the vector half.

**Chunking.**
- Default **500–800 tokens with ~50-token overlap** for prose. Chunk size affects retrieval quality *more than model choice*. (*Self-Hosted RAG*) — Clevar's current ~900-char sentence-aware overlap (`src/lib/chunk.ts`) is in the right ballpark; tune toward token-based sizing.
- The AI SDK reference RAG ships naive sentence-splitting and explicitly says optimal chunking is use-case dependent. (*Vercel AI SDK RAG Guide*)

**Over-fetch then trim/rerank.**
- Retrieve **20–40 candidates at the SQL layer**, then rerank/truncate to the **6–10 chunks the LLM actually sees**. Don't under-retrieve. (*Self-Hosted RAG*; *Building Hybrid Search* uses ~20/source → top 10)
- A **cross-encoder reranker** (e.g. `ms-marco-MiniLM-L-6-v2`) re-scores candidates jointly (query+doc tokens attend to each other) — more accurate than bi-encoders but can't scale to a full corpus, so use the **two-stage funnel**: bi-encoder retrieves top-N, cross-encoder re-scores only those. Cost ≈ **20 ms** for a few passages, **~80–120 ms** when reranking 20 docs on CPU. It raises precision (0.71→0.79) but **not recall** — it only reorders what was already retrieved. (*Hybrid Search and Re-Ranking*; *Stop the Hallucinations*)
- **HyDE** lifts recall: have the LLM draft a short hypothetical answer, embed *that* for vector search, and optionally feed it to BM25 too (dual-BM25) to surface domain synonyms. (*Stop the Hallucinations*)

**When (not) to add a dedicated vector DB.**
- `pgvector` + HNSW is **production-grade to ~100k–1M docs** (≈1–5M chunks), with **<20 ms at 1M vectors and >95% recall**. (*Self-Hosted RAG*; Encore *pgvector Guide*)
- A separate vector DB is only justified at **billions of vectors**, massive real-time write throughput, large multi-tenant filtered search, or zero-tuning managed autoscale. (Encore)
- Staying in Postgres buys **transactional consistency** (doc + embedding in one write; no dual-write orphans), one fewer system to run/monitor, and avoids an extra failure point. Vector search is rarely the latency bottleneck anyway — embedding calls (100–300 ms) and generation (500 ms–3 s) dominate. (Encore) — **Strong support for Clevar's Postgres-only posture.**

---

## 2. Grounding, abstention & citations

**Grounding is an atomic-claim property, not "did it cite a doc."**
- Decompose the answer into atomic claims; each must be *materially* supported by retrieved evidence with correct scope/interpretation/certainty. Score = supported_claims / total_claims. (*RAG Grounding: 11 Tests*; Ragas Faithfulness)
- Document-level citation is a named **failure mode**; citations should be traceable at the **sentence/fact level**. (*11 Tests*; *Know Or Not*)
- "Citation relevance swap" test: replace cited chunks with keyword-similar but semantically different ones — if the answer doesn't change, the citation was decorative. (*11 Tests*)

**Abstention must be designed in — RAG alone doesn't produce it.**
- Same model, same KB: a basic prompt abstained **only 1.8%** of the time on out-of-KB questions; a conservative "rely strictly on context / say I don't know" prompt + RAG **exceeded 60%**. (*Know Or Not*, arXiv)
- SOTA RAG still hallucinates on OOKB queries and keeps answering despite "only answer when certain" — so build + *evaluate* abstention explicitly. (*Know Or Not*)
- Concrete techniques: instruct context-only answering + a **fixed refusal phrase**; **penalize wrong answers more than declining**; cite **by fact-number** and say "I don't know / no citation" when nothing matches; a **retraction fallback** (drop an unsupported claim entirely rather than hedge). (*Know Or Not*; Zep *Reduce LLM Hallucinations*; *How to Force Claude to Cite Sources*)
- Runtime hallucination detection: sample the answer several times at temp ≈ 0.8 and measure semantic agreement; high disagreement → abstain/escalate. (Zep)

**Anthropic-specific grounding moves (relevant — Clevar defaults to Claude Haiku):**
- Have the model **extract relevant quotes into XML tags first**, then answer. (*Anthropic Prompting Docs*)
- Place long documents **at the top** of the prompt (above the query), each wrapped in XML with source/content metadata — up to **+30%** quality on complex multi-doc inputs. (*Anthropic Prompting Docs*)
- Forbid claims about unread content; require investigating sources before answering. (*Anthropic Prompting Docs*)

---

## 3. Action reliability (tool / function calling)

**Architecture: LLM decides, deterministic code executes.**
- The model only emits a *structured description* of a call (name + JSON args). Validation, authorization, execution, and next-step decisions belong to an **external orchestrator** with explicit allow/forbid/escalate policy — the canonical pattern for "if X then Y" actions (close, assign, update CRM field). (*Context Engineering* paper; StackAI; *LLM function calling best practices*; ML Mastery)
- Canonical loop = request → (app validates/authorizes/executes) → respond, possibly multi-step. The AI SDK automates this: appends responses to history, validates args against the Zod schema, executes, loops until `stopWhen`/`stepCountIs`. (OpenAI docs; *Vercel AI SDK* KB) — Clevar already does this (`buildActionTools`, `maxSteps:5`).

**Fewer tools = more reliable. This beats upgrading the model.**
- Tool-selection accuracy **degrades as the tool count grows**. OpenAI: keep **<20 functions** active per turn, defer rare ones via tool-search. (OpenAI docs)
- From 1,200 production deployments: *reducing tool count/complexity improved reliability more than a more capable model* — Cubic removed tools + forced reasoning logs instead of upgrading. Start with **1–5 high-impact tools**, expand gradually. (ZenML *LLMOps 2025*; ML Mastery; *LLM function calling best practices*)
- Contextual tool filtering (retrieve only relevant tools via a mini-RAG over the tool set) mitigates large catalogs. (Kubaski *Tool Best Practices*)

**Tool names/descriptions ARE prompts.**
- Models select tools probabilistically by name/description similarity. A correct tool sat **unused for two weeks** until `example_queries` was renamed `known_good_queries`. Treat naming as a first-class reliability lever. (ZenML)
- Each tool + every parameter must be clearly documented; ambiguous/overlapping descriptions cause wrong selection. Descriptions are guidelines — **validate all params independently**. (Kubaski; StackAI)

**`strict` / Structured Outputs — what it does and does NOT do. ⚠️ (refuted overreach corrected)**
- `strict:true` guarantees **structural** conformance only: correct field names/keys, declared types, no extra properties. (OpenAI docs)
- It does **NOT** guarantee semantic correctness — the model can still put wrong *values* in well-formed fields; it doesn't remove the need for app-level validation; parallel function calls are incompatible with strict; refusals/truncation can break adherence; only a subset of JSON Schema is supported. **Keep server-side validation regardless.** (Verified against OpenAI *Introducing Structured Outputs* + function-calling guide — this corrects a claim the sweep initially overstated.)
- Schema authoring rule for strict mode: every object sets `additionalProperties:false`, all fields `required`, optionals expressed via a `null` type. (OpenAI docs)
- `tool_choice` enables deterministic routing: `auto` (0–many), `required` (≥1), a named function (force one), `allowed_tools` (restrict subset). (OpenAI docs)

**Reliability scales with model capability + a "decide-then-call" contract.**
- Smaller models (4o-mini, 4.1-nano/mini) unreliably invoke tools — wrong tool, redundant repeat calls; only the most capable behaved consistently. (Kubaski) — *relevant: Clevar defaults agents to Haiku; consider a capability floor for action-heavy agents.*
- Asking the model to **state its plan before executing** (no forced `tool_choice`) improves selection. Enforce "collect all needed params before calling" to stop speculative tool-spam. (Kubaski; *LLM function calling best practices*)
- Instrument every call/response/error — tracing revealed hidden retry loops and **halved cost** in one case. (*LLM function calling best practices*)

**Human-in-the-loop on consequential actions.** Mutating/destructive tools (update/delete) and high-stakes ops should require explicit human validation, not autonomous execution. Categorize tools: read-only Data Access / Computation / consequential Actions — gate the third. (Kubaski; ML Mastery; OWASP)

---

## 4. Security & prompt-injection defense

**The hard truth: prompt-level instruction hierarchy is NOT a reliable guardrail.**
- *Control Illusion* (across 6 SOTA models): when two instructions conflict, the **Primary Obedience Rate was only 9.6–45.8%**, even though the same models obeyed each constraint individually 74.8–90.8%. Operator system-prompt constraints **cannot be assumed to override** conflicting user input.
- Explicitly declaring priority ("you must always…") only modestly helps and stays unreliable (emphasized-separation: 63.8% GPT-4o, 47.5% Claude; pure separation as low as 6.8–20.3%). Models rarely even *recognize* a conflict exists (Conflict Acknowledgment 0–20.3%).
- Not fixed by scale, prompting tweaks, or fine-tuning — a **fundamental architectural limitation**. (*Control Illusion*, arXiv)
- OpenAI's *Instruction Hierarchy* training helps (system > user > third-party; +63% on prompt-extraction defense, +30% jailbreak robustness incl. held-out attacks) but is a *training-time* mitigation, not something you can fully buy at the prompt layer. (OpenAI *Instruction Hierarchy*)

**Therefore: move safety from prompts into infrastructure (defense-in-depth).**
- No prompt-only defense fully prevents injection; layer input validation, structured prompting that **separates system instructions from user data**, output filtering, and human review. (OWASP *Prompt Injection Prevention Cheat Sheet*)
- A guardrail/LLM-as-judge at input/output/action-screening points is recommended **but is itself injectable** — never the sole defense. (OWASP)
- Architectural/session-level guardrails beat prompt constraints: e.g. **session-state "tainting"** that blocks tool use after the session touches untrusted data. Safety should move from prompts into infra. (ZenML)
- **Control-flow isolation** is the core principle: once an agent ingests untrusted input, structurally prevent that input from triggering consequential actions. (*Design Patterns for Securing LLM Agents*, arXiv)

**Design patterns (arXiv *Design Patterns for Securing LLM Agents*):**
- **Action-Selector** — translate NL requests into one of a *fixed* predefined action set, with no feedback from tool outputs back into the agent (an LLM-modulated switch). Immune to injection; fits constrained "close/assign/label" actions.
- **Plan-Then-Execute** — fix the plan of allowed tool calls *before* processing untrusted data, so injected instructions can't change *which* actions fire. Caveat: doesn't protect action *parameters* from untrusted influence, nor injections in the user prompt itself.
- **Dual LLM** — untrusted data goes to a quarantined, tool-less LLM; results returned as variables to a privileged LLM that handles symbols, not raw text. Isolates actions; the quarantined LLM can still be injected. Security costs generality.

**Guardrail detectors are empirically bypassable.**
- Emoji-smuggling / upside-down-text character injection reaches **up to 100% attack success** against production injection/jailbreak detectors. (*Bypassing LLM Guardrails*, arXiv)
- All major detectors individually vulnerable (Azure Prompt Shield, ProtectAI, Meta Prompt Guard, NeMo Guard, Vijil): character-injection ASRs up to 87–92%. Best-of-N jailbreaking: **89% on GPT-4o, 78% on Claude 3.5 Sonnet**. Root cause: the guardrail is trained on a different tokenizer/dataset than the LLM, so it's blind to perturbations the LLM still parses. Robustness varies wildly (Meta Prompt Guard 2.76% ASR best-case), so detector choice matters — but none is sufficient alone. (*Bypassing LLM Guardrails*; OWASP)

**Least privilege + risk-gated approval.** Run under minimal perms (read-only DB accounts where possible, restricted API scopes). Gate high-risk actions (sensitive keywords password/api_key/admin, or pattern matches) behind human approval via risk scoring. Per-tool auth (API keys/OAuth/service accounts). (OWASP; ML Mastery; Kubaski) — *maps directly to Clevar's RLS + per-action enable/guideline model.*

---

## 5. Evaluation harness

**Four-metric core** (retrieval precision, retrieval recall, groundedness, answer quality), evaluated in **three isolated stages** — retrieval, then generation, then full pipeline — not just end-to-end. (*Evaluating RAG Quality*; *RAG Evaluation Metrics 2026*)

**Faithfulness / groundedness = claim-decompose + verify each claim against retrieved context** (reference-free, LLM-as-judge). Production thresholds: **faithfulness ≥0.90** (≥0.95 high-stakes), **context recall ≥0.85**. Pin judge temperature for reproducibility. (Ragas; *RAG Evaluation Metrics 2026*)
- ⚠️ Faithfulness only catches *inference-layer* hallucination (contradicting retrieved content). It **cannot detect stale/wrong source material** — you can score 0.95 faithful while serving wrong answers from bad sources. Curate sources separately. (*RAGAS/TruLens/DeepEval Compared*)
- Cheaper groundedness: Vectara **HHEM-2.1-Open** (small T5 classifier) instead of an LLM judge. (Ragas)

**Tooling fit:** Ragas (offline dataset scoring), **DeepEval (pytest-style CI gate that breaks the build on failure**, 50+ metrics), TruLens (production observability, RAG-Triad span tracing). (*RAGAS/TruLens/DeepEval Compared*; *RAG Evaluation Metrics 2026*)

**Golden set:** 50–200 representative queries to start; for statistical significance ~**246 samples per slice** (80% pass, 5% margin, 95% conf). Promote synthetic "silver" → "gold" via SME review + evaluator-agreement; decontaminate against training data. (*RAG Evaluation Metrics 2026*; *Building a…* golden-dataset source)

**Cadence + safe rollout:** continuous sampled scoring on prod traffic + full golden-set on every release + quarterly adversarial/red-team. Roll out actions in **shadow mode** — agent predicts actions, an LLM-judge compares to human decisions, enable live only once shadow accuracy crosses a threshold (Ramp's pattern). The last 5% of quality is the expensive tail: ~80% comes fast, >95% eats most of the dev time. (*Evaluating RAG Quality*; ZenML)

---

## 6. Clevar implications — prioritized

Current state (per build state): RAG is **lexical-only** (`websearch_to_tsquery` + `ts_rank`, top-6 chunks, GIN FTS), agents default to **Claude Haiku**, actions run via AI SDK tool-calling with per-action enable/guideline + dry-run, handoff rules are zero-LLM keyword/ask-for-human (`src/lib/agent-rules.ts`). No embeddings, no reranker, no eval harness.

**High leverage, low effort**
1. **Conservative grounding + abstention prompt** — biggest accuracy win per the *Know Or Not* 1.8%→60% result. Force context-only answering, fixed refusal phrase, cite-by-fact-number. Mostly a `buildAgentSystemPrompt` change. (Partially present already — make abstention explicit + measured.)
2. **Over-fetch → rerank to top-k** — fetch 20–40 chunks, trim to 6–10. `retrieveContext` already returns top-6; add the wider candidate pool first.
3. **Capability floor for action-heavy agents** — Haiku is fine for grounded Q&A; bump model when many tools/destructive actions are enabled (Kubaski/ZenML). 
4. **Keep server-side validation on every action** regardless of any future strict-mode (refuted-claim lesson).

**Medium**
5. **`ts_rank` → BM25** via `pg_textsearch`/ParadeDB — fixes the no-IDF weakness + the 800k-row latency cliff before it bites. Stay in Postgres.
6. **Hybrid retrieval** — add `pgvector` (HNSW, cosine) alongside FTS, fuse with **RRF k=60**. The 62%→84% precision lift is the headline result. Confirmed unnecessary to leave Postgres until ~1–5M chunks.
7. **Eval harness** — DeepEval in CI as a deploy gate; golden set of 50–200 queries; faithfulness ≥0.90 threshold.

**Architectural (security)**
8. **Session tainting / control-flow isolation** — once a conversation ingests untrusted inbound content, gate consequential actions (the *Design Patterns* + ZenML pattern). Clevar's per-action toggles + RLS are a good base; add a taint check before mutating tools.
9. **Risk-gated HITL** on destructive actions; treat any guardrail/LLM-judge as *one* layer, never the only one.

> Note on instruction hierarchy: do **not** rely on "system prompt always wins" — *Control Illusion* shows 9.6–45.8% obedience under conflict. Operator guardrails that must hold (no refunds/discounts, escalate on sensitive topics) belong in **code/action-gating**, not only in the prompt.
