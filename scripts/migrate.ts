import { migrate } from "drizzle-orm/postgres-js/migrator";
import { closeDb, getDb } from "../db/index";

try {
  await migrate(getDb(), { migrationsFolder: "drizzle" });
  console.info("Migrações PostgreSQL aplicadas.");
} finally {
  await closeDb();
}
