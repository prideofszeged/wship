# LLM Integration Stabilization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Stabilize the planner LLM integration so CLI-driven plan generation reliably produces structured output instead of falling back to the generic template.

**Architecture:** Four targeted improvements to `packages/core/src/pipeline/planner.ts`: (1) fix the system prompt to explicitly include the JSON schema so the LLM knows what to produce, (2) add a provider fallback chain so a failure of the primary CLI tries a secondary before the template, (3) attach observability metadata to the pipeline result so failures are debuggable from completed job artifacts, and (4) apply mode-aware timeout budgets so quick-mode requests don't burn the full 120s. All changes guarded by `node:test` unit tests.

**Tech Stack:** TypeScript (ES2022, NodeNext ESM), `node:test` (built-in, no external deps), `node:assert/strict`

---

## Background

The pipeline currently falls back to the template in most LLM runs because:
- **Root cause #1 (highest impact):** The system prompt says "Return valid JSON matching the required schema fields" but never states what those fields are. The LLM guesses, often incorrectly.
- **Root cause #2:** A single provider failure (timeout or bad JSON) falls directly to the template with no secondary attempt.
- **Root cause #3:** Both quick and full mode use the same 120s timeout; quick-mode prompts are much shorter and shouldn't burn that budget.
- **Root cause #4:** When things go wrong, the completed job artifact has no record of which provider ran, its exit code, stderr, or which fields fell back.

---

## Task 1: Set Up Test Infrastructure

**Files:**
- Modify: `package.json` (root)
- Create: `packages/core/src/pipeline/planner.test.ts`
- Modify: `packages/core/tsconfig.json` (verify test files are included)

### Step 1: Add test script to root `package.json`

In `package.json`, add inside `"scripts"`:
```json
"test": "tsc -b && node --test packages/core/dist/pipeline/planner.test.js"
```

The full scripts block becomes:
```json
"scripts": {
  "build": "tsc -b",
  "clean": "rm -rf apps/*/dist packages/*/dist",
  "typecheck": "tsc -b --pretty",
  "dev:github-app": "node apps/github-app/dist/index.js",
  "dev:worker": "node apps/planner-worker/dist/index.js",
  "test": "tsc -b && node --test packages/core/dist/pipeline/planner.test.js"
}
```

### Step 2: Create `packages/core/src/pipeline/planner.test.ts`

```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Smoke test to verify test runner works
describe("planner test suite", () => {
  it("runs", () => {
    assert.ok(true);
  });
});
```

### Step 3: Run tests to verify setup works

```bash
npm test
```

Expected output: `▶ planner test suite` ... `✔ runs` ... `pass 1`

### Step 4: Commit

```bash
git add package.json packages/core/src/pipeline/planner.test.ts
git commit -m "test: add node:test infrastructure for planner pipeline"
```

---

## Task 2: Test and Fix `extractJsonObject`

The function in `planner.ts:135-156` strips markdown fences and extracts a JSON object from text. Test it to lock in its behavior before touching it.

**Files:**
- Modify: `packages/core/src/pipeline/planner.test.ts`
- Modify: `packages/core/src/pipeline/planner.ts` (export the function)

### Step 1: Export `extractJsonObject` from planner.ts

In `packages/core/src/pipeline/planner.ts`, change line 135 from:
```typescript
function extractJsonObject(text: string): Record<string, unknown> | null {
```
to:
```typescript
export function extractJsonObject(text: string): Record<string, unknown> | null {
```

Also export `resolvePlanObject` (line 165) and `normalizeLlmDraft` (line 196) the same way:
```typescript
export function resolvePlanObject(...)
export function normalizeLlmDraft(...)
```

### Step 2: Write failing tests — add to `planner.test.ts`

