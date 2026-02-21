import type { ParsedPlanCommand } from "./plan.js";

export type IntegrationProvider = "github" | "gitlab" | "jira" | "linear";

export interface InboundPlanRequest {
  provider: IntegrationProvider;
  sourceEvent: string;
  workItem: {
    id: string;
    title: string;
    body: string;
    labels: string[];
    url?: string;
    projectKey?: string;
    repoHint?: string;
    numericIssueNumber?: number;
  };
  comment: {
    body: string;
    author: string;
  };
  command: ParsedPlanCommand;
}

export type IntegrationParseResult =
  | { accepted: false; reason: string }
  | { accepted: true; request: InboundPlanRequest };

export interface ParsedWebhookRequest {
  provider: IntegrationProvider;
  endpoint: string;
  parseResult: IntegrationParseResult;
}

