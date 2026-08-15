import { execute, query } from "@/db/mysql";
import type { RowDataPacket } from "mysql2/promise";

type HistoryRow = RowDataPacket & {
  sender_email: string;
  requested_at: number;
  status: "verifying" | "confirmed" | "manual" | "failed";
  last_seen_at: number | null;
};

type LatestMessageRow = RowDataPacket & { sender_email: string; latest_at: number | null };

export async function verifyUnsubscribeHistory(accountEmail: string): Promise<void> {
  const history = await query<HistoryRow[]>(
    `SELECT sender_email, requested_at, status, last_seen_at
     FROM unsubscribe_history WHERE account_email = ?`,
    [accountEmail],
  );
  if (!history.length) return;

  const latestMessages = await query<LatestMessageRow[]>(
    `SELECT sender_email, MAX(received_at) AS latest_at
     FROM indexed_messages WHERE account_email = ?
     GROUP BY sender_email`,
    [accountEmail],
  );
  const latestBySender = new Map(
    latestMessages.map((item) => [item.sender_email, Number(item.latest_at ?? 0)]),
  );
  const now = Date.now();

  for (const record of history) {
    const latestAt = latestBySender.get(record.sender_email) ?? 0;
    let nextStatus = record.status;
    let lastSeenAt = record.last_seen_at;
    if (latestAt > record.requested_at + 5 * 60 * 1000) {
      nextStatus = "failed";
      lastSeenAt = latestAt;
    } else if (
      record.status === "verifying" &&
      now - record.requested_at >= 7 * 24 * 60 * 60 * 1000
    ) {
      nextStatus = "confirmed";
    }
    if (nextStatus !== record.status || lastSeenAt !== record.last_seen_at) {
      await execute(
        `UPDATE unsubscribe_history
         SET status = ?, last_seen_at = ?, updated_at = ?
         WHERE account_email = ? AND sender_email = ?`,
        [nextStatus, lastSeenAt, now, accountEmail, record.sender_email],
      );
    }
  }
}
