import { and, count, eq, gte, lt, max, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { gmailSyncState, indexedMessages } from "@/db/schema";
import {
  authorizedGoogleSession,
  buildMailboxQuery,
  jsonWithSession,
  rangeStartTimestamp,
  type ScanRange,
} from "@/lib/google";
import type { MessageCategory } from "@/lib/gmail-index";

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
      category: sql<MessageCategory>`CASE
        WHEN SUM(CASE WHEN ${indexedMessages.category} = 'Publicidad' THEN 1 ELSE 0 END) >=
             SUM(CASE WHEN ${indexedMessages.category} = 'Newsletters' THEN 1 ELSE 0 END)
         AND SUM(CASE WHEN ${indexedMessages.category} = 'Publicidad' THEN 1 ELSE 0 END) >=
             SUM(CASE WHEN ${indexedMessages.category} = 'Notificaciones' THEN 1 ELSE 0 END)
          THEN 'Publicidad'
        WHEN SUM(CASE WHEN ${indexedMessages.category} = 'Newsletters' THEN 1 ELSE 0 END) >=
             SUM(CASE WHEN ${indexedMessages.category} = 'Notificaciones' THEN 1 ELSE 0 END)
          THEN 'Newsletters'
        ELSE 'Notificaciones'
      END`,
      latestAt: max(indexedMessages.receivedAt),
      unsub: sql<number>`MAX(CASE WHEN ${indexedMessages.hasUnsubscribe} = 1 THEN 1 ELSE 0 END)`,
      primaryMessageId: sql<string>`COALESCE(
        MAX(CASE WHEN ${indexedMessages.hasUnsubscribe} = 1 THEN ${indexedMessages.messageId} END),
        MAX(${indexedMessages.messageId})
      )`,
    })
    .from(indexedMessages)
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
    return {
      id: row.id,
      name: row.name,
      domain: row.domain,
      count: row.count,
      category: row.category,
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
