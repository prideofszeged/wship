import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import type {
  PlanDraft,
  PlanJobPayload,
  PlanMode,
  PlannerLlmConfig,
  PlannerRunMetadata,
  RetrievedContext,
} from "../types/plan.js";

const execFileAsync = promisify(execFile);

interface PlannerOutput {
  draft: PlanDraft;
  notes: string[];
  meta: PlannerRunMetadata;
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

export function buildLlmSystemPrompt(): string {
  const schema = {
    summary:
      "One paragraph describing the problem and the chosen solution approach. Be specific to this issue.",
    research:
      "Bullet list of files, modules, symbols, and APIs to read and understand before writing any code.",
    designChoices:
      "Bullet list of architectural decisions and key tradeoffs for this change. Explain why each choice was made.",
    phases:
      "Numbered list of implementation phases. Each phase must have a clear completion criterion.",
    tasks:
      "Numbered list of specific code changes: exact file paths, function names, and what to add/modify/remove.",
    risks:
      "Bullet list of risks, edge cases, potential regressions, and concrete mitigation steps for each.",
    testing:
      "Bullet list of test cases covering unit, integration, and acceptance criteria for this change.",
    handoffPrompt:
      "Complete self-contained prompt for a coding agent. Must include: repository, exact files to change, constraints, test requirements, and the definition of done.",
  };

  return [
    "You are a senior software planning agent.",
    "Generate implementation plans that are concrete, testable, and scoped to the issue.",
    "",
    "Return ONLY a valid JSON object — no markdown fences, no explanation, no surrounding text.",
    "Do not wrap the object in any key. Output the raw object directly.",
    "",
    "The JSON object MUST contain exactly these 8 string fields:",
    JSON.stringify(schema, null, 2),
  ].join("\n");
}

export function buildLlmUserPrompt(payload: PlanJobPayload, ctx: RetrievedContext, mode: PlanMode): string {
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
  lines.push(
    "",
    "IMPORTANT: Respond with ONLY the JSON object. No markdown, no explanation, no surrounding text.",
  );
  return lines.join("\n");
}

export function extractJsonObject(text: string): Record<string, unknown> | null {
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

export function resolvePlanObject(candidate: Record<string, unknown>): Record<string, unknown> {
  if (countDraftFields(candidate) > 0) {
    return candidate;
  }

  const nestedCandidates: Array<unknown> = [
    candidate["structured_output"],
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

export function normalizeLlmDraft(candidate: Record<string, unknown>, fallback: PlanDraft): { draft: PlanDraft; missing: string[] } {
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
  const prompt = `${args.systemPrompt}\n\n${args.userPrompt}`;

  try {
    const commandArgs = [
      "exec",
      "--skip-git-repo-check",
      "--sandbox",
      "read-only",
      "--color",
      "never",
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

    let text = result.stdout.trim();
    if (!text && result.stderr) {
      const parsed = extractJsonObject(result.stderr);
      if (parsed) {
        text = JSON.stringify(parsed);
      }
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
  const commandArgs: string[] = [];
  if (args.model) {
    commandArgs.push("--model", args.model);
  }
  commandArgs.push(
    "--permission-mode",
    "bypassPermissions",
    "-p",
    "--output-format",
    "text",
    "--tools",
    "",
  );

  try {
    const result = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      const spawnEnv = { ...process.env };
      delete spawnEnv["CLAUDECODE"];
      const child = spawn(args.claudeBin ?? "claude", commandArgs, {
        stdio: ["pipe", "pipe", "pipe"],
        env: spawnEnv,
      });

      let stdout = "";
      let stderr = "";
      let timedOut = false;

      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
      }, args.timeoutMs);

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });

      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });

      child.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });

      child.on("close", (code, signal) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve({ stdout, stderr });
          return;
        }

        const err = new Error(`claude_exit_${code ?? "null"}`);
        if (code !== null) {
          (err as Error & { code?: string | number }).code = code;
        }
        if (signal) {
          (err as Error & { signal?: string }).signal = signal;
        }
        (err as Error & { stderr?: string }).stderr = stderr;
        (err as Error & { killed?: boolean }).killed = timedOut;
        reject(err);
      });

      child.stdin.end(prompt);
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

