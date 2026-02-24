import type { IntegrationProvider } from "./integration.js";

export type PlanMode = "quick" | "full";
export type PlanIntent = "plan" | "replan";

export interface ParsedPlanCommand {
  intent: PlanIntent;
  mode: PlanMode;
  raw: string;
}

export interface PlanJobPayload {
  provider: IntegrationProvider;
  sourceEvent: string;
  requestOrigin?: "webhook" | "slack";
  workItemId: string;
  workItemUrl?: string;
  projectKey?: string;
  repoFullName: string;
  repoResolution: "provided" | "mapped" | "unresolved";
  issueNumber: number;
  issueTitle: string;
  issueBody: string;
  issueLabels: string[];
  commentBody: string;
  commentAuthor: string;
  slackResponseUrl?: string;
  slackChannelId?: string;
  slackUserId?: string;
  slackTeamId?: string;
  existingRevision?: number;
}

export type PlanJobType = "PLAN_REQUEST" | "REPLAN_REQUEST";

export interface QueueJob<TPayload> {
  id: string;
  createdAt: string;
  idempotencyKey: string;
  type: PlanJobType;
  payload: TPayload;
  mode: PlanMode;
}

export interface RetrievedContext {
  structuralFileMentions: string[];
  symbolMentions: string[];
  relatedIssueMentions: string[];
  candidateFiles: string[];
  historicalHints: string[];
  repoLanguage?: string;
  readmeSnippet?: string;
  dependenciesSnippet?: string;
}

export interface PlanDraft {
  summary: string;
  research: string;
  designChoices: string;
  phases: string;
  tasks: string;
  risks: string;
  testing: string;
  handoffPrompt: string;
}

export interface CriticOutput {
  revisedDraft: PlanDraft;
  notes: string[];
}

export interface ScoreBreakdown {
  completeness: number;
  specificity: number;
  testability: number;
  riskCoverage: number;
  total: number;
}

export interface HandoffValidation {
  passed: boolean;
  reasons: string[];
}

export interface PlannerProviderAttempt {
  provider: "codex" | "claude";
  ok: boolean;
  error?: string;
  durationMs: number;
}

export interface PlannerRunMetadata {
  source: "llm" | "llm-partial" | "template";
  providersAttempted: PlannerProviderAttempt[];
  templateFilledFields: string[];
}

export interface PlanPipelineResult {
  status: "ready" | "needs_revision";
  markdown: string;
  score: ScoreBreakdown;
  handoff: HandoffValidation;
  criticNotes: string[];
  plannerMeta: PlannerRunMetadata;
  timingsMs: {
    retrieval: number;
    planner: number;
    critic: number;
    scoring: number;
    finalizer: number;
    total: number;
  };
}

export type PlannerLlmProvider = "none" | "codex" | "claude";

export interface PlannerLlmConfig {
  provider: PlannerLlmProvider;
  fallback?: Exclude<PlannerLlmProvider, "none">;  // secondary provider tried before template fallback
  model?: string;
  timeoutMs?: number;
  timeoutQuickMs?: number;   // timeout for quick-mode jobs (default: 45000)
  codexBin?: string;
  claudeBin?: string;
}

export interface JiraConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
}

export interface GitHubEnrichConfig {
  token?: string;
}

export interface PlanPipelineOptions {
  mode?: PlanMode;
  llm?: PlannerLlmConfig;
  jira?: JiraConfig;
  github?: GitHubEnrichConfig;
}
