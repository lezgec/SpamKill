import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { unsubscribeHistory } from "@/db/schema";
import { authorizedOutlookSession, outlookAccountKey } from "@/lib/outlook";
import { jsonWithSession } from "@/lib/google";

export async function GET(request: Request) {
  const { session, setCookie } = await authorizedOutlookSession(request);
  if (!session) return jsonWithSession({ error: "Outlook no está conectado." }, 401);
  const rows = await getDb().select().from(unsubscribeHistory)
    .where(eq(unsubscribeHistory.accountEmail, outlookAccountKey(session.email)))
    .orderBy(desc(unsubscribeHistory.requestedAt)).limit(100);
  return jsonWithSession({ history: rows }, 200, setCookie);
}
