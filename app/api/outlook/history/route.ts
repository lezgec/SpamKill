import { query } from "@/db/mysql";
import { authorizedOutlookSession, outlookAccountKey } from "@/lib/outlook";
import { jsonWithSession } from "@/lib/google";

export async function GET(request: Request) {
  const { session, setCookie } = await authorizedOutlookSession(request);
  if (!session) return jsonWithSession({ error: "Outlook no está conectado." }, 401);
  const rows = await query(
    `SELECT id, account_email AS accountEmail, provider,
            sender_email AS senderEmail, sender_name AS senderName,
            sender_domain AS senderDomain, status,
            requested_at AS requestedAt, updated_at AS updatedAt,
            last_seen_at AS lastSeenAt, messages_trashed AS messagesTrashed,
            manual_url AS manualUrl
     FROM unsubscribe_history
     WHERE account_email = ?
     ORDER BY requested_at DESC`,
    [outlookAccountKey(session.email)],
  );
  return jsonWithSession({ history: rows }, 200, setCookie);
}
