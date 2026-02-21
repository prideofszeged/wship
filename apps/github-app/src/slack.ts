import { createHmac, timingSafeEqual } from "node:crypto";
import {
  parseNumericIssueNumber,
  safeString,
  type InboundPlanRequest,
  type ParsedPlanCommand,
} from "@issue-planner/core";

const GITHUB_ISSUE_URL_RE =
  /^https?:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/issues\/(\d+)(?:\b|\/|$)/i;
const GITHUB_SHORTHAND_RE = /^([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)#(\d+)$/;
const JIRA_KEY_RE = /^([A-Z][A-Z0-9]+-\d+)$/;
const JIRA_BROWSE_RE = /\/browse\/([A-Z][A-Z0-9]+-\d+)(?:\b|\/|$)/i;

interface SlackSlashCommand {
  command: string;
  text: string;
  userId: string;
  userName: string;
  channelId: string;
  teamId: string;
  responseUrl?: string;
}

interface ParsedSlackCommand {
  target: string;
  repoOverride?: string;
  command: ParsedPlanCommand;
}

type SlackTarget =
  | { provider: "github"; repoFullName: string; issueNumber: number; issueUrl?: string }
  | { provider: "jira"; issueKey: string; issueUrl?: string };

export interface SlackResolveConfig {
  slackSigningSecret?: string;
  slackAllowedTeamId?: string;
  githubApiToken?: string;
  jiraBaseUrl?: string;
  jiraEmail?: string;
  jiraApiToken?: string;
}

export interface SlackRequestMeta {
  responseUrl?: string;
  channelId: string;
  userId: string;
  teamId: string;
  rawText: string;
}

export type SlackParseResult =
  | { ok: false; status: number; message: string }
  | {
      ok: true;
      request: InboundPlanRequest;
      meta: SlackRequestMeta;
    };

function unwrapSlackLink(token: string): string {
  const trimmed = token.trim();
  const wrapped = trimmed.match(/^<([^>|]+)(?:\|[^>]+)?>$/);
  return (wrapped?.[1] ?? trimmed).replace(/[),.;]+$/, "");
}

export function verifySlackSignature(args: {
  rawBody: Buffer;
  headers: Record<string, string | string[] | undefined>;
  signingSecret?: string;
  nowEpochSeconds?: number;
}): { ok: boolean; reason?: string } {
  const secret = args.signingSecret;
  if (!secret) {
    return { ok: true };
  }

  const signatureHeader = args.headers["x-slack-signature"];
  const timestampHeader = args.headers["x-slack-request-timestamp"];
  const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
  const timestamp = Array.isArray(timestampHeader) ? timestampHeader[0] : timestampHeader;

  if (!signature || !timestamp) {
    return { ok: false, reason: "missing_slack_signature" };
  }

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) {
    return { ok: false, reason: "invalid_slack_timestamp" };
  }

  const now = args.nowEpochSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > 60 * 5) {
    return { ok: false, reason: "stale_slack_timestamp" };
  }

  const base = `v0:${timestamp}:${args.rawBody.toString("utf8")}`;
  const computed = `v0=${createHmac("sha256", secret).update(base).digest("hex")}`;

  const left = Buffer.from(computed);
  const right = Buffer.from(signature);
  if (left.length !== right.length) {
    return { ok: false, reason: "invalid_slack_signature" };
  }

  return timingSafeEqual(left, right) ? { ok: true } : { ok: false, reason: "invalid_slack_signature" };
}

function parseSlashForm(rawBody: Buffer): SlackSlashCommand {
  const params = new URLSearchParams(rawBody.toString("utf8"));

  const command = safeString(params.get("command")).trim() || "/plan";
  const text = safeString(params.get("text")).trim();
  const userId = safeString(params.get("user_id")).trim() || "unknown";
  const userName = safeString(params.get("user_name")).trim() || userId;
  const channelId = safeString(params.get("channel_id")).trim() || "unknown";
  const teamId = safeString(params.get("team_id")).trim() || "unknown";
  const responseUrl = safeString(params.get("response_url")).trim();

  return {
    command,
    text,
    userId,
    userName,
    channelId,
    teamId,
    ...(responseUrl ? { responseUrl } : {}),
  };
}

function parseSlackCommand(commandName: string, text: string): ParsedSlackCommand | null {
  const tokens = text
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);

  let intent: ParsedPlanCommand["intent"] = commandName.toLowerCase() === "/replan" ? "replan" : "plan";
  let mode: ParsedPlanCommand["mode"] = "full";
  let repoOverride: string | undefined;
  const targetTokens: string[] = [];

  if (tokens.length === 0 && intent === "plan") {
    return null;
  }

  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (lower === "plan" || lower === "/plan") {
      continue;
    }
    if (lower === "replan" || lower === "/replan") {
      intent = "replan";
      mode = "full";
      continue;
    }
    if (lower === "--quick") {
      mode = "quick";
      continue;
    }
    if (lower === "--full") {
      mode = "full";
      continue;
    }

    const repoMatch = token.match(/^repo=(.+\/.+)$/i);
    if (repoMatch?.[1]) {
      repoOverride = repoMatch[1].trim();
      continue;
    }

    targetTokens.push(token);
  }

  const target = unwrapSlackLink(targetTokens[0] ?? "");
  if (!target) {
    return null;
  }

  const commandRaw = intent === "replan" ? "/replan" : mode === "quick" ? "/plan --quick" : "/plan";

  return {
    target,
    ...(repoOverride ? { repoOverride } : {}),
    command: {
      intent,
      mode,
      raw: commandRaw,
    },
  };
}

