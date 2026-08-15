import { query } from "@/db/mysql";
import type { RowDataPacket } from "mysql2/promise";
import { authorizedOutlookSession, outlookAccountKey } from "@/lib/outlook";
import { jsonWithSession, rangeStartTimestamp, type ScanRange } from "@/lib/google";
import { classificationReasonText } from "@/lib/gmail-index";

type IndexRow = RowDataPacket & {
  id: string;
  name: string;
  domain: string;
  count: number | string;
  latestAt: number | string | null;
  unsub: number | string;
  manualCategory: "Publicidad" | "Newsletters" | "Notificaciones" | null;
  isSafe: number | string;
  classificationReason: string;
  classificationConfidence: "high" | "medium" | "low";
  primaryMessageId: string;
};

export async function GET(request: Request) {
  const { session, setCookie } = await authorizedOutlookSession(request);
  if (!session) return jsonWithSession({ error: "Outlook no está conectado." }, 401);
  const requestUrl = new URL(request.url);
  const rangeValue = requestUrl.searchParams.get("range") ?? "90d";
  const range = (["all", "30d", "90d", "1y", "custom"].includes(rangeValue) ? rangeValue : "90d") as ScanRange;
  const after = requestUrl.searchParams.get("after");
  const before = requestUrl.searchParams.get("before");
  const params: unknown[] = [outlookAccountKey(session.email), rangeStartTimestamp(range, after)];
  let dateClause = "";
  if (range === "custom" && before) {
    const exclusiveEnd = new Date(`${before}T00:00:00Z`);
    exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1);
    dateClause = " AND im.received_at < ?";
    params.push(exclusiveEnd.getTime());
  }
  const groups = await query<IndexRow[]>(
    `SELECT im.sender_email AS id,
            MAX(im.sender_name) AS name,
            MAX(im.sender_domain) AS domain,
            COUNT(im.id) AS count,
            MAX(im.received_at) AS latestAt,
            MAX(CASE WHEN im.has_unsubscribe = 1 THEN 1 ELSE 0 END) AS unsub,
            MAX(sp.manual_category) AS manualCategory,
            MAX(CASE WHEN sp.is_safe = 1 THEN 1 ELSE 0 END) AS isSafe,
            MAX(im.classification_reason) AS classificationReason,
            MAX(im.classification_confidence) AS classificationConfidence,
            MAX(im.message_id) AS primaryMessageId
       FROM indexed_messages im
       LEFT JOIN sender_preferences sp
         ON sp.account_email = im.account_email AND sp.sender_email = im.sender_email
      WHERE im.account_email = ? AND im.trashed_at IS NULL AND im.received_at >= ?${dateClause}
      GROUP BY im.sender_email
      ORDER BY COUNT(im.id) DESC`,
    params,
  );
  const total = groups.reduce((sum, group) => sum + Number(group.count), 0);
  return jsonWithSession({
    email: session.email,
    groups: groups.map((group, index) => {
      const detectedCategory = group.classificationReason === "promotional_terms" || group.classificationReason === "gmail_promotions"
        ? "Publicidad"
        : group.classificationReason === "editorial_terms" || group.classificationReason === "unsubscribe_header" || group.classificationReason === "unsubscribe_content"
          ? "Newsletters"
          : "Notificaciones";
      const safe = Boolean(Number(group.isSafe));
      const category = safe ? "Notificaciones" : group.manualCategory ?? detectedCategory;
      const rawLatestAt = Number(group.latestAt ?? 0);
      const latestAt = Number.isFinite(rawLatestAt) && rawLatestAt > 0 ? rawLatestAt : 0;
      const name = String(group.name || group.id);
      return {
        id: group.id,
        name,
        domain: group.domain,
        count: Number(group.count),
        category,
        detectedCategory,
        detectedReason: classificationReasonText(group.classificationReason as Parameters<typeof classificationReasonText>[0]),
        classificationReason: safe ? "Lo marcaste como remitente seguro." : group.manualCategory ? `Corregiste este remitente como ${group.manualCategory}.` : classificationReasonText(group.classificationReason as Parameters<typeof classificationReasonText>[0]),
        confidence: safe || group.manualCategory ? "high" : group.classificationConfidence ?? "low",
        doubtful: !safe && !group.manualCategory && (group.classificationConfidence ?? "low") === "low",
        corrected: Boolean(group.manualCategory),
        safe,
        color: ["#f2612f", "#7b61ff", "#1676b7", "#e74334", "#111827", "#ef9d24"][index % 6],
        initials: name.slice(0, 2).toUpperCase(),
        last: latestAt ? new Intl.DateTimeFormat("es", { day: "numeric", month: "short" }).format(new Date(latestAt)) : "—",
        unsub: Boolean(Number(group.unsub)),
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
