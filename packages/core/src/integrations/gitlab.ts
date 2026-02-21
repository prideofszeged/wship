import type { IntegrationParseResult } from "../types/integration.js";
import { parsePlanCommand } from "../utils/commandParser.js";
import { parseNumericIssueNumber, parseRepoHint, safeString } from "./common.js";

export function parseGitLabNoteWebhook(payload: unknown): IntegrationParseResult {
  const body = payload as Record<string, unknown>;
  const objectKind = safeString(body["object_kind"] ?? body["event_type"]);
  if (objectKind && objectKind !== "note") {
    return { accepted: false, reason: "unsupported_event" };
  }

  const attrs = (body["object_attributes"] ?? {}) as Record<string, unknown>;
  const noteableType = safeString(attrs["noteable_type"]);
  if (noteableType && noteableType !== "Issue") {
    return { accepted: false, reason: "unsupported_noteable_type" };
  }

  const commentBody = safeString(attrs["note"]);
  const command = parsePlanCommand(commentBody);
  if (!command) {
    return { accepted: false, reason: "no_plan_command" };
  }

  const issue = (body["issue"] ?? {}) as Record<string, unknown>;
  const issueId = safeString(issue["iid"] ?? issue["id"]);
  if (!issueId) {
    return { accepted: false, reason: "missing_issue" };
  }

  const labelsRaw = issue["labels"];
  const labels = Array.isArray(labelsRaw) ? labelsRaw.map((l) => safeString(l)).filter(Boolean) : [];
  const issueBody = safeString(issue["description"]);
  const project = (body["project"] ?? {}) as Record<string, unknown>;
  const user = (body["user"] ?? {}) as Record<string, unknown>;
  const repoHint = safeString(project["path_with_namespace"]) || undefined;
  const url = safeString(issue["url"]);
  const computedRepoHint = repoHint ?? parseRepoHint(labels, [issueBody, commentBody]);
  const workItem = {
    id: issueId,
    numericIssueNumber: parseNumericIssueNumber(issueId),
    title: safeString(issue["title"]) || "(untitled issue)",
    body: issueBody,
    labels,
    ...(url ? { url } : {}),
    ...(computedRepoHint ? { repoHint: computedRepoHint } : {}),
  };

  return {
    accepted: true,
    request: {
      provider: "gitlab",
      sourceEvent: "note",
      workItem,
      comment: {
        body: commentBody,
        author: safeString(user["username"]) || "unknown",
      },
      command,
    },
  };
}
