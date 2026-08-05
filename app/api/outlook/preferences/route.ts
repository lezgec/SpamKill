import { getDb } from "@/db";
import { senderPreferences } from "@/db/schema";
import { authorizedOutlookSession, outlookAccountKey } from "@/lib/outlook";
import { jsonWithSession } from "@/lib/google";

type PreferencePayload = {
  senderEmail?: string;
  category?: "Publicidad" | "Newsletters" | "Notificaciones" | null;
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
  await getDb().insert(senderPreferences).values({
    id: `${accountEmail}:${senderEmail}`,
    accountEmail,
    senderEmail,
    manualCategory: payload.category ?? null,
    isSafe: Boolean(payload.safe),
    updatedAt: now,
  }).onConflictDoUpdate({
    target: [senderPreferences.accountEmail, senderPreferences.senderEmail],
    set: { manualCategory: payload.category ?? null, isSafe: Boolean(payload.safe), updatedAt: now },
  });
  return jsonWithSession({ saved: true }, 200, setCookie);
}
