import { query } from "@/db/mysql";
import { authorizedGoogleSession, jsonWithSession } from "@/lib/google";
import { verifyUnsubscribeHistory } from "@/lib/unsubscribe-history";

export async function GET(request: Request) {
  const { session, setCookie } = await authorizedGoogleSession(request);
  if (!session) return jsonWithSession({ error: "Gmail no está conectado." }, 401);

  try {
    await verifyUnsubscribeHistory(session.email);
    const rows = await query(
      `SELECT id, account_email AS accountEmail, provider,
              sender_email AS senderEmail, sender_name AS senderName,
              sender_domain AS senderDomain, status,
              requested_at AS requestedAt, updated_at AS updatedAt,
              last_seen_at AS lastSeenAt, messages_trashed AS messagesTrashed,
              manual_url AS manualUrl
       FROM unsubscribe_history
       WHERE account_email = ?
       ORDER BY requested_at DESC
       LIMIT 100`,
      [session.email],
    );
    return jsonWithSession({ history: rows }, 200, setCookie);
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo cargar el historial.";
    return jsonWithSession({ error: message }, 500, setCookie);
  }
}
