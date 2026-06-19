# ScanAndFindIt Interactive Lab

Educational eval exercises for the **Trust the Math** and **Trust the Agent** workshop. This repo is a **standalone teaching template** — it mirrors production *behavior*, not production source code. No API keys, no private repo access, and no network calls required.

**Public repo:** [github.com/wewesemsem/scanandfind-lab](https://github.com/wewesemsem/scanandfind-lab)

## Lab evals vs production gate

**These are lab teaching evals, not the production gate.**

The ScanAndFind product backend runs a much larger automated suite (`evals:agent-full` — 267 cases at deploy gate, plus NHANES population math evals, response-quality judges, and live staging checks). **This repo is a small, self-contained subset** built to teach the same ideas in 20–30 minutes without exposing proprietary code.

| | **This lab** | **Production backend** |
|---|---|---|
| **Purpose** | Workshop / Replit hands-on | CI deploy gate + regression safety |
| **Dependencies** | None (plain Node.js) | Full agent stack, mocked LLM, 31 tools |
| **Population eval** | 200 seeded synthetic adults | 1,000 NHANES-like profiles |
| **Agent cases** | 5 hand-picked scenarios | 166+ routing cases + judges |
| **Connection to prod** | None — runs entirely in this repo | Blocks deploy on failure |

Lab cases are *inspired by* production Top 10 impact scenarios (#2 food coloring guard, #7 food scan, #10 SDOH, Healthy Map guards). Passing here does **not** mean production passed, and production can change independently. If nutrition math or routing changes in the app, maintainers should update the `*-lite.js` modules here so workshop demos stay aligned.

**Facilitators:** timing, diagrams, debrief prompts, and architecture discussion live in the private ScanAndFind monorepo (`docs/interactive-lab-evals-integrity.md`). Participants only need this public repo.

## Structure

```
├── population-eval/     # Mifflin–St Jeor + DGA band checks (NHANES-like cohort)
└── agent-routing-eval/  # Pattern-matcher routing + tool-selection guards
```

## Quick start (local or Replit)

1. **Clone or import** this repo  
   - Git: `git clone https://github.com/wewesemsem/scanandfind-lab.git`  
   - Replit: *Create Repl* → *Import from GitHub* → `wewesemsem/scanandfind-lab`
2. Use **Node.js 18+** (no `npm install` — zero dependencies).
3. Run the exercises:

```bash
npm run population-eval
npm run agent-eval
npm run agent-eval -- --verbose
npm run agent-eval -- --tags sdoh,healthy-map
```

## How these evals pass

Everything is **deterministic and self-contained**:

- **Population** — `nhanesSampler-lite` generates profiles from published CDC summary stats (fixed seed). `goalCalculator-lite` computes calories; `dgaReference-lite` checks DGA bands. `run-population-eval.js` prints PASS when ≥ 85% fall within band.
- **Agent routing** — `cases/*.json` defines expected outcomes. `router.js` is a simplified pattern matcher. `run-agent-eval.js` compares actual vs expected and exits with a non-zero code on failure.

No external services, secrets, or calls into the private app. CI runs the same commands on every push (see `.github/workflows/evals.yml`).

## Part 1 — Population nutrition eval

```bash
cd population-eval
node run-population-eval.js
```

**Try this:** change `SEED` in `run-population-eval.js` from `20260524` to `42` and re-run. The % within DGA band should stay similar (same distribution, different individuals).

Open `synthetic-personas.json` and find `short_heavy_female_moderate` — discuss why adjusted body weight matters for BMI ≥ 30.

## Part 2 — Agent routing eval

```bash
cd agent-routing-eval
node run-agent-eval.js --verbose
```

## Ground rules

- General wellness education only — not FDA-approved, not clinical dosing.
- No production keys, no real user data.
- Simplified formulas and routers for learning; the real product uses the full backend eval suite.

## License

MIT — see [LICENSE](LICENSE).
