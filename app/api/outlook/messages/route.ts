import { and, count, desc, eq, gte, isNull, lt } from "drizzle-orm";
import { getDb } from "@/db";
import { indexedMessages } from "@/db/schema";
import { authorizedOutlookSession, outlookAccountKey } from "@/lib/outlook";
import { jsonWithSession, rangeStartTimestamp, type ScanRange } from "@/lib/google";

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
  const conditions = [
    eq(indexedMessages.accountEmail, outlookAccountKey(session.email)),
    eq(indexedMessages.senderEmail, sender),
    isNull(indexedMessages.trashedAt),
    gte(indexedMessages.receivedAt, rangeStartTimestamp(range, after)),
  ];
  if (range === "custom" && before) {
    const exclusiveEnd = new Date(`${before}T00:00:00Z`);
    exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1);
    conditions.push(lt(indexedMessages.receivedAt, exclusiveEnd.getTime()));
  }
  const where = and(...conditions);
  const rawOffset = Number(requestUrl.searchParams.get("pageToken") ?? 0);
  const offset = Number.isInteger(rawOffset) && rawOffset >= 0 ? rawOffset : 0;
  const db = getDb();
  const [messages, [{ total }]] = await Promise.all([
    db.select({
      id: indexedMessages.messageId,
      subject: indexedMessages.subject,
      snippet: indexedMessages.snippet,
      from: indexedMessages.senderEmail,
      receivedAt: indexedMessages.receivedAt,
      hasUnsubscribe: indexedMessages.hasUnsubscribe,
    }).from(indexedMessages).where(where).orderBy(desc(indexedMessages.receivedAt)).limit(50).offset(offset),
    db.select({ total: count(indexedMessages.id) }).from(indexedMessages).where(where),
  ]);
  const nextOffset = offset + messages.length;
  return jsonWithSession({
    messages: messages.map((message) => ({ ...message, subject: message.subject || "(Sin asunto)" })),
    nextPageToken: nextOffset < total ? String(nextOffset) : null,
    resultSizeEstimate: total,
  }, 200, setCookie);
}
