import type { IntegrationProvider, IntegrationParseResult } from "../types/integration.js";
import { parseGitHubIssueCommentEvent } from "./github.js";
import { parseGitLabNoteWebhook } from "./gitlab.js";
import { parseJiraWebhook } from "./jira.js";
import { parseLinearWebhook } from "./linear.js";

export function parseIntegrationWebhook(args: {
  provider: IntegrationProvider;
  eventName?: string;
  payload: unknown;
}): IntegrationParseResult {
  switch (args.provider) {
    case "github":
      return parseGitHubIssueCommentEvent(args.eventName ?? "", args.payload);
    case "gitlab":
      return parseGitLabNoteWebhook(args.payload);
    case "jira":
      return parseJiraWebhook(args.payload);
    case "linear":
      return parseLinearWebhook(args.payload);
    default:
      return { accepted: false, reason: "unsupported_provider" };
  }
}

