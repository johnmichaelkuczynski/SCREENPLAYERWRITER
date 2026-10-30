import { useEffect, useRef, useState } from "react";
import { useGetScreenplayStatus, type ScreenplayInput } from "@workspace/api-client-react";
import { Copy, Download, PenLine, RotateCcw, Sparkles, Check, AlertTriangle, Trash2 } from "lucide-react";
import { Field } from "@/components/field";
import { StreamWindow, type RunStatus } from "@/components/stream-window";
import { streamScreenplay, countWords } from "@/lib/stream";

type Mode = "scratch" | "adapt";
type ModeState = {
  instructions: string; originalText: string; styleSample: string; contentSource: string;
  draft: string; revision: string; partial: string; partialError: string; lastNote: string;
};
const empty: ModeState = { instructions: "", originalText: "", styleSample: "", contentSource: "", draft: "", revision: "", partial: "", partialError: "", lastNote: "" };
const KEY = "screenplay-writer:v1";

function load(): { mode: Mode; scratch: ModeState; adapt: ModeState } {
  try {
    const j = JSON.parse(localStorage.getItem(KEY) ?? "");
    return { mode: j.mode === "adapt" ? "adapt" : "scratch", scratch: { ...empty, ...j.scratch }, adapt: { ...empty, ...j.adapt } };
  } catch {
    return { mode: "scratch", scratch: { ...empty }, adapt: { ...empty } };
  }
}

