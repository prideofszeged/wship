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
