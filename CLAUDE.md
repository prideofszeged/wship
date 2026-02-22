# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run

```bash
npm install              # install dependencies
npm run build            # compile all packages (tsc -b)
npm run typecheck        # typecheck without emit (tsc -b --pretty)
npm run clean            # remove all dist/ directories

make start               # build + start both services in background
make stop                # stop both services
make restart             # restart both services
make status              # show service PIDs and status
make logs                # last 80 lines of logs
make logs-follow         # tail logs in real-time

npm run dev:github-app   # run webhook receiver directly (requires build first)
npm run dev:worker       # run planner worker directly (requires build first)
```

Tests use the built-in `node:test` runner. Run with `npm test` (compiles then runs `packages/core/dist/pipeline/planner.test.js`).

## Architecture

TypeScript monorepo (ES2022, NodeNext ESM, strict mode with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`). Zero external runtime dependencies — everything uses Node.js built-in modules.

### Workspace Layout

- **`packages/core`** — Shared library: types, file-backed job queue, integration parsers, planner pipeline stages, and utilities. All other packages depend on this.
- **`apps/github-app`** — HTTP server (port 8787) that receives webhooks from GitHub/Jira/Linear/GitLab and Slack slash commands, verifies signatures, parses payloads into a unified `PlanJobPayload`, and enqueues jobs.
- **`apps/planner-worker`** — Background polling loop (1.5s interval) that claims pending jobs, runs the planner pipeline, and posts results back to the originating platform.

### Data Flow

```
Webhook/Slack → github-app (parse + verify + enqueue) → data/queue/pending/
                                                              ↓
planner-worker (poll + claim) → data/queue/processing/ → runPlanPipeline()
                                                              ↓
                                                   data/queue/completed|failed/
                                                              ↓
                                              postback to GitHub/Jira/Slack
```

### Planner Pipeline (`packages/core/src/pipeline/`)

Five stages executed sequentially by `runPipeline.ts`:

1. **Retrieval** (`contextBuilder.ts`) — Extracts file paths, symbols, and related issues from issue metadata
2. **Planner** (`planner.ts`) — Generates a `PlanDraft` via LLM (codex/claude CLI) or falls back to template mode
3. **Critic** (`critic.ts`) — Heuristic refinement: checks repo resolution, file specificity, testing coverage
4. **Scorer** (`scorer.ts`) — Quality score 0-100 (completeness 40, specificity 20, testability 20, risk coverage 20)
5. **Finalizer** (`finalizer.ts`) — Renders markdown output, sets status to `ready` or `needs_revision` (threshold: 70)

### Integration Parsers (`packages/core/src/integrations/`)

`registry.ts` dispatches to per-provider parsers (github.ts, jira.ts, linear.ts, gitlab.ts). All parsers produce a unified `InboundPlanRequest`. Slack intake (`slack.ts`) handles `/plan` and `/replan` commands with URL, shorthand (`org/repo#123`), and Jira key formats.

### File-Backed Queue (`packages/core/src/queue/fileJobQueue.ts`)

Jobs are JSON files moved between `data/queue/{pending,processing,completed,failed}/` directories. The worker atomically claims jobs by renaming files from pending to processing.

### Provider Postback (`apps/planner-worker/src/outbound.ts`)

Results are posted back as comments: GitHub (API token or `gh` CLI), Jira (REST API with ADF conversion). Slack results go to the original `response_url`.

## Key Types (`packages/core/src/types/`)

- `PlanJobPayload` — Unified job payload with provider, workItemId, repo info, issue metadata, and optional Slack fields
- `PlanDraft` — LLM output structure: summary, research, designChoices, phases, tasks, risks, testing, handoffPrompt
- `PlanPipelineResult` — Pipeline output: status, markdown, score breakdown, critic notes, `plannerMeta`, timings
- `PlannerRunMetadata` — Observability for each pipeline run: source (`llm`/`llm-partial`/`template`), providers attempted with timing, template-filled fields
- `QueueJob<T>` — Queue wrapper with id, idempotencyKey, type (`PLAN_REQUEST`/`REPLAN_REQUEST`), mode (`quick`/`full`)

## Environment

Configuration is via `.env` file (see `.env.example`). Key variables:

- `PLANNER_LLM_PROVIDER=none|codex|claude` — LLM backend for plan generation (default: `none` = template mode)
- `PLANNER_LLM_FALLBACK=codex|claude` — Secondary provider tried when primary fails before template fallback
- `PLANNER_LLM_TIMEOUT_MS` — Timeout for full-mode LLM calls (default: 120000ms)
- `PLANNER_LLM_TIMEOUT_QUICK_MS` — Timeout for quick-mode LLM calls (default: 45000ms)
- `GITHUB_POSTBACK_MODE=auto|api|gh` — How to post comments back to GitHub
- `REPO_MAP_JSON` — Maps non-repo-native tracker keys to GitHub repos (e.g., `{"jira:ENG":"org/repo"}`)
- `SLACK_ALLOWED_TEAM_ID` — Restricts Slack commands to one workspace

## Conventions

- All source is in `src/` under each workspace package, compiled output goes to `dist/`
- Imports use `.js` extensions (required by NodeNext module resolution)
- No external runtime dependencies — use Node.js built-ins only
- Process management uses PID files in `.run/` and logs in `logs/`
