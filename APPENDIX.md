# Appendix — Reference architecture & RAG

Optional reading after the main lab exercises. Diagrams describe **where the product is headed** (Phase 2–3 on a hyperscaler), not what you run in Replit today. **§I** covers **algorithmic bias** mitigation and how the lab exercises connect to it.

**Today (MVP):** Expo clients → Node API on managed PaaS → Supabase → OpenAI + Google Vision.  
**Future:** Same app logic on **GKE** (Google Cloud) or **EKS** (AWS), with async workers, CDN/WAF, analytics warehouse, and **eval automation** in CI + cluster sandbox.

Pick **one** cloud for production — mixing GCP and AWS control planes adds operational cost. Supabase, OpenAI, and Google Vision stay external SaaS on either path.

---

## A. Future target — Google Cloud (GKE)

**Principle:** evolve incrementally. Near-term wins stay on managed PaaS (logging, backups, async decoupling) before migrating the API to Kubernetes + Helm. **GKE** is the primary documented path below.

### A.1 Target diagram (Phase 2–3)

```mermaid
flowchart TB
  subgraph dns [DNS and DR]
    R53[Route 53 or Cloud DNS health checks]
    R53 -->|primary| CDN
    R53 -->|failover DR region| CDN_DR[Cloud CDN - DR region]
  end

  subgraph edge_gcp [Edge]
    CDN[Cloud CDN + Cloud Armor]
    CDN --> LB[External HTTPS Load Balancer]
    CDN_DR --> LB_DR[HTTPS LB - DR region]
  end

  subgraph vpc_primary [VPC - primary region]
    NAT[Cloud NAT]
    subgraph private [Private subnets]
      subgraph gke [GKE cluster - Helm]
        API_DEP[api-monolith / microservices]
        WORK_DEP[Pub/Sub workers]
        EVAL[eval-sandbox namespace]
        ANALYTICS[analytics-batch namespace]
      end
    end
    private --> NAT
  end

  subgraph events [Decoupling]
    PS[Pub/Sub]
    DLQ[Dead-letter topic]
    EA[Eventarc optional]
    EA --> PS
    PS --> WORK_DEP
    PS -.->|failed| DLQ
  end

  subgraph data_layer [Data]
    Supabase[(Supabase Postgres primary)]
    Replica[(Read replica / PITR)]
    BQ[BigQuery - analytics and R&D graph]
    GCS[Cloud Storage - static / R&D assets]
    Supabase --> Replica
    Supabase -.->|ETL nightly| BQ
    GCS -.-> ANALYTICS
  end

  subgraph obs [Observability]
    Prom[Prometheus / Managed Prometheus]
    Graf[Grafana]
    Logs[Cloud Logging]
    Prom --> Graf
    Logs --> Graf
  end

  Mobile[Expo clients] --> CDN
  Web[Expo web or Firebase Hosting] --> CDN
  LB --> API_DEP
  API_DEP --> Supabase
  API_DEP --> PS
  WORK_DEP --> Supabase
  ANALYTICS --> BQ
  API_DEP -.-> Prom
  gke -.-> Prom
```

### A.2 Phased rollout (GCP)

| Phase | Focus | Path |
|-------|-------|------|
| **0 (now)** | Heroku API, Netlify web, Supabase | No change required to ship |
| **1** | DR docs, PITR, structured logs, SLO dashboards | Log drain → Cloud Logging; Grafana Cloud optional |
| **2** | Decouple heavy work | Pub/Sub → GKE workers (timeline rollups, plugin sync, alerts) |
| **3** | API portability | GKE monolith Helm chart behind HTTPS LB + Ingress |
| **4** | Edge hardening | Cloud CDN + Cloud Armor (rate limits on AI endpoints) |
| **5** | Multi-region DR | Second GCP region GKE + DNS failover |
| **R&D** | Property graph analytics | GKE + GCS + BigQuery (separate project or namespace) |

