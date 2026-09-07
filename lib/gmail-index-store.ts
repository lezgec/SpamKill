import { execute } from "@/db/mysql";
import { indexedMessageValues, type GmailMessage } from "@/lib/gmail-index";

const BATCH_SIZE = 20;

function placeholders(size: number): string {
  return Array.from({ length: size }, () => "?").join(", ");
}

export async function deleteIndexedMessageIds(
  accountEmail: string,
  messageIds: string[],
): Promise<void> {
  const uniqueIds = [...new Set(messageIds)].filter(Boolean);
  for (let index = 0; index < uniqueIds.length; index += BATCH_SIZE) {
    const ids = uniqueIds.slice(index, index + BATCH_SIZE);
    await execute(
      `DELETE FROM indexed_messages
       WHERE account_email = ? AND message_id IN (${placeholders(ids.length)})`,
      [accountEmail, ...ids],
    );
  }
}

export async function setIndexedMessagesTrashed(
  accountEmail: string,
  messageIds: string[],
  trashed: boolean,
): Promise<void> {
  const uniqueIds = [...new Set(messageIds)].filter(Boolean);
  for (let index = 0; index < uniqueIds.length; index += BATCH_SIZE) {
    const ids = uniqueIds.slice(index, index + BATCH_SIZE);
    await execute(
      `UPDATE indexed_messages SET trashed_at = ?
       WHERE account_email = ? AND message_id IN (${placeholders(ids.length)})`,
      [trashed ? Date.now() : null, accountEmail, ...ids],
    );
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

  for (let index = 0; index < values.length; index += 7) {
    const chunk = values.slice(index, index + 7);
    const rowPlaceholders = chunk.map(() => "(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").join(", ");
    const params = chunk.flatMap((value) => [
      value.id,
      value.accountEmail,
      value.messageId,
      value.senderEmail,
      value.senderName,
      value.senderDomain,
      value.subject,
      value.snippet,
      value.category,
      value.classificationReason,
      value.classificationConfidence,
      value.receivedAt,
      value.hasUnsubscribe ? 1 : 0,
      value.mailboxFolder,
      value.indexedAt,
      null,
    ]);
    await execute(
      `INSERT INTO indexed_messages
       (id, account_email, message_id, sender_email, sender_name, sender_domain,
        subject, snippet, category, classification_reason, classification_confidence,
        received_at, has_unsubscribe, mailbox_folder, indexed_at, trashed_at)
       VALUES ${rowPlaceholders}`,
      params,
    );
  }
  return values.length;
}
