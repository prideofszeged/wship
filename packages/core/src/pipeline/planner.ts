import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type {
  PlanDraft,
  PlanJobPayload,
  PlanMode,
  PlannerLlmConfig,
  RetrievedContext,
} from "../types/plan.js";

const execFileAsync = promisify(execFile);

interface PlannerOutput {
  draft: PlanDraft;
  notes: string[];
}

interface LlmCallResult {
  ok: boolean;
  text?: string;
  error?: string;
  provider: "codex" | "claude";
  model?: string;
}

const LLM_DEFAULT_TIMEOUT_MS = 120000;
const DRAFT_KEYS: Array<keyof PlanDraft> = [
  "summary",
  "research",
  "designChoices",
  "phases",
  "tasks",
  "risks",
  "testing",
  "handoffPrompt",
];

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string" },
    research: { type: "string" },
    designChoices: { type: "string" },
    phases: { type: "string" },
    tasks: { type: "string" },
    risks: { type: "string" },
    testing: { type: "string" },
    handoffPrompt: { type: "string" },
  },
  required: DRAFT_KEYS,
} as const;

function templatePlannerStage(payload: PlanJobPayload, ctx: RetrievedContext): PlanDraft {
  const targetFiles = ctx.candidateFiles.slice(0, 10);
  const files = targetFiles.map((f) => `- ${f}`).join("\n");
  const symbols = ctx.symbolMentions.length > 0 ? ctx.symbolMentions.join(", ") : "No direct symbol mentions detected.";

  return {
    summary: `Implement issue #${payload.issueNumber} for ${payload.repoFullName} using a phased, test-first change plan aligned with existing patterns.`,
    research: [
      "Key candidate files:",
      files || "- No direct file mentions found; retrieval fallback applied.",
      "",
      `Symbols referenced: ${symbols}`,
      ctx.historicalHints.length > 0 ? `Historical hints: ${ctx.historicalHints.join(" ")}` : "Historical hints: none",
    ].join("\n"),
    designChoices: [
      "- Prioritize incremental changes over broad refactors.",
      "- Preserve public interfaces where possible.",
      "- Ensure each phase has deterministic validation.",
    ].join("\n"),
    phases: [
      "1. Confirm current behavior and failure mode.",
      "2. Implement core change in identified modules.",
      "3. Add/adjust tests and run validation.",
      "4. Document rollout and rollback steps.",
    ].join("\n"),
    tasks: [
      "- Update core implementation files referenced above.",
      "- Add regression tests covering expected and edge behaviors.",
      "- Verify no breaking behavior for adjacent flows.",
      "- Prepare concise PR summary with risks and mitigations.",
    ].join("\n"),
    risks: [
      "- Hidden dependency changes across shared modules.",
      "- Incomplete test coverage for edge cases.",
      "- Runtime regressions from behavior changes.",
    ].join("\n"),
    testing: [
      "- Unit tests for changed logic paths.",
      "- Integration tests for API/workflow boundaries.",
      "- Regression checks against issue acceptance criteria.",
    ].join("\n"),
    handoffPrompt: [
      "You are implementing a pre-approved issue plan.",
      `Provider: ${payload.provider}`,
      `Work item: ${payload.workItemId}`,
      `Repo: ${payload.repoFullName}`,
      `Issue: #${payload.issueNumber} - ${payload.issueTitle}`,
      "Target files:",
      ...targetFiles.map((f) => `- ${f}`),
      "Read and modify only files listed in the Research section unless necessary.",
      "If you must expand scope, explain why before coding.",
      "Write tests first for current failing behavior, then implement fix, then rerun tests.",
      "Return: change summary, tests run, risks, and rollback notes.",
    ].join("\n"),
  };
}

function buildLlmSystemPrompt(): string {
  return [
    "You are a senior software planning agent.",
    "Generate implementation plans that are concrete, testable, and scoped to the issue.",
    "Return only valid JSON matching the required schema fields.",
  ].join("\n");
}

