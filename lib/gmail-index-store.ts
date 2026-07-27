import { and, eq, inArray } from "drizzle-orm";
import { getD1, getDb } from "@/db";
import { indexedMessages } from "@/db/schema";
import { indexedMessageValues, type GmailMessage } from "@/lib/gmail-index";

const DELETE_CHUNK_SIZE = 80;
const INSERT_CHUNK_SIZE = 7;

export async function deleteIndexedMessageIds(
  accountEmail: string,
  messageIds: string[],
): Promise<void> {
  const uniqueIds = [...new Set(messageIds)].filter(Boolean);
  const db = getDb();
  for (let index = 0; index < uniqueIds.length; index += DELETE_CHUNK_SIZE) {
    await db
      .delete(indexedMessages)
      .where(and(
        eq(indexedMessages.accountEmail, accountEmail),
        inArray(indexedMessages.messageId, uniqueIds.slice(index, index + DELETE_CHUNK_SIZE)),
      ));
  }
}

export async function setIndexedMessagesTrashed(
  accountEmail: string,
  messageIds: string[],
  trashed: boolean,
): Promise<void> {
  const uniqueIds = [...new Set(messageIds)].filter(Boolean);
  const db = getD1();
  for (let index = 0; index < uniqueIds.length; index += DELETE_CHUNK_SIZE) {
    const chunk = uniqueIds.slice(index, index + DELETE_CHUNK_SIZE);
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
