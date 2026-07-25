import {
  authorizedGoogleSession,
  buildMailboxQuery,
  extractHttpsUnsubscribe,
  jsonWithSession,
  type ScanRange,
} from "@/lib/google";
import { getDb } from "@/db";
import { unsubscribeHistory } from "@/db/schema";

type ActionPayload = {
  action?: "unsubscribe" | "unsubscribe_and_trash" | "trash";
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

  for (const group of groups) {
    let groupUnsubscribed = false;
    let groupManual = false;
    if (payload.action !== "trash" && group.primaryMessageId) {
      const metadataUrl = new URL(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(group.primaryMessageId)}`,
      );
      metadataUrl.searchParams.set("format", "metadata");
      for (const name of [
        "List-Unsubscribe",
        "List-Unsubscribe-Post",
        "Authentication-Results",
      ]) metadataUrl.searchParams.append("metadataHeaders", name);
      const metadataResponse = await fetch(metadataUrl, { headers: auth });
      if (metadataResponse.ok) {
        const message = (await metadataResponse.json()) as {
          payload?: { headers?: GmailHeader[] };
        };
        const headers = message.payload?.headers ?? [];
        const oneClick = /List-Unsubscribe=One-Click/i.test(
          header(headers, "List-Unsubscribe-Post"),
        );
        const dkimPassed = /dkim=pass/i.test(header(headers, "Authentication-Results"));
        const unsubscribeUrl = extractHttpsUnsubscribe(header(headers, "List-Unsubscribe"));
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
          }
        } else {
          manual += 1;
          groupManual = true;
        }
      }
    }

    let groupTrashed = 0;
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
        ? [...new Set(requestedIds)].slice(0, 5000)
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
        }
      }
    }

    if (payload.action !== "trash" && group.id && group.name && group.domain) {
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
      };
      await getDb()
        .insert(unsubscribeHistory)
        .values(record)
        .onConflictDoUpdate({
          target: [unsubscribeHistory.accountEmail, unsubscribeHistory.senderEmail],
          set: {
            senderName: record.senderName,
            senderDomain: record.senderDomain,
            status: groupManual ? "manual" : record.status,
            requestedAt: now,
            updatedAt: now,
            lastSeenAt: null,
            messagesTrashed: record.messagesTrashed,
          },
        });
    }
  }

  return jsonWithSession({ unsubscribed, manual, trashed }, 200, setCookie);
}
