import { execute, query } from "@/db/mysql";
import type { RowDataPacket } from "mysql2/promise";
import type { GmailMessage } from "@/lib/gmail-index";
import {
  deleteIndexedMessageIds,
  replaceIndexedMessages,
} from "@/lib/gmail-index-store";
import {
  authorizedGoogleSession,
  googleApiError,
  jsonWithSession,
} from "@/lib/google";
import { verifyUnsubscribeHistory } from "@/lib/unsubscribe-history";

type HistoryMessage = { message?: { id?: string } };
type HistoryRecord = {
  messages?: Array<{ id?: string }>;
  messagesAdded?: HistoryMessage[];
  messagesDeleted?: HistoryMessage[];
  labelsAdded?: HistoryMessage[];
  labelsRemoved?: HistoryMessage[];
};
type HistoryPage = {
  history?: HistoryRecord[];
  historyId?: string;
  nextPageToken?: string;
};
type SyncStateRow = RowDataPacket & { historyId: string | null };

const excludedLabels = new Set(["SENT", "DRAFT"]);

function touchedIds(page: HistoryPage): string[] {
  const ids = new Set<string>();
  for (const record of page.history ?? []) {
    let foundSpecificChange = false;
    for (const changes of [
      record.messagesAdded,
      record.messagesDeleted,
      record.labelsAdded,
      record.labelsRemoved,
    ]) {
      for (const change of changes ?? []) {
        if (change.message?.id) ids.add(change.message.id);
        foundSpecificChange = true;
      }
    }
    if (!foundSpecificChange) {
      for (const message of record.messages ?? []) {
        if (message.id) ids.add(message.id);
      }
    }
  }
  return [...ids];
}

export async function POST(request: Request) {
  const { session, setCookie } = await authorizedGoogleSession(request);
  if (!session) return jsonWithSession({ error: "Gmail no está conectado." }, 401);

  const [state] = await query<SyncStateRow[]>(
    `SELECT history_id AS historyId FROM gmail_sync_state WHERE account_email = ? LIMIT 1`,
    [session.email],
  );
  if (!state?.historyId) {
    return jsonWithSession({ needsFullSync: true, added: 0, removed: 0 }, 200, setCookie);
  }

  const auth = { Authorization: `Bearer ${session.accessToken}` };
  const changedIds = new Set<string>();
  let pageToken: string | null = null;
  let latestHistoryId = state.historyId;
  do {
    const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/history");
    url.searchParams.set("startHistoryId", state.historyId);
    url.searchParams.set("maxResults", "500");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await fetch(url, { headers: auth });
    if (response.status === 404) {
      return jsonWithSession({ needsFullSync: true, added: 0, removed: 0 }, 200, setCookie);
    }
    if (response.status === 429) {
      return jsonWithSession(
        { error: "Gmail solicita una pausa antes de sincronizar.", retryAfter: 60 },
        429,
        setCookie,
      );
    }
    if (!response.ok) {
      return jsonWithSession(
        { error: await googleApiError(response, "No se pudieron sincronizar los cambios de Gmail") },
        502,
        setCookie,
      );
    }
    const page = (await response.json()) as HistoryPage;
    for (const id of touchedIds(page)) changedIds.add(id);
    latestHistoryId = page.historyId ?? latestHistoryId;
    pageToken = page.nextPageToken ?? null;
  } while (pageToken);

  const activeMessages: GmailMessage[] = [];
  const removedIds: string[] = [];
  const ids = [...changedIds];
  for (let index = 0; index < ids.length; index += 10) {
    const batch = ids.slice(index, index + 10);
    const results = await Promise.all(batch.map(async (id) => {
      const url = new URL(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}`);
      url.searchParams.set("format", "metadata");
      for (const name of ["From", "Subject", "List-Unsubscribe", "Precedence"]) {
        url.searchParams.append("metadataHeaders", name);
      }
      const response = await fetch(url, { headers: auth });
      return {
        id,
        message: response.ok ? (await response.json()) as GmailMessage : null,
        missing: response.status === 404,
        rateLimited: response.status === 429,
        failed: !response.ok && response.status !== 404 && response.status !== 429,
      };
    }));
    if (results.some((item) => item.rateLimited)) {
      return jsonWithSession(
        { error: "Gmail solicita una pausa antes de sincronizar.", retryAfter: 60 },
        429,
        setCookie,
      );
    }
    if (results.some((item) => item.failed)) {
      return jsonWithSession(
        { error: "Gmail no permitió leer algunos mensajes modificados." },
        502,
        setCookie,
      );
    }
    for (const result of results) {
      if (result.missing || !result.message) {
        removedIds.push(result.id);
        continue;
      }
      if ((result.message.labelIds ?? []).some((label) => excludedLabels.has(label))) {
        removedIds.push(result.id);
      } else {
        activeMessages.push(result.message);
      }
    }
  }

  await deleteIndexedMessageIds(session.email, removedIds);
  const added = await replaceIndexedMessages(session.email, activeMessages);
  const syncedAt = Date.now();
  await execute(
    `UPDATE gmail_sync_state
        SET history_id = ?, last_incremental_sync_at = ?, updated_at = ?
      WHERE account_email = ?`,
    [latestHistoryId, syncedAt, syncedAt, session.email],
  );
  await verifyUnsubscribeHistory(session.email);

  return jsonWithSession(
    {
      needsFullSync: false,
      added,
      removed: removedIds.length,
      syncedAt,
    },
    200,
    setCookie,
  );
}