---

## B. Future target — AWS (EKS)

Same phased goals as §A — **Heroku → EKS → async workers → edge hardening → multi-region DR** — using AWS-native edge, networking, and observability. Helm charts and container images are **portable** between GKE and EKS; Ingress, IAM, and managed service bindings change.

### B.1 Target diagram (Phase 2–3)

```mermaid
flowchart TB
  subgraph dns_aws [DNS and DR]
    R53[Route 53 health checks + failover]
    R53 -->|primary| CF
    R53 -->|failover DR region| CF_DR[CloudFront - DR region]
  end

  subgraph edge_aws [Edge]
    CF[CloudFront + AWS WAF]
    CF --> ALB[Application Load Balancer]
    CF_DR --> ALB_DR[ALB - DR region]
  end

  subgraph vpc_aws [VPC - primary region]
    NAT_GW[NAT Gateway]
    subgraph private_aws [Private subnets]
      subgraph eks [EKS cluster - Helm]
        API_EKS[api-monolith / microservices]
        WORK_EKS[SQS / EventBridge workers]
        EVAL_EKS[eval-sandbox namespace]
        ANALYTICS_EKS[analytics-batch namespace]
      end
    end
    private_aws --> NAT_GW
  end

  subgraph events_aws [Decoupling]
    EB[EventBridge or SNS]
    SQS[SQS queues + DLQ]
    EB --> SQS
    SQS --> WORK_EKS
  end

  subgraph data_aws [Data]
    Supabase[(Supabase Postgres primary)]
    Replica[(Read replica / PITR)]
    S3[S3 - static / R&D assets]
    ATH[Athena + Glue - analytics tables]
    Supabase --> Replica
    Supabase -.->|ETL nightly| ATH
    S3 -.-> ANALYTICS_EKS
  end

  subgraph obs_aws [Observability]
    AMP[Amazon Managed Prometheus]
    AMG[Amazon Managed Grafana]
    CW[CloudWatch Logs]
    AMP --> AMG
    CW --> AMG
  end

  Mobile[Expo clients] --> CF
  Web[Expo web or S3 static] --> CF
  ALB --> API_EKS
  API_EKS --> Supabase
  API_EKS --> EB
  WORK_EKS --> Supabase
  ANALYTICS_EKS --> ATH
  API_EKS -.-> AMP
  eks -.-> AMP
```

### B.2 Phased rollout (AWS)

| Phase | Focus | Path |
|-------|-------|------|
| **0 (now)** | Heroku API, Netlify web, Supabase | No change required to ship |
| **1** | DR docs, PITR, structured logs | CloudWatch Logs; Grafana Cloud optional |
| **2** | Decouple heavy work | EventBridge / SNS → SQS → EKS workers |
| **3** | API portability | EKS behind ALB + AWS Load Balancer Controller |
| **4** | Edge hardening | CloudFront + AWS WAF |
| **5** | Multi-region DR | Second AWS region EKS + Route 53 failover |
| **R&D** | Analytics property graph | EKS + S3 + Athena/Glue |

---

## C. GCP (GKE) vs AWS (EKS) — for this product

Helm charts, Supabase, OpenAI, agent workflow, and eval gates are **portable** either way. Below is what matters for ScanAndFindIt specifically.

| | **GCP / GKE** | **AWS / EKS** |
|---|---------------|---------------|
| **Edge** | Cloud CDN + Cloud Armor | CloudFront + AWS WAF |
| **Async work** | Pub/Sub + dead-letter topics | EventBridge → SQS + DLQ |
| **Analytics warehouse** | **BigQuery** (documented R&D path) | **Athena + Glue** (or Redshift) |
| **Object storage** | GCS | S3 |
| **Vision / OCR today** | **Google Vision** shipped — labels, OCR, safe-search on scans | Rekognition + Textract possible — deliberate migration, not a toggle |
| **Web static** | Firebase Hosting or GCS + CDN | S3 + CloudFront |

