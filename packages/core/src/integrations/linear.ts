import type { IntegrationParseResult } from "../types/integration.js";
import { parsePlanCommand } from "../utils/commandParser.js";
import { parseNumericIssueNumber, parseRepoHint, safeString } from "./common.js";

export function parseLinearWebhook(payload: unknown): IntegrationParseResult {
  const body = payload as Record<string, unknown>;
  const action = safeString(body["action"] ?? "");
  const type = safeString(body["type"] ?? "");
  const data = (body["data"] ?? {}) as Record<string, unknown>;

  if (action && action !== "create") {
    return { accepted: false, reason: "unsupported_action" };
  }
  if (type && !/comment/i.test(type)) {
    return { accepted: false, reason: "unsupported_event" };
  }

  const commentBody = safeString(data["body"]);
  const command = parsePlanCommand(commentBody);
  if (!command) {
    return { accepted: false, reason: "no_plan_command" };
  }

  const issue = (data["issue"] ?? {}) as Record<string, unknown>;
  const issueId = safeString(issue["identifier"] ?? issue["id"]);
  if (!issueId) {
    return { accepted: false, reason: "missing_issue" };
  }

  const labelsRaw = issue["labels"];
  const labels: string[] = [];
  if (Array.isArray(labelsRaw)) {
    for (const label of labelsRaw) {
      labels.push(safeString((label as Record<string, unknown>)["name"] ?? label));
    }
  }

  const description = safeString(issue["description"]);
  const team = (issue["team"] ?? {}) as Record<string, unknown>;
  const projectKey = safeString(team["key"]);
  const user = (data["user"] ?? {}) as Record<string, unknown>;
  const url = safeString(issue["url"]);
  const repoHint = parseRepoHint(labels, [description, commentBody]);
  const workItem = {
    id: issueId,
    numericIssueNumber: parseNumericIssueNumber(issueId),
    title: safeString(issue["title"]) || "(untitled issue)",
    body: description,
    labels,
    ...(projectKey ? { projectKey } : {}),
    ...(url ? { url } : {}),
    ...(repoHint ? { repoHint } : {}),
  };

  return {
    accepted: true,
    request: {
      provider: "linear",
      sourceEvent: type || "linear.webhook",
      workItem,
      comment: {
        body: commentBody,
        author: safeString(user["name"]) || "unknown",
      },
      command,
    },
  };
}
