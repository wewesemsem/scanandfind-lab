# Architecture diagrams

**Structural truth snapshots** — what exists and how it connects. For reasoning, tradeoffs, and scaling logic, see [APPENDIX.md](../APPENDIX.md).

**Legend:** Solid boxes and arrows = implemented today · Dashed = conceptual / future / conditional

**Order:** Current system → domain modules → data flow → event model → conceptual scaling → phased evolution → GKE microservices → GKE cluster platform (last)

---

## 1. Current system

**Anchor diagram** — the only “real system of record” view. One Node API on managed PaaS; Supabase and vendor APIs as external dependencies.

```mermaid
flowchart TB
  Client[Expo clients<br/>iOS · Android · Web]
  API[Node API — modular monolith<br/>managed PaaS e.g. Heroku]
  SB[(Supabase<br/>Postgres · Auth · RLS)]
  OAI[OpenAI]
  GV[Google Vision]
  Pub[USDA · openFDA · Open Food Facts]

  Client --> API
  API --> SB
  API --> OAI
  API --> GV
  API --> Pub
```

| Piece | Role |
|-------|------|
| **Expo client** | Scan UI, goals, timeline, assistant |
| **Node API** | Single deploy unit; internal module boundaries |
| **Supabase** | Primary user database and auth |
| **OpenAI** | Assistant generation |
| **Google Vision** | Label OCR and safe-search |
| **Public APIs** | Nutrition and recall lookups |

---

## 2. Domain module map

**Hero diagram for modular monolith** — four logical domains inside **one** API process. No network boundary between modules today.

```mermaid
flowchart TB
  Client[Expo clients]

  subgraph API["Node API — modular monolith (one process)"]
    direction TB
    Scan[Scan module<br/>food · drug · pet · plastic]
    Asst[Assistant module<br/>chat · voice · safety · tools]
    Plat[Platform module<br/>profile · timeline · goals]
    Int[Integrations module<br/>wearables · maps · news]
  end

  SB[(Supabase)]
  Ext[OpenAI · Google Vision · public APIs]

  Client --> API
  Scan & Asst & Plat & Int --> SB
  Scan & Asst & Int --> Ext
```

| Module | Owns | Split trigger (future) |
|--------|------|------------------------|
| **Scan** | Scans, nutrition lookup, Vision | Burst traffic, Vision cost |
| **Assistant** | Chat, routing, threads, safety | LLM cost, long-lived connections |
| **Platform** | Profile, timeline, goals | Steady CRUD; timeline single-writer |
| **Integrations** | OAuth, wearables, maps | Scheduled sync, token isolation |

