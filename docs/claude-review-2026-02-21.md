## 1) Critical Findings

- **Retrieval strategy is too naive**: Keyword search + heuristics will miss architectural constraints, implicit dependencies, and structural patterns. Quality will suffer.
- **No cost/rate limiting**: LLM calls unbounded; could burn budget or hit rate limits on active repos.
- **Critic pass underspecified**: Mentions validation but doesn't define what it checks (tests? migrations? rollback? breaking changes?).
- **Handoff prompt generation is vague**: This is the stated primary goal but lacks validation strategy or quality criteria.
- **Token budget unspecified**: "Cap included context" mentioned but no numbers or overflow strategy.
- **Auto-plan by label is high-risk**: Could create spam loops or noise without strict safeguards; too early for MVP.
- **Observability missing**: No way to debug bad plans or measure retrieval quality separately from LLM output.
- **Concurrent replan handling undefined**: What if user triggers `/replan` twice in 30 seconds?
- **5-minute timeout not enforced**: Large repos could hang indefinitely; no graceful degradation path.

## 2) Scope Corrections

- **Single repo first, not multi-tenant**: Data model assumes `repositories` table and `github_installation_id`, but MVP should validate on one repo before scaling.
- **Embeddings are required, not optional**: The "optional pgvector" creates two code paths and guarantees poor quality on the non-embedding path. Commit or cut.
- **Defer auto-plan to post-MVP**: Label-triggered planning is dangerous without quality gates and user feedback loops. Manual `/plan` only for MVP.
- **Tighten success criteria**: "Useful plan" is too vague. Define as: "Plan includes all 8 template sections + passes quality scoring threshold (≥70%) + handoff prompt executes in Codex without clarification requests."
- **Clarify public vs private plans**: Are plans always public in issue comments? Security/sensitive code implications?
- **Add explicit non-goals**: No real-time collaboration, no plan branching/forking, no custom templates in MVP.

## 3) Architecture Adjustments

**Config System** (not detailed in original):
- Store in repo: `.github/issue-planner.yml`
- Schema: `{ excludedPaths: string[], tokenBudget: { quick: number, full: number }, model: string, templates: { planOverride?: string } }`
- Load + cache at webhook time; validate before enqueue.

**Retrieval Architecture** (replace naive approach):
- **Phase 1 - Structural**: Parse issue for explicit mentions (file paths, function names, stack traces). Weight: 1.0.
- **Phase 2 - Semantic**: Embed issue + code files; rank by cosine similarity. Weight: 0.4.
- **Phase 3 - Historical**: Find similar resolved issues/PRs via embedding search. Weight: 0.6.
- **Phase 4 - Dependency**: Static analysis (AST imports, call graphs) for files in Phases 1-2. Weight: 0.8.
- **Token budget enforcement**: Allocate tokens (quick: 50k, full: 200k); drop lowest-weighted context if exceeded.

**LLM Pipeline** (clarify critic pass):
1. **Planner**: Generate plan from issue + ranked context.
2. **Critic**: Validate (a) all files exist, (b) test strategy covers edge cases, (c) breaking changes flagged, (d) rollback plan for data changes.
3. **Scorer**: Auto-score plan (completeness, specificity, testability, risk coverage). Fail if <70%.
4. **Finalizer**: Merge critic fixes, render markdown, enforce schema.

**Worker Resilience**:
- Hard timeout: 5 minutes (return partial plan with "⚠️ Timeout - incomplete" banner).
- Idempotency: Track `(issue_id, plan_revision, trigger_hash)` to prevent duplicate work.
- Queue priority: User-triggered `/plan` > `/replan` > auto-label (post-MVP).

**Observability** (add from day 1):
- Structured logs: `{ event: "plan_started", issue_id, retrieval_ms, llm_ms, tokens_used }`
- Metrics: Plan quality score, retrieval recall (% of human-identified files included), replan trigger reasons.
- Failure taxonomy: timeout, context_overflow, llm_refusal, schema_invalid.

## 4) Retrieval/Eval Improvements

**Retrieval Quality**:
- **Ground truth test set**: Manually label 10 issues with "files that should be included". Measure recall.
- **Dependency discovery**: Use tree-sitter or language server to parse imports/callers, not just keyword search.
- **Historical context**: Search past issues/PRs with embeddings; prioritize merged PRs over closed-without-merge.
- **Negative sampling**: Explicitly exclude `node_modules/`, `vendor/`, generated files via config.

