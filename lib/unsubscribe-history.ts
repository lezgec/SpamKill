import { and, eq, max } from "drizzle-orm";
import { getDb } from "@/db";
import { indexedMessages, unsubscribeHistory } from "@/db/schema";

export async function verifyUnsubscribeHistory(accountEmail: string): Promise<void> {
  const db = getDb();
  const history = await db
    .select()
    .from(unsubscribeHistory)
    .where(eq(unsubscribeHistory.accountEmail, accountEmail));
  if (!history.length) return;

  const latestMessages = await db
    .select({
      senderEmail: indexedMessages.senderEmail,
      latestAt: max(indexedMessages.receivedAt),
    })
    .from(indexedMessages)
    .where(eq(indexedMessages.accountEmail, accountEmail))
    .groupBy(indexedMessages.senderEmail);
  const latestBySender = new Map(
    latestMessages.map((item) => [item.senderEmail, item.latestAt ?? 0]),
  );
  const now = Date.now();

  for (const record of history) {
    const latestAt = latestBySender.get(record.senderEmail) ?? 0;
    let nextStatus = record.status;
    let lastSeenAt = record.lastSeenAt;
    if (latestAt > record.requestedAt + 5 * 60 * 1000) {
      nextStatus = "failed";
      lastSeenAt = latestAt;
    } else if (
      record.status === "verifying" &&
      now - record.requestedAt >= 7 * 24 * 60 * 60 * 1000
    ) {
      nextStatus = "confirmed";
    }
    if (nextStatus !== record.status || lastSeenAt !== record.lastSeenAt) {
      await db
        .update(unsubscribeHistory)
        .set({ status: nextStatus, lastSeenAt, updatedAt: now })
        .where(and(
          eq(unsubscribeHistory.accountEmail, accountEmail),
          eq(unsubscribeHistory.senderEmail, record.senderEmail),
        ));
    }
  }
}
