import { getD1, getDb } from "@/db";
import { indexedMessages } from "@/db/schema";
import { indexedMessageValues, type GmailMessage } from "@/lib/gmail-index";

// Keep each D1 batch small and use one prepared statement per message. Outlook
// Graph IDs are long; a single IN (...) statement can become brittle even when
// its parameter count is below D1's documented limit.
const DELETE_BATCH_SIZE = 20;
const INSERT_CHUNK_SIZE = 7;

export async function deleteIndexedMessageIds(
  accountEmail: string,
  messageIds: string[],
): Promise<void> {
  const uniqueIds = [...new Set(messageIds)].filter(Boolean);
  const db = getD1();
  for (let index = 0; index < uniqueIds.length; index += DELETE_BATCH_SIZE) {
    const chunk = uniqueIds.slice(index, index + DELETE_BATCH_SIZE);
    await db.batch(chunk.map((messageId) => db
      .prepare(`DELETE FROM indexed_messages
        WHERE account_email = ? AND message_id = ?`)
      .bind(accountEmail, messageId)));
  }
}

export async function setIndexedMessagesTrashed(
  accountEmail: string,
  messageIds: string[],
  trashed: boolean,
): Promise<void> {
  const uniqueIds = [...new Set(messageIds)].filter(Boolean);
  const db = getD1();
  for (let index = 0; index < uniqueIds.length; index += DELETE_BATCH_SIZE) {
    const chunk = uniqueIds.slice(index, index + DELETE_BATCH_SIZE);
    await db.batch(chunk.map((messageId) => db
      .prepare(`UPDATE indexed_messages
        SET trashed_at = ?
        WHERE account_email = ? AND message_id = ?`)
      .bind(trashed ? Date.now() : null, accountEmail, messageId)));
  }
}

export async function replaceIndexedMessages(
  accountEmail: string,
  messages: GmailMessage[],
): Promise<number> {
  await deleteIndexedMessageIds(accountEmail, messages.map((message) => message.id));
  const values = messages
    .map((message) => indexedMessageValues(accountEmail, message))
    .filter((value): value is NonNullable<typeof value> => Boolean(value));
  const db = getDb();
  for (let index = 0; index < values.length; index += INSERT_CHUNK_SIZE) {
    await db
      .insert(indexedMessages)
      .values(values.slice(index, index + INSERT_CHUNK_SIZE));
  }
  return values.length;
}