**Stays the same on either path:** Supabase OLTP + Auth, JWT client contract, agent eval suites, wellness API on Postgres (not the warehouse).

**Practical takeaway:** Choose **GCP** if you want the documented BigQuery R&D path and may keep Google Vision with lower VPC friction. Choose **AWS** if edge/IAM/data-lake skills are already there — budget engineering to migrate Vision or run it cross-cloud.

### C.1 Service mapping (quick reference)

| Concern | Google Cloud | AWS |
|---------|--------------|-----|
| Kubernetes | GKE | EKS |
| Ingress / LB | GCE Ingress / Gateway API | ALB + LB Controller |
| CDN + WAF | Cloud CDN + Cloud Armor | CloudFront + AWS WAF |
| Pod IAM | Workload Identity | IRSA |
| Scheduled jobs | Cloud Scheduler | EventBridge Scheduler |
| DNS + failover | Cloud DNS | Route 53 |

### C.2 FAQ — Vision and analytics

**Could we use AWS Rekognition / Textract instead of Google Vision?**

Yes, in principle — it is a **product migration**, not a config change. Vision today powers scan routing (food, plastic, meds, pets), label OCR, and safe-search moderation. Switching requires a new adapter, re-tuning category inference, and re-running scan contract and safety evals.

| Pattern | When |
|---------|------|
| Keep Google Vision on AWS | Fastest path to EKS; accept cross-cloud API calls |
| Migrate to Rekognition + Textract | Long-term AWS consolidation |
| Stay on GCP + Vision | Lowest friction for current scan code |

**Why BigQuery? Is there an AWS alternative?**

BigQuery is the **analytics warehouse**, not the app database. It supports nightly ETL from Postgres, de-identified research exports, and R&D property-graph batch jobs. **Athena + Glue on S3** is the intentional AWS mirror — same batch-worker pattern on EKS, different SQL and pipeline tooling.

---

## D. In-app AI assistant (context for RAG)

Chat, voice, and in-thread images share one **server-side agent workflow** and up to **three skills per turn**. The client only executes `action` payloads (navigation, scan targets).

```mermaid
flowchart TB
  subgraph client [Expo client]
    Palette[Command palette / topics]
    Modal[Assistant modal]
    Actions[Client navigation handler]
  end

  subgraph api [API routes]
    Chat[Chat — SSE streaming]
    Voice[Voice — push-to-talk + realtime]
  end

  subgraph workflow [Agent workflow]
    Safety[Safety + image safety]
    Understand[UNDERSTAND]
    Skills["Skills — up to 3 of 20"]
    Plan[PLAN]
    Orch[EXECUTE — orchestrator]
    Exec[Tool registry]
    Respond[RESPOND — stream reply]
    Memory[MEMORY]
    Understand --> Skills --> Plan --> Orch --> Exec
    Orch --> Respond --> Memory
  end

  subgraph store [Supabase]
    ThreadsDB[(assistant threads)]
    Profile[(profiles / goals)]
  end

  subgraph llm [OpenAI]
    GPT[Chat model]
  end

  Modal --> Chat
  Modal --> Voice
  Chat --> Safety
  Voice --> Safety
  Safety --> Understand
  Respond --> GPT
  Respond --> Citations[ODPHP + MedlinePlus]
  Respond -->|action + citations| Modal
  Modal --> Actions
  Memory --> ThreadsDB
  Understand --> Profile
```

| Layer | Role |
|-------|------|
| **Safety** | Blocks jailbreaks and unsafe images before the LLM runs |
| **Understand** | Parses intent, locale, multimodal context |
| **Skills** | Injects up to 3 skill bodies (disclaimers, routing priority) |
| **Tools** | Nutrition lookup, SDOH, Healthy Map, internet search, scans, etc. |
| **Respond** | LLM reply + patient-education citations |

---

## E. Retrieval & citations (RAG) — how data reaches the model

