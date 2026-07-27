import { getD1 } from "@/db";
import { authorizedGoogleSession, jsonWithSession } from "@/lib/google";
import type { MessageCategory } from "@/lib/gmail-index";

type PreferencePayload = {
  senderEmail?: string;
  category?: MessageCategory | null;
  safe?: boolean;
};

const categories = new Set<MessageCategory>([
  "Publicidad",
  "Newsletters",
  "Notificaciones",
]);

export async function POST(request: Request) {
  const { session, setCookie } = await authorizedGoogleSession(request);
  if (!session) return jsonWithSession({ error: "Gmail no está conectado." }, 401);

  const payload = (await request.json()) as PreferencePayload;
  const senderEmail = payload.senderEmail?.trim().toLowerCase() ?? "";
  if (!/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(senderEmail)) {
    return jsonWithSession({ error: "El remitente no es válido." }, 400, setCookie);
  }
  const category = payload.category ?? null;
  if (category !== null && !categories.has(category)) {
    return jsonWithSession({ error: "La categoría no es válida." }, 400, setCookie);
  }
  const safe = Boolean(payload.safe);
  const db = getD1();
  if (!category && !safe) {
    await db
      .prepare(`DELETE FROM sender_preferences
        WHERE account_email = ? AND sender_email = ?`)
      .bind(session.email, senderEmail)
      .run();
  } else {
    await db
      .prepare(`INSERT INTO sender_preferences
        (id, account_email, sender_email, manual_category, is_safe, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(account_email, sender_email) DO UPDATE SET
          manual_category = excluded.manual_category,
          is_safe = excluded.is_safe,
          updated_at = excluded.updated_at`)
      .bind(
        `${session.email}:${senderEmail}`,
        session.email,
        senderEmail,
        category,
        safe ? 1 : 0,
        Date.now(),
      )
      .run();
  }

  return jsonWithSession(
    { senderEmail, category, safe },
    200,
    setCookie,
  );
}
