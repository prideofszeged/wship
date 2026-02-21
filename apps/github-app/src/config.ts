import path from "node:path";

export interface IntegrationAppConfig {
  port: number;
  queueDir: string;
  githubWebhookSecret?: string;
  gitlabWebhookToken?: string;
  jiraWebhookToken?: string;
  linearWebhookToken?: string;
  slackSigningSecret?: string;
  slackAllowedTeamId?: string;
  githubApiToken?: string;
  jiraBaseUrl?: string;
  jiraEmail?: string;
  jiraApiToken?: string;
  repoMap: Record<string, string>;
}

function parseRepoMap(value: string | undefined): Record<string, string> {
  if (!value) {
    return {};
  }
  try {
    const parsed = JSON.parse(value) as Record<string, string>;
    return parsed ?? {};
  } catch {
    return {};
  }
}

export function loadConfig(): IntegrationAppConfig {
  const githubWebhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
  const gitlabWebhookToken = process.env.GITLAB_WEBHOOK_TOKEN;
  const jiraWebhookToken = process.env.JIRA_WEBHOOK_TOKEN;
  const linearWebhookToken = process.env.LINEAR_WEBHOOK_TOKEN;
  const slackSigningSecret = process.env.SLACK_SIGNING_SECRET;
  const slackAllowedTeamId = process.env.SLACK_ALLOWED_TEAM_ID;
  const githubApiToken = process.env.GITHUB_API_TOKEN;
  const jiraBaseUrl = process.env.JIRA_BASE_URL;
  const jiraEmail = process.env.JIRA_EMAIL;
  const jiraApiToken = process.env.JIRA_API_TOKEN;

  return {
    port: Number(process.env.PORT ?? 8787),
    queueDir: process.env.QUEUE_DIR ?? path.resolve(process.cwd(), "data/queue"),
    repoMap: parseRepoMap(process.env.REPO_MAP_JSON),
    ...(githubWebhookSecret ? { githubWebhookSecret } : {}),
    ...(gitlabWebhookToken ? { gitlabWebhookToken } : {}),
    ...(jiraWebhookToken ? { jiraWebhookToken } : {}),
    ...(linearWebhookToken ? { linearWebhookToken } : {}),
    ...(slackSigningSecret ? { slackSigningSecret } : {}),
    ...(slackAllowedTeamId ? { slackAllowedTeamId } : {}),
    ...(githubApiToken ? { githubApiToken } : {}),
    ...(jiraBaseUrl ? { jiraBaseUrl } : {}),
    ...(jiraEmail ? { jiraEmail } : {}),
    ...(jiraApiToken ? { jiraApiToken } : {}),
  };
}