The assistant uses **retrieval-augmented generation** in the sense that replies are grounded on **fetched data injected into the prompt** — not on the model’s memory alone. This is **not** a private document vector database in production today.

```mermaid
flowchart LR
  Q[User question] --> R[Retrieve]
  R --> ODPHP[ODPHP MyHealthfinder topics]
  R --> Medline[MedlinePlus Connect codes]
  R --> Tools[Workflow tool results]
  R --> Ctx[Profile + thread + memories]
  ODPHP --> P[System prompt + citations]
  Medline --> P
  Tools --> P
  Ctx --> P
  P --> LLM[LLM generates reply]
  LLM --> User[User sees answer + links]
```

| Retrieval source | What it pulls | When |
|------------------|---------------|------|
| **ODPHP MyHealthfinder** | Public health-topic summaries (live API) | General wellness questions |
| **MedlinePlus Connect** | Patient education by ICD-10 (conditions) or NDC/name (medications) | Health questions; also after in-thread drug scans |
| **Workflow tools** | Internet search, scan results, SDOH, maps, market data | Agent EXECUTE phase — results passed into RESPOND context |
| **Profile + thread** | Goals, locale, conversation history | Every turn |
| **Long-term memories** | Stored user notes/preferences | **Keyword overlap** scoring today (not embeddings) |

Citations are merged, de-duplicated, and shown in the UI. Production evals check that replies align with retrieved sources and do not invent facts.

### E.1 Possible improvements (roadmap)

| Gap today | Improvement | Why it helps |
|-----------|-------------|--------------|
| Skill selection is keyword/trigger-based | Semantic / embedding retrieval for skills and memories | Catches paraphrases across locales without exploding regex lists |
| Memories use lexical overlap | Vector search over stored memories (e.g. pgvector) | Better recall of allergies and preferences across threads |
| ODPHP/Medline are live API lookups | Semantic cache of frequent education queries | Lower latency and cost at chat scale |
| Property graph is R&D-only (warehouse batch) | Embedding normalization in analytics namespace | Feeds timeline semantics later — productized only when ready |
| No unified retrieval index | Hybrid search (keyword + vector) over skills, citations, events | One retrieval layer for grounded coaching |

Eval strategy already separates **routing** (deterministic) from **response quality** (citations, grounding, optional semantic judge). Semantic retrieval would add a third offline eval layer for paraphrase recall.

---

## F. Eval sandbox on Kubernetes (why it appears in both diagrams)

The **eval-sandbox** namespace runs automated agent and population checks in CI — warm pools for regression, **not** user traffic. Same eval ideas you practiced in this lab (routing contracts, DGA plausibility bands, grounding guards) scale to hundreds of cases before deploy in a full product stack. The lab stub teaches the pattern; an example production monorepo runs the full suite.

---

## G. CI automation — GitHub Actions (and Terraform note)

Evals are wired into **GitHub Actions** so the same checks run locally and in CI.

### G.1 This lab repo

| Workflow | Trigger | What runs |
|----------|---------|-----------|
| `.github/workflows/evals.yml` | Push / PR to `main` | `npm run population-eval` + `npm run agent-eval` |

Same commands you run in Replit — no API keys.

### G.2 Production backend (conceptual — not in this repo)

| Workflow | Role |
|----------|------|
| Math / population evals | Nutrition cohort + persona checks on goal-calculator changes |
| Agent evals | 166+ routing and response-quality cases on agent/skills changes |
| Nightly agent evals | Full suites; optional **semantic judge** (generator ≠ evaluator) |
| Live staging evals | Weekly real API + OpenAI — catches drift mocks miss |
| Production / release readiness | Full test + eval gate before deploy |

Eval result artifacts upload to GitHub for review — pass rate is **not** a live production metric.

### G.3 Terraform (future)

**Today:** API on Heroku, web on Netlify, Supabase SaaS — **no Terraform in this lab**.

