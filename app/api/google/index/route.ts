import { and, count, eq, gte, isNull, lt, max, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { gmailSyncState, indexedMessages, senderPreferences } from "@/db/schema";
import {
  authorizedGoogleSession,
  buildMailboxQuery,
  jsonWithSession,
  rangeStartTimestamp,
  type ScanRange,
} from "@/lib/google";
import {
  classificationReasonText,
  type ClassificationConfidence,
  type ClassificationReason,
  type MessageCategory,
} from "@/lib/gmail-index";

const palette = ["#f2612f", "#7b61ff", "#1676b7", "#e74334", "#111827", "#ef9d24"];

function formatDate(receivedAt: number): string {
  if (!receivedAt) return "—";
  return new Intl.DateTimeFormat("es", { day: "numeric", month: "short" }).format(
    new Date(receivedAt),
  );
}

export async function GET(request: Request) {
  const { session, setCookie } = await authorizedGoogleSession(request);
  if (!session) return jsonWithSession({ error: "Gmail no está conectado." }, 401);

  const requestUrl = new URL(request.url);
  const rangeValue = requestUrl.searchParams.get("range") ?? "90d";
  const range = (["all", "30d", "90d", "1y", "custom"].includes(rangeValue)
    ? rangeValue
    : "90d") as ScanRange;
  const after = requestUrl.searchParams.get("after");
  const before = requestUrl.searchParams.get("before");
  try {
    buildMailboxQuery({ range, after, before });
  } catch (error) {
    return jsonWithSession(
      { error: error instanceof Error ? error.message : "El intervalo no es válido." },
      400,
      setCookie,
    );
  }

  const startAt = rangeStartTimestamp(range, after);
  const conditions = [
    eq(indexedMessages.accountEmail, session.email),
    isNull(indexedMessages.trashedAt),
    gte(indexedMessages.receivedAt, startAt),
  ];
  if (range === "custom" && before) {
    const exclusiveEnd = new Date(`${before}T00:00:00Z`);
    exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1);
    conditions.push(lt(indexedMessages.receivedAt, exclusiveEnd.getTime()));
  }

  const db = getDb();
  const rows = await db
    .select({
      id: indexedMessages.senderEmail,
      name: sql<string>`MAX(${indexedMessages.senderName})`,
      domain: sql<string>`MAX(${indexedMessages.senderDomain})`,
      count: count(indexedMessages.id),
      advertisingCount: sql<number>`SUM(CASE WHEN ${indexedMessages.category} = 'Publicidad' THEN 1 ELSE 0 END)`,
      newsletterCount: sql<number>`SUM(CASE WHEN ${indexedMessages.category} = 'Newsletters' THEN 1 ELSE 0 END)`,
      notificationCount: sql<number>`SUM(CASE WHEN ${indexedMessages.category} = 'Notificaciones' THEN 1 ELSE 0 END)`,
      transactionalCount: sql<number>`SUM(CASE WHEN ${indexedMessages.classificationReason} = 'transactional_terms' THEN 1 ELSE 0 END)`,
      gmailPromotionsCount: sql<number>`SUM(CASE WHEN ${indexedMessages.classificationReason} = 'gmail_promotions' THEN 1 ELSE 0 END)`,
      promotionalTermsCount: sql<number>`SUM(CASE WHEN ${indexedMessages.classificationReason} = 'promotional_terms' THEN 1 ELSE 0 END)`,
      gmailCategoriesCount: sql<number>`SUM(CASE WHEN ${indexedMessages.classificationReason} = 'gmail_categories' THEN 1 ELSE 0 END)`,
      editorialCount: sql<number>`SUM(CASE WHEN ${indexedMessages.classificationReason} = 'editorial_terms' THEN 1 ELSE 0 END)`,
      unsubscribeHeaderCount: sql<number>`SUM(CASE WHEN ${indexedMessages.classificationReason} = 'unsubscribe_header' THEN 1 ELSE 0 END)`,
      noSignalsCount: sql<number>`SUM(CASE WHEN ${indexedMessages.classificationReason} = 'no_signals' THEN 1 ELSE 0 END)`,
      legacyCount: sql<number>`SUM(CASE WHEN ${indexedMessages.classificationReason} = 'legacy_classification' THEN 1 ELSE 0 END)`,
      latestAt: max(indexedMessages.receivedAt),
      unsub: sql<number>`MAX(CASE WHEN ${indexedMessages.hasUnsubscribe} = 1 THEN 1 ELSE 0 END)`,
      primaryMessageId: sql<string>`COALESCE(
        MAX(CASE WHEN ${indexedMessages.hasUnsubscribe} = 1 THEN ${indexedMessages.messageId} END),
        MAX(${indexedMessages.messageId})
      )`,
      manualCategory: sql<MessageCategory | null>`MAX(${senderPreferences.manualCategory})`,
      isSafe: sql<number>`MAX(CASE WHEN ${senderPreferences.isSafe} = 1 THEN 1 ELSE 0 END)`,
    })
    .from(indexedMessages)
    .leftJoin(
      senderPreferences,
      and(
        eq(senderPreferences.accountEmail, indexedMessages.accountEmail),
        eq(senderPreferences.senderEmail, indexedMessages.senderEmail),
      ),
    )
    .where(and(...conditions))
    .groupBy(indexedMessages.senderEmail)
    .orderBy(sql`COUNT(${indexedMessages.id}) DESC`);
  const [state] = await db
    .select()
    .from(gmailSyncState)
    .where(eq(gmailSyncState.accountEmail, session.email))
    .limit(1);
  const coverageComplete = state?.coverageStartAt != null &&
    state.coverageStartAt <= startAt;
  const groups = rows.map((row, index) => {
    const latestAt = row.latestAt ?? 0;
    const categoryCounts: Array<[MessageCategory, number]> = [
      ["Publicidad", row.advertisingCount],
      ["Newsletters", row.newsletterCount],
      ["Notificaciones", row.notificationCount],
    ];
    categoryCounts.sort((a, b) => b[1] - a[1]);
    const detectedCategory = categoryCounts[0][0];
    const reasonCounts: Record<ClassificationReason, number> = {
      transactional_terms: row.transactionalCount,
      gmail_promotions: row.gmailPromotionsCount,
      promotional_terms: row.promotionalTermsCount,
      gmail_categories: row.gmailCategoriesCount,
      editorial_terms: row.editorialCount,
      unsubscribe_header: row.unsubscribeHeaderCount,
      no_signals: row.noSignalsCount,
      legacy_classification: row.legacyCount,
    };
    const candidates: Record<MessageCategory, ClassificationReason[]> = {
      Publicidad: ["gmail_promotions", "promotional_terms"],
      Newsletters: ["editorial_terms", "unsubscribe_header"],
      Notificaciones: ["transactional_terms", "gmail_categories", "no_signals"],
    };
    const detectedReason = row.legacyCount >= Math.ceil(row.count / 2)
      ? "legacy_classification"
      : candidates[detectedCategory]
        .sort((a, b) => reasonCounts[b] - reasonCounts[a])[0];
    const dominantRatio = row.count ? categoryCounts[0][1] / row.count : 0;
    const autoDoubtful = dominantRatio < 0.6 || row.noSignalsCount >= Math.ceil(row.count / 2);
    const detectedConfidence: ClassificationConfidence = autoDoubtful
      ? "low"
      : detectedReason === "unsubscribe_header" || detectedReason === "legacy_classification"
        ? "medium"
        : "high";
    const safe = Boolean(row.isSafe);
    const corrected = Boolean(row.manualCategory);
    const category = safe
      ? "Notificaciones"
      : row.manualCategory ?? detectedCategory;
    const classificationReason = safe
      ? "Lo marcaste como remitente seguro; nunca se tratará como publicidad."
      : corrected
        ? `Corregiste este remitente como ${row.manualCategory}; recordaremos tu elección.`
        : classificationReasonText(detectedReason);
    return {
      id: row.id,
      name: row.name,
      domain: row.domain,
      count: row.count,
      category,
      detectedCategory,
      detectedReason: classificationReasonText(detectedReason),
      classificationReason,
      confidence: safe || corrected ? "high" : detectedConfidence,
      doubtful: !safe && !corrected && autoDoubtful,
      corrected,
      safe,
      color: palette[index % palette.length],
      initials: row.name.slice(0, 2).toUpperCase(),
      last: formatDate(latestAt),
      unsub: Boolean(row.unsub),
      primaryMessageId: row.primaryMessageId,
      latestAt,
    };
  });

  return jsonWithSession(
    {
      email: session.email,
      groups,
      scanned: groups.reduce((total, group) => total + group.count, 0),
      resultSizeEstimate: groups.reduce((total, group) => total + group.count, 0),
      coverageComplete,
      syncedAt: state
        ? Math.max(state.lastIncrementalSyncAt ?? 0, state.lastFullScanAt ?? 0) || null
        : null,
    },
    200,
    setCookie,
  );
}
