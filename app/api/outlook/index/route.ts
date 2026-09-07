import { query } from "@/db/mysql";
import type { RowDataPacket } from "mysql2/promise";
import { authorizedOutlookSession, outlookAccountKey } from "@/lib/outlook";
import { jsonWithSession, rangeStartTimestamp, type ScanRange } from "@/lib/google";
import { classificationReasonText, type ManualCategory } from "@/lib/gmail-index";

type IndexRow = RowDataPacket & {
  id: string;
  name: string;
  domain: string;
  count: number | string;
  latestAt: number | string | null;
  unsub: number | string;
  manualCategory: ManualCategory | null;
  globalCategory: ManualCategory | null;
  globalVotes: number | string | null;
  globalTotalVotes: number | string | null;
  isSafe: number | string;
  classificationReason: string;
  classificationConfidence: "high" | "medium" | "low";
  primaryMessageId: string;
  spamCount: number | string;
  trashCount: number | string;
  inboxCount: number | string;
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
            MAX(gc.global_category) AS globalCategory,
            MAX(gc.global_votes) AS globalVotes,
            MAX(gc.global_total_votes) AS globalTotalVotes,
            MAX(CASE WHEN sp.is_safe = 1 THEN 1 ELSE 0 END) AS isSafe,
            MAX(im.classification_reason) AS classificationReason,
            MAX(im.classification_confidence) AS classificationConfidence,
            MAX(im.message_id) AS primaryMessageId
            ,SUM(CASE WHEN im.mailbox_folder = 'Spam' THEN 1 ELSE 0 END) AS spamCount
            ,SUM(CASE WHEN im.mailbox_folder = 'Papelera' THEN 1 ELSE 0 END) AS trashCount
            ,SUM(CASE WHEN im.mailbox_folder = 'Bandeja de entrada' THEN 1 ELSE 0 END) AS inboxCount
       FROM indexed_messages im
       LEFT JOIN sender_preferences sp
         ON sp.account_email = im.account_email AND sp.sender_email = im.sender_email
       LEFT JOIN (
         SELECT ranked.sender_email,
                ranked.category AS global_category,
                ranked.votes AS global_votes,
                totals.total_votes AS global_total_votes
           FROM (
             SELECT sender_email, category, COUNT(*) AS votes,
                    ROW_NUMBER() OVER (
                      PARTITION BY sender_email
                      ORDER BY COUNT(*) DESC, category ASC
                    ) AS rank_number
               FROM sender_classification_votes
              GROUP BY sender_email, category
           ) ranked
           JOIN (
             SELECT sender_email, COUNT(*) AS total_votes
               FROM sender_classification_votes
              GROUP BY sender_email
           ) totals ON totals.sender_email = ranked.sender_email
          WHERE ranked.rank_number = 1
            AND ranked.votes >= 2
            AND ranked.votes * 100 >= totals.total_votes * 60
       ) gc ON gc.sender_email = im.sender_email
      WHERE im.account_email = ? AND im.trashed_at IS NULL AND im.mailbox_folder <> 'Papelera' AND im.received_at >= ?${dateClause}
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
      const globalCategory = group.globalCategory;
      const globalCorrected = !group.manualCategory && Boolean(globalCategory);
      const category = safe ? "Notificaciones" : group.manualCategory ?? globalCategory ?? detectedCategory;
      const rawLatestAt = Number(group.latestAt ?? 0);
      const latestAt = Number.isFinite(rawLatestAt) && rawLatestAt > 0 ? rawLatestAt : 0;
      const name = String(group.name || group.id);
      const folder = Number(group.spamCount) > 0 ? "Spam" : Number(group.trashCount) > 0 ? "Papelera" : Number(group.inboxCount) > 0 ? "Bandeja de entrada" : "Archivado";
      return {
        id: group.id,
        name,
        domain: group.domain,
        count: Number(group.count),
        category,
        detectedCategory,
        detectedReason: classificationReasonText(group.classificationReason as Parameters<typeof classificationReasonText>[0]),
        classificationReason: safe ? "Lo marcaste como remitente seguro." : group.manualCategory ? `Corregiste este remitente como ${group.manualCategory}.` : globalCorrected ? `La comunidad lo clasificó como ${globalCategory} con ${Number(group.globalVotes)} de ${Number(group.globalTotalVotes)} votos.` : classificationReasonText(group.classificationReason as Parameters<typeof classificationReasonText>[0]),
        confidence: safe || group.manualCategory ? "high" : globalCorrected ? "medium" : group.classificationConfidence ?? "low",
        doubtful: !safe && !group.manualCategory && !globalCorrected && (group.classificationConfidence ?? "low") === "low",
        corrected: Boolean(group.manualCategory),
        global: globalCorrected,
        safe,
        color: ["#f2612f", "#7b61ff", "#1676b7", "#e74334", "#111827", "#ef9d24"][index % 6],
        initials: name.slice(0, 2).toUpperCase(),
        last: latestAt ? new Intl.DateTimeFormat("es", { day: "numeric", month: "short" }).format(new Date(latestAt)) : "—",
        unsub: Boolean(Number(group.unsub)),
        primaryMessageId: group.primaryMessageId,
        latestAt,
        folder,
      };
    }),
    scanned: total,
    resultSizeEstimate: total,
    coverageComplete: true,
    syncedAt: null,
  }, 200, setCookie);
}
