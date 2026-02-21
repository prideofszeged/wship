# Issue Planner Unified Plan v3

## Purpose
Combine all findings into one implementation plan for building our own Issue Planner with Codex + Claude Code.

## Inputs Reviewed
- `docs/issue-planner-mvp-plan.md`
- `docs/issue-planner-v2-deltas.md`
- `docs/claude-review-2026-02-21.md`
- `/home/steven/Downloads/Investigating CodeRabbit Issue Planner's Technicals.docx` (converted to `/tmp/gemini_coderabbit_research.md`)

## Confidence Rubric
- `Confirmed`: Directly documented by official CodeRabbit docs/blogs or Google Cloud’s CodeRabbit case study.
- `Likely`: Consistent with official materials, but not explicitly guaranteed as a product contract.
- `Speculative`: From secondary/community sources or analytical inference; do not treat as hard requirement.

## Confirmed Product Mechanics (What We Should Copy)
1. Issue Planner supports GitHub, GitLab, Jira, Linear.
2. Manual trigger exists via `@coderabbitai plan`.
3. Auto-planning is rule-driven (label logic on GitHub/GitLab; rules UI for Jira/Linear).
4. Plan refinement is conversational; re-planning produces updated plan versions.
5. Plan sections are fixed: Summary, Research, Design Choices, Phases, Tasks, Agent Prompt.
6. MCP integration in CodeRabbit docs is officially "CodeRabbit as MCP client" for external context enrichment.
7. Cloud Run case study confirms sandboxed execution for untrusted code/scripts in their review pipeline.

## Likely Architecture Patterns (Use in Our Build)
1. Deep retrieval beyond keyword search is required for quality on large repos.
2. Hybrid retrieval should include structural + semantic + historical signals.
3. Multi-stage generation (planner -> critic -> finalizer) improves stability.
4. Deterministic checks (file existence, schema checks, timeout handling) are essential before posting plans.

## Speculative or Non-Blocking Claims (Do Not Hardcode)
1. Exact model-routing internals and model performance numbers in the Gemini report.
2. Exact "1:1 code-to-context ratio" as a universal rule.
3. "CodeRabbit as MCP server" as an official built-in product guarantee.
4. Precise infra sizing/concurrency values as mandatory for Issue Planner.

## Unified Product Scope
### MVP (Now)
1. GitHub-only.
2. Manual `/plan` and `/replan` command flow.
3. Versioned plan comments on issues.
4. Hybrid retrieval (structural + embeddings + related issue/PR signals).
5. Planner + critic + scorer + finalizer pipeline.
6. Handoff prompt validation pass (Codex dry-run style check).

### Post-MVP
1. Label-triggered auto-planning.
2. Jira/Linear/GitLab support.
3. Optional sandboxed deterministic verification service for heavy checks.
4. Multi-repo and multi-tenant controls.

## Unified Architecture v3
1. `github-app`:
   - Webhook signature verification.
   - Command parsing and idempotent job enqueue.
2. `planner-worker`:
   - Gather issue/thread/repo context.
   - Run hybrid retrieval with token budget.
   - Execute planner -> critic -> scorer -> finalizer.
   - Publish markdown plan to issue.
3. `retrieval-engine`:
   - Structural extraction: file paths, symbols, stack traces from issue.
   - Dependency expansion: AST/import/call references.
   - Semantic reranking: embeddings on candidate files.
   - Historical retrieval: similar issues/PRs (prefer merged PRs).
4. `storage`:
   - Postgres for issues, runs, plans, revisions, context metadata.
   - Vector store (pgvector) for embeddings.
5. `evaluation`:
   - Quality scoring (`>=70` threshold).
   - Handoff prompt validation.
   - Observability and cost tracking.

## Retrieval and Quality Gates
1. Token budgets: `quick=50k`, `full=200k`.
2. Plan score must be `>=70/100` or return a failure summary instead of posting final plan.
3. Minimum plan specificity: at least 5 concrete file paths.
4. Critic checklist:
   - Referenced files exist.
   - Test strategy includes edge/integration coverage when needed.
   - Breaking-change and rollback notes when issue implies risk.
5. Hard run timeout: 5 minutes with partial-output fallback banner.

## Required Safety/Operations
1. Idempotency key: `(repo, issue_number, trigger_hash, requested_revision)`.
2. Concurrency control: single in-flight run per issue/revision.
3. Rate limits and cost budgets per repo/day.
4. Structured logs:
   - `retrieval_ms`
   - `llm_ms`
   - `tokens_used`
   - `quality_score`
   - `failure_reason`

## Two-Week Execution Plan (Merged)
### Week 1
1. Scaffold services and shared package structure.
2. Implement GitHub webhook + `/plan` enqueue path.
3. Build structural retrieval + dependency expansion.
4. Implement planner + scorer + markdown publish.
5. Add idempotency, timeout, and base logs.

### Week 2
1. Add embeddings + hybrid ranking + historical retrieval.
2. Implement critic pass and handoff prompt validator.
3. Implement `/replan` deterministic revisioning + delta notes.
4. Add evaluation harness on 10 labeled issues (retrieval recall + plan quality).

## Metrics for Go/No-Go
1. 3 real issues planned end-to-end with score `>=70`.
2. 80% retrieval recall on labeled test set.
3. Handoff prompt passes dry-run checks without clarification loops.
4. 95th percentile runtime under 5 minutes.
5. Stable reruns with no duplicate revisions under concurrent commands.

## Recommended Immediate Decisions
1. Keep MVP manual-only (`/plan`, `/replan`) and defer auto-label planning.
2. Commit to embeddings now (avoid dual code paths).
3. Keep sandboxed script execution out of MVP unless quality requires it.
