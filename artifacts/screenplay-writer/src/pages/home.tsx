import { useEffect, useRef, useState } from "react";
import { useGetScreenplayStatus, type ScreenplayInput, type WritingRun } from "@workspace/api-client-react";
import { Copy, Download, PenLine, RotateCcw, Sparkles, Check, AlertTriangle, Trash2 } from "lucide-react";
import { Field } from "@/components/field";
import { StreamWindow, type RunStatus } from "@/components/stream-window";
import { streamScreenplay, countWords, cancelRun, suspendRun, eraseRun, type RunHandle } from "@/lib/stream";
import { loadDrafts, saveDrafts, deleteDrafts } from "@/lib/draft-storage";

type Mode = "scratch" | "adapt";
type ModeState = {
  instructions: string; originalText: string; styleSample: string; contentSource: string;
  draft: string; revision: string; partial: string; partialError: string; lastNote: string;
  job?: RunHandle; progress?: string; evidence?: string[]; validation?: string;
  runs?: RunHandle[]; savedText?: string; stopped?: boolean;
};
const empty: ModeState = { instructions: "", originalText: "", styleSample: "", contentSource: "", draft: "", revision: "", partial: "", partialError: "", lastNote: "" };
const KEY = "screenplay-writer:v1";

function load(): { mode: Mode; scratch: ModeState; adapt: ModeState } {
  const recovery = (m: Mode) => {
    try { return JSON.parse(localStorage.getItem(`${KEY}:job:${m}`) || "null") as RunHandle | undefined; } catch { return undefined; }
  };
  try {
    const j = JSON.parse(localStorage.getItem(KEY) ?? "");
    return { mode: j.mode === "adapt" ? "adapt" : "scratch", scratch: { ...empty, ...j.scratch, job: recovery("scratch") || j.scratch?.job }, adapt: { ...empty, ...j.adapt, job: recovery("adapt") || j.adapt?.job } };
  } catch {
    return { mode: "scratch", scratch: { ...empty, job: recovery("scratch") }, adapt: { ...empty, job: recovery("adapt") } };
  }
}

