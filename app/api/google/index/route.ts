import { query } from "@/db/mysql";
import type { RowDataPacket } from "mysql2/promise";
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

type IndexRow = RowDataPacket & {
  id: string;
  name: string;
  domain: string;
  count: number | string;
  advertisingCount: number | string;
  newsletterCount: number | string;
  notificationCount: number | string;
  transactionalCount: number | string;
  gmailPromotionsCount: number | string;
  promotionalTermsCount: number | string;
  gmailCategoriesCount: number | string;
  editorialCount: number | string;
  unsubscribeHeaderCount: number | string;
  unsubscribeContentCount: number | string;
  noSignalsCount: number | string;
  legacyCount: number | string;
  latestAt: number | string | null;
  unsub: number | string;
  primaryMessageId: string;
  manualCategory: MessageCategory | null;
  isSafe: number | string;
};

type SyncStateRow = RowDataPacket & {
  coverageStartAt: number | string | null;
  lastIncrementalSyncAt: number | string | null;
  lastFullScanAt: number | string | null;
};

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

  const params: unknown[] = [session.email, rangeStartTimestamp(range, after)];
  let dateClause = "";
  if (range === "custom" && before) {
    const exclusiveEnd = new Date(`${before}T00:00:00Z`);
    exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1);
    dateClause = " AND im.received_at < ?";
    params.push(exclusiveEnd.getTime());
  }

  const rows = await query<IndexRow[]>(
    `SELECT im.sender_email AS id,
            MAX(im.sender_name) AS name,
            MAX(im.sender_domain) AS domain,
            COUNT(im.id) AS count,
            SUM(CASE WHEN im.category = 'Publicidad' THEN 1 ELSE 0 END) AS advertisingCount,
            SUM(CASE WHEN im.category = 'Newsletters' THEN 1 ELSE 0 END) AS newsletterCount,
            SUM(CASE WHEN im.category = 'Notificaciones' THEN 1 ELSE 0 END) AS notificationCount,
            SUM(CASE WHEN im.classification_reason = 'transactional_terms' THEN 1 ELSE 0 END) AS transactionalCount,
            SUM(CASE WHEN im.classification_reason = 'gmail_promotions' THEN 1 ELSE 0 END) AS gmailPromotionsCount,
            SUM(CASE WHEN im.classification_reason = 'promotional_terms' THEN 1 ELSE 0 END) AS promotionalTermsCount,
            SUM(CASE WHEN im.classification_reason = 'gmail_categories' THEN 1 ELSE 0 END) AS gmailCategoriesCount,
            SUM(CASE WHEN im.classification_reason = 'editorial_terms' THEN 1 ELSE 0 END) AS editorialCount,
            SUM(CASE WHEN im.classification_reason = 'unsubscribe_header' THEN 1 ELSE 0 END) AS unsubscribeHeaderCount,
            SUM(CASE WHEN im.classification_reason = 'unsubscribe_content' THEN 1 ELSE 0 END) AS unsubscribeContentCount,
            SUM(CASE WHEN im.classification_reason = 'no_signals' THEN 1 ELSE 0 END) AS noSignalsCount,
            SUM(CASE WHEN im.classification_reason = 'legacy_classification' THEN 1 ELSE 0 END) AS legacyCount,
            MAX(im.received_at) AS latestAt,
            MAX(CASE WHEN im.has_unsubscribe = 1 THEN 1 ELSE 0 END) AS unsub,
            COALESCE(MAX(CASE WHEN im.has_unsubscribe = 1 THEN im.message_id END), MAX(im.message_id)) AS primaryMessageId,
            MAX(sp.manual_category) AS manualCategory,
            MAX(CASE WHEN sp.is_safe = 1 THEN 1 ELSE 0 END) AS isSafe
       FROM indexed_messages im
       LEFT JOIN sender_preferences sp
         ON sp.account_email = im.account_email AND sp.sender_email = im.sender_email
      WHERE im.account_email = ? AND im.trashed_at IS NULL AND im.received_at >= ?${dateClause}
      GROUP BY im.sender_email
      ORDER BY COUNT(im.id) DESC`,
    params,
  );
  const [state] = await query<SyncStateRow[]>(
    `SELECT coverage_start_at AS coverageStartAt,
            last_incremental_sync_at AS lastIncrementalSyncAt,
            last_full_scan_at AS lastFullScanAt
       FROM gmail_sync_state WHERE account_email = ? LIMIT 1`,
    [session.email],
  );
  const startAt = rangeStartTimestamp(range, after);
  const coverageStartAt = state?.coverageStartAt == null ? null : Number(state.coverageStartAt);
  const coverageComplete = coverageStartAt != null && coverageStartAt <= startAt;

  const groups = rows.map((row, index) => {
    const count = Number(row.count);
    const categoryCounts: Array<[MessageCategory, number]> = [
      ["Publicidad", Number(row.advertisingCount)],
      ["Newsletters", Number(row.newsletterCount)],
      ["Notificaciones", Number(row.notificationCount)],
    ];
    categoryCounts.sort((a, b) => b[1] - a[1]);
    const detectedCategory = categoryCounts[0][0];
    const reasonCounts: Record<ClassificationReason, number> = {
      transactional_terms: Number(row.transactionalCount),
      gmail_promotions: Number(row.gmailPromotionsCount),
      promotional_terms: Number(row.promotionalTermsCount),
      gmail_categories: Number(row.gmailCategoriesCount),
      editorial_terms: Number(row.editorialCount),
      unsubscribe_header: Number(row.unsubscribeHeaderCount),
      unsubscribe_content: Number(row.unsubscribeContentCount),
      no_signals: Number(row.noSignalsCount),
      legacy_classification: Number(row.legacyCount),
    };
    const candidates: Record<MessageCategory, ClassificationReason[]> = {
      Publicidad: ["gmail_promotions", "promotional_terms"],
      Newsletters: ["editorial_terms", "unsubscribe_header", "unsubscribe_content"],
      Notificaciones: ["transactional_terms", "gmail_categories", "no_signals"],
    };
    const legacyCount = Number(row.legacyCount);
    const detectedReason = legacyCount >= Math.ceil(count / 2)
      ? "legacy_classification"
      : candidates[detectedCategory].sort((a, b) => reasonCounts[b] - reasonCounts[a])[0];
    const dominantRatio = count ? categoryCounts[0][1] / count : 0;
    const autoDoubtful = dominantRatio < 0.6 || Number(row.noSignalsCount) >= Math.ceil(count / 2);
    const detectedConfidence: ClassificationConfidence = autoDoubtful
      ? "low"
      : detectedReason === "unsubscribe_header" || detectedReason === "unsubscribe_content" || detectedReason === "legacy_classification"
        ? "medium"
        : "high";
    const safe = Boolean(Number(row.isSafe));
    const corrected = Boolean(row.manualCategory);
    const category = safe ? "Notificaciones" : row.manualCategory ?? detectedCategory;
    const name = String(row.name || row.id);
    return {
      id: row.id,
      name,
      domain: row.domain,
      count,
      category,
      detectedCategory,
      detectedReason: classificationReasonText(detectedReason),
      classificationReason: safe
        ? "Lo marcaste como remitente seguro; nunca se tratará como publicidad."
        : corrected
          ? `Corregiste este remitente como ${row.manualCategory}; recordaremos tu elección.`
          : classificationReasonText(detectedReason),
      confidence: safe || corrected ? "high" : detectedConfidence,
      doubtful: !safe && !corrected && autoDoubtful,
      corrected,
      safe,
      color: palette[index % palette.length],
      initials: name.slice(0, 2).toUpperCase(),
      last: formatDate(Number(row.latestAt ?? 0)),
      unsub: Boolean(Number(row.unsub)),
      primaryMessageId: row.primaryMessageId,
      latestAt: Number(row.latestAt ?? 0),
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
        ? Math.max(Number(state.lastIncrementalSyncAt ?? 0), Number(state.lastFullScanAt ?? 0)) || null
        : null,
    },
    200,
    setCookie,
  );
}
