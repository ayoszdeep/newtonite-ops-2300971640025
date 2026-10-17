import "dotenv/config";
import app from "./app";
import { pool } from "./db/pool";

const port = Number(process.env.PORT ?? 4000);

async function start() {
  await pool.query("SELECT 1");
  console.log("Database connection verified");

  const server = app.listen(port, () => {
    console.log(`OpsDesk API listening on port ${port}`);
  });

  async function shutdown() {
    console.log("Shutting down...");
    server.close(async () => {
      await pool.end();
      console.log("Database pool closed");
      process.exit(0);
    });
  }

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

start().catch((error) => {
  console.error("Failed to start OpsDesk API:", error);
  process.exit(1);
});
