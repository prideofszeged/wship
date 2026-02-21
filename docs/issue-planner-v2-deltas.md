# Issue Planner MVP v2 Deltas (Post-Claude Review)

## Keep
- GitHub-first scope.
- `/plan` and `/replan` command interface.
- Webhook + queue + worker architecture.
- Structured plan output with handoff section.

## Change Immediately
1. Defer label auto-planning to post-MVP.
2. Make embeddings mandatory for MVP retrieval quality.
3. Add hard timeout and idempotency for planner jobs.
4. Add explicit token budgets (`quick=50k`, `full=200k`).
5. Define critic checks and quality scoring threshold (`>=70`).
6. Add handoff prompt dry-run validation before posting.
7. Add cost tracking and rate-limit guards.

## New Acceptance Criteria
1. Each plan has all 8 required sections.
2. Each plan references at least 5 concrete file paths.
3. Quality score is `>=70/100`; otherwise post failure summary.
4. Handoff prompt passes Codex dry-run with no clarification requests.
5. `/replan` is concurrency-safe and increments revision deterministically.

## Week 1 Priority
1. End-to-end `/plan` path.
2. Structural retrieval + dependency expansion.
3. Planner + critic + scorer pipeline.
4. Markdown postback + logs (`retrieval_ms`, `llm_ms`, `tokens_used`, `quality_score`).

## Week 2 Priority
1. Embedding retrieval and hybrid ranking.
2. Historical issue/PR retrieval.
3. Handoff validation + auto-rewrite loop.
4. `/replan` revisioning and delta notes.

## Deferred
- Label-triggered auto-planning.
- Multi-repo/multi-tenant support.
- Custom per-repo templates.
