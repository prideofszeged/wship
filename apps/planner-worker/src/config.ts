import path from "node:path";

export interface WorkerConfig {
  queueDir: string;
  pollMs: number;
  githubApiToken?: string;
  jiraBaseUrl?: string;
  jiraEmail?: string;
  jiraApiToken?: string;
}

export function loadConfig(): WorkerConfig {
  const githubApiToken = process.env.GITHUB_API_TOKEN;
  const jiraBaseUrl = process.env.JIRA_BASE_URL;
  const jiraEmail = process.env.JIRA_EMAIL;
  const jiraApiToken = process.env.JIRA_API_TOKEN;

  return {
    queueDir: process.env.QUEUE_DIR ?? path.resolve(process.cwd(), "data/queue"),
    pollMs: Number(process.env.WORKER_POLL_MS ?? 1500),
    ...(githubApiToken ? { githubApiToken } : {}),
    ...(jiraBaseUrl ? { jiraBaseUrl } : {}),
    ...(jiraEmail ? { jiraEmail } : {}),
    ...(jiraApiToken ? { jiraApiToken } : {}),
  };
}
