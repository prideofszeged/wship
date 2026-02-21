import path from "node:path";

export interface WorkerConfig {
  queueDir: string;
  pollMs: number;
  githubPostbackMode: "api" | "gh" | "auto";
  githubApiToken?: string;
  jiraBaseUrl?: string;
  jiraEmail?: string;
  jiraApiToken?: string;
}

function parseGitHubPostbackMode(value: string | undefined): "api" | "gh" | "auto" {
  const normalized = (value ?? "auto").trim().toLowerCase();
  if (normalized === "api" || normalized === "gh" || normalized === "auto") {
    return normalized;
  }
  return "auto";
}

export function loadConfig(): WorkerConfig {
  const githubPostbackMode = parseGitHubPostbackMode(process.env.GITHUB_POSTBACK_MODE);
  const githubApiToken = process.env.GITHUB_API_TOKEN;
  const jiraBaseUrl = process.env.JIRA_BASE_URL;
  const jiraEmail = process.env.JIRA_EMAIL;
  const jiraApiToken = process.env.JIRA_API_TOKEN;

  return {
    queueDir: process.env.QUEUE_DIR ?? path.resolve(process.cwd(), "data/queue"),
    pollMs: Number(process.env.WORKER_POLL_MS ?? 1500),
    githubPostbackMode,
    ...(githubApiToken ? { githubApiToken } : {}),
    ...(jiraBaseUrl ? { jiraBaseUrl } : {}),
    ...(jiraEmail ? { jiraEmail } : {}),
    ...(jiraApiToken ? { jiraApiToken } : {}),
  };
}