function parseTarget(target: string): SlackTarget | null {
  const githubUrl = target.match(GITHUB_ISSUE_URL_RE);
  if (githubUrl?.[1] && githubUrl[2] && githubUrl[3]) {
    return {
      provider: "github",
      repoFullName: `${githubUrl[1]}/${githubUrl[2]}`,
      issueNumber: Number(githubUrl[3]),
      issueUrl: target,
    };
  }

  const githubShort = target.match(GITHUB_SHORTHAND_RE);
  if (githubShort?.[1] && githubShort[2]) {
    return {
      provider: "github",
      repoFullName: githubShort[1],
      issueNumber: Number(githubShort[2]),
      issueUrl: `https://github.com/${githubShort[1]}/issues/${githubShort[2]}`,
    };
  }

  const jiraUrl = target.match(JIRA_BROWSE_RE);
  if (jiraUrl?.[1]) {
    return {
      provider: "jira",
      issueKey: jiraUrl[1].toUpperCase(),
      issueUrl: target,
    };
  }

  const jiraKey = target.match(JIRA_KEY_RE);
  if (jiraKey?.[1]) {
    return {
      provider: "jira",
      issueKey: jiraKey[1].toUpperCase(),
    };
  }

  return null;
}

function buildGitHubApiUrl(repoFullName: string, issueNumber: number): string | null {
  const [owner, repo] = repoFullName.split("/");
  if (!owner || !repo) {
    return null;
  }
  return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${issueNumber}`;
}

async function fetchGitHubIssue(args: {
  repoFullName: string;
  issueNumber: number;
  githubApiToken?: string;
}): Promise<{ title: string; body: string; labels: string[]; url?: string } | null> {
  const url = buildGitHubApiUrl(args.repoFullName, args.issueNumber);
  if (!url) {
    return null;
  }

  try {
    const headers: Record<string, string> = {
      accept: "application/vnd.github+json",
      "user-agent": "issue-planner-mvp",
    };
    if (args.githubApiToken) {
      headers.authorization = `Bearer ${args.githubApiToken}`;
    }

    const response = await fetch(url, { method: "GET", headers });
    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const labels = Array.isArray(payload["labels"])
      ? payload["labels"]
          .map((label) => safeString((label as Record<string, unknown>)["name"]).trim())
          .filter(Boolean)
      : [];

    const title = safeString(payload["title"]).trim();
    const body = safeString(payload["body"]);
    const issueUrl = safeString(payload["html_url"]).trim();

    return {
      title: title || `${args.repoFullName}#${args.issueNumber}`,
      body,
      labels,
      ...(issueUrl ? { url: issueUrl } : {}),
    };
  } catch {
    return null;
  }
}

function normalizeJiraBaseUrl(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return value.replace(/\/+$/, "");
}

function defaultJiraBrowseUrl(baseUrl: string | undefined, issueKey: string): string | undefined {
  if (!baseUrl) {
    return undefined;
  }
  return `${baseUrl}/browse/${issueKey}`;
}

async function fetchJiraIssue(args: {
  issueKey: string;
  jiraBaseUrl?: string;
  jiraEmail?: string;
  jiraApiToken?: string;
}): Promise<{ title: string; body: string; labels: string[]; projectKey?: string; url?: string } | null> {
  const baseUrl = normalizeJiraBaseUrl(args.jiraBaseUrl);
  if (!baseUrl) {
    return null;
  }

  const url = `${baseUrl}/rest/api/3/issue/${encodeURIComponent(args.issueKey)}?fields=summary,description,labels,project`;

  try {
    const headers: Record<string, string> = {
      accept: "application/json",
    };

    if (args.jiraEmail && args.jiraApiToken) {
      const token = Buffer.from(`${args.jiraEmail}:${args.jiraApiToken}`, "utf8").toString("base64");
      headers.authorization = `Basic ${token}`;
    }

    const response = await fetch(url, { method: "GET", headers });
    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as Record<string, unknown>;
    const fields = (payload["fields"] ?? {}) as Record<string, unknown>;
    const project = (fields["project"] ?? {}) as Record<string, unknown>;

    const summary = safeString(fields["summary"]).trim();
    const description = safeString(fields["description"]);
    const labels = Array.isArray(fields["labels"]) ? fields["labels"].map((l) => safeString(l)).filter(Boolean) : [];
    const projectKey = safeString(project["key"]).trim();
    const selfUrl = safeString(payload["self"]).trim();

    return {
      title: summary || args.issueKey,
      body: description,
      labels,
      ...(projectKey ? { projectKey } : {}),
      ...(selfUrl ? { url: selfUrl } : {}),
    };
  } catch {
    return null;
  }
}

