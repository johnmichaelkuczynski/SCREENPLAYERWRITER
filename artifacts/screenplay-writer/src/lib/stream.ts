import type { ScreenplayInput } from "@workspace/api-client-react";

export type StreamEvent =
  | { type: "delta"; text: string }
  | { type: "done"; wordCount: number; truncated: boolean }
  | { type: "error"; error: string };

export async function streamScreenplay(
  input: ScreenplayInput,
  signal: AbortSignal,
  onEvent: (e: StreamEvent) => void,
): Promise<void> {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  const res = await fetch(`${base}/api/screenplay/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    credentials: "include",
    body: JSON.stringify(input),
    signal,
  });
  if (!res.ok || !res.body) {
    let msg = `Request failed (${res.status})`;
    try {
      const j = await res.json();
      if (j?.error) msg = String(j.error);
    } catch {
      /* not json */
    }
    throw new Error(msg);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const handleFrame = (frame: string) => {
    const data = frame
      .split(/\r?\n/)
      .filter((l) => l.startsWith("data:"))
      .map((l) => l.slice(5).replace(/^ /, ""))
      .join("\n");
    if (!data) return;
    try {
      onEvent(JSON.parse(data) as StreamEvent);
    } catch {
      /* ignore malformed */
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let idx: number;
    while ((idx = buf.search(/\r?\n\r?\n/)) !== -1) {
      const m = buf.slice(idx).match(/^\r?\n\r?\n/)!;
      handleFrame(buf.slice(0, idx));
      buf = buf.slice(idx + m[0].length);
    }
  }
  buf += dec.decode();
  if (buf.trim()) handleFrame(buf);
}

export const countWords = (t: string) => (t.trim() ? t.trim().split(/\s+/).length : 0);