Domain reasoning: [APPENDIX §3](../APPENDIX.md#3-domain-model-logical-modules)

---

## 3. Data flow

Request paths reviewers understand fastest — synchronous flows today.

```mermaid
flowchart LR
  subgraph client [Client]
    App[Expo app]
  end

  subgraph api [Node API]
    Routes[Route handlers]
    ScanPath[Scan pipeline]
    AsstPath[Assistant workflow]
    PlatPath[Platform CRUD]
  end

  subgraph data [Data & vendors]
    SB[(Supabase)]
    Vision[Google Vision]
    LLM[OpenAI]
    Tools[ODPHP · MedlinePlus · USDA · maps · SDOH]
  end

  App -->|HTTP| Routes
  Routes --> ScanPath & AsstPath & PlatPath
  ScanPath --> Vision
  ScanPath --> SB
  ScanPath --> Tools
  AsstPath --> LLM
  AsstPath --> Tools
  AsstPath --> SB
  PlatPath --> SB
  ScanPath & AsstPath & PlatPath -->|response| App
```

### Assistant turn (logical)

Chat, voice, and in-thread images share one server-side workflow. Dashed layers are conceptual orchestration inside the monolith — not separate deploy units.

```mermaid
flowchart LR
  User[User message] --> Safety[Safety gates]
  Safety --> Understand[UNDERSTAND]
  Understand --> Skills[Skills — up to 3]
  Skills --> Plan[PLAN]
  Plan --> Execute[EXECUTE tools]
  Execute --> Respond[RESPOND + citations]
  Respond --> Client[App reply or action]
```

| Layer | Status |
|-------|--------|
| **Safety, Respond, Supabase threads** | Implemented |
| **Understand, Skills, Plan, EXECUTE orchestration** | Logical model inside monolith |

RAG retrieval detail: [APPENDIX §3 — Retrieval](../APPENDIX.md#retrieval--citations-rag)

---

## 4. Event model

**Lightweight — not implemented today.** Introduced in Phase 2 (async workers) before any service split.

```mermaid
flowchart LR
  subgraph txn [Same DB transaction]
    API[API handler]
    Outbox[(Transactional outbox)]
    API --> Outbox
  end
  Outbox -->|relay| Bus[Conceptual event bus]
  Bus -->|at-least-once| Worker[Background worker]
  Worker -->|idempotency key| SB[(Supabase)]
  Bus -.->|poison / failed| DLQ[Dead-letter queue]
```

| Pattern | Purpose |
|---------|---------|
| **Transactional outbox** | DB write and event emit succeed or fail together |
| **Idempotency keys** | Prevent duplicate timeline rows on retries |
| **DLQ** | Poison messages do not block the bus |
| **At-least-once delivery** | Consumers must be idempotent |

Example: `scan.completed` → platform worker writes timeline event without blocking the scan response.

Scaling sequence: [APPENDIX §4](../APPENDIX.md#4-scaling-model)

---

## 5. Conceptual scaling model

> **Not implemented.** One future decomposition view — queue, workers, optional service splits. Same public API URL; users see no change.

```mermaid
flowchart TB
  subgraph today [Today — solid]
    App[iOS / Android / Web]
    Mono[Node API — modular monolith]
    SB[(Supabase)]
    App --> Mono --> SB
  end

  subgraph future ["Conceptual — dashed"]
    CDN[CDN + WAF]
    GW[Path routing<br/>same hostname]
    Scan[Scan service]
    Asst[Assistant service]
    Plat[Platform service]
    Int[Integrations service]
    Q[Event bus]
    W[Workers<br/>rollups · alerts · sync]

    App -.-> CDN --> GW
    GW -.-> Scan & Asst & Plat & Int
    Scan & Plat & Int -.->|events| Q --> W
    W -.-> SB
    Scan & Asst & Plat & Int -.-> SB
  end

  Mono -.->|metric-gated evolution| GW

  classDef conceptual stroke-dasharray: 5 5
  class CDN,GW,Scan,Asst,Plat,Int,Q,W conceptual
```

| Stage | Deploy units | Hosting |
|-------|--------------|---------|
| **Today** | 1 API | Managed PaaS + Supabase |
| **Future (when justified)** | 4 core APIs + workers | GKE or EKS + Supabase |
| **Unchanged** | Same API URL, same eval gates, same wellness posture | — |

Phased timeline and rollback criteria: [APPENDIX §4](../APPENDIX.md#4-scaling-model) · [§7](../APPENDIX.md#7-future-architecture-compressed) · [§6 below](#6-phased-evolution)

---

## 6. Phased evolution

> **Not implemented.** Metric-gated sequence — not calendar-driven. Users keep the **same API URL** through every phase.

### High-level path

```mermaid
flowchart LR
  A[Modular monolith<br/>one API · PaaS]
  B[Buffered monolith<br/>queues · workers · outbox]
  C[Microservices<br/>4 domains · same hostname]

  A -->|contracts · timeline events| B
  B -->|proven async patterns| C
```

| Stage | What changes | User-visible impact |
|-------|--------------|---------------------|
| **Modular monolith** | Four logical modules in one deploy unit | **None** — today |
| **Buffered monolith** | Event bus, background workers, idempotency | **None** — faster dashboards over time |
| **Microservices** | Optional domain splits behind path routing | **None** — same API URL |

### Detailed phases (0–5)

```mermaid
flowchart TB
  P0[Phase 0 — Foundation<br/>module contracts · timeline events]
  P1[Phase 1 — Container lift<br/>same code on GKE/EKS + Helm]
  P2[Phase 2 — Async workers<br/>event bus · outbox · DLQ]
  P3[Phase 3 — First splits<br/>scan + assistant · shadow/canary]
  P4[Phase 4 — Platform + integrations<br/>remaining domains extracted]
  P5[Phase 5 — Edge + optional social<br/>CDN/WAF hardening]

  P0 --> P1 --> P2 --> P3 --> P4 --> P5
```

Rollback triggers and shadow/canary gates: [APPENDIX §4](../APPENDIX.md#4-scaling-model).

---

## 7. Target microservices on GKE

> **Not implemented.** Future steady state on **GKE** (EKS equivalent is structurally similar — different Ingress and IAM bindings). Same Supabase, same eval gates, same public API URL.

```mermaid
flowchart TB
  subgraph Clients [Clients]
    App[iOS / Android / Web]
  end

  subgraph Edge [Edge]
    CDN[Cloud CDN + Cloud Armor]
    GW[API Gateway<br/>LB path routing]
  end

  subgraph Services [Microservices — GKE]
    SCAN[scan-service]
    ASST[assistant-service]
    PLAT[platform-service]
    INT[integrations-service]
  end

  subgraph OptionalV3 [Optional v3 — defer until scale]
    SOC[social-service]
  end

  subgraph Async [Event bus]
    PS[Pub/Sub]
    W1[worker-rollups]
    W2[worker-alerts]
    W3[worker-notifications]
    DLQ[Dead-letter topic]
  end

  subgraph Data [Data plane]
    SB[(Supabase Postgres<br/>schema-per-service)]
    Redis[(Redis — scan cache only)]
    GCS[Cloud Storage — feed media]
  end

  subgraph External [External systems]
    OAI[OpenAI]
    GV[Google Vision]
    FDA[openFDA · OFF · USDA]
    Wear[Wearables]
  end

  App --> CDN --> GW
  GW --> SCAN & ASST & PLAT & INT
  GW -.->|optional v3| SOC
  SCAN --> GV & FDA
  SCAN --> Redis
  SCAN -->|events| PS
  ASST --> OAI
  ASST --> SB
  PLAT --> SB
  INT --> Wear & SB
  SOC --> GCS & SB
  PS --> W1 & W2 & W3
  PS -.->|failed| DLQ
  W1 & W2 & W3 --> SB
  PLAT -->|events| PS
  INT -->|events| PS
```

| Layer | Role |
|-------|------|
| **Edge** | Global cache + WAF; one hostname routes `/api/food/*` → scan, `/api/chat/*` → assistant |
| **Microservices** | Four core deploy units — scan/assistant spikes do not take down goals or timeline |
| **Event bus** | `scan.completed` → timeline updates without blocking the scan response |
| **Workers** | Rollups, recall alerts, wearable sync — dashboards stay fast |
| **Data plane** | Supabase with logical schema-per-service; Redis for ephemeral scan cache only |
| **eval-sandbox** | Warm CI golden queries — never shares live user traffic ([Part 3](../README.md#part-3--trust-the-gate-optional)) |

Service topology detail: [§7 above](#7-target-microservices-on-gke) · EKS mirror: CloudFront + AWS WAF, NAT Gateway, EKS, EventBridge → SQS + DLQ, Athena + Glue — [APPENDIX §8](../APPENDIX.md#8-infrastructure-philosophy).

---

## 8. GKE cluster platform

> **Not implemented.** Cluster-level view — VPC, edge, decoupling, data, and observability. Pairs with [§7](#7-target-microservices-on-gke) (service wiring inside the cluster).

```mermaid
flowchart TB
  subgraph dns [DNS and DR]
    R53[Cloud DNS health checks]
    R53 -->|primary| CDN
    R53 -->|failover DR region| CDN_DR[Cloud CDN — DR region]
  end

  subgraph edge_gcp [Edge]
    CDN[Cloud CDN + Cloud Armor]
    CDN --> LB[External HTTPS Load Balancer]
    CDN_DR --> LB_DR[HTTPS LB — DR region]
  end

  subgraph vpc_primary [VPC — primary region]
    NAT[Cloud NAT]
    subgraph private [Private subnets]
      subgraph gke [GKE cluster — Helm]
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
    BQ[BigQuery — analytics and R&D graph]
    GCS[Cloud Storage — static / R&D assets]
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

| Layer | Role |
|-------|------|
| **DNS / DR** | Health-checked failover to a secondary region (Phase 5) |
| **Edge** | Cloud CDN + Cloud Armor in front of the HTTPS load balancer |
| **VPC** | Private subnets for GKE nodes; Cloud NAT for vendor API egress |
| **GKE** | Helm-deployed monolith or microservices, workers, eval-sandbox, analytics batch |
| **Pub/Sub** | Decouples burst writes from synchronous API paths; DLQ for poison messages |
| **Data** | Supabase OLTP; nightly ETL to BigQuery; GCS for static and R&D assets |
| **Observability** | Prometheus metrics, Cloud Logging, Grafana dashboards — Phase 1 milestone before K8s cutover |

GCP phased rollout table: [APPENDIX §8](../APPENDIX.md#8-infrastructure-philosophy) · Terraform workflow: [README Part 3](../README.md#part-3--trust-the-gate-optional).

---

*Reference material only — not required for the lab. Does not grant production access, cloud accounts, or legal advice.*