**Evaluation Strategy**:
- **Plan quality scoring** (auto-computed):
  - Completeness: 8/8 template sections present (10 pts each).
  - Specificity: ≥5 concrete file paths referenced (20 pts).
  - Testability: Test strategy section non-empty + mentions coverage (20 pts).
  - Risk coverage: ≥2 risks identified with mitigations (20 pts).
  - **Threshold**: ≥70/100 to post plan; else return error to user with score.
  
- **Handoff prompt validation** (critical for goal):
  - After generating plan, extract "Agent Handoff Prompt" section.
  - **Test**: Feed to Codex in dry-run mode; confirm no clarification questions or "I don't have enough context" responses.
  - If validation fails, trigger critic rewrite focused on handoff clarity.

- **Human feedback loop**:
  - Add 👍/👎 reactions to plan comments.
  - Track correlation between quality score and user reactions.
  - Iterate retrieval weights if score ≠ user rating.

**Critic Pass Checklist**:
1. All mentioned files exist in repo (GitHub API check).
2. Breaking changes section non-empty if issue has "breaking" label.
3. Test strategy mentions integration tests if issue touches API routes.
4. Rollback plan exists if issue mentions "database" or "migration".
5. Assumptions section has ≥1 item if issue description is <200 words (vague issue).

## 5) Revised 2-Week Execution Plan

### Week 1: Core Loop + Structural Retrieval
**Goal**: End-to-end `/plan` flow with basic quality, validated on 1 hardcoded issue.

**Days 1-2 - Skeleton**:
- [ ] GitHub App setup + webhook signature verification
- [ ] Command parser (recognize `/plan`, `/replan` in issue comments)
- [ ] BullMQ job queue + Redis connection
- [ ] Postgres schema (repositories, issues, plan_runs, plans, plan_context)
- [ ] Structured logging (JSON stdout with issue_id, event, timing)
- **Validation**: Webhook triggers job; job logs appear.

**Days 3-5 - Basic Planner**:
- [ ] Retrieval Phase 1: Parse issue for explicit file paths, function names
- [ ] Retrieval Phase 4: Static analysis (tree-sitter) for imports of Phase 1 files
- [ ] Token budget allocator (quick: 50k, full: 200k)
- [ ] LLM planner pass (system prompt + template schema)
- [ ] Plan quality scorer (completeness + specificity checks)
- [ ] GitHub comment poster (markdown render + plan_id link)
- **Validation**: Hardcoded issue → plan comment with ≥70 quality score.

### Week 2: Semantic Retrieval + Replan + Validation
**Goal**: 3 real issues planned with handoff prompt validation; replan working.

**Days 6-7 - Semantic Retrieval**:
- [ ] Embed issue text (OpenAI `text-embedding-3-small`)
- [ ] Embed candidate files (cache embeddings per file + git hash)
- [ ] Retrieval Phase 2: Cosine similarity ranking
- [ ] Retrieval Phase 3: Search similar resolved issues/PRs
- [ ] Hybrid ranking (weighted sum across 4 phases)
- **Validation**: Retrieval recall ≥80% on 5-issue test set.

**Days 8-9 - Critic + Handoff Validation**:
- [ ] Critic pass: file existence check, breaking change detection, rollback plan validator
- [ ] Plan scorer: add testability + risk coverage scoring
- [ ] Extract handoff prompt section
- [ ] Codex dry-run validator (feed handoff prompt, check for clarification requests)
- [ ] Auto-rewrite handoff if validation fails
- **Validation**: 3 real issues → plans with ≥70 score + passing Codex validation.

**Day 10 - Replan Flow**:
- [ ] `/replan` command: increment revision, include prior plan + issue thread updates
- [ ] Revision indexing (plans table has unique `issue_id + revision`)
- [ ] Plan delta notes ("Changes from v1: added rollback section")
- **Validation**: Issue with plan v1 → `/replan` → plan v2 posted with delta.

### Post-MVP (Deferred)
- Auto-plan by label rules (needs quality gates + cooldowns)
- Multi-repo support (requires tenant isolation)
- Custom plan templates per repo
- Advanced critic (semantic diff against codebase conventions)

### Definition of Done (MVP)
- [ ] 3 real issues planned via `/plan` with ≥70 quality score
- [ ] Handoff prompts from all 3 plans validate in Codex dry-run (no clarifications)
- [ ] `/replan` creates v2 with preserved v1 + delta notes
- [ ] Retrieval recall ≥80% on 10-issue test set
- [ ] Observability: logs include retrieval_ms, llm_ms, tokens_used, quality_score
- [ ] Cost tracking: total spend <$5 for 10 test issues (proves budgets work)
