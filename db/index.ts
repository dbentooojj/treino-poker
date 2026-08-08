import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import * as schema from "./schema";

let client: Sql | undefined;
let database: PostgresJsDatabase<typeof schema> | undefined;

function databaseUrl() {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) throw new Error("DATABASE_URL não está configurada.");
  return value;
}

export function getSqlClient() {
  client ??= postgres(databaseUrl(), {
    max: Number(process.env.DATABASE_POOL_SIZE ?? 10),
    idle_timeout: 20,
    connect_timeout: 10,
  });
  return client;
}

export function getDb() {
  database ??= drizzle(getSqlClient(), { schema });
  return database;
}

export async function closeDb() {
  if (client) await client.end();
  client = undefined;
  database = undefined;
}