**Phase 2–3 (planned):** Terraform provisions **GKE or EKS** (VPC, node pools, IAM), **eval-sandbox namespace**, event buses (Pub/Sub or SQS), CDN/WAF, and observability. Helm deploys the API; eval jobs run as CI-triggered workloads — **not** user traffic.

| Layer | Purpose |
|-------|---------|
| **Terraform** | Clusters, networking, managed Prometheus/Grafana |
| **Helm** | API, workers, eval-sandbox |
| **GitHub Actions** | Build → test → eval → deploy |

You do **not** need cloud accounts for this lab; this documents **where automation goes** when the platform scales off PaaS.

---

## H. Managed services — today vs future (evals & platform)

### H.1 MVP today

| Service | Role |
|---------|------|
| **Heroku** | Node API |
| **Netlify** | Expo web static |
| **Supabase** | Postgres, Auth, RLS |
| **OpenAI** | Assistant **generator** + optional **evaluator** judge |
| **Google Vision** | Scan labels, OCR, safe-search |
| **GitHub Actions** | CI evals (this repo + production monorepo) |

Evals run on **GitHub-hosted runners** — not on user request paths.

### H.2 Future platform options

See §A–C above. Pick **one** hyperscaler (GKE + BigQuery **or** EKS + Athena/Glue).

| Option | When it fits |
|--------|----------------|
| **Stay on PaaS longer** | Small team — add logging, backups, async queues first |
| **GKE + BigQuery** | Documented path; keep Google Vision; analytics R&D |
| **EKS + Athena/Glue** | Team already on AWS; budget Vision migration or cross-cloud calls |

### H.3 Future evals roadmap

| Direction | Notes |
|-----------|-------|
| **267-case offline gate** | Shipped in example production stack — deterministic contracts block deploy |
| **Live staging chat evals** | Shipped — weekly; real SSE/auth/threads |
| **Semantic judge** | Opt-in — separate model scores rubric; not default PR CI |
| **Eval sandbox on GKE/EKS** | Planned — warm pool namespace for full suite |
| **Semantic retrieval eval layer** | Roadmap — paraphrase recall across locales (pgvector / hybrid search) |
| **Third-party eval platforms** | Optional — dashboards/rubrics; **assertions stay in-repo** for deploy gate |

**Principle:** Managed services reduce ops toil; **eval contracts stay version-controlled** so releases cannot skip the same checks you ran in this lab.

---

## I. Algorithmic bias — mitigation & lab connection

