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
  console.log(`MySQL listo: ${process.env.MYSQL_DATABASE ?? "spamkill"}`);
} finally {
  await connection.end();
}