export default function Home() {
  const [initial] = useState(load);
  const [mode, setMode] = useState<Mode>(initial.mode);
  const [states, setStates] = useState({ scratch: initial.scratch, adapt: initial.adapt });
  const s = states[mode];
  const set = (patch: Partial<ModeState>, m: Mode = mode) => setStates((p) => ({ ...p, [m]: { ...p[m], ...patch } }));

  const status = useGetScreenplayStatus();
  const maxWords = status.data?.maxWords ?? 30000;
  const defWords = status.data?.defaultWords ?? 1000;

  const [run, setRun] = useState<{ mode: Mode; kind: "write" | "revise"; text: string; status: RunStatus; error: string | null; handle?: RunHandle } | null>(null);
  const [winOpen, setWinOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const [copied, setCopied] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [storageError, setStorageError] = useState("");
  const restored = useRef(false);
  const clearing = useRef(false);
  const session = useRef(0);
  const [busy, setBusy] = useState(false);
  const statesRef = useRef(states);
  const modeRef = useRef(mode);
  statesRef.current = states;
  modeRef.current = mode;
  const savedDraft = s.savedText ?? s.draft;

  useEffect(() => {
    void loadDrafts().then((value) => {
      const saved = value as typeof initial | undefined;
      if (saved?.scratch && saved?.adapt) {
        setStates({ scratch: { ...empty, ...saved.scratch, job: initial.scratch.job || saved.scratch.job }, adapt: { ...empty, ...saved.adapt, job: initial.adapt.job || saved.adapt.job } });
        setMode(saved.mode === "adapt" ? "adapt" : "scratch");
      }
    }).catch(() => setStorageError("Browser draft storage is unavailable. Writing-job checkpoints are still saved in Neon."))
      .finally(() => setStorageReady(true));
  }, []);
  useEffect(() => {
    if (!storageReady || clearing.current) return;
    const t = setTimeout(() => {
      if (clearing.current) return;
      void saveDrafts({ mode: modeRef.current, ...statesRef.current }).catch(() => setStorageError("Could not save drafts in this browser. Download important edits; writing checkpoints remain in Neon."));
    }, 300);
    return () => clearTimeout(t);
  }, [mode, states, storageReady]);
  useEffect(() => {
    if (!storageReady || restored.current) return;
    restored.current = true;
    const m = states[mode].job ? mode : states.scratch.job ? "scratch" : states.adapt.job ? "adapt" : null;
    if (m) { setMode(m); void start("write", states[m].job, false, m); }
  }, [storageReady]);

  const running = run?.status === "running";
  const runningHere = running && run?.mode === mode;

  const start = async (kind: "write" | "revise", existing?: RunHandle, resume = false, m: Mode = mode) => {
    const currentSession = ++session.current;
    const cur = statesRef.current[m];
    const input: ScreenplayInput = { mode: m, instructions: cur.instructions };
    if (m === "adapt") input.originalText = cur.originalText;
    if (cur.styleSample.trim()) input.styleSample = cur.styleSample;
    if (cur.contentSource.trim()) input.contentSource = cur.contentSource;
    if (kind === "revise") { input.currentDraft = cur.savedText ?? cur.draft; input.revisionInstructions = cur.revision; }

    const ac = new AbortController();
    abortRef.current = ac;
    let text = "";
    let failure: string | null = null;
    let finished = false;
    let suspended: WritingRun | undefined;
    let note = "";
    setRun({ mode: m, kind, text: existing ? cur.partial || cur.savedText || "" : "", status: "running", error: null, handle: existing });
    set({ stopped: false }, m);
    setWinOpen(true);
    try {
      if (!existing && cur.job) await cancelRun(cur.job);
      await streamScreenplay(input, ac.signal, (e) => {
        if (session.current !== currentSession) return;
        if (e.type === "snapshot") { text = e.text; setRun((r) => r && { ...r, text }); }
        else if (e.type === "handle") {
          setStates(p => ({ ...p, [m]: { ...p[m], job: e.handle, runs: [...(p[m].runs || []).filter(h => h.id !== e.handle.id), e.handle] } }));
          setRun(r => r && { ...r, handle: e.handle });
          // Persist the small recovery handle immediately, independently of large source text.
          try { localStorage.setItem(`${KEY}:job:${m}`, JSON.stringify(e.handle)); } catch { /* IndexedDB also stores it */ }
        }
        else if (e.type === "progress") set({ progress: e.state.progress, evidence: e.state.evidence, validation: e.state.validation }, m);
        else if (e.type === "suspended") suspended = e.state;
        else if (e.type === "done") { finished = true; note = `${e.wordCount.toLocaleString()} words${e.truncated ? " - stopped at the length limit" : ""}`; }
        else if (e.type === "error") failure = e.error;
      }, existing, resume);
      if (!finished && !suspended && !failure) failure = "The connection ended before the draft was finished.";
    } catch (e) {
      failure = ac.signal.aborted ? "Stopped." : (e as Error).message || "Network error";
    }
    if (session.current !== currentSession) return;
    abortRef.current = null;
    if (suspended) {
      const saved = suspended.savedText ?? suspended.text;
      setRun(r => r && { ...r, text: saved, status: "suspended", error: null });
      set({ savedText: cur.savedText ?? saved, partial: "", partialError: "", lastNote: "Suspended draft saved — not a final approved screenplay" }, m);
    } else if (failure) {
      setRun((r) => r && { ...r, status: ac.signal.aborted ? "stopped" : "error", error: failure });
      set({ ...(text.trim() ? { partial: text } : {}), partialError: failure }, m);
    } else {
      setRun((r) => r && { ...r, status: "done" });
      set({ draft: text, savedText: undefined, partial: "", partialError: "", lastNote: note, job: undefined, ...(kind === "revise" ? { revision: "" } : {}) }, m);
      localStorage.removeItem(`${KEY}:job:${m}`);
    }
  };

  const showingStream = runningHere;
  const outputText = showingStream ? run!.text : savedDraft;

  const copy = async () => {
    await navigator.clipboard.writeText(savedDraft);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };
  const download = () => {
    const blob = new Blob([savedDraft], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `screenplay-${mode}-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const control = async (action: "suspend" | "stop" | "restart") => {
    if (!run?.handle || busy) return;
    setBusy(true);
    setStorageError("");
    try {
      const result = action === "suspend" ? await suspendRun(run.handle) : await cancelRun(run.handle);
      session.current++;
      abortRef.current?.abort();
      abortRef.current = null;
      const m = run.mode;
      const saved = result.status === "completed" ? result.text : result.savedText ?? result.text;
      const patch: Partial<ModeState> = action === "suspend"
        ? { savedText: saved, partial: "", partialError: "", stopped: false, progress: result.progress, lastNote: "Suspended draft saved — not a final approved screenplay" }
        : { job: undefined, partial: result.text, partialError: "", stopped: true, progress: result.progress };
      const next = { ...statesRef.current, [m]: { ...statesRef.current[m], ...patch } };
      statesRef.current = next;
      setStates(next);
      setRun(r => r && { ...r, text: result.text, status: action === "suspend" ? "suspended" : "stopped", error: null });
      if (action !== "suspend") localStorage.removeItem(`${KEY}:job:${m}`);
      await saveDrafts({ mode: modeRef.current, ...next });
      if (action === "restart") void start(run.kind, undefined, false, m);
    } catch (error) {
      setStorageError((error as Error).message || "The action could not finish. Saved writing has not been discarded.");
    } finally { setBusy(false); }
  };
  const eraseEverything = async (scope: "page" | Mode) => {
    if (busy) return;
    const targets: Mode[] = scope === "page" ? ["scratch", "adapt"] : [scope];
    setBusy(true);
    clearing.current = true;
    setStorageError("");
    try {
      const handles = targets.flatMap(m => [...(statesRef.current[m].runs || []), ...(statesRef.current[m].job ? [statesRef.current[m].job!] : [])]);
      await Promise.all([...new Map(handles.map(h => [h.id, h])).values()].map(eraseRun));
      if (run && targets.includes(run.mode)) {
        session.current++;
        abortRef.current?.abort();
        abortRef.current = null;
        setRun(null);
        setWinOpen(false);
      }
      for (const m of targets) localStorage.removeItem(`${KEY}:job:${m}`);
      localStorage.removeItem(KEY);
      if (scope === "page") {
        await deleteDrafts();
        window.location.reload();
        return;
      }
      const next = { ...statesRef.current, [scope]: { ...empty } };
      statesRef.current = next;
      setStates(next);
      await saveDrafts({ mode: modeRef.current, ...next });
    } catch (error) {
      setStorageError((error as Error).message || "Erasure could not finish. Retry; browser inputs have been retained.");
    } finally { clearing.current = false; setBusy(false); }
  };

  const canWrite = storageReady && !busy && !running && s.instructions.trim() && (mode === "scratch" || s.originalText.trim());
  const canRevise = storageReady && !busy && !running && savedDraft.trim() && s.revision.trim();
  const starting = !!running && !run?.handle;

  const st = status.data;
  const statusChip = status.isLoading
    ? { t: "Checking connection", c: "bg-muted text-muted-foreground" }
    : status.isError
      ? { t: "Server unreachable", c: "bg-destructive/10 text-destructive" }
      : st?.configured
        ? { t: `Configured: ${st.provider} / ${st.model}`, c: "bg-accent text-accent-foreground" }
        : { t: `Not configured${st?.provider ? ` (${st.provider})` : ""}`, c: "bg-destructive/10 text-destructive" };

  return (
    <div className="min-h-[100dvh]">
      <header className="border-b border-border/70 bg-background/85 backdrop-blur sticky top-0 z-30">
        <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-3 px-5 py-3">
          <div className="flex items-baseline gap-2">
            <span className="script text-lg font-bold tracking-tight">FADE IN:</span>
            <h1 className="text-lg font-semibold tracking-tight">Screenplay Writer</h1>
          </div>
          <span title="Configured means a provider key is set; it has not been test-called." data-testid="status-provider"
            className={`script rounded px-2 py-0.5 text-[11px] ${statusChip.c}`}>{statusChip.t}</span>
          {status.isError && <button onClick={() => status.refetch()} className="text-xs underline text-primary" data-testid="button-retry-status">Retry</button>}
          <button onClick={() => eraseEverything("page")} disabled={!storageReady || busy || starting} data-testid="button-clear"
            className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:border-destructive hover:text-destructive transition-colors">
            <RotateCcw className="h-3.5 w-3.5" /> Erase everything on this page
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 pb-24 pt-8">
        {storageError && <p className="mb-3 text-sm text-destructive">{storageError}</p>}
        {st && <p className={`mb-3 text-xs ${st.database ? "text-muted-foreground" : "text-destructive"}`} data-testid="database-status">
          {st.database ? "Neon checkpoint database connected. Sources up to 30,000 words; writing up to 30,000 words." : st.databaseError}
        </p>}
        <p className="mb-3 text-xs text-muted-foreground">Long-form writing is experimental. Drafts that do not pass length and coherence checks remain saved and resumable, not marked complete.</p>
        <div className="mb-8 grid grid-cols-2 gap-0 rounded-lg border border-primary/25 bg-card p-1" role="tablist">
          {([["scratch", "Write from scratch", "Start with an idea"], ["adapt", "Adapt existing text", "Turn a story, article or script into a screenplay"]] as const).map(([m, t, sub]) => (
            <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)} data-testid={`tab-${m}`}
              className={`rounded-md px-4 py-3 text-left transition-all ${mode === m ? "bg-primary text-primary-foreground shadow" : "hover:bg-secondary"}`}>
              <div className="font-semibold">{t}</div>
              <div className={`text-xs ${mode === m ? "opacity-80" : "text-muted-foreground"}`}>{sub}</div>
            </button>
          ))}
        </div>

        <div key={mode} className="space-y-7">
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={() => eraseEverything(mode)} disabled={!storageReady || busy || starting} data-testid={`button-erase-${mode}`}
              className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs text-muted-foreground hover:text-destructive disabled:opacity-40">
              <Trash2 className="h-3.5 w-3.5" /> Erase everything in this tab
            </button>
            <span className="text-xs text-muted-foreground">Erases inputs, outputs and saved checkpoints in this scope. Stops its generation immediately. No confirmation.</span>
          </div>
          {mode === "adapt" && (
            <Field id="original" label="Original document" upload rows={10} value={s.originalText} onChange={(v) => set({ originalText: v })}
              hint="Paste, type or upload (TXT, MD, PDF, DOCX up to 8 MB). Extracted text stays editable." disabled={runningHere} />
          )}
          <Field id="instructions" label={mode === "scratch" ? "Instructions" : "Adaptation instructions"} rows={5}
            value={s.instructions} onChange={(v) => set({ instructions: v })} disabled={runningHere}
            placeholder={mode === "scratch"
              ? "e.g. Two estranged sisters meet at their father's storage unit the night before it's auctioned. About 1,200 words, dry humor."
              : "e.g. Keep only the train scene, move it to present-day Lisbon, about 900 words."}
            hint={<>Say how long you want it in your own words. Default is about {defWords.toLocaleString()} words; maximum {maxWords.toLocaleString()} words. Long drafts are planned, written with a shared continuity ledger, and checked before completion.</>} />
          <Field id="style" label="Style sample" optional upload rows={4} value={s.styleSample} onChange={(v) => set({ styleSample: v })}
            hint="Writing whose voice you want echoed." disabled={runningHere} />
          <Field id="source" label="Content source" optional upload rows={4} value={s.contentSource} onChange={(v) => set({ contentSource: v })}
            hint="Notes, research or facts to draw from." disabled={runningHere} />

          <div className="flex flex-wrap items-center gap-3">
            {s.job && !running && <button disabled={busy} onClick={() => start("write", s.job, true)} data-testid="button-resume"
              className="rounded-md border border-primary px-4 py-2 text-sm text-primary">Resume saved writing</button>}
            <button onClick={() => start("write")} disabled={!canWrite} data-testid="button-write"
              className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 font-semibold text-primary-foreground shadow-sm transition hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 disabled:opacity-45 disabled:hover:translate-y-0">
              <Sparkles className="h-4 w-4" /> {s.stopped ? "Start again" : savedDraft ? "Write a new draft" : "Write screenplay"}
            </button>
            {savedDraft && !running && <span className="text-xs text-muted-foreground">Your saved writing stays until the new one finishes.</span>}
            {runningHere && <>
              <button disabled={busy || starting} onClick={() => control("suspend")} data-testid="button-suspend-main" className="rounded-md border border-primary px-3 py-2 text-sm text-primary disabled:opacity-40">Suspend and save</button>
              <button disabled={busy || starting} onClick={() => control("stop")} data-testid="button-stop-main" className="rounded-md border px-3 py-2 text-sm disabled:opacity-40">Stop</button>
              <button disabled={busy || starting} onClick={() => control("restart")} data-testid="button-restart-main" className="rounded-md border px-3 py-2 text-sm disabled:opacity-40">Stop and start again</button>
            </>}
            {running && run?.mode !== mode && <span className="text-xs text-muted-foreground">Writing in the other mode. Wait or stop it first.</span>}
          </div>
          {(s.progress || s.evidence?.length || s.partialError) && <div className="rounded border border-border px-3 py-2 text-xs" aria-live="polite">
            <p data-testid="run-progress">{s.progress}</p>
            {s.partialError && !runningHere && <p className="text-destructive">{s.partialError}</p>}
            <details className="mt-2" data-testid="run-evidence"><summary className="cursor-pointer text-primary">Writing and coherence evidence</summary>
              <ol className="mt-2 space-y-1">{s.evidence?.map((item, i) => <li key={i}>{item}</li>)}</ol>
              {s.validation && <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap">{s.validation}</pre>}
            </details>
          </div>}

          <section className="pt-4">
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <label htmlFor="output" className="font-semibold text-[15px]">Output</label>
              <span className="script text-[11px] text-muted-foreground" data-testid="text-word-count">
                {countWords(outputText).toLocaleString()} / {maxWords.toLocaleString()} words{s.lastNote && !showingStream ? ` - ${s.lastNote}` : ""}
              </span>
              <div className="ml-auto flex gap-1">
                <button onClick={copy} disabled={!savedDraft || showingStream} data-testid="button-copy"
                  className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs text-primary hover:bg-accent disabled:opacity-40 transition-colors">
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Copied" : "Copy"}
                </button>
                <button onClick={download} disabled={!savedDraft || showingStream} data-testid="button-download"
                  className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs text-primary hover:bg-accent disabled:opacity-40 transition-colors">
                  <Download className="h-3.5 w-3.5" /> Download .txt
                </button>
                {savedDraft && !showingStream && (
                  <button onClick={() => set({ draft: "", savedText: s.job ? "" : undefined, lastNote: "" })} data-testid="button-delete-draft"
                    className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
                    <Trash2 className="h-3.5 w-3.5" /> Delete draft
                  </button>
                )}
              </div>
            </div>
            {showingStream && <p className="mb-2 text-xs text-primary">Streaming. {run!.kind === "revise" ? "Your previous draft is kept until this finishes." : ""}</p>}
            <textarea id="output" value={outputText} readOnly={showingStream} onChange={(e) => set(s.savedText !== undefined ? { savedText: e.target.value } : { draft: e.target.value })}
              rows={20} data-testid="input-output" placeholder="Your screenplay appears here. You can edit it directly."
              className="paper script w-full rounded-md border border-input px-6 py-5 text-[14px] leading-relaxed shadow-sm outline-none focus:border-primary focus:ring-2 focus:ring-ring/25 resize-y" />

            {s.partial && !showingStream && (
              <div className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 rise" data-testid="panel-partial">
                <div className="flex items-start gap-2 text-sm">
                  <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive shrink-0" />
                  <div className="flex-1">
                    <div className="font-semibold">The last run didn't finish ({s.partialError})</div>
                    <div className="text-xs text-muted-foreground">Kept {countWords(s.partial).toLocaleString()} partial words separately. Your draft above is unchanged.</div>
                  </div>
                </div>
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-primary">Show partial text</summary>
                  <pre className="paper script mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded border border-border p-3 text-xs">{s.partial}</pre>
                </details>
                <div className="mt-2 flex gap-2">
                  <button onClick={() => set({ draft: s.partial, savedText: undefined, partial: "", partialError: "", lastNote: "partial draft" })} data-testid="button-use-partial"
                    className="rounded border border-primary/40 px-2.5 py-1 text-xs text-primary hover:bg-accent">Use partial as draft</button>
                  <button onClick={() => set({ partial: "", partialError: "" })} data-testid="button-discard-partial"
                    className="rounded px-2.5 py-1 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10">Discard partial</button>
                </div>
              </div>
            )}
          </section>

          <section className="rounded-lg border border-dashed border-primary/30 p-4">
            <Field id="revision" label="Revision instructions" rows={3} value={s.revision} onChange={(v) => set({ revision: v })} disabled={runningHere}
              hint="Rewrites the current output above. Your existing draft is kept unless the rewrite finishes."
              placeholder="e.g. Cut the opening scene, give the sister the last line, make it colder." />
            <button onClick={() => start("revise")} disabled={!canRevise} data-testid="button-revise"
              className="mt-3 inline-flex items-center gap-2 rounded-md border border-primary bg-card px-4 py-2 text-sm font-semibold text-primary transition hover:bg-primary hover:text-primary-foreground disabled:opacity-45 disabled:hover:bg-card disabled:hover:text-primary">
              <PenLine className="h-4 w-4" /> Rewrite draft
            </button>
            {!savedDraft && <span className="ml-3 text-xs text-muted-foreground">Write a draft first.</span>}
          </section>
        </div>
      </main>

      <StreamWindow open={winOpen && !!run} title={run ? `${run.kind === "revise" ? "Revising" : "Writing"} - ${run.mode === "scratch" ? "From scratch" : "Adaptation"}` : ""}
        text={run?.text ?? ""} status={run?.status ?? "idle"} error={run?.error ?? null} progress={run ? states[run.mode].progress : ""}
        controlsDisabled={busy || starting} onSuspend={() => control("suspend")} onRestart={() => control("restart")}
        onStop={() => control("stop")} onClose={() => setWinOpen(false)} />
    </div>
  );
}
