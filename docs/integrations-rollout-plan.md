# Integrations Rollout Plan

## Current
1. Canonical webhook parsing for:
   - GitHub issue comments
   - Jira comment webhooks
   - Linear comment webhooks
   - GitLab issue notes
2. All providers normalize into one queue job shape and reuse the same planner worker pipeline.
3. Repo mapping for non-repo-native trackers is supported via `REPO_MAP_JSON`.

## Next
1. Persist integration installations and repo mappings in Postgres.
2. Replace `REPO_MAP_JSON` with DB-backed mapping APIs/UI.
3. Add outbound adapters to post plan revisions back to each provider.
4. Add provider-specific signature verification parity with official webhook specs.
5. Add contract tests with fixture payloads for each provider.

## Later
1. Auto-plan rules per provider.
2. Multi-workspace org controls.
3. MCP enrichers (Confluence/Slack/Notion) in retrieval stage.
