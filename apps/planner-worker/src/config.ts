import path from "node:path";

export interface WorkerConfig {
  queueDir: string;
  pollMs: number;
  plannerLlmProvider: "none" | "codex" | "claude";
  plannerLlmModel?: string;
  plannerLlmFallback?: "codex" | "claude";
  plannerLlmTimeoutMs: number;
  plannerLlmTimeoutQuickMs: number;
  plannerCodexBin?: string;
  plannerClaudeBin?: string;
  githubPostbackMode: "api" | "gh" | "auto";
  githubApiToken?: string;
  jiraBaseUrl?: string;
  jiraEmail?: string;
  jiraApiToken?: string;
}

function parsePlannerProvider(value: string | undefined): "none" | "codex" | "claude" {
  const normalized = (value ?? "none").trim().toLowerCase();
  if (normalized === "none" || normalized === "codex" || normalized === "claude") {
    return normalized;
  }
  return "none";
}

function parseGitHubPostbackMode(value: string | undefined): "api" | "gh" | "auto" {
  const normalized = (value ?? "auto").trim().toLowerCase();
  if (normalized === "api" || normalized === "gh" || normalized === "auto") {
    return normalized;
  }
  return "auto";
}

export function loadConfig(): WorkerConfig {
  const plannerLlmProvider = parsePlannerProvider(process.env.PLANNER_LLM_PROVIDER);
  const plannerLlmModel = process.env.PLANNER_LLM_MODEL;
  const plannerLlmFallbackRaw = (process.env.PLANNER_LLM_FALLBACK ?? "").trim().toLowerCase();
  const plannerLlmFallback: "codex" | "claude" | undefined =
    plannerLlmFallbackRaw === "codex" || plannerLlmFallbackRaw === "claude"
      ? plannerLlmFallbackRaw
      : undefined;
  const plannerLlmTimeoutMs = Number(process.env.PLANNER_LLM_TIMEOUT_MS ?? 120000);
  const plannerLlmTimeoutQuickMs = Number(process.env.PLANNER_LLM_TIMEOUT_QUICK_MS ?? 45000);
  const plannerCodexBin = process.env.PLANNER_CODEX_BIN;
  const plannerClaudeBin = process.env.PLANNER_CLAUDE_BIN;
  const githubPostbackMode = parseGitHubPostbackMode(process.env.GITHUB_POSTBACK_MODE);
  const githubApiToken = process.env.GITHUB_API_TOKEN;
  const jiraBaseUrl = process.env.JIRA_BASE_URL;
  const jiraEmail = process.env.JIRA_EMAIL;
  const jiraApiToken = process.env.JIRA_API_TOKEN;

  return {
    queueDir: process.env.QUEUE_DIR ?? path.resolve(process.cwd(), "data/queue"),
    pollMs: Number(process.env.WORKER_POLL_MS ?? 1500),
    plannerLlmProvider,
    plannerLlmTimeoutMs: Number.isFinite(plannerLlmTimeoutMs) && plannerLlmTimeoutMs > 0 ? plannerLlmTimeoutMs : 120000,
    plannerLlmTimeoutQuickMs: Number.isFinite(plannerLlmTimeoutQuickMs) && plannerLlmTimeoutQuickMs > 0 ? plannerLlmTimeoutQuickMs : 45000,
    ...(plannerCodexBin ? { plannerCodexBin } : {}),
    ...(plannerClaudeBin ? { plannerClaudeBin } : {}),
    githubPostbackMode,
    ...(plannerLlmModel ? { plannerLlmModel } : {}),
    ...(plannerLlmFallback ? { plannerLlmFallback } : {}),
    ...(githubApiToken ? { githubApiToken } : {}),
    ...(jiraBaseUrl ? { jiraBaseUrl } : {}),
    ...(jiraEmail ? { jiraEmail } : {}),
    ...(jiraApiToken ? { jiraApiToken } : {}),
  };
}
