import { execute } from "@/db/mysql";
import type { ManualCategory } from "@/lib/gmail-index";

export async function recordGlobalClassification(
  accountEmail: string,
  senderEmail: string,
  category: ManualCategory | null,
): Promise<void> {
  const normalizedSender = senderEmail.trim().toLowerCase();
  if (!normalizedSender) return;
  if (!category) {
    await execute(
      `DELETE FROM sender_classification_votes
       WHERE account_email = ? AND sender_email = ?`,
      [accountEmail, normalizedSender],
    );
    return;
  }
  const senderDomain = normalizedSender.split("@")[1] ?? normalizedSender;
  await execute(
    `INSERT INTO sender_classification_votes
     (account_email, sender_email, sender_domain, category, updated_at)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       sender_domain = VALUES(sender_domain),
       category = VALUES(category),
       updated_at = VALUES(updated_at)`,
    [accountEmail, normalizedSender, senderDomain, category, Date.now()],
  );
}
