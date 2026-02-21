import type { IntegrationParseResult } from "../types/integration.js";
import { parsePlanCommand } from "../utils/commandParser.js";
import { parseNumericIssueNumber, parseRepoHint, safeString } from "./common.js";

export function parseJiraWebhook(payload: unknown): IntegrationParseResult {
  const body = payload as Record<string, unknown>;
  const event = safeString(body["webhookEvent"] ?? body["issue_event_type_name"]);

  const issue = (body["issue"] ?? {}) as Record<string, unknown>;
  const fields = (issue["fields"] ?? {}) as Record<string, unknown>;
  const comment = (body["comment"] ?? {}) as Record<string, unknown>;

  const commentBody = safeString(comment["body"]);
  const command = parsePlanCommand(commentBody);
  if (!command) {
    return { accepted: false, reason: "no_plan_command" };
  }

  const issueKey = safeString(issue["key"] ?? issue["id"]);
  if (!issueKey) {
    return { accepted: false, reason: "missing_issue" };
  }

  const summary = safeString(fields["summary"]) || "(untitled issue)";
  const description = safeString(fields["description"]);
  const labels = Array.isArray(fields["labels"]) ? fields["labels"].map((l) => safeString(l)).filter(Boolean) : [];
  const project = (fields["project"] ?? {}) as Record<string, unknown>;
  const projectKey = safeString(project["key"]);
  const url = safeString(issue["self"]);
  const repoHint = parseRepoHint(labels, [description, commentBody]);
  const workItem = {
    id: issueKey,
    numericIssueNumber: parseNumericIssueNumber(issueKey),
    title: summary,
    body: description,
    labels,
    ...(projectKey ? { projectKey } : {}),
    ...(url ? { url } : {}),
    ...(repoHint ? { repoHint } : {}),
  };

  return {
    accepted: true,
    request: {
      provider: "jira",
      sourceEvent: event || "jira.webhook",
      workItem,
      comment: {
        body: commentBody,
        author: safeString((comment["author"] as Record<string, unknown> | undefined)?.["displayName"]) || "unknown",
      },
      command,
    },
  };
}
