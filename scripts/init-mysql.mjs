import { readFileSync } from "node:fs";
import mysql from "mysql2/promise";

function loadLocalEnv() {
  try {
    const content = readFileSync(".env.local", "utf8");
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)=(.*)\s*$/);
      if (!match || process.env[match[1]]) continue;
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
  } catch {
    // Environment variables can also be supplied by the shell.
  }
}

loadLocalEnv();
const schema = readFileSync(new URL("../db/schema.sql", import.meta.url), "utf8");
const connection = await mysql.createConnection({
  host: process.env.MYSQL_HOST ?? "127.0.0.1",
  port: Number(process.env.MYSQL_PORT ?? 3306),
  user: process.env.MYSQL_USER ?? "root",
  password: process.env.MYSQL_PASSWORD ?? "",
  multipleStatements: true,
});

try {
  await connection.query(schema);
  const [columns] = await connection.query(
    `SELECT COUNT(*) AS count FROM information_schema.columns
     WHERE table_schema = ? AND table_name = 'indexed_messages' AND column_name = 'mailbox_folder'`,
    [process.env.MYSQL_DATABASE ?? "spamkill"],
  );
  if (Number(columns[0]?.count ?? 0) === 0) {
    await connection.query(
      "ALTER TABLE indexed_messages ADD COLUMN mailbox_folder VARCHAR(32) CHARACTER SET utf8mb4 NOT NULL DEFAULT 'Bandeja de entrada' AFTER has_unsubscribe",
    );
  }
  console.log(`MySQL listo: ${process.env.MYSQL_DATABASE ?? "spamkill"}`);
} finally {
  await connection.end();
}
