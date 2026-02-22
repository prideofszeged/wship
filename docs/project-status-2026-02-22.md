# Project Status - 2026-02-22

## Objective
Build an internal "Issue Planner" workflow similar to CodeRabbit, triggered from Slack, integrating GitHub/Jira, and eventually handing off to coding agents.

## What Is Completed

### 1. Core architecture and services
- Monorepo scaffold with:
  - `apps/github-app` (webhook + Slack intake)
  - `apps/planner-worker` (queue consumer + planner pipeline)
  - `packages/core` (types, retrieval, pipeline stages, integrations)
- File-backed queue with lifecycle dirs:
  - `data/queue/pending`
  - `data/queue/processing`
  - `data/queue/completed`
  - `data/queue/failed`

### 2. Integrations and intake paths
- GitHub/Jira/Linear/GitLab webhook parsing to unified plan request shape.
- Slack slash-command endpoint at `POST /webhooks/slack`.
- Slack command parsing supports:
  - GitHub URL or `owner/repo#123`
  - Jira key/URL plus optional `repo=owner/repo`
- Slack signature verification and optional team allow-list.

### 3. End-to-end Slack flow (working)
- Slack `/plan` requests are enqueued and processed.
- Worker posts results back to Slack via `response_url`.
- Callback diagnostics are persisted in completed artifacts (`slackCallback`).

### 4. Provider postback (working)
- Worker posts generated plans back to provider work items:
  - GitHub comments (API or `gh` CLI mode)
  - Jira comments
- Provider callback diagnostics persisted in completed artifacts (`providerCallback`).
- GitHub webhook repo resolution fixed to use `repository.full_name`.

### 5. Ops/dev ergonomics
- `scripts/devctl.sh` + `Makefile` commands for start/stop/restart/status/logs.
- `.gitignore`/repo hygiene updates.
- Slack app manifest in `docs/slack-app-manifest.yml`.

## Commits Already Pushed (latest first)
- `8cbb445` Fix Claude CLI argument ordering and improve gh postback errors.
- `cee7cd4` Switch planner LLM integration to codex/claude CLI providers.
- `134e364` Add GitHub CLI postback mode for worker.
- `3e5cb4c` Add provider postback for GitHub/Jira and improve GitHub repo resolution.
- `b238bf1` Add service control scripts and callback persistence.
- `0b34588`, `d559974` Earlier Slack/Jira/GitHub workflow integration steps.

## What Is Verified In Runtime
- GitHub postback via `gh` is working when repo/issue is correct.
- Slack callbacks are returning HTTP 200.
- Recent successful full run log pattern:
  - `provider_result_posted`
  - `slack_result_posted`
  - `job_completed`

## Current Blockers / Gaps

### 1. Planner quality remains mostly template-level
- Even with CLI LLM attempts, many runs still fall back/partial.
- Score remains flat at `85/100` because scoring is largely structural and not semantic quality-sensitive.

### 2. Claude CLI planner mode is not reliable for this payload
- Previously failed due argument ordering (fixed).
- Current behavior is often timeout/partial for full planner schema/prompt, producing fallback or partial notes.

### 3. Codex CLI planner mode still needs hardening
- Direct Codex CLI can return correct JSON quickly on simple prompts.
- In-pipeline behavior with long planner prompts is inconsistent and near timeout boundaries.
- Additional tuning is still needed for stable structured output and latency.

### 4. No execution agent stage yet
- `/plan` works, but there is no `/implement` style path yet to run Codex/Claude on repo changes and open PRs.

## In-Progress Local Changes (not yet committed)
- `packages/core/src/pipeline/planner.ts` has additional experiments for CLI robustness:
  - Claude stdin-based invocation + permission mode changes
  - Codex invocation mode changes
- These changes are local and currently uncommitted.

## Recommended Next Steps (priority order)

1. Stabilize planner provider selection
- Introduce provider strategy:
  - `codex` primary
  - `claude` optional fallback
  - `none` safe fallback
- Add clear timeout budget policy per provider/mode.

2. Make structured parsing resilient
- Accept both strict JSON object and wrapped outputs.
- Add deterministic validation on required sections before passing to critic.
- If partial LLM output, explicitly annotate which sections were template-filled.

3. Improve observability for LLM calls
- Persist planner provider, timeout, exit code/signal, and stderr snippet in result metadata.
- Add distinct error codes for:
  - timeout
  - auth/credential issues
  - malformed JSON
  - empty output

4. Add a deterministic test harness
- Add fixtures + integration tests for planner stage with mocked CLI outputs.
- Add regression tests for Slack command parsing and provider postback behavior.

5. Implement execution phase after planner stabilization
- Add `/implement <target>` job type.
- Use handoff prompt + repo checkout + agent execution + PR open + Slack/provider callback.

## Immediate Operator Guidance
- For reliable demos right now, run with template planner mode:
  - `PLANNER_LLM_PROVIDER=none`
- Keep GitHub postback in CLI mode if preferred:
  - `GITHUB_POSTBACK_MODE=gh`
- Verify issue target typos carefully (`prideofszeged` vs `priceofszeged`) to avoid false postback failures.
