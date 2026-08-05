import { getDb } from "@/db";
import { unsubscribeHistory } from "@/db/schema";
import {
  extractContentUnsubscribeFromText,
  extractHttpsUnsubscribe,
  extractManualUnsubscribeTarget,
  jsonWithSession,
  rangeStartTimestamp,
  type ScanRange,
} from "@/lib/google";
import {
  authorizedOutlookSession,
  outlookAccountKey,
  outlookGraphFetch,
} from "@/lib/outlook";
import { setIndexedMessagesTrashed } from "@/lib/gmail-index-store";

type ActionPayload = {
  action?: "unsubscribe" | "unsubscribe_and_trash" | "trash" | "restore";
  range?: ScanRange;
  after?: string;
  before?: string;
  groups?: Array<{
    id?: string;
    name?: string;
    domain?: string;
    primaryMessageId?: string;
    messageIds?: string[];
  }>;
};

type GraphMessage = {
  id: string;
  internetMessageHeaders?: Array<{ name: string; value: string }>;
  body?: { contentType?: string; content?: string };
};

function header(headers: Array<{ name: string; value: string }>, name: string): string {
  return headers.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function safeGraphId(value: string): boolean {
  return value.length > 0 && value.length < 600 && !/[\u0000-\u001f]/.test(value);
}

async function findMessageIds(
  session: Parameters<typeof outlookGraphFetch>[0],
  sender: string,
  range: ScanRange,
  after?: string,
  before?: string,
): Promise<string[]> {
  const conditions = [`from/emailAddress/address eq '${sender.replaceAll("'", "''")}'`, "isDraft eq false"];
  const start = rangeStartTimestamp(range, after);
  if (start > 0) conditions.push(`receivedDateTime ge ${new Date(start).toISOString()}`);
  if (range === "custom" && before) {
    const end = new Date(`${before}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    conditions.push(`receivedDateTime lt ${end.toISOString()}`);
  }
  const ids: string[] = [];
  let url: string | null = `/me/messages?${new URLSearchParams({
    "$top": "100",
    "$select": "id",
    "$filter": conditions.join(" and "),
  }).toString()}`;
  while (url && ids.length < 10_000) {
    const response = await outlookGraphFetch(session, url);
    if (!response.ok) break;
    const page = (await response.json()) as { value?: Array<{ id?: string }>; "@odata.nextLink"?: string };
    ids.push(...(page.value ?? []).map((item) => item.id).filter((id): id is string => Boolean(id)));
    url = page["@odata.nextLink"] ?? null;
    if (url && !url.startsWith("https://graph.microsoft.com/")) break;
  }
  return ids;
}

async function moveMessages(session: Parameters<typeof outlookGraphFetch>[0], ids: string[], destinationId: string): Promise<string[]> {
  const moved: string[] = [];
  for (let index = 0; index < ids.length; index += 10) {
    const batch = ids.slice(index, index + 10);
    const results = await Promise.all(batch.map(async (id) => {
      const response = await outlookGraphFetch(session, `/me/messages/${encodeURIComponent(id)}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ destinationId }),
      });
      return response.ok;
    }));
    batch.forEach((id, offset) => { if (results[offset]) moved.push(id); });
  }
  return moved;
}

