import mysql, {
  type Pool,
  type ResultSetHeader,
  type RowDataPacket,
} from "mysql2/promise";

let pool: Pool | null = null;

function mysqlConfig() {
  return {
    host: process.env.MYSQL_HOST ?? "127.0.0.1",
    port: Number(process.env.MYSQL_PORT ?? 3306),
    user: process.env.MYSQL_USER ?? "root",
    password: process.env.MYSQL_PASSWORD ?? "",
    database: process.env.MYSQL_DATABASE ?? "spamkill",
    waitForConnections: true,
    connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT ?? 10),
    namedPlaceholders: false,
    timezone: "Z",
  };
}

export function getPool(): Pool {
  if (!pool) pool = mysql.createPool(mysqlConfig());
  return pool;
}

export async function query<T extends RowDataPacket[] = RowDataPacket[]>(
  statement: string,
  values: unknown[] = [],
): Promise<T> {
  const [rows] = await getPool().query<T>(statement, values);
  return rows;
}

export async function execute(
  statement: string,
  values: unknown[] = [],
): Promise<ResultSetHeader> {
  const [result] = await getPool().execute<ResultSetHeader>(statement, values);
  return result;
}

export async function closePool(): Promise<void> {
  if (!pool) return;
  await pool.end();
  pool = null;
}
