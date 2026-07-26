import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { unsubscribeHistory } from "@/db/schema";
import { authorizedGoogleSession, jsonWithSession } from "@/lib/google";
import { verifyUnsubscribeHistory } from "@/lib/unsubscribe-history";

export async function GET(request: Request) {
  const { session, setCookie } = await authorizedGoogleSession(request);
  if (!session) return jsonWithSession({ error: "Gmail no está conectado." }, 401);

  try {
    await verifyUnsubscribeHistory(session.email);
    const rows = await getDb()
      .select()
      .from(unsubscribeHistory)
      .where(eq(unsubscribeHistory.accountEmail, session.email))
      .orderBy(desc(unsubscribeHistory.requestedAt))
      .limit(100);
    return jsonWithSession({ history: rows }, 200, setCookie);
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo cargar el historial.";
    return jsonWithSession({ error: message }, 500, setCookie);
  }
}
