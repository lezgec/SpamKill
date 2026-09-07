import { query } from "@/db/mysql";
import type { RowDataPacket } from "mysql2/promise";
import { authorizedOutlookSession, outlookAccountKey } from "@/lib/outlook";
import { jsonWithSession, rangeStartTimestamp, type ScanRange } from "@/lib/google";

type MessageRow = RowDataPacket & {
  id: string;
  subject: string;
  snippet: string;
  from: string;
  receivedAt: number | string;
  hasUnsubscribe: number | string;
};
type CountRow = RowDataPacket & { total: number | string };

export async function GET(request: Request) {
  const { session, setCookie } = await authorizedOutlookSession(request);
  if (!session) return jsonWithSession({ error: "Outlook no está conectado." }, 401);
  const requestUrl = new URL(request.url);
  const sender = requestUrl.searchParams.get("sender");
  if (!sender) return jsonWithSession({ error: "Falta el remitente." }, 400, setCookie);
  const rangeValue = requestUrl.searchParams.get("range") ?? "90d";
  const range = (["all", "30d", "90d", "1y", "custom"].includes(rangeValue) ? rangeValue : "90d") as ScanRange;
  const after = requestUrl.searchParams.get("after");
  const before = requestUrl.searchParams.get("before");
  const params: unknown[] = [outlookAccountKey(session.email), sender, rangeStartTimestamp(range, after)];
  let dateClause = "";
  if (range === "custom" && before) {
    const exclusiveEnd = new Date(`${before}T00:00:00Z`);
    exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1);
    dateClause = " AND received_at < ?";
    params.push(exclusiveEnd.getTime());
  }
  const rawOffset = Number(requestUrl.searchParams.get("pageToken") ?? 0);
  const offset = Number.isInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
  const where = `account_email = ? AND sender_email = ? AND trashed_at IS NULL AND mailbox_folder <> 'Papelera' AND received_at >= ?${dateClause}`;
  const [messages, counts] = await Promise.all([
    query<MessageRow[]>(
      `SELECT message_id AS id, subject, snippet, sender_email AS \`from\`, received_at AS receivedAt, has_unsubscribe AS hasUnsubscribe
         FROM indexed_messages WHERE ${where} ORDER BY received_at DESC LIMIT 50 OFFSET ${offset}`,
      params,
    ),
    query<CountRow[]>(`SELECT COUNT(id) AS total FROM indexed_messages WHERE ${where}`, params),
  ]);
  const total = Number(counts[0]?.total ?? 0);
  const nextOffset = offset + messages.length;
  return jsonWithSession({
    messages: messages.map((message) => ({
      ...message,
      subject: message.subject || "(Sin asunto)",
      receivedAt: Number(message.receivedAt),
      hasUnsubscribe: Boolean(Number(message.hasUnsubscribe)),
    })),
    nextPageToken: nextOffset < total ? String(nextOffset) : null,
    resultSizeEstimate: total,
  }, 200, setCookie);
}
