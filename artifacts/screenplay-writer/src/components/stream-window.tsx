import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Minus, Square, X, Maximize2 } from "lucide-react";
import { countWords } from "@/lib/stream";

export type RunStatus = "idle" | "running" | "done" | "stopped" | "error";

export function StreamWindow({
  open, title, text, status, error, onStop, onClose,
}: {
  open: boolean; title: string; text: string; status: RunStatus; error: string | null;
  onStop: () => void; onClose: () => void;
}) {
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [collapsed, setCollapsed] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setMinimized(false);
      setPos((p) => (p.x || p.y ? p : { x: Math.max(16, window.innerWidth - 560), y: 96 }));
    }
  }, [open, title]);

  useEffect(() => {
    const el = bodyRef.current;
    if (el && status === "running") el.scrollTop = el.scrollHeight;
  }, [text, status]);

  if (!open) return null;

  const words = countWords(text);
  const label = { idle: "Waiting", running: "Writing", done: "Finished", stopped: "Stopped", error: "Error" }[status];
  const dot = status === "running" ? "bg-amber-500 animate-pulse" : status === "error" ? "bg-destructive" : status === "done" ? "bg-emerald-600" : "bg-muted-foreground";

  if (minimized) {
    return (
      <button onClick={() => setMinimized(false)} data-testid="button-restore-stream"
        className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm text-primary-foreground shadow-lg hover:-translate-y-0.5 transition-transform">
        <span className={`h-2 w-2 rounded-full ${dot}`} /> {label} - {words} words <Maximize2 className="h-3.5 w-3.5" />
      </button>
    );
  }

  return (
    <div role="dialog" aria-modal="false" aria-label="Live draft" data-testid="window-stream"
      className="fixed z-50 flex flex-col overflow-hidden rounded-lg border border-primary/30 bg-card shadow-[0_18px_50px_-12px_hsl(222_58%_20%/0.45)]"
      style={{ left: pos.x, top: pos.y, width: 520, height: collapsed ? "auto" : 440, minWidth: 300, minHeight: collapsed ? 0 : 180, maxWidth: "95vw", maxHeight: "85vh", resize: collapsed ? "none" : "both" }}>
      <div
        className="flex cursor-move select-none items-center gap-2 bg-primary px-3 py-2 text-primary-foreground touch-none"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          setPos({
            x: Math.min(window.innerWidth - 80, Math.max(-200, e.clientX - drag.current.dx)),
            y: Math.min(window.innerHeight - 40, Math.max(0, e.clientY - drag.current.dy)),
          });
        }}
        onPointerUp={() => (drag.current = null)}
      >
        <span className={`h-2 w-2 rounded-full ${dot}`} />
        <span className="text-sm font-semibold truncate">{title}</span>
        <span className="script text-xs opacity-80 ml-1" data-testid="text-stream-status">{label} - {words} words</span>
        <div className="ml-auto flex items-center">
          {status === "running" && (
            <button onClick={onStop} data-testid="button-stop" title="Stop"
              className="mr-1 inline-flex items-center gap-1 rounded bg-primary-foreground/15 px-2 py-0.5 text-xs hover:bg-primary-foreground/30">
              <Square className="h-3 w-3 fill-current" /> Stop
            </button>
          )}
          <button onClick={() => setCollapsed((c) => !c)} data-testid="button-collapse-stream" title={collapsed ? "Expand" : "Collapse"} className="rounded p-1 hover:bg-primary-foreground/20">
            {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
          </button>
          <button onClick={() => setMinimized(true)} data-testid="button-minimize-stream" title="Minimize" className="rounded p-1 hover:bg-primary-foreground/20">
            <Minus className="h-4 w-4" />
          </button>
          {status !== "running" && (
            <button onClick={onClose} data-testid="button-close-stream" title="Close" className="rounded p-1 hover:bg-primary-foreground/20">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
      {!collapsed && (
        <>
          {error && <div className="bg-destructive/10 px-3 py-2 text-xs text-destructive" data-testid="text-stream-error">{error}</div>}
          <div ref={bodyRef} className="paper flex-1 overflow-auto px-5 py-4">
            <pre className={`script whitespace-pre-wrap text-[13.5px] leading-relaxed ${status === "running" ? "caret" : ""}`} data-testid="text-stream">
              {text || (status === "running" ? "" : "No words came back.")}
            </pre>
          </div>
        </>
      )}
    </div>
  );
}