function buildLlmUserPrompt(payload: PlanJobPayload, ctx: RetrievedContext, mode: PlanMode): string {
  const candidateFiles = ctx.candidateFiles.slice(0, mode === "quick" ? 8 : 16);
  const lines = [
    `Planning mode: ${mode}`,
    `Provider: ${payload.provider}`,
    `Repo: ${payload.repoFullName}`,
    `Work item: ${payload.workItemId}`,
    `Issue number: ${payload.issueNumber}`,
    `Issue title: ${payload.issueTitle}`,
    "",
    "Issue body:",
    payload.issueBody || "(empty)",
    "",
    "Command/comment body:",
    payload.commentBody || "(empty)",
    "",
    "Candidate files:",
    ...(candidateFiles.length > 0 ? candidateFiles.map((f) => `- ${f}`) : ["- none"]),
    "",
    `Symbol mentions: ${ctx.symbolMentions.length > 0 ? ctx.symbolMentions.join(", ") : "none"}`,
    `Historical hints: ${ctx.historicalHints.length > 0 ? ctx.historicalHints.join(" ") : "none"}`,
    "",
    "Requirements:",
    "- Be specific to this issue and repo context.",
    "- Include concrete files/functions when possible.",
    "- Provide phased execution steps and explicit tests.",
    "- Include risks and rollback mitigation for risky changes.",
    "- Handoff prompt must include strong guardrails.",
  ];
  return lines.join("\n");
}

function extractJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  const withoutFence = trimmed.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try {
    return JSON.parse(withoutFence) as Record<string, unknown>;
  } catch {
    const start = withoutFence.indexOf("{");
    const end = withoutFence.lastIndexOf("}");
    if (start < 0 || end <= start) {
      return null;
    }
    try {
      return JSON.parse(withoutFence.slice(start, end + 1)) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

function countDraftFields(candidate: Record<string, unknown>): number {
  return DRAFT_KEYS.reduce((count, key) => {
    const value = candidate[key];
    return typeof value === "string" && value.trim().length > 0 ? count + 1 : count;
  }, 0);
}

function resolvePlanObject(candidate: Record<string, unknown>): Record<string, unknown> {
  if (countDraftFields(candidate) > 0) {
    return candidate;
  }

  const nestedCandidates: Array<unknown> = [
    candidate["result"],
    candidate["output"],
    candidate["data"],
    candidate["response"],
  ];

  for (const nested of nestedCandidates) {
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      const nestedObj = nested as Record<string, unknown>;
      if (countDraftFields(nestedObj) > 0) {
        return nestedObj;
      }
    }
    if (typeof nested === "string") {
      const parsed = extractJsonObject(nested);
      if (parsed && countDraftFields(parsed) > 0) {
        return parsed;
      }
    }
  }

  return candidate;
}

function normalizeLlmDraft(candidate: Record<string, unknown>, fallback: PlanDraft): { draft: PlanDraft; missing: string[] } {
  const out: PlanDraft = { ...fallback };
  const missing: string[] = [];

  for (const key of DRAFT_KEYS) {
    const value = candidate[key];
    if (typeof value === "string" && value.trim().length > 0) {
      out[key] = value.trim();
      continue;
    }
    missing.push(key);
  }

  return { draft: out, missing };
}

function formatCliError(error: unknown, tag: string): string {
  if (!error || typeof error !== "object") {
    return `${tag}:unknown_error`;
  }

  const err = error as Error & {
    code?: string | number;
    signal?: string;
    stderr?: string;
    stdout?: string;
    killed?: boolean;
  };

  const parts: string[] = [tag];
  if (err.code !== undefined) {
    parts.push(`code=${String(err.code)}`);
  }
  if (err.signal) {
    parts.push(`signal=${err.signal}`);
  }
  if (err.killed) {
    parts.push("killed=true");
  }
  const stderr = typeof err.stderr === "string" ? err.stderr.trim().slice(0, 200) : "";
  if (stderr) {
    parts.push(`stderr=${stderr}`);
  }
  return parts.join(" ");
}

async function callCodexLlm(args: {
  systemPrompt: string;
  userPrompt: string;
  model?: string;
  timeoutMs: number;
  codexBin?: string;
}): Promise<LlmCallResult> {
  const schemaPath = path.join(os.tmpdir(), `issue-planner-schema-${randomUUID()}.json`);
  const outputPath = path.join(os.tmpdir(), `issue-planner-codex-out-${randomUUID()}.txt`);
  const prompt = `${args.systemPrompt}\n\n${args.userPrompt}`;

  try {
    await writeFile(schemaPath, JSON.stringify(OUTPUT_SCHEMA), "utf8");
    const commandArgs = [
      "exec",
      "--skip-git-repo-check",
      "--sandbox",
      "read-only",
      "--color",
      "never",
      "--output-schema",
      schemaPath,
      "--output-last-message",
      outputPath,
      "--",
      prompt,
    ];

    if (args.model) {
      commandArgs.splice(1, 0, "--model", args.model);
    }

    const result = await execFileAsync(args.codexBin ?? "codex", commandArgs, {
      maxBuffer: 1024 * 1024 * 6,
      timeout: args.timeoutMs,
    });

    let text = "";
    try {
      text = (await readFile(outputPath, "utf8")).trim();
    } catch {
      text = "";
    }

    if (!text) {
      text = result.stdout.trim();
    }

    if (!text) {
      return {
        ok: false,
        provider: "codex",
        ...(args.model ? { model: args.model } : {}),
        error: "codex_empty_output",
      };
    }

    return {
      ok: true,
      provider: "codex",
      ...(args.model ? { model: args.model } : {}),
      text,
    };
  } catch (error) {
    return {
      ok: false,
      provider: "codex",
      ...(args.model ? { model: args.model } : {}),
      error: formatCliError(error, "codex_exec_failed"),
    };
  } finally {
    await Promise.all([rm(schemaPath, { force: true }), rm(outputPath, { force: true })]);
  }
}

async function callClaudeLlm(args: {
  systemPrompt: string;
  userPrompt: string;
  model?: string;
  timeoutMs: number;
  claudeBin?: string;
}): Promise<LlmCallResult> {
  const prompt = `${args.systemPrompt}\n\n${args.userPrompt}`;
  const commandArgs = [
    "-p",
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify(OUTPUT_SCHEMA),
    "--tools",
    "",
    prompt,
  ];
  if (args.model) {
    commandArgs.splice(2, 0, "--model", args.model);
  }

  try {
    const result = await execFileAsync(args.claudeBin ?? "claude", commandArgs, {
      maxBuffer: 1024 * 1024 * 6,
      timeout: args.timeoutMs,
    });
    const text = result.stdout.trim();
    if (!text) {
      return {
        ok: false,
        provider: "claude",
        ...(args.model ? { model: args.model } : {}),
        error: "claude_empty_output",
      };
    }

    return {
      ok: true,
      provider: "claude",
      ...(args.model ? { model: args.model } : {}),
      text,
    };
  } catch (error) {
    return {
      ok: false,
      provider: "claude",
      ...(args.model ? { model: args.model } : {}),
      error: formatCliError(error, "claude_exec_failed"),
    };
  }
}

async function generateDraftWithLlm(args: {
  payload: PlanJobPayload;
  ctx: RetrievedContext;
  mode: PlanMode;
  llm: PlannerLlmConfig;
  fallback: PlanDraft;
}): Promise<PlannerOutput> {
  const systemPrompt = buildLlmSystemPrompt();
  const userPrompt = buildLlmUserPrompt(args.payload, args.ctx, args.mode);
  const timeoutMs = args.llm.timeoutMs ?? LLM_DEFAULT_TIMEOUT_MS;

  const callResult =
    args.llm.provider === "codex"
      ? await callCodexLlm({
          systemPrompt,
          userPrompt,
          timeoutMs,
          ...(args.llm.model ? { model: args.llm.model } : {}),
          ...(args.llm.codexBin ? { codexBin: args.llm.codexBin } : {}),
        })
      : await callClaudeLlm({
          systemPrompt,
          userPrompt,
          timeoutMs,
          ...(args.llm.model ? { model: args.llm.model } : {}),
          ...(args.llm.claudeBin ? { claudeBin: args.llm.claudeBin } : {}),
        });

  if (!callResult.ok || !callResult.text) {
    return {
      draft: args.fallback,
      notes: [`LLM planner fallback: ${callResult.error ?? "unknown_error"}`],
    };
  }

  const parsed = extractJsonObject(callResult.text);
  if (!parsed) {
    return {
      draft: args.fallback,
      notes: [`LLM planner fallback: invalid_json_output (${callResult.provider})`],
    };
  }

  const resolved = resolvePlanObject(parsed);
  const normalized = normalizeLlmDraft(resolved, args.fallback);
  if (normalized.missing.length > 0) {
    return {
      draft: normalized.draft,
      notes: [
        `LLM planner partial output (${callResult.provider}); template-filled fields: ${normalized.missing.join(", ")}`,
      ],
    };
  }

  return { draft: normalized.draft, notes: [] };
}

export async function plannerStage(args: {
  payload: PlanJobPayload;
  ctx: RetrievedContext;
  mode?: PlanMode;
  llm?: PlannerLlmConfig;
}): Promise<PlannerOutput> {
  const mode = args.mode ?? "full";
  const fallback = templatePlannerStage(args.payload, args.ctx);
  if (!args.llm || args.llm.provider === "none") {
    return {
      draft: fallback,
      notes: [],
    };
  }

  return generateDraftWithLlm({
    payload: args.payload,
    ctx: args.ctx,
    mode,
    llm: args.llm,
    fallback,
  });
}
