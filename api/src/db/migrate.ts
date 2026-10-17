import "dotenv/config";
import fs from "fs";
import path from "path";
import { pool } from "./pool";

async function ensureMigrationsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function getAppliedMigrations(): Promise<Set<string>> {
  const result = await pool.query("SELECT version FROM schema_migrations ORDER BY version");
  return new Set(result.rows.map((r: { version: string }) => r.version));
}

async function migrate(): Promise<void> {
  console.log("Running database migrations...");

  await ensureMigrationsTable();
  const applied = await getAppliedMigrations();

  const migrationsDir = path.resolve(__dirname, "migrations");
  const files = fs.readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  for (const file of files) {
    const version = file.replace(".sql", "");

    if (applied.has(version)) {
      console.log(`  Skipping ${file} (already applied)`);
      continue;
    }

    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
    const client = await pool.connect();

    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        "INSERT INTO schema_migrations (version) VALUES ($1)",
        [version]
      );
      await client.query("COMMIT");
      console.log(`  Applied ${file}`);
    } catch (error) {
      await client.query("ROLLBACK");
      console.error(`  Failed to apply ${file}:`, error);
      throw error;
    } finally {
      client.release();
    }
  }

  console.log("Migrations complete.");
  await pool.end();
}

migrate().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
