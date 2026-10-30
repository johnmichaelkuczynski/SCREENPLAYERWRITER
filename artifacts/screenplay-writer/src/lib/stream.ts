import type { ScreenplayInput, WritingRun } from "@workspace/api-client-react";

export type RunHandle = { id: string; token: string };
export type StreamEvent =
  | { type: "snapshot"; text: string }
  | { type: "handle"; handle: RunHandle }
  | { type: "progress"; state: WritingRun }
  | { type: "suspended"; state: WritingRun }
  | { type: "done"; wordCount: number; truncated: boolean }
  | { type: "error"; error: string };
const base = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/screenplay/runs`;

async function request(url: string, init: RequestInit): Promise<WritingRun> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status}).`);
  return body as WritingRun;
}
export async function cancelRun(handle: RunHandle) {
  return request(`${base}/${handle.id}/cancel`, { method: "POST", headers: { "x-run-token": handle.token }, keepalive: true });
}
export async function suspendRun(handle: RunHandle) {
  return request(`${base}/${handle.id}/suspend`, { method: "POST", headers: { "x-run-token": handle.token } });
}
export async function eraseRun(handle: RunHandle) {
  const response = await fetch(`${base}/${handle.id}`, { method: "DELETE", headers: { "x-run-token": handle.token } });
  if (!response.ok && response.status !== 404) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || "Could not erase the writing job. Your browser data has not been erased.");
  }
}
export async function streamScreenplay(
  input: ScreenplayInput, signal: AbortSignal, onEvent: (event: StreamEvent) => void,
  existing?: RunHandle, resume = false,
) {
  let handle = existing;
  if (!handle) {
    const state = await request(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal });
    if (!state.token) throw new Error("The writing job did not return an access token.");
    handle = { id: state.id, token: state.token };
    onEvent({ type: "handle", handle });
  } else if (resume) {
    await request(`${base}/${handle.id}/resume`, { method: "POST", headers: { "x-run-token": handle.token }, signal });
  }
  const currentHandle = handle;
  if (signal.aborted) { await cancelRun(currentHandle); signal.throwIfAborted(); }
  let lastText = "";
    for (;;) {
      signal.throwIfAborted();
      const state = await request(`${base}/${handle.id}`, { headers: { "x-run-token": handle.token }, signal });
      onEvent({ type: "progress", state });
      if (state.text !== lastText) {
        lastText = state.text;
        onEvent({ type: "snapshot", text: state.text });
      }
      if (state.status === "completed") {
        onEvent({ type: "done", wordCount: state.wordCount, truncated: false });
        return;
      }
      if (state.status === "suspended") {
        onEvent({ type: "suspended", state });
        return;
      }
      if (["failed", "interrupted", "cancelled"].includes(state.status)) throw new Error(state.error || "Writing paused. Resume from the saved checkpoint.");
      await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); };
        const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, 1000);
        signal.addEventListener("abort", abort, { once: true });
      });
    }
}
export const countWords = (t: string) => t.trim() ? t.trim().split(/\s+/u).length : 0;
