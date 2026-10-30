import { randomUUID } from "node:crypto";
import { completion, jsonCompletion, object } from "./longform-llm";
import { evidence, getRun, patchRun, pool, sections, sources, wordCount, type Run, type Section, type Source } from "./longform-store";
import { logger } from "./logger";

const workers = new Map<string, AbortController>();
export const isWorking = (id: string) => workers.has(id);
export async function stopWorker(id: string) {
  workers.get(id)?.abort();
  const deadline = Date.now() + 5000;
  while (workers.has(id) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
}

type Plan = Record<string, unknown> & { sections: Record<string, unknown>[] };
type Issue = { sectionIndex: number; reason: string; repair: string };
type Audit = { approved: boolean; issues: Issue[]; notes: string };
type Edits = { edits: { find: string; replace: string }[] };
const isEdits = (v: unknown): v is Edits => object(v) && Array.isArray(v.edits) && v.edits.length > 0 &&
  v.edits.every(e => object(e) && typeof e.find === "string" && e.find.length > 0 && typeof e.replace === "string");
const isAudit = (v: unknown): v is Audit => object(v) && typeof v.approved === "boolean" && typeof v.notes === "string" && Array.isArray(v.issues) &&
  v.issues.every(x => object(x) && Number.isInteger(x.sectionIndex) && typeof x.reason === "string" && typeof x.repair === "string");

const inputBrief = (run: Run) => JSON.stringify({
  mode: run.input.mode, instructions: run.input.instructions,
  revisionInstructions: run.input.revisionInstructions, targetWords: run.target_words,
  revision: Boolean(run.input.currentDraft),
});
const join = (parts: Section[]) => parts.map(p => p.text || "").filter(Boolean).join("\n\n");
const tail = (text: string, n = 350) => text.trim().split(/\s+/u).slice(-n).join(" ");
const head = (text: string, n = 160) => text.trim().split(/\s+/u).slice(0, n).join(" ");

function relevantSources(part: Section, src: Source[], totalSections: number) {
  const query = new Set(JSON.stringify(part.plan).toLowerCase().match(/[a-z]{4,}/g) || []);
  const scored = src.map(s => ({
    s,
    score: [...query].reduce((n, term) => n + (JSON.stringify(s.summary).toLowerCase().includes(term) ? 1 : 0), 0),
  })).sort((a, b) => b.score - a.score);
  const chosen = new Set<Source>(scored.slice(0, 3).map(s => s.s));
  for (const kind of ["originalText", "currentDraft", "contentSource", "styleSample"]) {
    const group = src.filter(s => s.kind === kind);
    if (group.length) chosen.add(group[Math.min(group.length - 1, Math.floor(part.section_index / totalSections * group.length))]!);
  }
  return [...chosen].map(s => ({ ref: `${s.kind}:${s.chunk_index}`, summary: s.summary, rawText: s.text }));
}

function duplicateIssues(parts: Section[]): Issue[] {
  const seen = new Map<string, number>();
  const issues: Issue[] = [];
  for (const p of parts) {
    for (const sentence of (p.text || "").split(/(?<=[.!?])\s+/u)) {
      const normalized = sentence.toLowerCase().replace(/[^a-z0-9\s]/g, "").replace(/\s+/g, " ").trim();
      if (wordCount(normalized) < 18) continue;
      const earlier = seen.get(normalized);
      if (earlier !== undefined && earlier !== p.section_index) {
        issues.push({ sectionIndex: p.section_index, reason: `Repeated long passage from section ${earlier}.`, repair: `Remove or meaningfully rework the repeated passage unless it is an explicitly necessary dramatic callback: ${sentence.slice(0, 600)}` });
        break;
      }
      seen.set(normalized, p.section_index);
    }
  }
  return issues;
}

export function launchRun(id: string) {
  if (workers.has(id)) return;
  const controller = new AbortController();
  workers.set(id, controller);
  void execute(id, controller).catch(() => {}).finally(() => workers.delete(id));
}

async function execute(id: string, controller: AbortController) {
  const worker = randomUUID();
  const signal = controller.signal;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let previewTimer = 0;
  const checkpoint = (patch: Record<string, unknown>) => patchRun(id, patch, worker);
  const progress = async (message: string) => { signal.throwIfAborted(); await checkpoint({ progress: message }); };
  const streamPreview = async (base: string, text: string) => {
    signal.throwIfAborted();
    if (Date.now() - previewTimer > 700) {
      previewTimer = Date.now();
      await checkpoint({ preview: `${base}${base ? "\n\n" : ""}${text}` });
    }
  };
  try {
    const lease = await pool.query(`UPDATE screenplay_runs SET status='running',worker_id=$2,lease_until=now()+interval '60 seconds',error=NULL,updated_at=now()
      WHERE id=$1 AND status!='completed' AND (status!='running' OR lease_until < now() OR lease_until IS NULL) RETURNING id`, [id, worker]);
    if (!lease.rowCount) return;
    heartbeat = setInterval(() => {
      void pool.query("UPDATE screenplay_runs SET lease_until=now()+interval '60 seconds' WHERE id=$1 AND worker_id=$2 AND status='running'", [id, worker])
        .then(result => { if (!result.rowCount) controller.abort(); }).catch(() => controller.abort());
    }, 15000);
    const run = (await getRun(id))!;
    await evidence(id, "Run started/resumed with database checkpoints.");

    // PASS 1a: every source paragraph is ingested once; no prefix-only absorption.
    let src = await sources(id);
    for (const [i, source] of src.entries()) {
      if (source.summary) continue;
      await progress(`Reading ${source.kind}: source part ${i + 1} of ${src.length}`);
      const summary = await jsonCompletion(
        `Absorb this entire source segment for a screenplay. Reference ${source.kind}:${source.chunk_index}; ${source.word_count} words.
Capture concrete facts, events in order, character/entity identities, exact names and relationships, chronology, promises/setups, terminology definitions, constraints and contradictions. For styleSample also capture dialogue patterns, tone, syntax, pacing, recurring techniques with brief quoted examples. For currentDraft capture scene order and what must survive revision. No rewriting. Return JSON {reference, facts:[], entities:[], chronology:[], commitments:[], openThreads:[], style:{}, conflicts:[]}. Preserve specifics; keep this compact (roughly 600 words maximum).
USER BRIEF: ${inputBrief(run)}
SOURCE MATERIAL:\n${source.text}`, signal, object);
      signal.throwIfAborted();
      await pool.query("UPDATE screenplay_sources SET summary=$4 WHERE run_id=$1 AND kind=$2 AND chunk_index=$3",
        [id, source.kind, source.chunk_index, JSON.stringify(summary)]);
    }
    src = await sources(id);
    await evidence(id, `Absorbed all ${src.length} source parts (${src.reduce((n, s) => n + s.word_count, 0).toLocaleString()} source words); full source text retained for relevant retrieval.`);

    // PASS 1b: one global skeleton, screenplay bible and budgeted narrative arc.
    if (!run.skeleton) {
      const count = Math.max(1, Math.ceil(run.target_words / 1400));
      await progress("Planning the complete narrative and continuity ledger");
      const plan = await jsonCompletion<Plan>(
        `Plan ONE complete coherent screenplay, not ${count} separate stories. ${inputBrief(run)}
All source-segment summaries follow; each source has been fully read. Respect ALL supplied instructions and the source's concrete particulars. If revising, preserve unaffected original events and dialogue, and apply requested changes throughout.
Build a hierarchical global skeleton in JSON: {title, premise, dramaticArc, audience, qualityStandard, characters:[{name,identity,relationships,voice}], terminology:[{term,meaning}], commitments:[], timeline:[], styleRules:[], sourceCoverage:[], sections:[{index,purpose,scenes:[],newDevelopments:[],enteringState,exitingState,setups:[],payoffs:[],mustNotRepeat:[],sourceRefs:[]}]}.
EXACTLY ${count} sequential sections, indexes 0 to ${count - 1}. A section is only a production boundary, not a fresh introduction or independent mini-play. Assign every actual scene and major event to EXACTLY ONE section. Never assign the same discovery, confrontation, test, testimony, recovery, injury change, resolution or conversation twice. Explicitly define the last permitted event of each section in exitingState. Allocate progression, revelations, callbacks and payoffs across the WHOLE work. Only the first section introduces the play; only the last concludes it. Each section will be ~${Math.round(run.target_words / count)} words. Define unique dramatic work for each; no repetitive plot reset or recap. Include detailed per-section plans under one concise global bible. At most 4000 words of JSON.
SOURCES:\n${JSON.stringify(src.map(s => ({ ref: `${s.kind}:${s.chunk_index}`, summary: s.summary })))}`,
        signal, (v): v is Plan => object(v) && Array.isArray(v.sections) && v.sections.length === count && v.sections.every(object));
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("UPDATE screenplay_runs SET skeleton=$2 WHERE id=$1 AND worker_id=$3 AND status='running'", [id, JSON.stringify(plan), worker]);
        for (const [i, p] of plan.sections.entries()) {
          const budget = Math.floor(run.target_words / count) + (i < run.target_words % count ? 1 : 0);
          await client.query("INSERT INTO screenplay_sections(run_id,section_index,plan,target_words) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING", [id, i, JSON.stringify(p), budget]);
        }
        await client.query("COMMIT");
      } catch (e) { await client.query("ROLLBACK"); throw e; }
      finally { client.release(); }
      run.skeleton = plan;
      await evidence(id, `Global skeleton saved: ${count} budgeted sections, shared character bible, chronology, commitment ledger, and setup/payoff arc.`);
    }

    const summarize = async (part: Section, text: string) => {
      const delta = await jsonCompletion(
        `Read this actual screenplay section and extract its continuity delta, NOT what its plan hoped it would do.
Return JSON {sectionIndex,events:[],newInformation:[],characterStates:[],timeline:[],termsUsed:[],setupsOpened:[],setupsResolved:[],sourceRefs:[],conflicts:[],repetitionRisks:[],endingState}. Be specific and concise (max 450 words). Identify contradictions with the global bible explicitly; do not silently fix them in the report.
BIBLE: ${JSON.stringify(run.skeleton)}
SECTION INDEX ${part.section_index}; PLAN: ${JSON.stringify(part.plan)}
ACTUAL TEXT:\n${text}`, signal, object);
      signal.throwIfAborted();
      await pool.query("UPDATE screenplay_sections SET text=$3,delta=$4 WHERE run_id=$1 AND section_index=$2", [id, part.section_index, text, JSON.stringify(delta)]);
      part.text = text; part.delta = delta;
    };
    const draftSection = async (part: Section, parts: Section[], instruction?: string) => {
      const earlier = parts.filter(p => p.section_index < part.section_index);
      const base = join(earlier);
      const previous = earlier.at(-1);
      const following = parts.find(p => p.section_index === part.section_index + 1);
      const shared = `BRIEF: ${inputBrief(run)}
The brief's word count is for the ENTIRE screenplay, NOT this response. This response is ONLY section ${part.section_index + 1}, with ${part.target_words} words.
GLOBAL BIBLE AND MASTER PLAN: ${JSON.stringify(run.skeleton)}
ALL COMMITTED SECTION DELTAS: ${JSON.stringify(parts.filter(p => p.delta).map(p => ({ index: p.section_index, delta: p.delta })))}
THIS SECTION ${part.section_index + 1}/${parts.length}, WORD BUDGET ${part.target_words}: ${JSON.stringify(part.plan)}
PREVIOUS SECTION END (continue naturally; do not repeat it): ${previous?.text ? tail(previous.text) : "(Beginning of play)"}
NEXT SECTION START (if repairing, preserve this transition): ${following?.text ? head(following.text) : "(Not yet written)"}
RELEVANT SOURCE MATERIAL:\n${JSON.stringify(relevantSources(part, src, parts.length))}`;
      const prompt = instruction
        ? `${shared}\nTARGETED REPAIR: ${instruction}\nCURRENT SECTION:\n${part.text}\nReturn the COMPLETE repaired section only. Preserve every unaffected dramatic development, narrative voice and boundary transition. No repair explanation.`
        : `${shared}\nWrite ONLY this section's assigned scenes, approximately ${part.target_words} words, NOT the brief's total ${run.target_words}. Every scene must add a new development. Honor ledger facts and existing character states. Never recap prior sections or repeat a reveal. Maintain source specifics and style. The source includes material for the entire story: do NOT adapt later events yet.
HARD STOP: end immediately after this section's assigned exitingState: ${JSON.stringify(part.plan.exitingState)}. Do not write any scene assigned to a different section. Do not go beyond the last assigned scene even if the source describes what happens next.
Use screenplay formatting. ${part.section_index === 0 ? "Begin the play with its title." : "NO new title, prologue, summary or re-introduction; continue the narrative."} ${part.section_index === parts.length - 1 ? "This is the finale: resolve the dramatic arc and earned setups." : "No FADE OUT, THE END, premature conclusion, or authorial prediction of future events."} Output the actual screenplay text only.`;
      let text = await completion(prompt, signal, current => streamPreview(base, current));
      // Bounded local length repair; never pad mechanically or silently truncate text.
      for (let attempt = 0; attempt < 2 && (wordCount(text) < part.target_words * .8 || wordCount(text) > part.target_words * 1.2); attempt++) {
        await progress(`Adjusting section ${part.section_index + 1} to its narrative word budget`);
        text = await completion(`${shared}\nThe actual section below is ${wordCount(text)} words; target ${part.target_words}. Rewrite ONLY this section to approximately ${part.target_words} words. ${wordCount(text) < part.target_words ? "Develop the planned scenes through substantive actions, choices and distinctive dialogue, not recap, filler or repeated events." : "Compress redundant exposition and action while preserving every unique dramatic beat."}\nCURRENT SECTION:\n${text}\nOutput only the complete replacement screenplay section.`, signal, current => streamPreview(base, current));
      }
      if (part.section_index < parts.length - 1) text = text.replace(/\n\s*(?:FADE OUT\.?|THE END\.?)\s*$/i, "").trim();
      await summarize(part, text);
      await checkpoint({ preview: join(parts), validation: null });
    };

    // Repairs are exact, localized edits. They cannot accidentally regenerate the whole
    // story, copy future scenes from the source, or alter unaffected sections.
    const editSection = async (part: Section, parts: Section[], instruction: string, lengthOnly = false) => {
      const before = part.text!;
      const { sections: _outline, ...bible } = run.skeleton!;
      let feedback = "";
      for (let attempt = 0; attempt < 3; attempt++) {
        const changes = await jsonCompletion<Edits>(
          `You are making LOCAL EDITS to exactly one section of an existing screenplay.
BRIEF: ${inputBrief(run)}
IMMUTABLE GLOBAL BIBLE: ${JSON.stringify(bible)}
THIS SECTION'S EXCLUSIVE SCENE ALLOCATION: ${JSON.stringify(part.plan)}
OTHER SECTIONS' EXCLUSIVE ALLOCATIONS (do NOT restage any of these): ${JSON.stringify(parts.filter(p => p !== part).map(p => ({ sectionIndex: p.section_index, scenes: p.plan.scenes, newDevelopments: p.plan.newDevelopments })))}
ACTUAL CONTINUITY REPORTS: ${JSON.stringify(parts.map(p => ({ sectionIndex: p.section_index, delta: p.delta })))}
REPAIR REQUEST: ${instruction}
CURRENT SECTION HAS ${wordCount(before)} WORDS. Usual section budget ${part.target_words}.
Return JSON {edits:[{find:"EXACT substring copied verbatim from CURRENT SECTION",replace:"replacement screenplay text, or empty string to remove duplicated material"}]}.
Use the fewest non-overlapping edits needed. Each find must occur exactly once. Preserve all unaffected text byte-for-byte. Do not repeat a scene assigned elsewhere, add plot summaries or recaps, or write the next section's events. If adding words, expand only THIS section's assigned events through new concrete actions, consequential choices and fresh dialogue. Never add FADE OUT/THE END unless this is the last section. ${feedback}
CURRENT SECTION:\n${before}`, signal, isEdits);
        let candidate = before;
        let valid = true;
        for (const edit of changes.edits) {
          const index = candidate.indexOf(edit.find);
          if (index < 0 || candidate.indexOf(edit.find, index + 1) >= 0) { valid = false; break; }
          candidate = candidate.slice(0, index) + edit.replace + candidate.slice(index + edit.find.length);
        }
        if (!valid || !candidate.trim()) { feedback = "Previous edits did not match exact unique substrings or removed the entire section. Correct the find strings; preserve this section's unique events."; continue; }
        if (part.section_index < parts.length - 1) candidate = candidate.replace(/\n\s*(?:FADE OUT\.?|THE END\.?)\s*$/i, "").trim();
        const originalTotal = wordCount(join(parts));
        const candidateTotal = originalTotal - wordCount(before) + wordCount(candidate);
        const low = run.target_words * .95;
        const high = Math.min(30000, run.target_words * 1.05);
        const distance = (n: number) => n < low ? low - n : n > high ? n - high : 0;
        if (lengthOnly && distance(candidateTotal) >= distance(originalTotal)) {
          feedback = `Your previous edit produced ${wordCount(candidate)} section words and ${candidateTotal} total words, which did not improve the required range ${Math.ceil(low)}–${Math.floor(high)}. Correct the amount of actual text added/removed. Do NOT trust your own estimated word count.`;
          continue;
        }
        await summarize(part, candidate);
        await checkpoint({ preview: join(parts), validation: null });
        await evidence(id, `Localized repair to section ${part.section_index + 1}: ${wordCount(before)} → ${wordCount(candidate)} actual words; unaffected sections preserved.`);
        return;
      }
      throw new Error("A targeted repair could not safely improve the saved section. Checkpoints are preserved; resume to retry.");
    };

    // PASS 2: sequential drafting receives the global plan and accumulating actual ledger.
    let parts = await sections(id);
    for (const part of parts) {
      if (part.text && part.delta) continue;
      await progress(`Writing section ${part.section_index + 1} of ${parts.length}`);
      await draftSection(part, parts);
      await evidence(id, `Section ${part.section_index + 1} checkpointed: ${wordCount(part.text!)} actual words; continuity delta stored.`);
    }

    const balanceLength = async () => {
      for (let attempt = 0; attempt < 8; attempt++) {
        const total = wordCount(join(parts));
        const low = Math.ceil(run.target_words * .95);
        const high = Math.min(30000, Math.floor(run.target_words * 1.05));
        if (total >= low && total <= high) return;
        const difference = run.target_words - total;
        const sorted = [...parts].sort((a, b) => difference > 0
          ? (a.target_words - wordCount(a.text!)) - (b.target_words - wordCount(b.text!))
          : (wordCount(a.text!) - a.target_words) - (wordCount(b.text!) - b.target_words));
        const part = sorted.at(-1)!;
        const desired = Math.max(100, Math.min(2400, wordCount(part.text!) + difference));
        await progress(`Balancing total length: ${total.toLocaleString()} / ${run.target_words.toLocaleString()} words`);
        await editSection(part, parts, `The entire screenplay is ${total} words, target ${run.target_words}. Make this section approximately ${desired} actual words (currently ${wordCount(part.text!)}). ${difference > 0 ? `Add about ${desired - wordCount(part.text!)} words by developing ONLY the section's assigned scenes; never add another section's events.` : `Remove about ${wordCount(part.text!) - desired} words of unnecessary exposition/redundant exchanges, without deleting unique events or altering commitments.`}`, true);
      }
      const count = wordCount(join(parts));
      if (count < run.target_words * .95 || count > Math.min(30000, run.target_words * 1.05)) throw new Error(`Length check did not pass (${count.toLocaleString()} / ${run.target_words.toLocaleString()} words). Checkpoints are saved; resume to continue length repair.`);
    };
    // PASS 3: hierarchical audits over compact deltas + actual boundary text, then micro-repairs.
    let approved = false;
    for (let round = 0; round < 3; round++) {
      await progress(`Checking global coherence${round ? ` after repair pass ${round}` : ""}`);
      const localReports: Audit[] = [];
      for (let i = 0; i < parts.length; i += 6) {
        const group = parts.slice(i, i + 6);
        const report = await jsonCompletion<Audit>(
          `Audit this group within ONE screenplay. Check actual delta reports against immutable commitments, chronology, character states and one another. Detect concrete contradictions and actually repeated scenes/events, not merely repeated terms, motifs or references. Creative elaboration and harmless scene reordering are allowed; a new supporting detail need not have appeared in the plan. Do not flag things solely because they are not explicitly depicted, nor treat thematic callbacks or testimony about an earlier event as restaging it. If a section prematurely writes future sections' scenes, REMOVE those future scenes from the earliest offending section; keep each event only at its assigned position. Flag only substantive issues and specify the exact zero-based sectionIndex to repair. Prefer concrete cut/replace instructions over full-section rewrites. Return JSON {approved:boolean,issues:[{sectionIndex,reason,repair}],notes:string}. Never approve while substantive issues remain.
BRIEF: ${inputBrief(run)}
BIBLE: ${JSON.stringify(run.skeleton)}
ALL DELTAS: ${JSON.stringify(parts.map(p => ({ index: p.section_index, delta: p.delta })))}
GROUP ACTUAL TEXT AND BOUNDARIES: ${JSON.stringify(group.map(p => ({ index: p.section_index, text: p.text })))}`, signal, isAudit);
        localReports.push(report);
      }
      const finalAudit = await jsonCompletion<Audit>(
        `Global consistency stitch audit for one screenplay. Reconcile all reports and actual continuity deltas against immutable commitments. Check concrete long-range character/chronology/terminology contradictions, actually repeated scenes and plot developments, dangling essential setups at the END and the narrative arc. New creative details, harmless scene reordering and intentional callbacks are allowed; absence of a planned detail is not by itself a contradiction. A testimony mentioning established evidence is not the same as restaging its discovery. A section is not a separate document. Produce a minimal targeted repair plan ONLY for affected sections; no global rewrite. When events are staged too early, cut them from the premature section and retain their assigned later occurrence. Include unresolved substantive local issues. Return JSON {approved:boolean,issues:[{sectionIndex,reason,repair}],notes:string}. Only approve if all substantive issues are resolved.
BRIEF: ${inputBrief(run)}
BIBLE: ${JSON.stringify(run.skeleton)}
DELTAS: ${JSON.stringify(parts.map(p => ({ index: p.section_index, delta: p.delta })))}
GROUP REPORTS: ${JSON.stringify(localReports)}
BEGINNING: ${head(parts[0]!.text!, 300)}
ENDING: ${tail(parts.at(-1)!.text!, 600)}`, signal, isAudit);
      const combined = [...localReports.flatMap(r => r.issues), ...finalAudit.issues, ...duplicateIssues(parts)];
      if (combined.some(i => i.sectionIndex < 0 || i.sectionIndex >= parts.length)) throw new Error("The consistency audit returned an invalid section reference. Resume to repeat the audit.");
      approved = finalAudit.approved && localReports.every(r => r.approved) && combined.length === 0;
      await checkpoint({ validation: { approved, round, global: finalAudit, groups: localReports, duplicateChecks: duplicateIssues(parts), actualWords: wordCount(join(parts)), requestedWords: run.target_words } });
      await evidence(id, `Coherence audit ${round + 1}: ${approved ? "passed" : `${combined.length} issue(s) flagged for specific-section repair`}.`);
      if (approved) {
        const beforeBalance = join(parts);
        await balanceLength();
        if (join(parts) === beforeBalance) break;
        approved = false; // Length edits must themselves pass a new coherence audit.
        continue;
      }
      if (!combined.length) throw new Error("The audit did not approve the draft and supplied no actionable repair. Resume to repeat the audit.");
      if (round === 2) break;
      for (const part of parts) {
        const issues = combined.filter(i => i.sectionIndex === part.section_index);
        if (!issues.length) continue;
        await progress(`Repairing section ${part.section_index + 1}: ${issues[0]!.reason}`);
        await editSection(part, parts, issues.map(i => `${i.reason}: ${i.repair}`).join("\n"));
        await pool.query("UPDATE screenplay_sections SET repairs=repairs+1 WHERE run_id=$1 AND section_index=$2", [id, part.section_index]);
      }
      await balanceLength();
      parts = await sections(id);
    }
    if (!approved) throw new Error("The screenplay has not passed all coherence checks yet. Draft and audit findings are saved; resume to continue targeted repairs.");
    const final = join(parts);
    const actual = wordCount(final);
    if (actual < run.target_words * .95 || actual > Math.min(30000, run.target_words * 1.05)) throw new Error("The repaired screenplay is outside the requested length tolerance. Resume to rebalance it.");
    await evidence(id, `Completed all three passes: ${actual.toLocaleString()} words, ${parts.length} connected sections; coherence audit passed.`);
    await checkpoint({ status: "completed", progress: "Complete — length and coherence checks passed", final_output: final, preview: final, lease_until: null });
  } catch (error) {
    const run = await getRun(id).catch(() => undefined);
    if (run?.status === "cancelled" || run?.worker_id !== worker) return;
    const message = signal.aborted ? "Writing was interrupted. Saved checkpoints can be resumed."
      : error instanceof Error && !/postgres|password|connection string|ssl|certificate|SELECT |UPDATE |INSERT /i.test(error.message) ? error.message
        : "A checkpoint or provider request failed. Saved work is intact; resume to retry.";
    logger.warn({ runId: id, interrupted: signal.aborted }, "Long-form run paused");
    await patchRun(id, { status: "failed", error: message, progress: "Paused — saved work can be resumed", lease_until: null }, worker).catch(() => {});
  } finally {
    if (heartbeat) clearInterval(heartbeat);
  }
}
