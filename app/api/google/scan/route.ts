import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { gmailSyncState } from "@/db/schema";
import {
  classificationFor,
  classificationReasonText,
  messageTimestamp,
  gmailHeader,
  senderFrom,
  type GmailMessage,
} from "@/lib/gmail-index";
import { replaceIndexedMessages } from "@/lib/gmail-index-store";
import { verifyUnsubscribeHistory } from "@/lib/unsubscribe-history";
import {
  authorizedGoogleSession,
  buildMailboxQuery,
  googleApiError,
  jsonWithSession,
  rangeStartTimestamp,
  type ScanRange,
} from "@/lib/google";

type SenderGroup = {
  id: string;
  name: string;
  domain: string;
  count: number;
  category: "Publicidad" | "Newsletters" | "Notificaciones";
  detectedCategory: "Publicidad" | "Newsletters" | "Notificaciones";
  detectedReason: string;
  classificationReason: string;
  confidence: "high" | "medium" | "low";
  doubtful: boolean;
  corrected: boolean;
  safe: boolean;
  color: string;
  initials: string;
  last: string;
  unsub: boolean;
  primaryMessageId: string;
  latestAt: number;
};

const palette = ["#f2612f", "#7b61ff", "#1676b7", "#e74334", "#111827", "#ef9d24"];

function formatDate(internalDate?: string): string {
  const timestamp = messageTimestamp(internalDate);
  if (!timestamp) return "—";
  if (!internalDate) return "—";
  return new Intl.DateTimeFormat("es", { day: "numeric", month: "short" }).format(
    new Date(timestamp),
  );
}

