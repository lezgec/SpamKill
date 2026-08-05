import { and, count, eq, gte, isNull, lt, max, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { indexedMessages, senderPreferences } from "@/db/schema";
import { authorizedOutlookSession, outlookAccountKey } from "@/lib/outlook";
import { jsonWithSession, rangeStartTimestamp, type ScanRange } from "@/lib/google";
import { classificationReasonText, type MessageCategory } from "@/lib/gmail-index";

export async function GET(request: Request) {
  const { session, setCookie } = await authorizedOutlookSession(request);
  if (!session) return jsonWithSession({ error: "Outlook no está conectado." }, 401);
  const requestUrl = new URL(request.url);
  const rangeValue = requestUrl.searchParams.get("range") ?? "90d";
  const range = (["all", "30d", "90d", "1y", "custom"].includes(rangeValue) ? rangeValue : "90d") as ScanRange;
  const after = requestUrl.searchParams.get("after");
  const before = requestUrl.searchParams.get("before");
  const conditions = [
    eq(indexedMessages.accountEmail, outlookAccountKey(session.email)),
    isNull(indexedMessages.trashedAt),
    gte(indexedMessages.receivedAt, rangeStartTimestamp(range, after)),
  ];
  if (range === "custom" && before) {
    const exclusiveEnd = new Date(`${before}T00:00:00Z`);
    exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1);
    conditions.push(lt(indexedMessages.receivedAt, exclusiveEnd.getTime()));
  }
  const db = getDb();
  const where = and(...conditions);
  const groups = await db.select({
    id: indexedMessages.senderEmail,
    name: sql<string>`MAX(${indexedMessages.senderName})`,
    domain: sql<string>`MAX(${indexedMessages.senderDomain})`,
    count: count(indexedMessages.id),
    latestAt: max(indexedMessages.receivedAt),
    unsub: sql<number>`MAX(CASE WHEN ${indexedMessages.hasUnsubscribe} = 1 THEN 1 ELSE 0 END)`,
    manualCategory: sql<MessageCategory | null>`MAX(${senderPreferences.manualCategory})`,
    isSafe: sql<number>`MAX(CASE WHEN ${senderPreferences.isSafe} = 1 THEN 1 ELSE 0 END)`,
    classificationReason: sql<string>`MAX(${indexedMessages.classificationReason})`,
    classificationConfidence: sql<"high" | "medium" | "low">`MAX(${indexedMessages.classificationConfidence})`,
    primaryMessageId: sql<string>`MAX(${indexedMessages.messageId})`,
  }).from(indexedMessages)
    .leftJoin(senderPreferences, and(
      eq(senderPreferences.accountEmail, indexedMessages.accountEmail),
      eq(senderPreferences.senderEmail, indexedMessages.senderEmail),
    ))
    .where(where)
    .groupBy(indexedMessages.senderEmail)
    .orderBy(sql`COUNT(${indexedMessages.id}) DESC`);
  const total = groups.reduce((sum, group) => sum + Number(group.count), 0);
  return jsonWithSession({
    email: session.email,
    groups: groups.map((group, index) => {
      const detectedCategory = group.classificationReason === "promotional_terms" || group.classificationReason === "gmail_promotions" ? "Publicidad" : group.classificationReason === "editorial_terms" || group.classificationReason === "unsubscribe_header" || group.classificationReason === "unsubscribe_content" ? "Newsletters" : "Notificaciones";
      const category = group.isSafe ? "Notificaciones" : group.manualCategory ?? detectedCategory;
      const latestAt = Number(group.latestAt ?? 0);
      return {
        id: group.id,
        name: group.name,
        domain: group.domain,
        count: Number(group.count),
        category,
        detectedCategory,
        detectedReason: classificationReasonText(group.classificationReason as Parameters<typeof classificationReasonText>[0]),
        classificationReason: group.isSafe ? "Lo marcaste como remitente seguro." : group.manualCategory ? `Corregiste este remitente como ${group.manualCategory}.` : classificationReasonText(group.classificationReason as Parameters<typeof classificationReasonText>[0]),
        confidence: group.isSafe || group.manualCategory ? "high" : group.classificationConfidence ?? "low",
        doubtful: !group.isSafe && !group.manualCategory && (group.classificationConfidence ?? "low") === "low",
        corrected: Boolean(group.manualCategory),
        safe: Boolean(group.isSafe),
        color: ["#f2612f", "#7b61ff", "#1676b7", "#e74334", "#111827", "#ef9d24"][index % 6],
        initials: group.name.slice(0, 2).toUpperCase(),
        last: latestAt ? new Intl.DateTimeFormat("es", { day: "numeric", month: "short" }).format(new Date(latestAt)) : "—",
        unsub: Boolean(group.unsub),
        primaryMessageId: group.primaryMessageId,
        latestAt,
      };
    }),
    scanned: total,
    resultSizeEstimate: total,
    coverageComplete: true,
    syncedAt: null,
  }, 200, setCookie);
}