export async function POST(request: Request) {
  const { session, setCookie } = await authorizedOutlookSession(request);
  if (!session) return jsonWithSession({ error: "Outlook no está conectado." }, 401);
  const payload = (await request.json()) as ActionPayload;
  const groups = (payload.groups ?? []).slice(0, 25);
  if (!groups.length || !payload.action) return jsonWithSession({ error: "No hay remitentes seleccionados." }, 400, setCookie);

  const accountEmail = outlookAccountKey(session.email);
  let unsubscribed = 0;
  let manual = 0;
  let trashed = 0;
  let restored = 0;
  const trashedGroups: Array<{ id: string; messageIds: string[] }> = [];

  for (const group of groups) {
    let groupUnsubscribed = false;
    let groupManual = false;
    let groupManualUrl: string | null = null;
    if ((payload.action === "unsubscribe" || payload.action === "unsubscribe_and_trash") && group.primaryMessageId && safeGraphId(group.primaryMessageId)) {
      const url = `/me/messages/${encodeURIComponent(group.primaryMessageId)}?$select=id,internetMessageHeaders,body`;
      const response = await outlookGraphFetch(session, url, { headers: { Prefer: 'outlook.body-content-type="html"' } });
      if (response.ok) {
        const message = (await response.json()) as GraphMessage;
        const headers = message.internetMessageHeaders ?? [];
        const unsubscribeHeader = header(headers, "List-Unsubscribe");
        const unsubscribeUrl = extractHttpsUnsubscribe(unsubscribeHeader);
        const manualUrl = extractManualUnsubscribeTarget(unsubscribeHeader)
          ?? extractContentUnsubscribeFromText(
            message.body?.contentType?.toLowerCase() === "html" ? message.body.content ?? "" : "",
            message.body?.contentType?.toLowerCase() === "text" ? message.body.content ?? "" : "",
          );
        const oneClick = /List-Unsubscribe=One-Click/i.test(header(headers, "List-Unsubscribe-Post"));
        const dkimPassed = /dkim=pass/i.test(header(headers, "Authentication-Results"));
        if (oneClick && dkimPassed && unsubscribeUrl) {
          const unsubscribeResponse = await fetch(unsubscribeUrl, {
            method: "POST",
            redirect: "manual",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: "List-Unsubscribe=One-Click",
          });
          if (unsubscribeResponse.ok) {
            unsubscribed += 1;
            groupUnsubscribed = true;
          } else {
            manual += 1;
            groupManual = true;
            groupManualUrl = manualUrl;
          }
        } else {
          manual += 1;
          groupManual = true;
          groupManualUrl = manualUrl;
        }
      } else {
        manual += 1;
        groupManual = true;
      }
    } else if (payload.action === "unsubscribe" || payload.action === "unsubscribe_and_trash") {
      manual += 1;
      groupManual = true;
    }

    if ((payload.action === "unsubscribe_and_trash" || payload.action === "trash") && group.id) {
      const requestedIds = (group.messageIds ?? []).filter((id): id is string => safeGraphId(id));
      const ids = requestedIds.length ? [...new Set(requestedIds)] : await findMessageIds(session, group.id, payload.range ?? "all", payload.after, payload.before);
      const movedIds = await moveMessages(session, ids, "deleteditems");
      if (movedIds.length) {
        trashed += movedIds.length;
        await setIndexedMessagesTrashed(accountEmail, movedIds, true);
        trashedGroups.push({ id: group.id, messageIds: movedIds });
      }
    }

    if (payload.action === "restore") {
      const ids = [...new Set((group.messageIds ?? []).filter((id): id is string => safeGraphId(id)))];
      const restoredIds = await moveMessages(session, ids, "inbox");
      if (restoredIds.length) {
        restored += restoredIds.length;
        await setIndexedMessagesTrashed(accountEmail, restoredIds, false);
      }
    }

    if ((payload.action === "unsubscribe" || payload.action === "unsubscribe_and_trash") && group.id && group.name && group.domain) {
      const now = Date.now();
      const record = {
        id: `${accountEmail}:${group.id}`,
        accountEmail,
        provider: "outlook",
        senderEmail: group.id,
        senderName: group.name,
        senderDomain: group.domain,
        status: (groupUnsubscribed ? "verifying" : "manual") as "verifying" | "manual",
        requestedAt: now,
        updatedAt: now,
        lastSeenAt: null,
        messagesTrashed: trashedGroups.at(-1)?.id === group.id ? trashedGroups.at(-1)?.messageIds.length ?? 0 : 0,
        manualUrl: groupManualUrl,
      };
      await getDb().insert(unsubscribeHistory).values(record).onConflictDoUpdate({
        target: [unsubscribeHistory.accountEmail, unsubscribeHistory.senderEmail],
        set: {
          senderName: record.senderName,
          senderDomain: record.senderDomain,
          provider: record.provider,
          status: groupManual ? "manual" : record.status,
          requestedAt: now,
          updatedAt: now,
          lastSeenAt: null,
          messagesTrashed: record.messagesTrashed,
          manualUrl: record.manualUrl,
        },
      });
    }
  }
  return jsonWithSession({ unsubscribed, manual, trashed, restored, trashedGroups }, 200, setCookie);
}
