import pg from "pg";
import { readFile } from "node:fs/promises";

// The user supplied a PostgreSQL connection URI under this historical secret name.
// Never print the URI or the raw database error (which may contain credentials).
const uri = process.env.NEONPOSTGRES_API_KEY;
if (!uri || !/^postgres(?:ql)?:\/\//.test(uri)) {
  process.stderr.write("NEONPOSTGRES_API_KEY must contain a PostgreSQL connection URI.\n");
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: uri, connectionTimeoutMillis: 15000 });
try {
  await pool.query("SELECT 1");
  await pool.query(await readFile(new URL("./longform.sql", import.meta.url), "utf8"));
  process.stdout.write("Neon connection verified. Screenplay checkpoint tables are ready.\n");
} catch {
  process.stderr.write("Could not connect to Neon or create checkpoint tables. No credentials were printed.\n");
  process.exitCode = 1;
} finally {
  await pool.end();
}
