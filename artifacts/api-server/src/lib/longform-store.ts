import { createHash, randomBytes, randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import type { ScreenplayInput } from "@workspace/api-zod";
import { splitDocument, wordCount } from "./longform-text";
export { splitDocument, wordCount } from "./longform-text";

export { pool };
export type Source = { kind: string; chunk_index: number; text: string; word_count: number; summary: unknown };
export type Section = { section_index: number; plan: Record<string, unknown>; target_words: number; text: string | null; delta: unknown; repairs: number };
export type Run = {
  id: string; token_hash: string; input: ScreenplayInput; target_words: number; status: string; progress: string;
  skeleton: Record<string, unknown> | null; validation: unknown; preview: string; final_output: string | null;
  error: string | null; evidence: string[]; lease_until: Date | null; worker_id: string | null;
  saved_output: string | null;
};
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

// Paragraph boundaries are preferred; an oversized paragraph is split at sentence boundaries.
// An exceptionally long unpunctuated sentence stays intact rather than silently losing words.
export async function createRun(input: ScreenplayInput, targetWords: number) {
  const id = randomUUID();
  const token = randomBytes(32).toString("hex");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO screenplay_runs(id,token_hash,input,target_words) VALUES($1,$2,$3,$4)",
      [id, hashToken(token), JSON.stringify(input), targetWords]);
    for (const kind of ["originalText", "contentSource", "styleSample", "currentDraft"] as const) {
      const text = input[kind];
      if (!text?.trim()) continue;
      const parts = splitDocument(text);
      for (const [i, part] of parts.entries()) {
        await client.query("INSERT INTO screenplay_sources(run_id,kind,chunk_index,text,word_count) VALUES($1,$2,$3,$4,$5)",
          [id, kind, i, part, wordCount(part)]);
      }
    }
    await client.query("COMMIT");
  } catch (e) { await client.query("ROLLBACK"); throw e; }
  finally { client.release(); }
  return { id, token };
}

export async function getRun(id: string): Promise<Run | undefined> {
  return (await pool.query("SELECT * FROM screenplay_runs WHERE id=$1", [id])).rows[0];
}
export async function sources(id: string): Promise<Source[]> {
  return (await pool.query("SELECT kind,chunk_index,text,word_count,summary FROM screenplay_sources WHERE run_id=$1 ORDER BY kind,chunk_index", [id])).rows;
}
export async function sections(id: string): Promise<Section[]> {
  return (await pool.query("SELECT section_index,plan,target_words,text,delta,repairs FROM screenplay_sections WHERE run_id=$1 ORDER BY section_index", [id])).rows;
}
export async function patchRun(id: string, patch: Record<string, unknown>, worker?: string) {
  const allowed = new Set(["status", "progress", "skeleton", "validation", "preview", "final_output", "error", "lease_until", "worker_id", "saved_output"]);
  const entries = Object.entries(patch);
  if (entries.some(([key]) => !allowed.has(key))) throw new Error("Invalid checkpoint");
  const vals = entries.map(([key, value]) => ["skeleton", "validation"].includes(key) && value !== null ? JSON.stringify(value) : value);
  const result = await pool.query(`UPDATE screenplay_runs SET ${entries.map(([key], i) => `${key}=$${i + 2}`).join(",")},updated_at=now() WHERE id=$1${worker ? ` AND worker_id=$${entries.length + 2} AND status='running'` : ""}`,
    [id, ...vals, ...(worker ? [worker] : [])]);
  if (worker && !result.rowCount) throw new Error("Run ownership lost");
}
export async function evidence(id: string, message: string) {
  await pool.query("UPDATE screenplay_runs SET evidence=evidence || jsonb_build_array($2::text),updated_at=now() WHERE id=$1", [id, message]);
}
export async function publicRun(run: Run) {
  const [parts, src] = await Promise.all([
    pool.query("SELECT count(*)::int AS total,count(*) FILTER(WHERE text IS NOT NULL AND delta IS NOT NULL)::int AS completed FROM screenplay_sections WHERE run_id=$1", [run.id]),
    pool.query("SELECT count(*) FILTER(WHERE summary IS NOT NULL)::int AS completed FROM screenplay_sources WHERE run_id=$1", [run.id]),
  ]);
  const expired = run.status === "running" && (!run.lease_until || new Date(run.lease_until).getTime() < Date.now());
  const text = run.final_output ?? run.preview;
  return {
    id: run.id, status: expired ? "interrupted" : run.status, progress: run.progress, text, wordCount: wordCount(text),
    targetWords: run.target_words, sectionsCompleted: parts.rows[0].completed, totalSections: parts.rows[0].total,
    sourceChunks: src.rows[0].completed,
    canResume: expired || ["failed", "cancelled", "suspended", "queued"].includes(run.status),
    ...(run.saved_output !== null ? { savedText: run.saved_output } : {}),
    ...(run.error ? { error: run.error } : {}),
    evidence: run.evidence,
    ...(run.validation ? { validation: JSON.stringify(run.validation, null, 2) } : {}),
  };
}
