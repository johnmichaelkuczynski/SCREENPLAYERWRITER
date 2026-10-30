# Screenplay Writer

A two-mode screenplay writing app using DeepSeek, with checkpointed cross-section coherence, live writing, and iterative revisions.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required secret: `DEEPSEEK_API_KEY` — used only by the API server.
- Required secret: `NEONPOSTGRES_API_KEY` — despite the historical name, this contains the user's external Neon PostgreSQL connection URI, not a Neon management API token.
- External Neon schema setup: `pnpm --filter @workspace/db exec node setup-longform.mjs`. This adds only screenplay-specific checkpoint tables. Replit's managed-database publishing migrations do not manage this external database.
- Source-boundary regression checks: `node --test artifacts/api-server/src/lib/longform-text.test.mjs`.

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

- Inputs and editable drafts are mirrored in browser IndexedDB. Writing jobs, source sections, global plans, generated sections, deltas and audits are checkpointed in the user-provided Neon database.
- Uploaded documents are extracted in memory, not retained as files.
- The provider status indicates configuration, not a successful live generation.
- Writing-job access is anonymous but private through a random capability token, stored only in the originating browser. The server stores its hash. Job IDs alone do not grant access.
- Jobs run independently of the browser connection, with database leases and explicit resume after interruption. Only an audited, length-checked draft becomes completed output.

## Product

- Write from instructions or adapt existing text.
- Optional pasted/uploaded style samples and content sources.
- Revise the current screenplay instead of starting from scratch.
- Stream writing into a movable, collapsible, resizable popup.

## User preferences

- Use DeepSeek as the LLM.
- Keep the interface simple, with labeled boxes for each input and output.
- The user has now requested 3,000–30,000-word inputs and outputs, using the attached cross-chunk coherence method. Keep existing short writing and both modes; preserve the interface.
- Default to approximately 1,000 words when no length is supplied naturally in instructions.

## Gotchas

- Regenerate API hooks and Zod schemas after changing the OpenAPI contract.
- Never expose or log the DeepSeek API key.
- Long-form output remains experimental: real runs verified ingestion/checkpoint recovery, but automatic coherence repair has not reliably converged to an approved final screenplay. Do not describe the 30,000-word path as quality-verified.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
