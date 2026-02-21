# Issue Planner MVP Scaffold

This repo contains an Issue Planner scaffold aligned with `docs/issue-planner-mvp-plan.md`.

## Apps
- `apps/github-app`: Integration webhook receiver for GitHub/Jira and Slack command intake.
- `apps/planner-worker`: Background worker that consumes queued plan jobs and runs planner pipeline.

## Package
- `packages/core`: Shared types, queue, retrieval, and planner pipeline stages.

## Queue Backend (MVP Scaffold)
A file-backed queue is used for local development:
- `data/queue/pending`
- `data/queue/processing`
- `data/queue/completed`
- `data/queue/failed`

## Build
```bash
npm install
npm run build
```

## Run
```bash
npm run dev:worker
npm run dev:github-app
```

## Process Control
Use the provided process manager to run both services in the background:
```bash
make start
make status
make logs
make logs-follow
make restart
make stop
```

Notes:
- Reads env from `.env` (supports `KEY=value` and `export KEY=value`).
- Writes PID files to `.run/` and logs to `logs/`.
- `make start` runs `npm run build` first unless `SKIP_BUILD=1`.

## Webhook Endpoints
- `POST /webhooks/github`
- `POST /webhooks/jira`
- `POST /webhooks/slack`

Auth verification:
- GitHub: `x-hub-signature-256` when `GITHUB_WEBHOOK_SECRET` is set.
- Jira: `x-jira-token` or `x-webhook-token` when `JIRA_WEBHOOK_TOKEN` is set.
- Slack: signature verification (`x-slack-signature`, `x-slack-request-timestamp`) when `SLACK_SIGNING_SECRET` is set.

Supported manual commands in issue comments:
- `/plan`
- `/plan --quick`
- `/plan --full`
- `/replan`

Supported Slack command text:
- `/plan https://github.com/<org>/<repo>/issues/<number>`
- `/plan <org>/<repo>#<number> --quick`
- `/plan ENG-123 repo=<org>/<repo>`
- `/replan ENG-123 repo=<org>/<repo>`

Optional repo mapping for non-repo-native trackers:
- `REPO_MAP_JSON='{\"jira:ENG\":\"acme/repo\",\"jira:default\":\"acme/repo\"}'`

Optional issue enrichment for Slack requests:
- GitHub: `GITHUB_API_TOKEN`
- Jira: `JIRA_BASE_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN`

Optional Slack guardrail:
- `SLACK_ALLOWED_TEAM_ID` to only accept one workspace.

Slack app bootstrap:
- Import `docs/slack-app-manifest.yml` in Slack App Manifest settings.