Optional depth after [Integrity & wellness boundaries](./README.md#integrity--wellness-boundaries) in the main README.

**One-line framing:** Bias mitigation here is mostly **transparent rules + representative testing + integrity guardrails**, not “we trained on diverse data so the model is fair.” Synthetic cohort data is a **test harness** for population plausibility, not training data that debiases an ML model.

### I.1 Two surfaces where bias can appear

| Surface | Mechanism | Primary bias risk |
|---------|-----------|-------------------|
| **Nutrition goal math** | Deterministic formulas (BMI → BMR → activity → DGA bands) | Systematic over/under-estimation for body types, life stages, or activity levels the formulas handle poorly |
| **In-app AI assistant** | LLM replies + routing/tools/skills across 6 locales | Wrong tool for a locale or phrasing; authoritative tone; clinical overreach; training-data skew in the foundation model |

```mermaid
flowchart TB
  subgraph math [Nutrition goals — deterministic]
    DGA[Published DGA + Mifflin–St Jeor]
    Pop[Population eval — synthetic cohort]
    DGA --> Pop
  end
  subgraph agent [AI assistant — hybrid]
    Route[Routing + safety guards]
    I18n[6-locale patterns + disclaimer keys]
    Ground[Citations + wellness framing]
    Judge[Optional semantic judge — live only]
    Route --> I18n --> Ground --> Judge
  end
```

### I.2 Where bias can enter (even with good intentions)

| Source | Example | Why it matters at scale |
|--------|---------|---------------------------|
| **Formula defaults** | Default activity = sedentary when unknown | Conservative for intake, but may feel “punishing” vs over-estimating |
| **Sex/gender buckets in BMR** | Male/female/other floors and offsets | Simplified physiology; must not encode stigma or exclude nonbinary users from usable targets |
| **High BMI handling** | Adjusted weight for BMR only | Corrects over-prediction; easy to mis-explain to users as judgment |
| **English-first routing patterns** | Typo or dialect not in regex | Silent misroute — feels broken or discriminatory for non-English users |
| **LLM training data** | Tone, cultural food norms, gendered health advice | Routing can pass while **wording** still harms or misleads |
| **Device & literacy barriers** | Vision scan fails; voice not available | Benefits skew toward digitally fluent, sighted, high-bandwidth users |
| **Research narrative** | Cohort simulation cited as “impact” | Overstates benefit for groups underrepresented in synthetic data |

Report disparities with **structural context** (design, infrastructure, policy) — not as inherent group limitations.

### I.3 Mitigations in place today

#### Nutrition math

| Mitigation | What it does |
|------------|--------------|
| **Published standards** | [DGA 2020–2025](https://www.dietaryguidelines.gov/) bands, Mifflin–St Jeor BMR, documented activity multipliers — not opaque ML on user behavior |
| **Special populations** | Pregnancy/lactation add-ons, older-adult life stage (60+), BMI ≥ 30 adjusted weight for BMR, sex-specific calorie floors |
| **Hand-curated personas** | Edge cases in population eval (high BMI, pregnancy, adolescents) — see `population-eval/synthetic-personas.json` |
| **Population eval** | NHANES-*like* synthetic adults; **≥ 85%** within DGA band + safety floors/ceiling — catches **cohort-level drift** |
| **No race-based targeting** | Product logic does not segment or treat users by race/ethnicity |

#### AI assistant & product integrity

| Mitigation | What it does |
|------------|--------------|
| **Offline routing evals** | Example production stacks use hundreds of cases; this lab stub teaches the same **contract** idea — binary pass per scenario |
| **Locale coverage** | Routing regression and disclaimer keys for **EN, ES, AR, ZH, HI, SW** |
| **Negative guards** | e.g. food-safety questions stay in chat — do not open scanner ([Top 10 #2](./README.md#part-2--trust-the-agent)) |
| **Hallucination / grounding cases** | No diagnosis, no FDA approval claims, no invented profile or intake data |
| **Mandatory citations** | ODPHP / MedlinePlus for educational replies — reduces invented “facts” |
| **Live + semantic judge (opt-in)** | Second model scores high-risk **wording** (overdose + driving, travel compound) when mocks are not enough |
| **Inclusive gender options** | Profile supports diverse gender identity; math uses documented buckets with explicit floors |
| **ADA-oriented UX** | WCAG labels, focus, large text (ongoing product work) |

### I.4 Role of data — test harness, not debiasing training

Participants often ask: *“Do we use data to reduce bias?”* Be precise:

| Use of data | Role | In this lab? |
|-------------|------|--------------|
| **NHANES-like synthetic cohort** | Sample demographics from published CDC **summary statistics**; run calorie math at scale | **Yes** — `population-eval/` |
| **Fixed random seed** | Reproducible cohort between runs | **Yes** — change `SEED` in [Part 1 exercise](./README.md#part-1--trust-the-math) |
| **Hand-curated personas** | Named edge cases the sampler might under-represent | **Yes** — `short_heavy_female_moderate` task |
| **User production data for ML training** | **Not used** for routing or calorie formulas in this product model | **No** |
| **Stratified equity analysis** | Compare adherence, scan success, burden by age/gender/locale | **Research / future** — optional survey layer |

**Synthetic cohort caveat:** Marginal sampling from published stats does **not** preserve full covariance (region, socioeconomic links, rare subgroups). Fine for **workshop plausibility**; not enough for research claims about real populations.

### I.5 Eval & guardrail map (quick reference)

| Bias-adjacent failure | Product stance | Eval / guardrail |
|-----------------------|----------------|------------------|
| Calorie targets drift low/high for many profiles | Wellness estimates from DGA pipeline | Population eval ≥ 85% in band; persona JSON |
| Wrong scanner by locale or typo | Same server `action` contract on all clients | Routing cases per locale; typo cases (e.g. “scam my food”) |
| Assistant implies diagnosis or FDA approval | General wellness only | Hallucination guards; disclaimers |
| Invented user data | Use only profile fields on file | Factual-grounding cases |
| Harmful safety wording | Urgent help; no minimizing overdose | Safety + response-quality cases |
| Non-English disclaimer gaps | Same legal meaning in 6 locales | Locale compliance tests |
| SDOH routed to wrong tool | Benefits programs ≠ camera “snap” | SDOH routing cases + benefits-program guards |

### I.6 What passing does **not** prove

| Claim | Verdict |
|-------|---------|
| “Fair outcomes for all demographic groups” | **Not proven** by Layer 0 alone |
| “Clinically correct for any individual” | **Not proven** — plausibility only |
| “LLM replies are unbiased in tone and culture” | **Not fully proven** — offline contracts + optional judge reduce risk |
| “Synthetic cohort predicts real-world NHANES” | **Not claimed** — summary-stat sampling ≠ full survey covariance |
| “No digital divide” | **Not measured** in lab — device, bandwidth, literacy still matter |

**Integrity hook:** If population Layer 0 fails, do **not** cite simulated Layer 1–3 “AI impact” cohort charts in decks or demos ([Research layers](./README.md#research-layers-context-only)).

### I.7 Gaps & honest scope

| Gap | Direction |
|-----|-----------|
| LLM tone bias by gender or culture | Stratified audits; expand live semantic judge coverage |
| Locale regex holes | Add regression eval per new variant when bugs are found |
| Older adults / low vision | Simplified flows, voice (planned); stratify scan success by age in research |
| Equity of API cost / device burden | Analyze by region and device tier in research design |
| Formal legal sign-off on algorithmic bias | Product compliance milestone |

### I.8 Lab exercises that touch bias

| Lab moment | Bias lesson |
|------------|-------------|
| [Part 1 — population eval](./README.md#part-1--trust-the-math) | Representative **testing** catches systematic math drift; BMI-adjusted weight persona |
| [Part 2 — agent eval](./README.md#part-2--trust-the-agent) | “Helpful” wrong action (scanner vs chat; SDOH vs snap) is an integrity/bias failure |
| [Top 10 impact table](./README.md#part-2--trust-the-agent) | Each row locks a failure mode that disproportionately breaks trust |
| [Integrity section](./README.md#integrity--wellness-boundaries) | Connect product promise to automated proof |
| [Self-debrief #3](./README.md#self-debrief) | One persona vs hundreds of synthetic profiles |

### I.9 Reflect — facilitator-style prompts

| Prompt | Expected direction |
|--------|-------------------|
| “Is NHANES-like data the same as training a fair ML model?” | **No** — it tests deterministic math across synthetic demographics |
| “What does ≥ 85% in DGA band actually guarantee?” | Plausibility / regression safety — not fairness or clinical validity |
| “Where could the assistant sound helpful but act out of integrity?” | Wrong tool, FDA implication, English-only routing, invented intake |
| “What bias risk remains after all offline cases pass?” | Wording drift, locale gaps, digital divide, over-trusting authoritative tone |
| “If Layer 0 fails, can we still show AI impact slides?” | **No** — Layer 0 blocks citing cohort simulation narratives |

---

*This appendix uses only public architecture concepts and educational stubs. It does not grant production access, cloud accounts, or legal advice.*
