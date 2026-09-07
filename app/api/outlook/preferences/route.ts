import { execute } from "@/db/mysql";
import { authorizedOutlookSession, outlookAccountKey } from "@/lib/outlook";
import { jsonWithSession } from "@/lib/google";
import type { ManualCategory } from "@/lib/gmail-index";

type PreferencePayload = {
  senderEmail?: string;
  category?: ManualCategory | null;
  safe?: boolean;
};

export async function POST(request: Request) {
  const { session, setCookie } = await authorizedOutlookSession(request);
  if (!session) return jsonWithSession({ error: "Outlook no está conectado." }, 401);
  const payload = (await request.json()) as PreferencePayload;
  const senderEmail = payload.senderEmail?.trim().toLowerCase() ?? "";
  if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(senderEmail)) {
    return jsonWithSession({ error: "El remitente no es válido." }, 400, setCookie);
  }
  const accountEmail = outlookAccountKey(session.email);
  const now = Date.now();
  await execute(
    `INSERT INTO sender_preferences
     (id, account_email, sender_email, manual_category, is_safe, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       manual_category = VALUES(manual_category),
       is_safe = VALUES(is_safe),
       updated_at = VALUES(updated_at)`,
    [
      `${accountEmail}:${senderEmail}`,
      accountEmail,
      senderEmail,
      payload.category ?? null,
      payload.safe ? 1 : 0,
      now,
    ],
  );
  return jsonWithSession({ saved: true }, 200, setCookie);
}
