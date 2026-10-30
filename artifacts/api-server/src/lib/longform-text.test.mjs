import { test } from "node:test";
import assert from "node:assert/strict";
import { splitDocument, wordCount, parseRequestedWords } from "./longform-text.ts";

test("all 30,000 source words survive paragraph-aware segmentation", () => {
  const text = Array.from({ length: 300 }, (_, i) => Array.from({ length: 100 }, (_, j) => `fact${i}_${j}${j === 99 ? "." : ""}`).join(" ")).join("\n\n");
  const chunks = splitDocument(text);
  assert.equal(wordCount(text), 30000);
  assert.equal(chunks.reduce((n, c) => n + wordCount(c), 0), 30000);
  assert.deepEqual(chunks.join(" ").split(/\s+/u), text.split(/\s+/u));
  assert.ok(chunks.every(c => wordCount(c) <= 2200));
  assert.ok(chunks.at(-1).endsWith("fact299_99."));
});
test("oversized paragraphs split on sentences without losing ending facts", () => {
  const text = Array.from({ length: 3000 }, (_, i) => `Event ${i} happens.`).join(" ");
  const chunks = splitDocument(text, 800);
  assert.deepEqual(chunks.join(" ").split(/\s+/u), text.split(/\s+/u));
  assert.ok(chunks.every(c => c.endsWith(".")));
});
test("long unpunctuated text is preserved rather than silently truncated", () => {
  const text = Array.from({ length: 30000 }, (_, i) => `word${i}`).join(" ");
  assert.equal(splitDocument(text).join(" "), text);
});
test("manual length instructions include commas, k notation, and hyphenated forms", () => {
  for (const text of ["30,000 words", "30k words", "30K-word screenplay", "30000-word play"]) assert.equal(parseRequestedWords(text), 30000);
  assert.equal(parseRequestedWords("make it 3.5k words"), 3500);
  assert.equal(parseRequestedWords("a touching screenplay"), undefined);
});
