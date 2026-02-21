import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { PlanJobPayload, PlanPipelineResult, QueueJob } from "@issue-planner/core";

const execFileAsync = promisify(execFile);

export interface OutboundConfig {
  githubPostbackMode: "api" | "gh" | "auto";
  githubApiToken?: string;
  jiraBaseUrl?: string;
  jiraEmail?: string;
  jiraApiToken?: string;
}

export type ProviderPostResult =
  | { attempted: false; reason: string }
  | { attempted: true; ok: true; status: number; provider: "github" | "jira" }
  | { attempted: true; ok: false; provider: "github" | "jira"; error: string; status?: number };

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars - 18)}\n\n[truncated output]`;
}

function buildProviderComment(args: {
  job: QueueJob<PlanJobPayload>;
  result: PlanPipelineResult;
}): string {
  const { job, result } = args;
  const statusTitle = result.status === "ready" ? "Issue Plan" : "Issue Plan (Needs Revision)";
  const summaryLine =
    result.status === "ready"
      ? `Quality score: **${result.score.total}/100**`
      : `Quality score: **${result.score.total}/100** (below threshold or failed validation)`;

  return [
    `## ${statusTitle}`,
    "",
    summaryLine,
    "",
    `Provider: \`${job.payload.provider}\``,
    `Work item: \`${job.payload.workItemId}\``,
    `Mode: \`${job.mode}\``,
    "",
    truncate(result.markdown, 60000),
  ].join("\n");
}

function normalizeJiraBaseUrl(baseUrl: string | undefined): string | undefined {
  if (!baseUrl) {
    return undefined;
  }
  return baseUrl.replace(/\/+$/, "");
}

function adfParagraph(text: string): Record<string, unknown> {
  return {
    type: "paragraph",
    content: [{ type: "text", text }],
  };
}

function toJiraAdf(markdown: string): Record<string, unknown> {
  const lines = markdown
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const paragraphs = lines.slice(0, 250).map((line) => adfParagraph(truncate(line, 900)));
  if (paragraphs.length === 0) {
    paragraphs.push(adfParagraph("(no content)"));
  }

  return {
    type: "doc",
    version: 1,
    content: paragraphs,
  };
}

async function postGitHubComment(args: {
  token: string;
  repoFullName: string;
  issueNumber: number;
  body: string;
}): Promise<ProviderPostResult> {
  const [owner, repo] = args.repoFullName.split("/");
  if (!owner || !repo) {
    return { attempted: false, reason: "invalid_repo_full_name" };
  }

  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${args.issueNumber}/comments`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${args.token}`,
      "content-type": "application/json",
      "user-agent": "issue-planner-mvp",
    },
    body: JSON.stringify({ body: args.body }),
  });

  if (!response.ok) {
    return {
      attempted: true,
      ok: false,
      provider: "github",
      status: response.status,
      error: `github_comment_http_${response.status}`,
    };
  }

  return {
    attempted: true,
    ok: true,
    provider: "github",
    status: response.status,
  };
}

async function postGitHubCommentViaGh(args: {
  repoFullName: string;
  issueNumber: number;
  body: string;
}): Promise<ProviderPostResult> {
  const [owner, repo] = args.repoFullName.split("/");
  if (!owner || !repo) {
    return { attempted: false, reason: "invalid_repo_full_name" };
  }

  const tempFile = path.join(os.tmpdir(), `issue-planner-gh-body-${randomUUID()}.md`);
  try {
    await writeFile(tempFile, truncate(args.body, 60000), "utf8");
    await execFileAsync(
      "gh",
      [
        "issue",
        "comment",
        String(args.issueNumber),
        "--repo",
        args.repoFullName,
        "--body-file",
        tempFile,
      ],
      { maxBuffer: 1024 * 1024 * 4 },
    );

    return {
      attempted: true,
      ok: true,
      provider: "github",
      status: 200,
    };
  } catch (error) {
    const err = error as Error & { code?: string | number };
    return {
      attempted: true,
      ok: false,
      provider: "github",
      error: `github_cli_comment_failed${err?.code ? `_${String(err.code)}` : ""}`,
    };
  } finally {
    await rm(tempFile, { force: true });
  }
}

async function postJiraComment(args: {
  issueKey: string;
  baseUrl: string;
  email: string;
  apiToken: string;
  bodyMarkdown: string;
}): Promise<ProviderPostResult> {
  const authToken = Buffer.from(`${args.email}:${args.apiToken}`, "utf8").toString("base64");
  const url = `${args.baseUrl}/rest/api/3/issue/${encodeURIComponent(args.issueKey)}/comment`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Basic ${authToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      body: toJiraAdf(truncate(args.bodyMarkdown, 10000)),
    }),
  });

  if (!response.ok) {
    return {
      attempted: true,
      ok: false,
      provider: "jira",
      status: response.status,
      error: `jira_comment_http_${response.status}`,
    };
  }

  return {
    attempted: true,
    ok: true,
    provider: "jira",
    status: response.status,
  };
}

export async function postProviderResult(args: {
  config: OutboundConfig;
  job: QueueJob<PlanJobPayload>;
  result: PlanPipelineResult;
}): Promise<ProviderPostResult> {
  const { config, job, result } = args;
  const comment = buildProviderComment({ job, result });

  if (job.payload.provider === "github") {
    if (config.githubPostbackMode === "api") {
      if (!config.githubApiToken) {
        return { attempted: false, reason: "missing_github_api_token" };
      }
      return postGitHubComment({
        token: config.githubApiToken,
        repoFullName: job.payload.repoFullName,
        issueNumber: job.payload.issueNumber,
        body: comment,
      });
    }

    if (config.githubPostbackMode === "gh") {
      return postGitHubCommentViaGh({
        repoFullName: job.payload.repoFullName,
        issueNumber: job.payload.issueNumber,
        body: comment,
      });
    }

    if (config.githubApiToken) {
      return postGitHubComment({
        token: config.githubApiToken,
        repoFullName: job.payload.repoFullName,
        issueNumber: job.payload.issueNumber,
        body: comment,
      });
    }

    return postGitHubCommentViaGh({
      repoFullName: job.payload.repoFullName,
      issueNumber: job.payload.issueNumber,
      body: comment,
    });
  }

  if (job.payload.provider === "jira") {
    const baseUrl = normalizeJiraBaseUrl(config.jiraBaseUrl);
    if (!baseUrl || !config.jiraEmail || !config.jiraApiToken) {
      return {
        attempted: false,
        reason: "missing_jira_credentials",
      };
    }
    return postJiraComment({
      issueKey: job.payload.workItemId,
      baseUrl,
      email: config.jiraEmail,
      apiToken: config.jiraApiToken,
      bodyMarkdown: comment,
    });
  }

  return { attempted: false, reason: "unsupported_provider_for_postback" };
}
