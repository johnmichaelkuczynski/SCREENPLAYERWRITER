import { Router, type IRouter } from "express";
import { GenerateScreenplayBody, ExtractDocumentBody, ExtractDocumentResponse, GetScreenplayStatusResponse } from "@workspace/api-zod";
import { buildMessages, DEFAULT_WORDS, MAX_WORDS, readProviderEvents, requestedWords } from "../lib/screenplay";
import writingRunsRouter from "./writing-runs";
import { pool, wordCount } from "../lib/longform-store";

const router: IRouter = Router();
let activeGenerations = 0;
router.use("/runs", writingRunsRouter);

router.get("/status", async (_req, res): Promise<void> => {
  let database = false;
  if (process.env.NEONPOSTGRES_API_KEY) {
    try { await pool.query("SELECT id FROM screenplay_runs LIMIT 0"); database = true; } catch { /* sanitized status only */ }
  }
  res.json(GetScreenplayStatusResponse.parse({
    configured: Boolean(process.env.DEEPSEEK_API_KEY),
    provider: "DeepSeek",
    model: "deepseek-chat",
    defaultWords: DEFAULT_WORDS,
    maxWords: MAX_WORDS,
    database,
    ...(!database ? { databaseError: "Neon checkpoints are unavailable. Check the database connection." } : {}),
  }));
});

router.post("/generate", async (req, res): Promise<void> => {
  const parsed = GenerateScreenplayBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "The writing request is invalid or too large. Please shorten your inputs." });
    return;
  }
  const input = parsed.data;
  const revising = Boolean(input.currentDraft?.trim());
  if (revising && !input.revisionInstructions?.trim()) {
    res.status(400).json({ error: "Enter instructions describing how to revise the current screenplay." });
    return;
  }
  if (!revising && input.mode === "scratch" && !input.instructions.trim()) {
    res.status(400).json({ error: "Describe the screenplay you want to write." });
    return;
  }
  if (!revising && input.mode === "adapt" && !input.originalText?.trim()) {
    res.status(400).json({ error: "Paste or upload the original text you want to adapt." });
    return;
  }
  const words = requestedWords(input);
  if ((words || 0) > 3000) {
    res.status(400).json({ error: "Use the checkpointed /screenplay/runs endpoint for long screenplays." });
    return;
  }
  if (words !== undefined && (words < 50 || words > MAX_WORDS)) {
    res.status(400).json({ error: `This version supports short screenplays of 50–${MAX_WORDS.toLocaleString()} words. Adjust the length in your instructions.` });
    return;
  }
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    res.status(503).json({ error: "DeepSeek is not configured. Add DEEPSEEK_API_KEY in the project's Secrets." });
    return;
  }
  if (activeGenerations >= 4) {
    res.status(429).json({ error: "All writing slots are currently busy. Please try again shortly." });
    return;
  }
  activeGenerations++;
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 240000);
  res.on("close", () => controller.abort());
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  try {
    const upstream = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "deepseek-chat",
        messages: buildMessages(input),
        stream: true,
        max_tokens: 8192,
        temperature: 0.85,
      }),
      signal: controller.signal,
    });
    if (!upstream.ok || !upstream.body) {
      req.log.warn({ providerStatus: upstream.status }, "DeepSeek request rejected");
      const error = upstream.status === 401 ? "DeepSeek rejected the API key. Update DEEPSEEK_API_KEY in Secrets."
        : upstream.status === 402 ? "Your DeepSeek account has insufficient balance. Add funds to the DeepSeek account."
          : upstream.status === 429 ? "DeepSeek is rate limiting requests. Please try again shortly."
            : "DeepSeek could not start writing. Please try again.";
      await upstream.body?.cancel();
      res.status(502).json({ error });
      return;
    }
    res.status(200).set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();
    const send = (event: object) => { if (!res.destroyed) res.write(`data: ${JSON.stringify(event)}\n\n`); };
    heartbeat = setInterval(() => { if (!res.destroyed) res.write(": heartbeat\n\n"); }, 10000);
    let output = "";
    let finishReason: string | null | undefined;
    for await (const event of readProviderEvents(upstream.body)) {
      if (event.error) throw new Error("provider_stream_error");
      const choice = event.choices?.[0];
      const text = choice?.delta?.content;
      if (text) {
        output += text;
        send({ type: "delta", text });
      }
      if (choice?.finish_reason) finishReason = choice.finish_reason;
    }
    if (!output.trim()) throw new Error("empty_output");
    if (!finishReason) throw new Error("incomplete_stream");
    send({ type: "done", wordCount: output.trim().split(/\s+/).length, truncated: finishReason === "length" });
    req.log.info({ wordCount: output.trim().split(/\s+/).length, finishReason }, "Screenplay stream completed");
    res.end();
  } catch {
    if (res.destroyed) return;
    const error = timedOut ? "DeepSeek took too long to finish. Your partial writing is preserved; try a shorter request."
      : "The connection to DeepSeek was interrupted. Any partial writing is preserved. Please try again.";
    req.log.warn({ timedOut }, "Screenplay generation interrupted");
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ type: "error", error })}\n\n`);
      res.end();
    } else res.status(502).json({ error });
  } finally {
    clearTimeout(timeout);
    if (heartbeat) clearInterval(heartbeat);
    activeGenerations--;
  }
});

router.post("/extract", async (req, res): Promise<void> => {
  const parsed = ExtractDocumentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Select a supported document under 8 MB." });
    return;
  }
  const { filename, base64 } = parsed.data;
  const ext = filename.split(".").pop()?.toLowerCase();
  if (!["txt", "md", "pdf", "docx"].includes(ext || "")) {
    res.status(400).json({ error: "Supported files: TXT, Markdown, PDF, and DOCX." });
    return;
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
    res.status(400).json({ error: "The uploaded file could not be read." });
    return;
  }
  const buffer = Buffer.from(base64, "base64");
  if (!buffer.length || buffer.length > 8 * 1024 * 1024) {
    res.status(400).json({ error: "Select a nonempty document under 8 MB." });
    return;
  }
  try {
    let text = "";
    if (ext === "pdf") {
      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: buffer });
      try { text = (await parser.getText()).text; }
      finally { await parser.destroy(); }
    } else if (ext === "docx") {
      const mammoth = await import("mammoth");
      text = (await mammoth.extractRawText({ buffer })).value;
    } else text = buffer.toString("utf8").replace(/^\uFEFF/, "");
    text = text.trim();
    if (!text) {
      res.status(400).json({ error: "No readable text was found. For scanned PDFs, paste the text or upload a text-based document." });
      return;
    }
    if (text.length > 1000000 || wordCount(text) > 30000) {
      res.status(400).json({ error: "This document exceeds 30,000 words or 1,000,000 characters. Upload a shorter excerpt." });
      return;
    }
    res.json(ExtractDocumentResponse.parse({ text, filename }));
  } catch {
    req.log.warn({ extension: ext }, "Document text extraction failed");
    res.status(400).json({ error: "This document could not be read. Try an unencrypted PDF, a DOCX, or plain text." });
  }
});

export default router;
