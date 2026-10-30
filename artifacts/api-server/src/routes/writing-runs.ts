import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { GenerateScreenplayBody } from "@workspace/api-zod";
import { createRun, getRun, hashToken, patchRun, pool, publicRun, wordCount } from "../lib/longform-store";
import { isWorking, launchRun, stopWorker } from "../lib/longform-engine";
import { DEFAULT_WORDS, requestedWords } from "../lib/screenplay";

const router: IRouter = Router();
router.use(async (_req, res, next): Promise<void> => {
  if (!process.env.NEONPOSTGRES_API_KEY) {
    res.status(503).json({ error: "The Neon database connection is not configured." });
    return;
  }
  next();
});
router.post("/", async (req, res): Promise<void> => {
  const parsed = GenerateScreenplayBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "The request is too large or invalid. Each source can contain up to 30,000 words (and 1,000,000 characters)." });
    return;
  }
  const input = parsed.data;
  if (!process.env.DEEPSEEK_API_KEY) { res.status(503).json({ error: "DeepSeek is not configured." }); return; }
  if (input.currentDraft?.trim() ? !input.revisionInstructions?.trim() : input.mode === "scratch" ? !input.instructions.trim() : !input.originalText?.trim()) {
    res.status(400).json({ error: input.currentDraft ? "Enter revision instructions." : input.mode === "adapt" ? "Provide the original text to adapt." : "Describe the screenplay you want." });
    return;
  }
  for (const key of ["originalText", "styleSample", "contentSource", "currentDraft"] as const) {
    if (wordCount(input[key] || "") > 30000) {
      res.status(400).json({ error: `${key} exceeds the 30,000-word source limit. Shorten that source and try again.` });
      return;
    }
  }
  const target = requestedWords(input) ?? (input.currentDraft?.trim() ? wordCount(input.currentDraft) : DEFAULT_WORDS);
  if (!Number.isInteger(target) || target < 50 || target > 30000) {
    res.status(400).json({ error: "Specify a screenplay length between 50 and 30,000 words." });
    return;
  }
  try {
    const count = await pool.query("SELECT count(*)::int AS total FROM screenplay_runs WHERE status='running' AND lease_until>now()");
    if (count.rows[0].total >= 4) { res.status(429).json({ error: "Four writing jobs are already active. Try again shortly." }); return; }
    const handle = await createRun(input, target);
    const run = (await getRun(handle.id))!;
    res.status(202).json({ ...await publicRun(run), token: handle.token });
    launchRun(handle.id);
  } catch {
    req.log.warn("Unable to create writing checkpoint");
    res.status(503).json({ error: "The Neon checkpoint database is unavailable. No writing job was started." });
  }
});

async function authorize(req: Request, res: Response, next: NextFunction): Promise<void> {
  const id = String(req.params.id);
  const token = req.get("x-run-token");
  if (!/^[0-9a-f-]{36}$/i.test(id) || !token || token.length > 256) {
    res.status(404).json({ error: "Writing job not found." }); return;
  }
  try {
    const run = await getRun(id);
    if (!run || hashToken(token) !== run.token_hash) { res.status(404).json({ error: "Writing job not found." }); return; }
    res.locals.run = run;
    next();
  } catch {
    res.status(503).json({ error: "The checkpoint database is temporarily unavailable. Your job can continue in the background; retry shortly." });
  }
}
router.get("/:id", authorize, async (_req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  res.json(await publicRun(res.locals.run));
});
router.post("/:id/suspend", authorize, async (_req, res): Promise<void> => {
  const run = res.locals.run;
  if (run.status !== "completed") {
    // One atomic statement freezes the exact output visible through polling.
    await pool.query("UPDATE screenplay_runs SET status='suspended',saved_output=preview,progress='Suspended — current output saved',error=NULL,worker_id=NULL,lease_until=NULL,updated_at=now() WHERE id=$1 AND status!='completed'", [run.id]);
    await stopWorker(run.id);
  }
  res.json(await publicRun((await getRun(run.id))!));
});
router.delete("/:id", authorize, async (_req, res): Promise<void> => {
  const id = res.locals.run.id;
  await patchRun(id, { status: "cancelled", worker_id: null, lease_until: null });
  await stopWorker(id);
  // Sources, sections and reports are owned by this run and cascade with it.
  await pool.query("DELETE FROM screenplay_runs WHERE id=$1", [id]);
  res.status(204).end();
});
router.post("/:id/cancel", authorize, async (_req, res): Promise<void> => {
  const run = res.locals.run;
  if (run.status !== "completed") {
    await patchRun(run.id, { status: "cancelled", progress: "Stopped — start again for a fresh generation", lease_until: null, worker_id: null });
    await stopWorker(run.id);
  }
  res.json(await publicRun((await getRun(run.id))!));
});
router.post("/:id/resume", authorize, async (_req, res): Promise<void> => {
  const run = res.locals.run;
  if (run.status === "completed") { res.status(202).json(await publicRun(run)); return; }
  if (isWorking(run.id) && run.status === "running") { res.status(202).json(await publicRun(run)); return; }
  if (isWorking(run.id)) {
    await stopWorker(run.id);
    if (isWorking(run.id)) { res.status(409).json({ error: "The previous request is finishing. Try Resume again shortly." }); return; }
  }
  if (run.status === "running" && run.lease_until && new Date(run.lease_until).getTime() > Date.now()) {
    res.status(409).json({ error: "The previous worker is still active. Wait up to one minute before resuming." }); return;
  }
  await patchRun(run.id, { status: "queued", error: null, progress: "Resuming from saved checkpoints", lease_until: null });
  res.status(202).json(await publicRun((await getRun(run.id))!));
  launchRun(run.id);
});

export default router;
