import type { PlanJobPayload, RetrievedContext } from "../types/plan.js";

const FILE_PATH_RE = /\b(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.[A-Za-z0-9]+\b/g;
const SYMBOL_RE = /\b[A-Za-z_][A-Za-z0-9_]*\(/g;
const ISSUE_REF_RE = /#\d+/g;

function uniq(items: string[]): string[] {
  return Array.from(new Set(items));
}

export function buildRetrievedContext(payload: PlanJobPayload): RetrievedContext {
  const corpus = `${payload.issueTitle}\n${payload.issueBody}\n${payload.commentBody}`;
  const structuralFileMentions = uniq(corpus.match(FILE_PATH_RE) ?? []);
  const symbolMentions = uniq((corpus.match(SYMBOL_RE) ?? []).map((s) => s.replace(/\($/, "")));
  const relatedIssueMentions = uniq(corpus.match(ISSUE_REF_RE) ?? []);

  const candidateFiles = uniq([
    ...structuralFileMentions,
    "src/index.ts",
    "src/config.ts",
    "src/services/planner.ts",
    "src/services/retrieval.ts",
    "src/services/github.ts",
  ]).slice(0, payload.commentBody.includes("--quick") ? 8 : 20);

  const historicalHints = relatedIssueMentions.map((id) => `Inspect closed issue ${id} for similar behavior.`);

  return {
    structuralFileMentions,
    symbolMentions,
    relatedIssueMentions,
    candidateFiles,
    historicalHints,
  };
}
