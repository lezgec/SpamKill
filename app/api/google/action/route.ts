import {
  authorizedGoogleSession,
  buildMailboxQuery,
  extractContentUnsubscribeTarget,
  extractHttpsUnsubscribe,
  extractManualUnsubscribeTarget,
  jsonWithSession,
  type GmailMimePart,
  type ScanRange,
} from "@/lib/google";
import { execute } from "@/db/mysql";
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

type GmailHeader = { name: string; value: string };

function header(headers: GmailHeader[], name: string): string {
  return headers.find((item) => item.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

async function findMessageIds(
  accessToken: string,
  query: string,
): Promise<string[]> {
  const ids: string[] = [];
  let pageToken: string | null = null;
  do {
    const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
    url.searchParams.set("maxResults", "500");
    url.searchParams.set("q", query);
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) break;
    const page = (await response.json()) as {
      messages?: Array<{ id: string }>;
      nextPageToken?: string;
    };
    ids.push(...(page.messages ?? []).map((message) => message.id));
    pageToken = page.nextPageToken ?? null;
  } while (pageToken);
  return ids;
}

export async function POST(request: Request) {
  const { session, setCookie } = await authorizedGoogleSession(request);
  if (!session) return jsonWithSession({ error: "Gmail no está conectado." }, 401);
  const payload = (await request.json()) as ActionPayload;
  const groups = (payload.groups ?? []).slice(0, 25);
  if (!groups.length || !payload.action) {
    return jsonWithSession({ error: "No hay remitentes seleccionados." }, 400, setCookie);
  }

  const auth = { Authorization: `Bearer ${session.accessToken}` };
  const range = payload.range ?? "all";
  let unsubscribed = 0;
  let manual = 0;
  let trashed = 0;
  let restored = 0;
  const trashedGroups: Array<{ id: string; messageIds: string[] }> = [];

  for (const group of groups) {
    let groupUnsubscribed = false;
    let groupManual = false;
    let groupManualUrl: string | null = null;
    if (
      (payload.action === "unsubscribe" || payload.action === "unsubscribe_and_trash") &&
      group.primaryMessageId
    ) {
      const metadataUrl = new URL(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(group.primaryMessageId)}`,
      );
      metadataUrl.searchParams.set("format", "full");
      const metadataResponse = await fetch(metadataUrl, { headers: auth });
      if (metadataResponse.ok) {
        const message = (await metadataResponse.json()) as {
          payload?: GmailMimePart;
        };
        const headers = message.payload?.headers ?? [];
        const oneClick = /List-Unsubscribe=One-Click/i.test(
          header(headers, "List-Unsubscribe-Post"),
        );
        const dkimPassed = /dkim=pass/i.test(header(headers, "Authentication-Results"));
        const unsubscribeHeader = header(headers, "List-Unsubscribe");
        const unsubscribeUrl = extractHttpsUnsubscribe(unsubscribeHeader);
        const manualUrl = extractManualUnsubscribeTarget(unsubscribeHeader)
          ?? extractContentUnsubscribeTarget(message.payload);
        if (oneClick && dkimPassed && unsubscribeUrl) {
          const response = await fetch(unsubscribeUrl, {
            method: "POST",
            redirect: "manual",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: "List-Unsubscribe=One-Click",
          });
          if (response.ok) {
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

    let groupTrashed = 0;
    const successfulTrashedIds: string[] = [];
    if (
      (payload.action === "unsubscribe_and_trash" || payload.action === "trash") &&
      group.id
    ) {
      let query: string;
      try {
        query = buildMailboxQuery({
          range,
          after: payload.after,
          before: payload.before,
          sender: group.id,
        });
      } catch (error) {
        return jsonWithSession(
          { error: error instanceof Error ? error.message : "El intervalo no es válido." },
          400,
          setCookie,
        );
      }
      const requestedIds = (group.messageIds ?? []).filter(
        (id): id is string => typeof id === "string" && /^[A-Za-z0-9_-]+$/.test(id),
      );
      const messageIds = requestedIds.length
        ? [...new Set(requestedIds)]
        : await findMessageIds(session.accessToken, query);
      for (let index = 0; index < messageIds.length; index += 1000) {
        const ids = messageIds.slice(index, index + 1000);
        const response = await fetch(
          "https://gmail.googleapis.com/gmail/v1/users/me/messages/batchModify",
          {
            method: "POST",
            headers: { ...auth, "Content-Type": "application/json" },
            body: JSON.stringify({
              ids,
              addLabelIds: ["TRASH"],
              removeLabelIds: ["INBOX"],
            }),
          },
        );
        if (response.ok) {
          trashed += ids.length;
          groupTrashed += ids.length;
          successfulTrashedIds.push(...ids);
          await setIndexedMessagesTrashed(session.email, ids, true);
        }
      }
      if (successfulTrashedIds.length) {
        trashedGroups.push({ id: group.id, messageIds: successfulTrashedIds });
      }
    }

    if (payload.action === "restore") {
      const messageIds = [...new Set((group.messageIds ?? []).filter(
        (id): id is string => typeof id === "string" && /^[A-Za-z0-9_-]+$/.test(id),
      ))];
      for (let index = 0; index < messageIds.length; index += 1000) {
        const ids = messageIds.slice(index, index + 1000);
        const response = await fetch(
          "https://gmail.googleapis.com/gmail/v1/users/me/messages/batchModify",
          {
            method: "POST",
            headers: { ...auth, "Content-Type": "application/json" },
            body: JSON.stringify({
              ids,
              addLabelIds: ["INBOX"],
              removeLabelIds: ["TRASH"],
            }),
          },
        );
        if (response.ok) {
          restored += ids.length;
          await setIndexedMessagesTrashed(session.email, ids, false);
        }
      }
    }

    if (
      (payload.action === "unsubscribe" || payload.action === "unsubscribe_and_trash") &&
      group.id && group.name && group.domain
    ) {
      const now = Date.now();
      const record = {
        id: `${session.email}:${group.id}`,
        accountEmail: session.email,
        provider: "gmail",
        senderEmail: group.id,
        senderName: group.name,
        senderDomain: group.domain,
        status: (groupUnsubscribed ? "verifying" : "manual") as "verifying" | "manual",
        requestedAt: now,
        updatedAt: now,
        lastSeenAt: null,
        messagesTrashed: groupTrashed,
        manualUrl: groupManualUrl,
      };
      await execute(
        `INSERT INTO unsubscribe_history
         (id, account_email, provider, sender_email, sender_name, sender_domain,
          status, requested_at, updated_at, last_seen_at, messages_trashed, manual_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
          sender_name = VALUES(sender_name), sender_domain = VALUES(sender_domain),
          status = VALUES(status), requested_at = VALUES(requested_at),
          updated_at = VALUES(updated_at), last_seen_at = VALUES(last_seen_at),
          messages_trashed = VALUES(messages_trashed), manual_url = VALUES(manual_url)`,
        [
          record.id, record.accountEmail, record.provider, record.senderEmail,
          record.senderName, record.senderDomain,
          groupManual ? "manual" : record.status, now, now, null,
          record.messagesTrashed, record.manualUrl,
        ],
      );
    }
  }

  return jsonWithSession(
    { unsubscribed, manual, trashed, restored, trashedGroups },
    200,
    setCookie,
  );
}
