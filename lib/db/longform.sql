CREATE TABLE IF NOT EXISTS screenplay_runs (
  id uuid PRIMARY KEY,
  token_hash text NOT NULL,
  input jsonb NOT NULL,
  target_words integer NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  progress text NOT NULL DEFAULT 'Queued',
  skeleton jsonb,
  validation jsonb,
  preview text NOT NULL DEFAULT '',
  final_output text,
  error text,
  evidence jsonb NOT NULL DEFAULT '[]',
  lease_until timestamptz,
  worker_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS screenplay_sources (
  run_id uuid NOT NULL REFERENCES screenplay_runs(id) ON DELETE CASCADE,
  kind text NOT NULL,
  chunk_index integer NOT NULL,
  text text NOT NULL,
  word_count integer NOT NULL,
  summary jsonb,
  PRIMARY KEY (run_id, kind, chunk_index)
);
CREATE TABLE IF NOT EXISTS screenplay_sections (
  run_id uuid NOT NULL REFERENCES screenplay_runs(id) ON DELETE CASCADE,
  section_index integer NOT NULL,
  plan jsonb NOT NULL,
  target_words integer NOT NULL,
  text text,
  delta jsonb,
  repairs integer NOT NULL DEFAULT 0,
  PRIMARY KEY (run_id, section_index)
);
CREATE INDEX IF NOT EXISTS screenplay_runs_status_idx ON screenplay_runs(status, lease_until);
ALTER TABLE screenplay_runs ADD COLUMN IF NOT EXISTS saved_output text;
