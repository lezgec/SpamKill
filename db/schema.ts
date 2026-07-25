import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

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

export type UnsubscribeHistory = typeof unsubscribeHistory.$inferSelect;