function usageText(): string {
  return [
    "Usage:",
    "- `/plan <target> [--quick|--full] [repo=owner/repo]`",
    "- `/replan <target> [repo=owner/repo]`",
    "Supported targets:",
    "- GitHub: `https://github.com/org/repo/issues/123` or `org/repo#123`",
    "- Jira: `ENG-123` or `https://<site>.atlassian.net/browse/ENG-123`",
  ].join("\n");
}

function buildSlackMeta(form: SlackSlashCommand): SlackRequestMeta {
  return {
    ...(form.responseUrl ? { responseUrl: form.responseUrl } : {}),
    channelId: form.channelId,
    userId: form.userId,
    teamId: form.teamId,
    rawText: form.text,
  };
}

export async function parseSlackPlanRequest(args: {
  rawBody: Buffer;
  config: SlackResolveConfig;
}): Promise<SlackParseResult> {
  const form = parseSlashForm(args.rawBody);

  if (args.config.slackAllowedTeamId && form.teamId !== args.config.slackAllowedTeamId) {
    return {
      ok: false,
      status: 403,
      message: "This Slack workspace is not allowed for this endpoint.",
    };
  }

  const parsedCommand = parseSlackCommand(form.command, form.text);
  if (!parsedCommand) {
    return {
      ok: false,
      status: 200,
      message: usageText(),
    };
  }

  const target = parseTarget(parsedCommand.target);
  if (!target) {
    return {
      ok: false,
      status: 200,
      message: `Could not parse target: ${parsedCommand.target}\n\n${usageText()}`,
    };
  }

  if (target.provider === "github") {
    const enriched = await fetchGitHubIssue({
      repoFullName: target.repoFullName,
      issueNumber: target.issueNumber,
      ...(args.config.githubApiToken ? { githubApiToken: args.config.githubApiToken } : {}),
    });

    const workItem = {
      id: `${target.repoFullName}#${target.issueNumber}`,
      numericIssueNumber: target.issueNumber,
      title: enriched?.title ?? `${target.repoFullName}#${target.issueNumber}`,
      body: enriched?.body ?? "",
      labels: enriched?.labels ?? [],
      repoHint: target.repoFullName,
      ...(enriched?.url ? { url: enriched.url } : {}),
      ...(target.issueUrl && !enriched?.url ? { url: target.issueUrl } : {}),
    };

    return {
      ok: true,
      request: {
        provider: "github",
        sourceEvent: "slack.slash_command",
        workItem,
        comment: {
          body: form.text,
          author: form.userName,
        },
        command: parsedCommand.command,
      },
      meta: buildSlackMeta(form),
    };
  }

  const defaultProjectKey = target.issueKey.split("-")[0]?.toUpperCase();
  const jiraBaseUrl = normalizeJiraBaseUrl(args.config.jiraBaseUrl);
  const enriched = await fetchJiraIssue({
    issueKey: target.issueKey,
    ...(jiraBaseUrl ? { jiraBaseUrl } : {}),
    ...(args.config.jiraEmail ? { jiraEmail: args.config.jiraEmail } : {}),
    ...(args.config.jiraApiToken ? { jiraApiToken: args.config.jiraApiToken } : {}),
  });

  const fallbackJiraUrl =
    !target.issueUrl && !enriched?.url ? defaultJiraBrowseUrl(jiraBaseUrl, target.issueKey) : undefined;

  const workItem = {
    id: target.issueKey,
    numericIssueNumber: parseNumericIssueNumber(target.issueKey),
    title: enriched?.title ?? target.issueKey,
    body: enriched?.body ?? "",
    labels: enriched?.labels ?? [],
    ...(parsedCommand.repoOverride ? { repoHint: parsedCommand.repoOverride } : {}),
    ...(enriched?.projectKey ? { projectKey: enriched.projectKey } : {}),
    ...(defaultProjectKey && !enriched?.projectKey ? { projectKey: defaultProjectKey } : {}),
    ...(enriched?.url ? { url: enriched.url } : {}),
    ...(target.issueUrl && !enriched?.url ? { url: target.issueUrl } : {}),
    ...(fallbackJiraUrl ? { url: fallbackJiraUrl } : {}),
  };

  return {
    ok: true,
    request: {
      provider: "jira",
      sourceEvent: "slack.slash_command",
      workItem,
      comment: {
        body: form.text,
        author: form.userName,
      },
      command: parsedCommand.command,
    },
    meta: buildSlackMeta(form),
  };
}

export function slackEphemeral(text: string): Record<string, unknown> {
  return {
    response_type: "ephemeral",
    text,
  };
}
