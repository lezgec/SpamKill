import {
  authorizedGoogleSession,
  extractHttpsUnsubscribe,
  jsonWithSession,
} from "@/lib/google";
import { getDb } from "@/db";
import { unsubscribeHistory } from "@/db/schema";

type ActionPayload = {
  action?: "unsubscribe" | "unsubscribe_and_trash";
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

export async function POST(request: Request) {
  const { session, setCookie } = await authorizedGoogleSession(request);
  if (!session) return jsonWithSession({ error: "Gmail no está conectado." }, 401);
  const payload = (await request.json()) as ActionPayload;
  const groups = (payload.groups ?? []).slice(0, 25);
  if (!groups.length || !payload.action) {
    return jsonWithSession({ error: "No hay remitentes seleccionados." }, 400, setCookie);
  }

  const auth = { Authorization: `Bearer ${session.accessToken}` };
  let unsubscribed = 0;
  let manual = 0;
  let trashed = 0;

  for (const group of groups) {
    let groupUnsubscribed = false;
    let groupManual = false;
    if (group.primaryMessageId) {
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
    if (payload.action === "unsubscribe_and_trash") {
      for (const messageId of (group.messageIds ?? []).slice(0, 500)) {
        const response = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/trash`,
          { method: "POST", headers: auth },
        );
        if (response.ok) {
          trashed += 1;
          groupTrashed += 1;
        }
      }
    }

    if (group.id && group.name && group.domain) {
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
