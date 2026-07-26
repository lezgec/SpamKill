import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const unsubscribeHistory = sqliteTable(
  "unsubscribe_history",
  {
    id: text("id").primaryKey(),
    accountEmail: text("account_email").notNull(),
    provider: text("provider").notNull().default("gmail"),
    senderEmail: text("sender_email").notNull(),
    senderName: text("sender_name").notNull(),
    senderDomain: text("sender_domain").notNull(),
    status: text("status", {
      enum: ["verifying", "confirmed", "manual", "failed"],
    }).notNull(),
    requestedAt: integer("requested_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    lastSeenAt: integer("last_seen_at"),
    messagesTrashed: integer("messages_trashed").notNull().default(0),
  },
  (table) => [
    uniqueIndex("unsubscribe_account_sender_idx").on(
      table.accountEmail,
      table.senderEmail,
    ),
  ],
);

export const indexedMessages = sqliteTable(
  "indexed_messages",
  {
    id: text("id").primaryKey(),
    accountEmail: text("account_email").notNull(),
    messageId: text("message_id").notNull(),
    senderEmail: text("sender_email").notNull(),
    senderName: text("sender_name").notNull(),
    senderDomain: text("sender_domain").notNull(),
    subject: text("subject").notNull().default(""),
    snippet: text("snippet").notNull().default(""),
    category: text("category", {
      enum: ["Publicidad", "Newsletters", "Notificaciones"],
    }).notNull(),
    receivedAt: integer("received_at").notNull(),
    hasUnsubscribe: integer("has_unsubscribe", { mode: "boolean" })
      .notNull()
      .default(false),
    indexedAt: integer("indexed_at").notNull(),
  },
  (table) => [
    uniqueIndex("indexed_account_message_idx").on(table.accountEmail, table.messageId),
    uniqueIndex("indexed_account_sender_message_idx").on(
      table.accountEmail,
      table.senderEmail,
      table.messageId,
    ),
    index("indexed_account_received_idx").on(table.accountEmail, table.receivedAt),
  ],
);

export const gmailSyncState = sqliteTable("gmail_sync_state", {
  accountEmail: text("account_email").primaryKey(),
  historyId: text("history_id"),
  coverageStartAt: integer("coverage_start_at"),
  lastFullScanAt: integer("last_full_scan_at"),
  lastIncrementalSyncAt: integer("last_incremental_sync_at"),
  updatedAt: integer("updated_at").notNull(),
});

export type UnsubscribeHistory = typeof unsubscribeHistory.$inferSelect;
export type IndexedMessage = typeof indexedMessages.$inferSelect;
