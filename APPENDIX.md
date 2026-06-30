# Appendix — System design reference

Optional reading after the main lab exercises. This appendix is **reasoning about the system** — constraints, tradeoffs, scaling logic, and eval philosophy.

**Structural diagrams** (what exists and how it connects) live in [docs/architecture-reference.md](./docs/architecture-reference.md). No narrative there — just bounded views.

**Golden rule:** Appendix = *why and how it evolves* · Diagrams = *simplified truth of the system*

**Legend (all diagrams):** Solid = implemented today · Dashed = conceptual / future / conditional

**Today (MVP):** Expo clients → Node API on managed PaaS (e.g. Heroku) → Supabase → OpenAI + Google Vision.  
**Not today:** Kubernetes, microservices, multi-region DR, or cloud Terraform in production.

**Hands-on — Trust the Gate (Part 3):** [README Part 3](./README.md#part-3--trust-the-gate-optional) — local kind + Terraform eval Job; no managed cloud infrastructure required.

---

## 1. System framing

ScanAndFindIt is a **wellness education app**: food and label scanning, nutrition goals, a health timeline, and an in-app AI assistant. The production system is a **modular monolith** — one deployable Node API with clear internal module boundaries, not four independent services.

| Concept | Meaning |
|---------|---------|
| **Modular monolith** | One API process and one deploy unit; domains (scan, assistant, platform, integrations) are **logical modules** with contracts between them |
| **Real today** | Expo client, Node API on managed PaaS, Supabase (Postgres + Auth), OpenAI, Google Vision, CI eval gates |
| **Conceptual / future** | Service splits, Kubernetes lift, event bus + workers, CDN/WAF, analytics warehouse — introduced only when **operational metrics** justify them |

**Why microservices are not the default:** A single API keeps deploy coupling low, eval gates simple, and operational cost appropriate for MVP. Distributed systems add network failure modes, cross-service consistency work, and infra toil before user-facing problems require them. Service extraction is a **downstream response to sustained pressure**, not a starting architecture.

Pick **one** cloud for production if you eventually lift to Kubernetes — mixing GCP and AWS control planes adds operational cost without user benefit.

> Hero diagram — current modular monolith: [architecture-reference §1](./docs/architecture-reference.md#1-current-system) · Domain boundaries inside the monolith: [§2](./docs/architecture-reference.md#2-domain-module-map)

---

## 2. Current architecture reality

Mobile and web clients call **one public API URL**. The API orchestrates scans, goal math, timeline writes, and the assistant. User data lives in **Supabase** (Postgres + Auth + RLS). Heavy or bursty work (Vision labels, LLM generation) runs as **synchronous API calls** to managed vendors today — not a separate worker fleet.

| Piece | Role |
|-------|------|
| **Expo client** (iOS / Android / Web) | Scan UI, goals, timeline, assistant — six locales |
| **Node API** | Auth, rate limits, module orchestration, eval-gated routing |
| **Supabase** | Profiles, health events, goals, assistant threads |
| **OpenAI** | Assistant generator (+ optional evaluator judge in production) |
| **Google Vision** | Scan labels, OCR, safe-search |
| **Public data APIs** | USDA nutrition, openFDA, Open Food Facts |
| **GitHub Actions** | CI population + agent eval gates in this lab |

This is the **right shape for MVP** — one deployable unit, strong module structure inside, eval contracts version-controlled.

Request paths today: client → API route → Supabase read/write → optional Vision or LLM call → response. No message bus between domains yet. See [architecture-reference §3 — Data flow](./docs/architecture-reference.md#3-data-flow).

---

## 3. Domain model (logical modules)

All four domains live **inside the same monolith process** today. Boundaries are enforced by code structure and contracts, not network hops.

| Module | What it owns | Why it is a boundary |
|--------|--------------|----------------------|
| **Scan** | Food/plastic/drug/pet scans, nutrition lookup, Vision/OCR | Burst traffic and per-call Vision cost |
| **Assistant** | Chat, voice, tool routing, thread history, safety pipeline | LLM cost, long-lived connections, integrity-critical routing |
| **Platform** | Profile, health timeline, goals, check-ins | Steady CRUD; single writer for timeline events |
| **Integrations** | Wearables, weather, health news, maps | OAuth tokens, scheduled sync jobs |

**Social** (teams, feed, wellness studio) is deferred until v3 scale needs it — not a core boundary today.

### In-app AI assistant

Chat, voice, and in-thread images share one **server-side agent workflow** and up to **three skills per turn**. The client only executes `action` payloads (navigation, scan targets).

| Layer | Role |
|-------|------|
| **Safety** | Blocks jailbreaks and unsafe images before the LLM runs |
| **Understand** | Parses intent, locale, multimodal context |
| **Skills** | Injects up to 3 skill bodies (disclaimers, routing priority) |
| **Tools** | Nutrition lookup, SDOH, Healthy Map, internet search, scans, etc. |
| **Respond** | LLM reply + patient-education citations |

> Lab-level assistant diagram: [README Part 2](./README.md#part-2--trust-the-agent) · Data-flow view: [architecture-reference §3](./docs/architecture-reference.md#3-data-flow)

### Retrieval & citations (RAG)

The assistant uses **retrieval-augmented generation** — replies are grounded on **fetched data injected into the prompt**, not on the model's memory alone. This is **not** a private document vector database in production today.

| Retrieval source | What it pulls | When |
|------------------|---------------|------|
| **ODPHP MyHealthfinder** | Public health-topic summaries (live API) | General wellness questions |
| **MedlinePlus Connect** | Patient education by ICD-10 or NDC/name | Health questions; after in-thread drug scans |
| **Workflow tools** | Internet search, scan results, SDOH, maps | Agent EXECUTE phase |
| **Profile + thread** | Goals, locale, conversation history | Every turn |
| **Long-term memories** | Stored user notes/preferences | **Keyword overlap** scoring today (not embeddings) |

Citations are merged, de-duplicated, and shown in the UI. Production evals check that replies align with retrieved sources and do not invent facts.

**Possible improvements (roadmap):** semantic skill/memory retrieval (embeddings / pgvector), semantic cache of frequent education queries, hybrid search over skills and citations. These are **conceptual** — not shipped.

---

## 4. Scaling model

**This is the most important section.** User count is **not** treated as a scaling metric. Advancement is driven by **operational metrics**:

- p99 latency exceeding SLOs
- Supabase connection pressure or write contention
- LLM/API quota or cost saturation
- queue/consumer lag or DLQ growth
- cross-domain deploy coupling risks

### What breaks first

| Pressure point | Symptom | First response |
|----------------|---------|----------------|
| **Database** | Connection limits, write contention on timeline | Buffering, rate limits, idempotency keys |
| **LLM / Vision APIs** | Quota exhaustion, cost spikes, tail latency | Per-route rate limits, caching, backpressure |
| **Synchronous heavy work** | Scan or chat spikes block other routes | Queues + workers (before splitting services) |
| **Deploy coupling** | One bad assistant deploy affects barcode lookup | Module contracts, then optional service extraction |

### Evolution order (always this sequence)

1. **Buffering** — queues + workers so burst writes do not hit Postgres directly
2. **Rate limiting** — per-route and per-user caps on scan events, timeline writes, LLM calls
3. **Idempotency** — keys for high-volume operations; transactional outbox when events go async
4. **Decomposition** — extract bounded contexts only after async patterns are proven

Microservices and multi-region architecture are **downstream** responses to sustained operational pressure, not prerequisites. A conceptual ~1M-user stress target is used to **reason about failure modes**, not as a deployment goal.

### Phased evolution (metric-gated, not calendar-driven)

| Phase | What changes | User-visible impact |
| ----- | ------------ | ------------------- |
| **0 — Foundation** | Stronger module contracts; timeline events | **None** |
| **1 — Container lift** | Same code on Kubernetes with Helm | **None** — DNS/ops only |
| **2 — Async workers** | Event bus + background jobs | **None** — faster dashboards over time |
| **3 — First splits** | Scan + assistant; shadow/canary before full routing | **None** — same API URL |
| **4 — Platform + integrations** | Remaining domains extracted | **None** |
| **5 — Edge + optional social** | CDN/WAF hardening; social split if needed | **None** |

**Strangler fig pattern:** new pieces grow around the old system; traffic moves slice by slice; obsolete code is removed only when the replacement is proven ([FTGO Step 3](https://microservices.io/refactoring/example-of-extracting-a-service.html) — deploy first, route user traffic only after validation).

### Shadow, canary, and rollback

Each phase gate requires: offline agent eval suite passes, Layer 0 population eval (≥ 85% DGA band), shadow/canary metrics within SLO, rollback runbook tested in staging.

| Phase | Rollback trigger | Rollback action |
| ----- | ---------------- | --------------- |
| **0** | Layer 0 or agent eval failure | Block merge / deploy |
| **1** | p99 > baseline +20%; error rate > 0.5% | DNS back to PaaS |
| **2** | Duplicate rollups; consumer lag > SLO; DLQ spike | Disable consumers; monolith fallback |
| **3+** | Agent eval failure; shadow diff on golden scans | Ingress **100% to monolith** |

> Conceptual scaling diagram (one view): [architecture-reference §5](./docs/architecture-reference.md#5-conceptual-scaling-model) · Lightweight event model: [§4](./docs/architecture-reference.md#4-event-model) · Phased evolution: [§6](./docs/architecture-reference.md#6-phased-evolution) · GKE microservices target: [§7](./docs/architecture-reference.md#7-target-microservices-on-gke) · GKE cluster platform: [§8](./docs/architecture-reference.md#8-gke-cluster-platform)

---

## 5. Eval system

Evals verify **alignment in code** — they are **not legal proof** of FDA, ADA, or privacy compliance.

### This lab repo

| Workflow | Trigger | What runs |
|----------|---------|-----------|
| `.github/workflows/evals.yml` | Push / PR to `main` | `npm run population-eval` + `npm run agent-eval` |

Same commands you run in Replit — no API keys.

### Production backend (conceptual — not in this repo)

| Workflow | Role |
|----------|------|
| Math / population evals | Nutrition cohort + persona checks on goal-calculator changes |
| Agent evals | 166+ routing and response-quality cases |
| Nightly agent evals | Full suites; optional **semantic judge** |
| Live staging evals | Weekly real API + OpenAI — catches drift mocks miss |
| Production / release readiness | Full test + eval gate before deploy |

### Eval sandbox on Kubernetes

The **eval-sandbox** namespace runs automated agent and population checks in CI — warm pools for regression, **not** user traffic. Part 3 runs this pattern locally with kind + Terraform. See [README Part 3](./README.md#part-3--trust-the-gate-optional).

### What evals prove — and what they do **not**

| Eval layer | What passing **proves** | What passing does **not** prove |
| ---------- | ----------------------- | -------------------------------- |
| **Layer 0 — population** | DGA-band plausibility for the formula pipeline | Clinical correctness for any individual |
| **Offline agent cases** | Tool routing, safety blocks, forbidden-claim **wording contracts** | Live OpenAI **wording drift**; end-to-end auth or network wiring |
| **Forbidden-claim / locale tests** | No FDA-approval claims in tested strings; six-locale disclaimer patterns | Legal sign-off; WCAG audit; tone/cultural bias in LLM replies |
| **Live staging evals** *(weekly — not deploy gate)* | End-to-end action, streaming, safety over the wire | Not on every PR — drift can appear between runs |

Offline mocks **cannot** catch model drift, cross-service wiring bugs, or production IAM/network misconfiguration. See [Live evals — beyond the offline gate](./README.md#live-evals--beyond-the-offline-gate).

### Drift detection

**Drift** is when live behavior diverges from what you intended in code or config. Two parallel tracks — neither replaces the other:

| | **ML drift** | **Infrastructure drift** |
| --- | --- | --- |
| **What drifts** | Model outputs, routing, calorie math | Deployed runtime vs version-controlled intent |
| **Risk if ignored** | Wrong calories, unsafe assistant wording | Auth misconfig, eval gates bypassed, wiring bugs |
| **Gates as you grow** | Layer 0 + agent evals → live staging → semantic judge | CI checks → Terraform `plan` on PR → shadow/canary before cutover |
| **Lab connection** | [Parts 1–2](./README.md#workshop-flow) | [Part 3](./README.md#part-3--trust-the-gate-optional) |

Scale the gates, don't replace them — each growth phase **adds** drift detection; Layer 0 and agent locks stay the floor.

### Future evals roadmap

| Direction | Notes |
|-----------|-------|
| **267-case offline gate** | Shipped in example production stack |
| **Live staging chat evals** | Weekly; real SSE/auth/threads |
| **Semantic judge** | Opt-in — not default PR CI |
| **Eval sandbox on GKE/EKS** | Planned — warm pool namespace |
| **Semantic retrieval eval layer** | Roadmap — paraphrase recall across locales |

**Principle:** Eval contracts stay version-controlled regardless of hosting.

---

## 6. Bias / integrity model

Optional depth after [Integrity & wellness boundaries](./README.md#integrity--wellness-boundaries).

**One-line framing:** Bias mitigation here is **transparent rules + representative testing + integrity guardrails**, not “we trained on diverse data so the model is fair.” Synthetic cohort data is a **test harness**, not training data that debiases an ML model.

### Two surfaces where bias can appear

| Surface | Mechanism | Primary bias risk |
|---------|-----------|-------------------|
| **Nutrition goal math** | Deterministic formulas (BMI → BMR → activity → DGA bands) | Systematic over/under-estimation for body types, life stages, or activity levels |
| **In-app AI assistant** | LLM replies + routing/tools/skills across 6 locales | Wrong tool for a locale or phrasing; clinical overreach; training-data skew |

### Where bias can enter

| Source | Example |
|--------|---------|
| **Formula defaults** | Default activity = sedentary when unknown |
| **Sex/gender buckets in BMR** | Male/female/other floors and offsets |
| **High BMI handling** | Adjusted weight for BMR only — easy to mis-explain |
| **English-first routing patterns** | Typo or dialect not in regex |
| **LLM training data** | Tone, cultural food norms, gendered health advice |
| **Device & literacy barriers** | Vision scan fails; voice not available |

### Mitigations in place today

**Nutrition math:** published DGA bands and Mifflin–St Jeor BMR; special populations (pregnancy/lactation, BMI ≥ 30 adjusted weight); hand-curated personas in `population-eval/synthetic-personas.json`; population eval ≥ 85% within DGA band; no race-based targeting in product logic.

**AI assistant:** offline routing evals; locale coverage (EN, ES, AR, ZH, HI, SW); negative guards (food-safety questions stay in chat); hallucination/grounding cases; mandatory ODPHP/MedlinePlus citations; optional live semantic judge for high-risk wording.

### Role of data — test harness, not debiasing training

| Use of data | Role | In this lab? |
|-------------|------|--------------|
| **NHANES-like synthetic cohort** | Sample demographics from published CDC summary statistics | **Yes** — `population-eval/` |
| **Fixed random seed** | Reproducible cohort between runs | **Yes** — change `SEED` in Part 1 |
| **Hand-curated personas** | Named edge cases the sampler might under-represent | **Yes** — `short_heavy_female_moderate` task |
| **User production data for ML training** | **Not used** for routing or calorie formulas | **No** |

### What passing does **not** prove

| Claim | Verdict |
|-------|---------|
| “Fair outcomes for all demographic groups” | **Not proven** by Layer 0 alone |
| “Clinically correct for any individual” | **Not proven** — plausibility only |
| “LLM replies are unbiased in tone and culture” | **Not fully proven** — offline contracts + optional judge reduce risk |
| “Synthetic cohort predicts real-world NHANES” | **Not claimed** |
| “No digital divide” | **Not measured** in lab |

### Lab exercises that touch bias

| Lab moment | Bias lesson |
|------------|-------------|
| [Part 1 — population eval](./README.md#part-1--trust-the-math) | Representative **testing** catches systematic math drift |
| [Part 2 — agent eval](./README.md#part-2--trust-the-agent) | “Helpful” wrong action is an integrity/bias failure |
| [Self-debrief #3](./README.md#self-debrief) | One persona vs hundreds of synthetic profiles |

---

## 7. Future architecture (compressed)

**Honest status:** Kubernetes and microservices are **not in production today.** This section describes a **conceptual evolution path** when scale metrics justify phased change.

At large scale, architecture choices affect whether eval contracts stay trustworthy: a vision spike on the food scanner should not slow chat; a bad assistant deploy should not take down barcode lookup; infrastructure moves must not break routing case #2 (food-coloring safety question stays in chat).

### Evolution path

```
Modular monolith (today)
  → hardened modules + timeline events
  → buffered monolith (queues + workers)
  → evented monolith (durable bus, idempotent consumers)
  → optional service splits (scan, assistant, platform, integrations)
```

The **same app** keeps **one public API URL** behind a load balancer. Workers handle timeline rollups, recall alerts, and wearable sync so heavy jobs do not block scan or chat.

> Phased path diagram: [architecture-reference §6](./docs/architecture-reference.md#6-phased-evolution) · GKE microservices target: [§7](./docs/architecture-reference.md#7-target-microservices-on-gke) · GKE cluster platform: [§8](./docs/architecture-reference.md#8-gke-cluster-platform)

### What never changes

| Commitment | Why it matters to the lab |
| ---------- | ------------------------- |
| **Same app API URL** | Client and eval configs stay stable |
| **Agent routing eval gate, zero allowed failures** (production) | Routing and safety locks survive infra moves |
| **Layer 0 population eval (≥ 85% DGA band)** | Goal math pipeline unchanged in meaning |
| **General wellness framing; no FDA approval claims** | Disclaimers enforced in evals and copy |
| **Six locales** (EN, ES, AR, ZH, HI, SW) | Locale compliance tests still apply |
| **Supabase as primary user database** | No “migrate all user data day one” surprise |

### Data ownership as services emerge (conceptual)

Schema-per-service on **one Supabase Postgres** is an **interim** pattern — logical ownership enforcement, not full isolation until credentials and write paths are scoped per domain. Scan → timeline flows become **eventual** via `scan.completed` events; OAuth tokens stay in integrations module only.

---

## 8. Infrastructure philosophy

### Managed services first

| Service | Role today |
|---------|------------|
| **Heroku** (or similar PaaS) | Node API |
| **Netlify** | Expo web static |
| **Supabase** | Postgres, Auth, RLS |
| **OpenAI** | Assistant generator + optional evaluator judge |
| **Google Vision** | Scan labels, OCR, safe-search |
| **GitHub Actions** | CI evals |

**Principle:** Managed services reduce ops toil; **eval contracts stay version-controlled**. Stay on PaaS longer when the team is small — add logging, backups, and async queues before Kubernetes.

### No Kubernetes in the current system

Kubernetes appears in this lab **only** as Part 3's local eval-sandbox (kind + Terraform) — a teaching pattern for CI isolation, not production hosting. Production lift to GKE or EKS is **planned, not shipped**. Cluster-level GKE view: [architecture-reference §8](./docs/architecture-reference.md#8-gke-cluster-platform).

### Eventual platform options (when metrics justify)

| Option | When it fits |
|--------|----------------|
| **Stay on PaaS longer** | Small team — buffering and observability first |
| **GKE + BigQuery** | Documented path; keep Google Vision; analytics R&D |
| **EKS + Athena/Glue** | Team already on AWS; budget Vision migration or cross-cloud calls |

Helm charts, Supabase, OpenAI, agent workflow, and eval gates are **portable** either way. Choose **one** cloud — mixing control planes adds cost.

| Concern | Google Cloud | AWS |
|---------|--------------|-----|
| Kubernetes | GKE | EKS |
| Async work | Pub/Sub + DLQ | EventBridge → SQS + DLQ |
| Analytics warehouse | BigQuery | Athena + Glue |
| Edge | Cloud CDN + Cloud Armor | CloudFront + AWS WAF |
| Vision today | **Google Vision** (shipped) | Rekognition + Textract — deliberate migration |

**AWS Rekognition instead of Google Vision?** Yes, in principle — a **product migration** requiring a new adapter, re-tuned category inference, and re-running scan contract and safety evals. Fastest EKS path: keep Google Vision cross-cloud until migration is justified.

### Terraform — Infrastructure as Code (future)

**Today:** API on Heroku, web on Netlify, Supabase SaaS — **no cloud Terraform in production**. Part 3 uses local Terraform + kind on your machine — no hyperscaler spend (you still need Docker, base-image pulls, and local compute).

**When justified:** Terraform provisions VPC, GKE/EKS, IAM, event bus, CDN/WAF, observability. **Helm** deploys workloads; **GitHub Actions** runs build → eval → `terraform plan` → (approved) `apply`. Eval gates stay in GitHub Actions — Terraform changes *where* workloads run, not *what* we verify.

| Concept | What it means |
|---------|---------------|
| **Plan vs apply** | `plan` = dry-run diff; `apply` = execute after review |
| **Apply vs reconcile** | `apply` provisions objects once; **Kubernetes controllers** reconcile runtime — Terraform is not a continuous reconciliation loop |
| **Idempotency** | Re-run `apply` safely — no change → “0 to add, 0 to change, 0 to destroy” |
| **State** | Tracks what Terraform created (remote backend with locking — **not** in git) |

### J.11 AI workloads on Kubernetes *(optional — architects)*

Modern platforms run **microservices and AI on the same operational plane**. Treat AI as **another workload class** — different scheduling, cost, and security — not a separate island.

| Choice | When |
| ------ | ---- |
| **Managed APIs** (OpenAI, Vertex AI) | MVP, spiky traffic — **ScanAndFindIt today** |
| **Self-hosted on K8s** | Steady high QPS, strict data residency, token economics favor owned GPU |
| **Hybrid** | Microservices on GKE/EKS; primary LLM via managed API; small GPU pool for batch evals in eval-sandbox |

ScanAndFindIt today uses managed OpenAI + Google Vision — appropriate for eval-gated assistant contracts.

#### J.11.1 AI agents for platform operations

Beyond product-facing assistants ([§3 — In-app AI assistant](#in-app-ai-assistant)), **platform AI agents** help SREs and platform engineers run Kubernetes and cloud infrastructure. They accelerate diagnosis and drafting — they do **not** replace on-call judgment or change-management policy.

| Use case | What an agent can do |
| -------- | -------------------- |
| **Cluster troubleshooting** | Correlate pod events, `CrashLoopBackOff`, node pressure, and recent deploys; suggest likely root causes and safe `kubectl` next steps |
| **Log and metrics analysis** | Query centralized logs (Cloud Logging, Loki) and metrics (Prometheus, Grafana) in plain language; join signals across namespaces and time windows |
| **Incident response** | Build timelines from alerts, summarize blast radius, draft runbook steps, prepare status updates for stakeholders |
| **Cost optimization** | Flag idle GPU nodes, oversized requests/limits, orphaned volumes, and rightsizing opportunities |
| **Capacity planning** | Forecast CPU, memory, and GPU headroom from historical usage; recommend HPA/VPA tuning or node-pool changes before saturation |

**Benefits**

| Benefit | Why it matters |
| ------- | -------------- |
| **Faster diagnosis** | Shorter mean-time-to-understand during incidents — less manual log grep and `describe` chaining |
| **Consistent patterns** | Agents apply the same platform conventions (labels, probes, resource shapes) every time |
| **Lower toil** | Repetitive triage moves off humans; engineers focus on judgment calls |
| **Knowledge bridge** | New team members get guided context on an unfamiliar cluster or cloud provider |

**Honest status:** Platform agents are **emerging practice**, not something this lab ships today. When ScanAndFindIt moves to GKE/EKS ([§7–8](#7-future-architecture-compressed)), the same eval and approval gates that protect wellness integrity should govern any agent that can change infrastructure.

> Production foundations (shared responsibility, IAM/secrets, networking/DR/observability): [§8 — Infrastructure philosophy](#8-infrastructure-philosophy). Integrity-at-scale matrix: [§6 — Bias / integrity model](#6-bias--integrity-model). Not required to complete the lab.

---

*This appendix uses only public architecture concepts and educational stubs. It does not grant production access, cloud accounts, or legal advice.*
