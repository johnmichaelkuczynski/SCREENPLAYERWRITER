# Screenplay Writer

A two-mode short-screenplay writing app using DeepSeek, with live streaming and iterative revisions.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required secret: `DEEPSEEK_API_KEY` — used only by the API server.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- Frontend: `artifacts/screenplay-writer`
- Writing and document extraction: `artifacts/api-server/src/routes/screenplay.ts`
- Prompt and upstream streaming: `artifacts/api-server/src/lib/screenplay.ts`
- API contract: `lib/api-spec/openapi.yaml`

## Architecture decisions

- Drafts and inputs stay in the browser; no account or shared document database is required for this initial tool.
- Uploaded documents are extracted in memory, not retained as files.
- The provider status indicates configuration, not a successful live generation.

## Product

- Write from instructions or adapt existing text.
- Optional pasted/uploaded style samples and content sources.
- Revise the current screenplay instead of starting from scratch.
- Stream writing into a movable, collapsible, resizable popup.

## User preferences

- Use DeepSeek as the LLM.
- Keep the interface simple, with labeled boxes for each input and output.
- The user explicitly limits this first version to short screenplays; do not implement long-form generation until they provide further instructions.
- Default to approximately 1,000 words when no length is supplied naturally in instructions.

## Gotchas

- Regenerate API hooks and Zod schemas after changing the OpenAPI contract.
- Never expose or log the DeepSeek API key.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
