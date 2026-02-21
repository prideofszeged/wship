import type { GitHubIssueCommentEvent } from "../types/events.js";
import type { IntegrationParseResult } from "../types/integration.js";
import { parsePlanCommand } from "../utils/commandParser.js";
import { parseRepoHint } from "./common.js";

export function parseGitHubIssueCommentEvent(eventName: string, payload: unknown): IntegrationParseResult {
  if (eventName !== "issue_comment") {
    return { accepted: false, reason: "unsupported_event" };
  }

  const body = payload as GitHubIssueCommentEvent;
  if (body.action !== "created") {
    return { accepted: false, reason: "unsupported_action" };
  }

  const commentBody = body.comment?.body ?? "";
  const command = parsePlanCommand(commentBody);
  if (!command) {
    return { accepted: false, reason: "no_plan_command" };
  }

  const issueId = String(body.issue?.number ?? "");
  if (!issueId) {
    return { accepted: false, reason: "missing_issue" };
  }

  const labels = (body.issue?.labels ?? []).map((l) => l.name ?? "").filter(Boolean);
  const issueBody = body.issue?.body ?? "";
  const repoHint = body.repository?.full_name ?? parseRepoHint(labels, [issueBody, commentBody]);
  const numericIssueNumber = body.issue?.number;
  const issueUrl = body.issue?.html_url;
  const workItem = {
    id: issueId,
    title: body.issue?.title ?? "(untitled issue)",
    body: issueBody,
    labels,
    ...(typeof numericIssueNumber === "number" ? { numericIssueNumber } : {}),
    ...(issueUrl ? { url: issueUrl } : {}),
    ...(repoHint ? { repoHint } : {}),
  };

  return {
    accepted: true,
    request: {
      provider: "github",
      sourceEvent: eventName,
      workItem,
      comment: {
        body: commentBody,
        author: body.comment?.user?.login ?? "unknown",
      },
      command,
    },
  };
}
