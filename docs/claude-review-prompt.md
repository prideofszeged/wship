# Claude Review Packet: Issue Planner MVP

Please review this implementation plan for an internal GitHub-first "Issue Planner" system.

## Context
We want to replicate the core behavior of CodeRabbit Issue Planner for internal use:
- Trigger plan generation from GitHub issues.
- Generate structured implementation plans from issue + codebase context.
- Refine/replan with version history.
- Produce handoff prompts for coding agents.

Primary plan doc:
- `docs/issue-planner-mvp-plan.md`

## What I want from your review
1. Identify critical architecture risks and missing components.
2. Identify where this plan will likely fail in production first.
3. Suggest concrete improvements to retrieval quality and plan reliability.
4. Propose a better v1 scope if any parts are overbuilt.
5. Recommend eval metrics and acceptance tests we should add before coding.

## Constraints
- Small team, ship fast.
- Prefer pragmatic implementation over perfect architecture.
- GitHub-only MVP first.
- Must support Codex + Claude Code handoff.

## Output format
Please respond with:
1. `Critical Findings` (highest severity first)
2. `Scope Corrections`
3. `Architecture Adjustments`
4. `Retrieval/Eval Improvements`
5. `Revised 2-week Execution Plan`