export async function GET(request: Request) {
  const { session, setCookie } = await authorizedGoogleSession(request);
  if (!session) return jsonWithSession({ error: "Gmail no está conectado." }, 401);

  const auth = { Authorization: `Bearer ${session.accessToken}` };
  const requestUrl = new URL(request.url);
  const rangeValue = requestUrl.searchParams.get("range") ?? "all";
  const range = (["all", "30d", "90d", "1y", "custom"].includes(rangeValue)
    ? rangeValue
    : "all") as ScanRange;
  let query: string;
  try {
    query = buildMailboxQuery({
      range,
      after: requestUrl.searchParams.get("after"),
      before: requestUrl.searchParams.get("before"),
    });
  } catch (error) {
    return jsonWithSession(
      { error: error instanceof Error ? error.message : "El intervalo no es válido." },
      400,
      setCookie,
    );
  }

  const pageToken = requestUrl.searchParams.get("pageToken");
  let syncStartHistoryId = requestUrl.searchParams.get("syncStartHistoryId");
  if (!syncStartHistoryId || !/^\d+$/.test(syncStartHistoryId)) {
    const profileResponse = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/profile",
      { headers: auth },
    );
    if (profileResponse.status === 429) {
      return jsonWithSession(
        { error: "Gmail alcanzó temporalmente su cuota por usuario.", retryAfter: 60 },
        429,
        setCookie,
      );
    }
    if (profileResponse.ok) {
      const profile = (await profileResponse.json()) as { historyId?: string };
      syncStartHistoryId = profile.historyId ?? null;
    }
  }

  const listUrl = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  listUrl.searchParams.set("maxResults", "100");
  listUrl.searchParams.set("q", query);
  if (pageToken) listUrl.searchParams.set("pageToken", pageToken);
  const listResponse = await fetch(listUrl, { headers: auth });
  if (!listResponse.ok) {
    if (listResponse.status === 429) {
      return jsonWithSession(
        { error: "Gmail alcanzó temporalmente su cuota por usuario.", retryAfter: 60 },
        429,
        setCookie,
      );
    }
    return jsonWithSession(
      { error: await googleApiError(listResponse, "No se pudieron consultar los mensajes de Gmail") },
      502,
      setCookie,
    );
  }
  const list = (await listResponse.json()) as {
    messages?: Array<{ id: string }>;
    nextPageToken?: string;
    resultSizeEstimate?: number;
  };
  const ids = list.messages ?? [];
  const messages: GmailMessage[] = [];

  for (let index = 0; index < ids.length; index += 15) {
    const batch = ids.slice(index, index + 15);
    const results = await Promise.all(batch.map(async ({ id }) => {
      const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}`);
      url.searchParams.set("format", "metadata");
      for (const name of [
        "From",
        "Subject",
        "List-Unsubscribe",
        "List-Unsubscribe-Post",
        "Precedence",
      ]) url.searchParams.append("metadataHeaders", name);
      const response = await fetch(url, { headers: auth });
      return {
        message: response.ok ? (await response.json()) as GmailMessage : null,
        rateLimited: response.status === 429,
      };
    }));
    if (results.some((item) => item.rateLimited)) {
      return jsonWithSession(
        { error: "Gmail alcanzó temporalmente su cuota por usuario.", retryAfter: 60 },
        429,
        setCookie,
      );
    }
    messages.push(...results
      .map((item) => item.message)
      .filter((item): item is GmailMessage => Boolean(item)));
  }

  await replaceIndexedMessages(session.email, messages);

  const grouped = new Map<string, SenderGroup>();
  for (const message of messages) {
    const fromValue = gmailHeader(message, "From");
    if (!fromValue) continue;
    const sender = senderFrom(fromValue);
    const existing = grouped.get(sender.email);
    if (existing) {
      existing.count += 1;
      existing.unsub ||= Boolean(gmailHeader(message, "List-Unsubscribe"));
      const receivedAt = Number(message.internalDate ?? 0);
      if (receivedAt > existing.latestAt) {
        existing.latestAt = receivedAt;
        existing.last = formatDate(message.internalDate);
        existing.primaryMessageId = message.id;
      }
      continue;
    }
    const domain = sender.email.split("@")[1] ?? sender.email;
    const position = grouped.size;
    const classification = classificationFor(message, fromValue);
    const classificationReason = classificationReasonText(classification.reason);
    grouped.set(sender.email, {
      id: sender.email,
      name: sender.name,
      domain,
      count: 1,
      category: classification.category,
      detectedCategory: classification.category,
      detectedReason: classificationReason,
      classificationReason,
      confidence: classification.confidence,
      doubtful: classification.confidence === "low",
      corrected: false,
      safe: false,
      color: palette[position % palette.length],
      initials: sender.name.slice(0, 2).toUpperCase(),
      last: formatDate(message.internalDate),
      unsub: Boolean(gmailHeader(message, "List-Unsubscribe")),
      primaryMessageId: message.id,
      latestAt: Number(message.internalDate ?? 0),
    });
  }

  if (!list.nextPageToken) {
    const db = getDb();
    const now = Date.now();
    const [existingState] = await db
      .select()
      .from(gmailSyncState)
      .where(eq(gmailSyncState.accountEmail, session.email))
      .limit(1);
    const requestedCoverage = rangeStartTimestamp(
      range,
      requestUrl.searchParams.get("after"),
    );
    const coverageStartAt = existingState?.coverageStartAt == null
      ? requestedCoverage
      : Math.min(existingState.coverageStartAt, requestedCoverage);
    const state = {
      accountEmail: session.email,
      historyId: syncStartHistoryId ?? existingState?.historyId ?? null,
      coverageStartAt,
      lastFullScanAt: now,
      lastIncrementalSyncAt: existingState?.lastIncrementalSyncAt ?? null,
      updatedAt: now,
    };
    await db
      .insert(gmailSyncState)
      .values(state)
      .onConflictDoUpdate({
        target: gmailSyncState.accountEmail,
        set: {
          historyId: state.historyId,
          coverageStartAt: state.coverageStartAt,
          lastFullScanAt: state.lastFullScanAt,
          updatedAt: state.updatedAt,
        },
      });
    await verifyUnsubscribeHistory(session.email);
  }

  return jsonWithSession(
    {
      email: session.email,
      groups: [...grouped.values()].sort((a, b) => b.count - a.count),
      scanned: messages.length,
      nextPageToken: list.nextPageToken ?? null,
      resultSizeEstimate: list.resultSizeEstimate ?? messages.length,
      syncStartHistoryId,
    },
    200,
    setCookie,
  );
}
