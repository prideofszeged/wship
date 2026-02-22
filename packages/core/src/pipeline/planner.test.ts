import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractJsonObject, resolvePlanObject, normalizeLlmDraft, buildLlmSystemPrompt, buildLlmUserPrompt } from "./planner.js";
import type { PlanDraft, PlanJobPayload, RetrievedContext } from "../types/plan.js";

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

const TEST_PAYLOAD: PlanJobPayload = {
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

const TEST_CTX: RetrievedContext = {
  structuralFileMentions: [],
  symbolMentions: [],
  relatedIssueMentions: [],
  candidateFiles: ["src/foo.ts"],
  historicalHints: [],
};

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

  it("instructs the LLM to return only JSON with no surrounding text", () => {
    const lower = prompt.toLowerCase();
    assert.ok(lower.includes("only") && lower.includes("json"), "System prompt should say return ONLY JSON");
  });
});

describe("buildLlmUserPrompt", () => {
  it("includes the repo name", () => {
    const p = buildLlmUserPrompt(TEST_PAYLOAD, TEST_CTX, "full");
    assert.ok(p.includes("org/repo"));
  });

  it("includes the issue title", () => {
    const p = buildLlmUserPrompt(TEST_PAYLOAD, TEST_CTX, "full");
    assert.ok(p.includes("Fix the thing"));
  });

  it("includes a JSON output reminder", () => {
    const p = buildLlmUserPrompt(TEST_PAYLOAD, TEST_CTX, "full");
    assert.ok(p.toLowerCase().includes("json"), "User prompt must include JSON reminder");
  });

  it("includes fewer candidate files in quick mode than full mode", () => {
    const manyFiles: RetrievedContext = {
      ...TEST_CTX,
      candidateFiles: Array.from({ length: 20 }, (_, i) => `src/file${i}.ts`),
    };
    const quick = buildLlmUserPrompt(TEST_PAYLOAD, manyFiles, "quick");
    const full = buildLlmUserPrompt(TEST_PAYLOAD, manyFiles, "full");
    assert.ok(quick.length < full.length, "Quick mode prompt should be shorter than full mode");
  });
});