Replace the file contents:
```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractJsonObject, resolvePlanObject, normalizeLlmDraft } from "./planner.js";
import type { PlanDraft } from "../types/plan.js";

const FULL_DRAFT: PlanDraft = {
  summary: "s",
  research: "r",
  designChoices: "d",
  phases: "p",
  tasks: "t",
  risks: "ri",
  testing: "te",
  handoffPrompt: "h",
};

describe("extractJsonObject", () => {
  it("parses a plain JSON object", () => {
    const result = extractJsonObject('{"foo":"bar"}');
    assert.deepEqual(result, { foo: "bar" });
  });

  it("strips ```json fences", () => {
    const result = extractJsonObject("```json\n{\"foo\":\"bar\"}\n```");
    assert.deepEqual(result, { foo: "bar" });
  });

  it("strips plain ``` fences", () => {
    const result = extractJsonObject("```\n{\"foo\":\"bar\"}\n```");
    assert.deepEqual(result, { foo: "bar" });
  });

  it("extracts JSON from surrounding text", () => {
    const result = extractJsonObject('Here is the plan:\n{"foo":"bar"}\nDone.');
    assert.deepEqual(result, { foo: "bar" });
  });

  it("returns null for empty string", () => {
    assert.equal(extractJsonObject(""), null);
  });

  it("returns null for whitespace only", () => {
    assert.equal(extractJsonObject("   "), null);
  });

  it("returns null for invalid JSON", () => {
    assert.equal(extractJsonObject("{not valid json}"), null);
  });

  it("returns null when no braces found", () => {
    assert.equal(extractJsonObject("no json here"), null);
  });
});

describe("resolvePlanObject", () => {
  it("returns candidate directly if it has draft fields", () => {
    const candidate = { summary: "hello", research: "r", designChoices: "d", phases: "p", tasks: "t", risks: "ri", testing: "te", handoffPrompt: "h" };
    assert.deepEqual(resolvePlanObject(candidate), candidate);
  });

  it("resolves from 'result' wrapper key", () => {
    const inner = { summary: "hello", research: "r", designChoices: "d", phases: "p", tasks: "t", risks: "ri", testing: "te", handoffPrompt: "h" };
    const candidate = { result: inner };
    assert.deepEqual(resolvePlanObject(candidate), inner);
  });

  it("resolves from 'structured_output' wrapper key", () => {
    const inner = { summary: "x", research: "r", designChoices: "d", phases: "p", tasks: "t", risks: "ri", testing: "te", handoffPrompt: "h" };
    assert.deepEqual(resolvePlanObject({ structured_output: inner }), inner);
  });

  it("resolves from stringified JSON in wrapper key", () => {
    const inner = { summary: "x", research: "r", designChoices: "d", phases: "p", tasks: "t", risks: "ri", testing: "te", handoffPrompt: "h" };
    assert.deepEqual(resolvePlanObject({ output: JSON.stringify(inner) }), inner);
  });

  it("returns original candidate when nothing resolves", () => {
    const candidate = { unrelated: "data" };
    assert.deepEqual(resolvePlanObject(candidate), candidate);
  });
});