export default function Home() {
  const [initial] = useState(load);
  const [mode, setMode] = useState<Mode>(initial.mode);
  const [states, setStates] = useState({ scratch: initial.scratch, adapt: initial.adapt });
  const s = states[mode];
  const set = (patch: Partial<ModeState>, m: Mode = mode) => setStates((p) => ({ ...p, [m]: { ...p[m], ...patch } }));

  const status = useGetScreenplayStatus();
  const maxWords = status.data?.maxWords ?? 3000;
  const defWords = status.data?.defaultWords ?? 1000;

  const [run, setRun] = useState<{ mode: Mode; kind: "write" | "revise"; text: string; status: RunStatus; error: string | null } | null>(null);
  const [winOpen, setWinOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => localStorage.setItem(KEY, JSON.stringify({ mode, ...states })), 300);
    return () => clearTimeout(t);
  }, [mode, states]);

  const running = run?.status === "running";
  const runningHere = running && run?.mode === mode;

  const start = async (kind: "write" | "revise") => {
    const m = mode;
    const cur = states[m];
    const input: ScreenplayInput = { mode: m, instructions: cur.instructions };
    if (m === "adapt") input.originalText = cur.originalText;
    if (cur.styleSample.trim()) input.styleSample = cur.styleSample;
    if (cur.contentSource.trim()) input.contentSource = cur.contentSource;
    if (kind === "revise") { input.currentDraft = cur.draft; input.revisionInstructions = cur.revision; }

    const ac = new AbortController();
    abortRef.current = ac;
    let text = "";
    let failure: string | null = null;
    let finished = false;
    let note = "";
    setRun({ mode: m, kind, text: "", status: "running", error: null });
    setWinOpen(true);
    try {
      await streamScreenplay(input, ac.signal, (e) => {
        if (e.type === "delta") { text += e.text; setRun((r) => r && { ...r, text }); }
        else if (e.type === "done") { finished = true; note = `${e.wordCount.toLocaleString()} words${e.truncated ? " - stopped at the length limit" : ""}`; }
        else if (e.type === "error") failure = e.error;
      });
      if (!finished && !failure) failure = "The connection ended before the draft was finished.";
    } catch (e) {
      failure = ac.signal.aborted ? "Stopped." : (e as Error).message || "Network error";
    }
    abortRef.current = null;
    if (failure) {
      setRun((r) => r && { ...r, status: ac.signal.aborted ? "stopped" : "error", error: failure });
      if (text.trim()) set({ partial: text, partialError: failure }, m);
    } else {
      setRun((r) => r && { ...r, status: "done" });
      set({ draft: text, partial: "", partialError: "", lastNote: note, ...(kind === "revise" ? { revision: "" } : {}) }, m);
    }
  };

  const showingStream = runningHere;
  const outputText = showingStream ? run!.text : s.draft;

  const copy = async () => {
    await navigator.clipboard.writeText(s.draft);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };
  const download = () => {
    const blob = new Blob([s.draft], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `screenplay-${mode}-${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const clearAll = () => { abortRef.current?.abort(); localStorage.removeItem(KEY); window.location.reload(); };

  const canWrite = !running && s.instructions.trim() && (mode === "scratch" || s.originalText.trim());
  const canRevise = !running && s.draft.trim() && s.revision.trim();

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
          <button onClick={clearAll} data-testid="button-clear"
            className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:border-destructive hover:text-destructive transition-colors">
            <RotateCcw className="h-3.5 w-3.5" /> Clear everything
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 pb-24 pt-8">
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
          {mode === "adapt" && (
            <Field id="original" label="Original document" upload rows={10} value={s.originalText} onChange={(v) => set({ originalText: v })}
              hint="Paste, type or upload (TXT, MD, PDF, DOCX up to 8 MB). Extracted text stays editable." disabled={runningHere} />
          )}
          <Field id="instructions" label={mode === "scratch" ? "Instructions" : "Adaptation instructions"} rows={5}
            value={s.instructions} onChange={(v) => set({ instructions: v })} disabled={runningHere}
            placeholder={mode === "scratch"
              ? "e.g. Two estranged sisters meet at their father's storage unit the night before it's auctioned. About 1,200 words, dry humor."
              : "e.g. Keep only the train scene, move it to present-day Lisbon, about 900 words."}
            hint={<>Say how long you want it in your own words. Default is about {defWords.toLocaleString()} words; short screenplays are limited to {maxWords.toLocaleString()} words.</>} />
          <Field id="style" label="Style sample" optional upload rows={4} value={s.styleSample} onChange={(v) => set({ styleSample: v })}
            hint="Writing whose voice you want echoed." disabled={runningHere} />
          <Field id="source" label="Content source" optional upload rows={4} value={s.contentSource} onChange={(v) => set({ contentSource: v })}
            hint="Notes, research or facts to draw from." disabled={runningHere} />

          <div className="flex flex-wrap items-center gap-3">
            <button onClick={() => start("write")} disabled={!canWrite} data-testid="button-write"
              className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-2.5 font-semibold text-primary-foreground shadow-sm transition hover:-translate-y-0.5 hover:shadow-md active:translate-y-0 disabled:opacity-45 disabled:hover:translate-y-0">
              <Sparkles className="h-4 w-4" /> {s.draft ? "Write a new draft" : "Write screenplay"}
            </button>
            {s.draft && !running && <span className="text-xs text-muted-foreground">Your current draft stays until the new one finishes.</span>}
            {running && run?.mode !== mode && <span className="text-xs text-muted-foreground">Writing in the other mode. Wait or stop it first.</span>}
          </div>

          <section className="pt-4">
            <div className="mb-1.5 flex flex-wrap items-center gap-2">
              <label htmlFor="output" className="font-semibold text-[15px]">Output</label>
              <span className="script text-[11px] text-muted-foreground" data-testid="text-word-count">
                {countWords(outputText).toLocaleString()} / {maxWords.toLocaleString()} words{s.lastNote && !showingStream ? ` - ${s.lastNote}` : ""}
              </span>
              <div className="ml-auto flex gap-1">
                <button onClick={copy} disabled={!s.draft || showingStream} data-testid="button-copy"
                  className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs text-primary hover:bg-accent disabled:opacity-40 transition-colors">
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Copied" : "Copy"}
                </button>
                <button onClick={download} disabled={!s.draft || showingStream} data-testid="button-download"
                  className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs text-primary hover:bg-accent disabled:opacity-40 transition-colors">
                  <Download className="h-3.5 w-3.5" /> Download .txt
                </button>
                {s.draft && !showingStream && (
                  <button onClick={() => set({ draft: "", lastNote: "" })} data-testid="button-delete-draft"
                    className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
                    <Trash2 className="h-3.5 w-3.5" /> Delete draft
                  </button>
                )}
              </div>
            </div>
            {showingStream && <p className="mb-2 text-xs text-primary">Streaming. {run!.kind === "revise" ? "Your previous draft is kept until this finishes." : ""}</p>}
            <textarea id="output" value={outputText} readOnly={showingStream} onChange={(e) => set({ draft: e.target.value })}
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
                  <button onClick={() => set({ draft: s.partial, partial: "", partialError: "", lastNote: "partial draft" })} data-testid="button-use-partial"
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
            {!s.draft && <span className="ml-3 text-xs text-muted-foreground">Write a draft first.</span>}
          </section>
        </div>
      </main>

      <StreamWindow open={winOpen && !!run} title={run ? `${run.kind === "revise" ? "Revising" : "Writing"} - ${run.mode === "scratch" ? "From scratch" : "Adaptation"}` : ""}
        text={run?.text ?? ""} status={run?.status ?? "idle"} error={run?.error ?? null}
        onStop={() => abortRef.current?.abort()} onClose={() => setWinOpen(false)} />
    </div>
  );
}
