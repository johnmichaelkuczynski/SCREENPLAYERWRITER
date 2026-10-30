import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

const connectionString = process.env.NEONPOSTGRES_API_KEY || process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString, connectionTimeoutMillis: 15000, max: 8 });
export const db = drizzle(pool, { schema });

export * from "./schema";