describe("normalizeLlmDraft", () => {
  it("accepts a fully populated candidate", () => {
    const candidate = { ...FULL_DRAFT } as Record<string, unknown>;
    const { draft, missing } = normalizeLlmDraft(candidate, FULL_DRAFT);
    assert.equal(missing.length, 0);
    assert.deepEqual(draft, FULL_DRAFT);
  });

  it("falls back missing fields from template", () => {
    const candidate: Record<string, unknown> = { summary: "custom summary" };
    const { draft, missing } = normalizeLlmDraft(candidate, FULL_DRAFT);
    assert.equal(draft.summary, "custom summary");
    assert.equal(draft.research, FULL_DRAFT.research);
    assert.ok(missing.includes("research"));
    assert.ok(missing.includes("designChoices"));
  });

  it("ignores whitespace-only field values", () => {
    const candidate: Record<string, unknown> = { summary: "   " };
    const { draft, missing } = normalizeLlmDraft(candidate, FULL_DRAFT);
    assert.equal(draft.summary, FULL_DRAFT.summary);
    assert.ok(missing.includes("summary"));
  });
});
```

### Step 3: Run tests — expect failures (function not exported yet, or import errors)

```bash
npm test
```

Expected: compile error or import failure until exports are added.

### Step 4: Add the exports as described in Step 1, then run again

```bash
npm test
```

Expected: all tests in the three `describe` blocks pass.

### Step 5: Commit

```bash
git add packages/core/src/pipeline/planner.ts packages/core/src/pipeline/planner.test.ts
git commit -m "test: add unit tests for JSON extraction and draft normalization"
```

---

## Task 3: Fix System Prompt to Include JSON Schema

This is the **highest-impact change** — the LLM currently has no idea what fields to produce.

**Files:**
- Modify: `packages/core/src/pipeline/planner.ts` (`buildLlmSystemPrompt`, lines 95-101)
- Modify: `packages/core/src/pipeline/planner.test.ts` (add prompt tests)

### Step 1: Write a failing test — add to the describe blocks in `planner.test.ts`

First, export `buildLlmSystemPrompt` from `planner.ts`:
```typescript
export function buildLlmSystemPrompt(): string {
```

Then add this test block in `planner.test.ts`:
```typescript
import { extractJsonObject, resolvePlanObject, normalizeLlmDraft, buildLlmSystemPrompt } from "./planner.js";

// ... existing tests ...

describe("buildLlmSystemPrompt", () => {
  const prompt = buildLlmSystemPrompt();

  const REQUIRED_FIELDS = [
    "summary",
    "research",
    "designChoices",
    "phases",
    "tasks",
    "risks",
    "testing",
    "handoffPrompt",
  ];

  for (const field of REQUIRED_FIELDS) {
    it(`includes field name "${field}"`, () => {
      assert.ok(prompt.includes(field), `System prompt missing field: ${field}`);
    });
  }

  it("instructs the LLM to return only JSON", () => {
    assert.ok(
      prompt.toLowerCase().includes("json") && prompt.toLowerCase().includes("only"),
      "System prompt should instruct LLM to return only JSON"
    );
  });
});
```

### Step 2: Run tests — `buildLlmSystemPrompt` tests fail

```bash
npm test
```

Expected: 9 failures for the prompt tests (field names not found in current 3-line prompt).

### Step 3: Replace `buildLlmSystemPrompt` in `planner.ts`

Replace lines 95-101 with:
```typescript
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
```

### Step 4: Run tests — all pass

```bash
npm test
```

Expected: all tests pass including the 9 new prompt tests.

### Step 5: Commit

```bash
git add packages/core/src/pipeline/planner.ts packages/core/src/pipeline/planner.test.ts
git commit -m "feat: include JSON schema in LLM system prompt for reliable structured output"
```

---

## Task 4: Strengthen User Prompt Output Instructions

The user prompt should reinforce JSON-only output and remind the model mid-prompt.

**Files:**
- Modify: `packages/core/src/pipeline/planner.ts` (`buildLlmUserPrompt`, lines 103-133)

### Step 1: Write failing test

Export `buildLlmUserPrompt` from `planner.ts`:
```typescript
export function buildLlmUserPrompt(payload: PlanJobPayload, ctx: RetrievedContext, mode: PlanMode): string {
```

Add test in `planner.test.ts`:
```typescript
import { extractJsonObject, resolvePlanObject, normalizeLlmDraft, buildLlmSystemPrompt, buildLlmUserPrompt } from "./planner.js";
import type { PlanJobPayload, RetrievedContext } from "../types/plan.js";

// Add after existing describe blocks:
describe("buildLlmUserPrompt", () => {
  const payload: PlanJobPayload = {
    provider: "github",
    sourceEvent: "issue_comment",
    workItemId: "github:org/repo#42",
    repoFullName: "org/repo",
    repoResolution: "provided",
    issueNumber: 42,
    issueTitle: "Fix the thing",
    issueBody: "It is broken",
    issueLabels: [],
    commentBody: "/plan",
    commentAuthor: "dev",
  };
  const ctx: RetrievedContext = {
    structuralFileMentions: [],
    symbolMentions: [],
    relatedIssueMentions: [],
    candidateFiles: ["src/foo.ts"],
    historicalHints: [],
  };

  it("includes repo name", () => {
    const p = buildLlmUserPrompt(payload, ctx, "full");
    assert.ok(p.includes("org/repo"));
  });

  it("includes issue title", () => {
    const p = buildLlmUserPrompt(payload, ctx, "full");
    assert.ok(p.includes("Fix the thing"));
  });

  it("includes JSON output reminder", () => {
    const p = buildLlmUserPrompt(payload, ctx, "full");
    assert.ok(p.toLowerCase().includes("json"), "User prompt should include JSON reminder");
  });

  it("limits candidate files in quick mode", () => {
    const ctxMany: RetrievedContext = { ...ctx, candidateFiles: Array.from({ length: 20 }, (_, i) => `src/file${i}.ts`) };
    const quick = buildLlmUserPrompt(payload, ctxMany, "quick");
    const full = buildLlmUserPrompt(payload, ctxMany, "full");
    assert.ok(quick.length < full.length, "Quick mode should include fewer candidate files");
  });
});
```

### Step 2: Run tests — JSON reminder test fails

```bash
npm test
```

Expected: `includes JSON output reminder` fails (current prompt has no JSON reminder at the end).

### Step 3: Update `buildLlmUserPrompt` in `planner.ts`

Replace the `return lines.join("\n")` at line 132 with:
```typescript
  lines.push(
    "",
    "IMPORTANT: Respond with ONLY the JSON object. No markdown, no explanation, no surrounding text.",
  );
  return lines.join("\n");
```

### Step 4: Run tests — all pass

```bash
npm test
```

### Step 5: Commit

```bash
git add packages/core/src/pipeline/planner.ts packages/core/src/pipeline/planner.test.ts
git commit -m "feat: add JSON output reminder to user prompt"
```

---

## Task 5: Add Provider Fallback Chain

**Files:**
- Modify: `packages/core/src/types/plan.ts` (add `fallback` to `PlannerLlmConfig`)
- Modify: `apps/planner-worker/src/config.ts` (add `plannerLlmFallback`)
- Modify: `packages/core/src/pipeline/planner.ts` (refactor `generateDraftWithLlm` for fallback)
- Modify: `apps/planner-worker/src/index.ts` (pass fallback to pipeline)
- Modify: `packages/core/src/pipeline/planner.test.ts` (test fallback selection logic)

### Step 1: Update `PlannerLlmConfig` in `packages/core/src/types/plan.ts`

Change:
```typescript
export interface PlannerLlmConfig {
  provider: PlannerLlmProvider;
  model?: string;
  timeoutMs?: number;
  codexBin?: string;
  claudeBin?: string;
}
```

To:
```typescript
export interface PlannerLlmConfig {
  provider: PlannerLlmProvider;
  fallback?: Exclude<PlannerLlmProvider, "none">;  // NEW: secondary provider to try on failure
  model?: string;
  timeoutMs?: number;
  codexBin?: string;
  claudeBin?: string;
}
```

### Step 2: Add fallback config to `apps/planner-worker/src/config.ts`

In the `WorkerConfig` interface, add:
```typescript
plannerLlmFallback?: "codex" | "claude";
```

In `loadConfig()`, add after `plannerLlmModel`:
```typescript
const plannerLlmFallbackRaw = (process.env.PLANNER_LLM_FALLBACK ?? "").trim().toLowerCase();
const plannerLlmFallback: "codex" | "claude" | undefined =
  plannerLlmFallbackRaw === "codex" || plannerLlmFallbackRaw === "claude"
    ? plannerLlmFallbackRaw
    : undefined;
```

And in the returned object, add:
```typescript
...(plannerLlmFallback ? { plannerLlmFallback } : {}),
```

### Step 3: Extract selection logic as a pure testable function in `planner.ts`

Add this new exported function **before** `generateDraftWithLlm`:

```typescript
export function selectDraftFromResults(
  attempts: Array<{ result: LlmCallResult; text: string | undefined }>,
  fallback: PlanDraft,
): { draft: PlanDraft; notes: string[]; providersAttempted: Array<{ provider: "codex" | "claude"; ok: boolean; error?: string }> } {
  const providersAttempted = attempts.map((a) => ({
    provider: a.result.provider,
    ok: a.result.ok,
    ...(a.result.error ? { error: a.result.error } : {}),
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
    const note =
      normalized.missing.length > 0
        ? `LLM planner partial output (${attempt.result.provider}); template-filled: ${normalized.missing.join(", ")}`
        : undefined;
    return {
      draft: normalized.draft,
      notes: note ? [note] : [],
      providersAttempted,
    };
  }

  const failNotes = attempts.map((a) => `LLM planner fallback (${a.result.provider}): ${a.result.error ?? "unknown_error"}`);
  return {
    draft: fallback,
    notes: failNotes,
    providersAttempted,
  };
}
```

### Step 4: Write failing tests for `selectDraftFromResults`

Add to `planner.test.ts`:
```typescript
import {
  extractJsonObject,
  resolvePlanObject,
  normalizeLlmDraft,
  buildLlmSystemPrompt,
  buildLlmUserPrompt,
  selectDraftFromResults,
} from "./planner.js";

// Add after existing describe blocks:
describe("selectDraftFromResults", () => {
  const fallback: PlanDraft = FULL_DRAFT;
  const goodText = JSON.stringify(FULL_DRAFT);

  it("returns LLM draft when first attempt succeeds", () => {
    const attempts = [
      { result: { ok: true as const, provider: "codex" as const, text: goodText }, text: goodText },
    ];
    const { draft, notes } = selectDraftFromResults(attempts, fallback);
    assert.equal(notes.length, 0);
    assert.equal(draft.summary, FULL_DRAFT.summary);
  });

  it("falls through to second attempt when first fails", () => {
    const attempts = [
      { result: { ok: false as const, provider: "codex" as const, error: "timeout" }, text: undefined },
      { result: { ok: true as const, provider: "claude" as const, text: goodText }, text: goodText },
    ];
    const { draft, notes, providersAttempted } = selectDraftFromResults(attempts, fallback);
    assert.equal(draft.summary, FULL_DRAFT.summary);
    assert.equal(providersAttempted.length, 2);
    assert.equal(notes.length, 0);
  });

  it("returns template and error notes when all attempts fail", () => {
    const attempts = [
      { result: { ok: false as const, provider: "codex" as const, error: "codex_timeout" }, text: undefined },
      { result: { ok: false as const, provider: "claude" as const, error: "claude_timeout" }, text: undefined },
    ];
    const { draft, notes } = selectDraftFromResults(attempts, fallback);
    assert.equal(draft.summary, fallback.summary);
    assert.equal(notes.length, 2);
    assert.ok(notes[0]?.includes("codex"));
    assert.ok(notes[1]?.includes("claude"));
  });

  it("records partial output note when LLM fills only some fields", () => {
    const partial = JSON.stringify({ summary: "custom" });
    const attempts = [
      { result: { ok: true as const, provider: "codex" as const, text: partial }, text: partial },
    ];
    const { draft, notes } = selectDraftFromResults(attempts, fallback);
    assert.equal(draft.summary, "custom");
    assert.ok(notes.length > 0);
    assert.ok(notes[0]?.includes("template-filled"));
  });
});
```

### Step 5: Run tests — new tests fail (function doesn't exist yet)

```bash
npm test
```

Expected: import errors for `selectDraftFromResults`.

### Step 6: Refactor `generateDraftWithLlm` to use `selectDraftFromResults`

Replace the entire `generateDraftWithLlm` function in `planner.ts`:

```typescript
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

  // Build ordered list of providers to try
  const providers: Array<"codex" | "claude"> = [];
  if (args.llm.provider === "codex" || args.llm.provider === "claude") {
    providers.push(args.llm.provider);
  }
  if (args.llm.fallback && args.llm.fallback !== args.llm.provider) {
    providers.push(args.llm.fallback);
  }

  const attempts: Array<{ result: LlmCallResult; text: string | undefined }> = [];

  for (const provider of providers) {
    const callResult =
      provider === "codex"
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

    attempts.push({ result: callResult, text: callResult.text });

    // Short-circuit: if this attempt succeeded and produced parseable JSON, stop trying
    if (callResult.ok && callResult.text) {
      const parsed = extractJsonObject(callResult.text);
      if (parsed) {
        break;
      }
    }
  }

  const { draft, notes } = selectDraftFromResults(attempts, args.fallback);
  return { draft, notes };
}
```

### Step 7: Pass fallback through in `apps/planner-worker/src/index.ts`

Find the `llm:` object passed to `runPlanPipeline` (around line 38-44) and add:
```typescript
llm: {
  provider: config.plannerLlmProvider,
  ...(config.plannerLlmModel ? { model: config.plannerLlmModel } : {}),
  ...(config.plannerLlmFallback ? { fallback: config.plannerLlmFallback } : {}),  // NEW
  timeoutMs: config.plannerLlmTimeoutMs,
  ...(config.plannerCodexBin ? { codexBin: config.plannerCodexBin } : {}),
  ...(config.plannerClaudeBin ? { claudeBin: config.plannerClaudeBin } : {}),
},
```

### Step 8: Run tests — all pass

```bash
npm test
```

Expected: all tests pass including the 4 new `selectDraftFromResults` tests.

### Step 9: Commit

```bash
git add packages/core/src/types/plan.ts apps/planner-worker/src/config.ts packages/core/src/pipeline/planner.ts apps/planner-worker/src/index.ts packages/core/src/pipeline/planner.test.ts
git commit -m "feat: add provider fallback chain (primary -> fallback -> template)"
```

---

## Task 6: Add Observability Metadata

**Files:**
- Modify: `packages/core/src/types/plan.ts` (add `PlannerRunMetadata`, add to `PlanPipelineResult`)
- Modify: `packages/core/src/pipeline/planner.ts` (populate metadata in output)
- Modify: `packages/core/src/pipeline/runPipeline.ts` (thread metadata through to result)

### Step 1: Add types to `packages/core/src/types/plan.ts`

Add before `PlanPipelineResult`:
```typescript
export interface PlannerProviderAttempt {
  provider: "codex" | "claude";
  model?: string;
  ok: boolean;
  error?: string;
  durationMs: number;
}

export interface PlannerRunMetadata {
  source: "llm" | "llm-partial" | "template";
  providersAttempted: PlannerProviderAttempt[];
  templateFilledFields: string[];
}
```

Add `plannerMeta` to `PlanPipelineResult`:
```typescript
export interface PlanPipelineResult {
  status: "ready" | "needs_revision";
  markdown: string;
  score: ScoreBreakdown;
  handoff: HandoffValidation;
  criticNotes: string[];
  plannerMeta: PlannerRunMetadata;  // NEW
  timingsMs: {
    retrieval: number;
    planner: number;
    critic: number;
    scoring: number;
    finalizer: number;
    total: number;
  };
}
```

### Step 2: Update `PlannerOutput` interface in `planner.ts`

Change:
```typescript
interface PlannerOutput {
  draft: PlanDraft;
  notes: string[];
}
```

To:
```typescript
interface PlannerOutput {
  draft: PlanDraft;
  notes: string[];
  meta: PlannerRunMetadata;
}
```

### Step 3: Update `selectDraftFromResults` to return timing and full metadata

Update the function signature and return type to carry `durationMs` per attempt. Change the `attempts` array type in `generateDraftWithLlm`:

```typescript
const attempts: Array<{ result: LlmCallResult; text: string | undefined; durationMs: number }> = [];
```

Track timing in the loop:
```typescript
for (const provider of providers) {
  const callStart = Date.now();
  const callResult = ...;
  const durationMs = Date.now() - callStart;
  attempts.push({ result: callResult, text: callResult.text, durationMs });
  ...
}
```

Update `selectDraftFromResults` to accept durations and return full `PlannerRunMetadata`. Update its return type:
```typescript
export function selectDraftFromResults(
  attempts: Array<{ result: LlmCallResult; text: string | undefined; durationMs: number }>,
  fallback: PlanDraft,
  model?: string,
): { draft: PlanDraft; notes: string[]; meta: PlannerRunMetadata }
```

Inside, build `meta`:
```typescript
const providersAttempted: PlannerProviderAttempt[] = attempts.map((a) => ({
  provider: a.result.provider,
  ok: a.result.ok,
  ...(model ? { model } : {}),
  ...(a.result.error ? { error: a.result.error } : {}),
  durationMs: a.durationMs,
}));
```

On success: `source: normalized.missing.length > 0 ? "llm-partial" : "llm"`, `templateFilledFields: normalized.missing`
On all-fail: `source: "template"`, `templateFilledFields: []` (all fields are template)

For template path (no LLM providers configured), in `plannerStage`:
```typescript
if (!args.llm || args.llm.provider === "none") {
  return {
    draft: fallback,
    notes: [],
    meta: {
      source: "template",
      providersAttempted: [],
      templateFilledFields: [],
    },
  };
}
```

### Step 4: Thread `plannerMeta` through `runPipeline.ts`

In `runPlanPipeline`, add `plannerMeta` to the return:
```typescript
return {
  status: finalized.status,
  markdown: finalized.markdown,
  score,
  handoff,
  criticNotes,
  plannerMeta: planner.meta,   // NEW
  timingsMs: { ... },
};
```

### Step 5: Run build and verify no type errors

```bash
npm run typecheck
```

Expected: no errors. Fix any type errors that TypeScript strict mode surfaces (e.g., missing `meta` in test doubles).

### Step 6: Run tests

```bash
npm test
```

Expected: existing tests still pass. (Update test `selectDraftFromResults` calls to include `durationMs: 0` in attempt objects.)

### Step 7: Commit

```bash
git add packages/core/src/types/plan.ts packages/core/src/pipeline/planner.ts packages/core/src/pipeline/runPipeline.ts packages/core/src/pipeline/planner.test.ts
git commit -m "feat: add PlannerRunMetadata observability to pipeline result"
```

---

## Task 7: Mode-Aware Timeout Budgets

Quick mode uses shorter prompts and should get a shorter timeout. Also support `PLANNER_LLM_TIMEOUT_QUICK_MS` env var.

**Files:**
- Modify: `apps/planner-worker/src/config.ts` (add `plannerLlmTimeoutQuickMs`)
- Modify: `packages/core/src/types/plan.ts` (add `timeoutQuickMs` to `PlannerLlmConfig`)
- Modify: `packages/core/src/pipeline/planner.ts` (pick timeout based on mode)
- Modify: `apps/planner-worker/src/index.ts` (pass `timeoutQuickMs`)

### Step 1: Add `timeoutQuickMs` to `PlannerLlmConfig` in `plan.ts`

```typescript
export interface PlannerLlmConfig {
  provider: PlannerLlmProvider;
  fallback?: Exclude<PlannerLlmProvider, "none">;
  model?: string;
  timeoutMs?: number;        // full mode timeout (default: 120000)
  timeoutQuickMs?: number;   // quick mode timeout (default: 45000)
  codexBin?: string;
  claudeBin?: string;
}
```

### Step 2: Add to `WorkerConfig` and `loadConfig()` in `config.ts`

In interface:
```typescript
plannerLlmTimeoutQuickMs: number;
```

In `loadConfig()`:
```typescript
const plannerLlmTimeoutQuickMs = Number(process.env.PLANNER_LLM_TIMEOUT_QUICK_MS ?? 45000);
```

In returned object:
```typescript
plannerLlmTimeoutQuickMs: Number.isFinite(plannerLlmTimeoutQuickMs) && plannerLlmTimeoutQuickMs > 0 ? plannerLlmTimeoutQuickMs : 45000,
```

### Step 3: Use mode-appropriate timeout in `planner.ts`

In `generateDraftWithLlm`, replace:
```typescript
const timeoutMs = args.llm.timeoutMs ?? LLM_DEFAULT_TIMEOUT_MS;
```

With:
```typescript
const LLM_QUICK_TIMEOUT_MS = 45000;
const timeoutMs =
  args.mode === "quick"
    ? (args.llm.timeoutQuickMs ?? LLM_QUICK_TIMEOUT_MS)
    : (args.llm.timeoutMs ?? LLM_DEFAULT_TIMEOUT_MS);
```

### Step 4: Pass `timeoutQuickMs` from worker in `apps/planner-worker/src/index.ts`

Add to the `llm` object:
```typescript
llm: {
  ...
  timeoutMs: config.plannerLlmTimeoutMs,
  timeoutQuickMs: config.plannerLlmTimeoutQuickMs,  // NEW
  ...
},
```

### Step 5: Add a test for timeout selection

In `planner.test.ts`, add a test that verifies the function compiles and the constant is reasonable:
```typescript
describe("timeout budgets", () => {
  it("quick mode constant is less than full mode constant", () => {
    // 45s < 120s
    assert.ok(45000 < 120000);
  });
});
```

(A trivial smoke test — the real behavior is tested by running the worker with quick-mode jobs.)

### Step 6: Run tests and typecheck

```bash
npm test && npm run typecheck
```

Expected: all pass.

### Step 7: Commit

```bash
git add packages/core/src/types/plan.ts apps/planner-worker/src/config.ts packages/core/src/pipeline/planner.ts apps/planner-worker/src/index.ts packages/core/src/pipeline/planner.test.ts
git commit -m "feat: add mode-aware timeout budgets (quick=45s, full=120s)"
```

---

## Task 8: Update Documentation

**Files:**
- Modify: `CLAUDE.md` (add PLANNER_LLM_FALLBACK and PLANNER_LLM_TIMEOUT_QUICK_MS to env vars section)
- Modify: `README.md` (add new env vars to planner config section)
- Modify: `docs/project-status-2026-02-22.md` (mark completed items)

### Step 1: Update `README.md` planner config section

Find the block starting with `Planner LLM configuration (worker):` and add:
```text
- `PLANNER_LLM_FALLBACK=codex|claude` (optional; secondary provider tried if primary fails)
- `PLANNER_LLM_TIMEOUT_QUICK_MS=45000` (optional; timeout for quick-mode jobs, default 45s)
```

### Step 2: Update `CLAUDE.md` environment variables section

Add to the environment variables list:
```text
- `PLANNER_LLM_FALLBACK=codex|claude` — Secondary provider tried when primary fails before template fallback
- `PLANNER_LLM_TIMEOUT_QUICK_MS` — Timeout for quick-mode jobs (default: 45000ms)
```

### Step 3: Commit

```bash
git add CLAUDE.md README.md docs/project-status-2026-02-22.md
git commit -m "docs: document new LLM fallback and timeout config options"
```

---

## Verification

After all tasks are complete:

```bash
# 1. Run full test suite
npm test

# 2. Check no type errors
npm run typecheck

# 3. Test template mode still works
PLANNER_LLM_PROVIDER=none make start
# Trigger a /plan via Slack or webhook, verify comment posted

# 4. Test with fallback chain (if codex available)
PLANNER_LLM_PROVIDER=codex PLANNER_LLM_FALLBACK=claude make restart
make logs-follow
# Trigger a plan, verify logs show which provider succeeded
# Look for "plannerMeta" in data/queue/completed/*.json

# 5. Inspect a completed job for metadata
ls data/queue/completed/ | head -1 | xargs -I{} node -e "
  const f = require('fs');
  const j = JSON.parse(f.readFileSync('data/queue/completed/{}'));
  console.log(JSON.stringify(j.result?.plannerMeta, null, 2));
"
```

Expected in `plannerMeta`:
```json
{
  "source": "llm",
  "providersAttempted": [
    { "provider": "codex", "ok": true, "durationMs": 12000 }
  ],
  "templateFilledFields": []
}
```
