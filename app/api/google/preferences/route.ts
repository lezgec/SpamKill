import { execute } from "@/db/mysql";
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
  if (!category && !safe) {
    await execute(
      `DELETE FROM sender_preferences
       WHERE account_email = ? AND sender_email = ?`,
      [session.email, senderEmail],
    );
  } else {
    await execute(
      `INSERT INTO sender_preferences
       (id, account_email, sender_email, manual_category, is_safe, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         manual_category = VALUES(manual_category),
         is_safe = VALUES(is_safe),
         updated_at = VALUES(updated_at)`,
      [
        `${session.email}:${senderEmail}`,
        session.email,
        senderEmail,
        category,
        safe ? 1 : 0,
        Date.now(),
      ],
    );
  }

  return jsonWithSession(
    { senderEmail, category, safe },
    200,
    setCookie,
  );
}
