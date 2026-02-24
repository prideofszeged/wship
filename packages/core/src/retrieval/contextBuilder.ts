import type { PlanJobPayload, RetrievedContext } from "../types/plan.js";
import type { GitHubRepoContext } from "./githubEnricher.js";

const FILE_PATH_RE = /\b(?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.[A-Za-z0-9]+\b/g;
const SYMBOL_RE = /\b[A-Za-z_][A-Za-z0-9_]*\(/g;
const ISSUE_REF_RE = /#\d+/g;

const FALLBACK_CANDIDATE_FILES = [
  "src/index.ts",
  "src/config.ts",
  "src/services/planner.ts",
  "src/services/retrieval.ts",
  "src/services/github.ts",
];

function uniq(items: string[]): string[] {
  return Array.from(new Set(items));
}

export function buildRetrievedContext(
  payload: PlanJobPayload,
  github?: GitHubRepoContext | null,
): RetrievedContext {
  const corpus = `${payload.issueTitle}\n${payload.issueBody}\n${payload.commentBody}`;
  const structuralFileMentions = uniq(corpus.match(FILE_PATH_RE) ?? []);
  const symbolMentions = uniq((corpus.match(SYMBOL_RE) ?? []).map((s) => s.replace(/\($/, "")));
  const relatedIssueMentions = uniq(corpus.match(ISSUE_REF_RE) ?? []);

  const isQuick = payload.commentBody.includes("--quick");
  const maxFiles = isQuick ? 8 : 20;

  let candidateFiles: string[];
  if (github && github.filePaths.length > 0) {
    // Use real repo files, prioritising any mentioned in the issue text
    const mentioned = structuralFileMentions.filter((f) => github.filePaths.includes(f));
    const rest = github.filePaths.filter((f) => !mentioned.includes(f));
    candidateFiles = uniq([...mentioned, ...rest]).slice(0, maxFiles);
  } else {
    candidateFiles = uniq([...structuralFileMentions, ...FALLBACK_CANDIDATE_FILES]).slice(
      0,
      maxFiles,
    );
  }

  const historicalHints = relatedIssueMentions.map(
    (id) => `Inspect closed issue ${id} for similar behavior.`,
  );

  return {
    structuralFileMentions,
    symbolMentions,
    relatedIssueMentions,
    candidateFiles,
    historicalHints,
    ...(github?.language ? { repoLanguage: github.language } : {}),
    ...(github?.readmeSnippet ? { readmeSnippet: github.readmeSnippet } : {}),
    ...(github?.dependenciesSnippet ? { dependenciesSnippet: github.dependenciesSnippet } : {}),
  };
}