export function selectDraftFromResults(
  attempts: ReadonlyArray<{ result: LlmCallResult; durationMs: number }>,
  fallback: PlanDraft,
): { draft: PlanDraft; notes: string[]; meta: PlannerRunMetadata } {
  const providersAttempted: PlannerRunMetadata["providersAttempted"] = attempts.map((a) => ({
    provider: a.result.provider,
    ok: a.result.ok,
    ...(a.result.error ? { error: a.result.error } : {}),
    durationMs: a.durationMs,
  }));

  for (const attempt of attempts) {
    if (!attempt.result.ok || !attempt.result.text) {
      continue;
    }
    const parsed = extractJsonObject(attempt.result.text);
    if (!parsed) {
      continue;
    }
    const resolved = resolvePlanObject(parsed);
    const normalized = normalizeLlmDraft(resolved, fallback);
    const isPartial = normalized.missing.length > 0;
    const note = isPartial
      ? `LLM planner partial output (${attempt.result.provider}); template-filled: ${normalized.missing.join(", ")}`
      : undefined;
    return {
      draft: normalized.draft,
      notes: note !== undefined ? [note] : [],
      meta: {
        source: isPartial ? "llm-partial" : "llm",
        providersAttempted,
        templateFilledFields: normalized.missing,
      },
    };
  }

  const failNotes = attempts.map((a) => {
    if (a.result.ok) {
      return `LLM planner fallback (${a.result.provider}): unparseable_output`;
    }
    return `LLM planner fallback (${a.result.provider}): ${a.result.error ?? "unknown_error"}`;
  });
  return {
    draft: fallback,
    notes: failNotes,
    meta: {
      source: "template",
      providersAttempted,
      templateFilledFields: [],
    },
  };
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
  const LLM_QUICK_DEFAULT_TIMEOUT_MS = 45000;
  const timeoutMs =
    args.mode === "quick"
      ? (args.llm.timeoutQuickMs ?? LLM_QUICK_DEFAULT_TIMEOUT_MS)
      : (args.llm.timeoutMs ?? LLM_DEFAULT_TIMEOUT_MS);

  // Build ordered list of providers to try (primary, then optional fallback)
  const providers: Array<"codex" | "claude"> = [];
  if (args.llm.provider === "codex" || args.llm.provider === "claude") {
    providers.push(args.llm.provider);
  }
  if (args.llm.fallback && args.llm.fallback !== args.llm.provider) {
    providers.push(args.llm.fallback);
  }

  const attempts: Array<{ result: LlmCallResult; durationMs: number }> = [];

  for (const provider of providers) {
    const isPrimary = provider === args.llm.provider;
    const callStart = Date.now();
    const callResult =
      provider === "codex"
        ? await callCodexLlm({
            systemPrompt,
            userPrompt,
            timeoutMs,
            ...(isPrimary && args.llm.model ? { model: args.llm.model } : {}),
            ...(args.llm.codexBin ? { codexBin: args.llm.codexBin } : {}),
          })
        : await callClaudeLlm({
            systemPrompt,
            userPrompt,
            timeoutMs,
            ...(isPrimary && args.llm.model ? { model: args.llm.model } : {}),
            ...(args.llm.claudeBin ? { claudeBin: args.llm.claudeBin } : {}),
          });
    const durationMs = Date.now() - callStart;
    attempts.push({ result: callResult, durationMs });

    // Short-circuit: if this attempt succeeded and produced parseable JSON, stop trying
    if (callResult.ok && callResult.text && extractJsonObject(callResult.text)) {
      break;
    }
  }

  const { draft, notes, meta } = selectDraftFromResults(attempts, args.fallback);
  return { draft, notes, meta };
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
      meta: {
        source: "template" as const,
        providersAttempted: [],
        templateFilledFields: [],
      },
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
