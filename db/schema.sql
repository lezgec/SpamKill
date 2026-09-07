CREATE DATABASE IF NOT EXISTS spamkill
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE spamkill;

CREATE TABLE IF NOT EXISTS unsubscribe_history (
  id VARCHAR(640) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  account_email VARCHAR(320) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  provider VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'gmail',
  sender_email VARCHAR(320) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  sender_name VARCHAR(255) NOT NULL,
  sender_domain VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  requested_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  last_seen_at BIGINT NULL,
  messages_trashed INT NOT NULL DEFAULT 0,
  manual_url VARCHAR(2048) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY unsubscribe_account_sender_idx (account_email, sender_email)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS indexed_messages (
  id VARCHAR(1400) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  account_email VARCHAR(320) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  message_id VARCHAR(1024) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  sender_email VARCHAR(320) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  sender_name VARCHAR(255) NOT NULL,
  sender_domain VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  subject TEXT NOT NULL,
  snippet TEXT NOT NULL,
  category VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  classification_reason VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'no_signals',
  classification_confidence VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL DEFAULT 'low',
  received_at BIGINT NOT NULL,
  has_unsubscribe TINYINT(1) NOT NULL DEFAULT 0,
  indexed_at BIGINT NOT NULL,
  trashed_at BIGINT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY indexed_account_message_idx (account_email, message_id),
  UNIQUE KEY indexed_account_sender_message_idx (account_email, sender_email, message_id),
  KEY indexed_account_received_idx (account_email, received_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS gmail_sync_state (
  account_email VARCHAR(320) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  history_id VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
  coverage_start_at BIGINT NULL,
  last_full_scan_at BIGINT NULL,
  last_incremental_sync_at BIGINT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (account_email)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sender_preferences (
  id VARCHAR(640) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  account_email VARCHAR(320) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  sender_email VARCHAR(320) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  manual_category VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
  is_safe TINYINT(1) NOT NULL DEFAULT 0,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY sender_preference_account_sender_idx (account_email, sender_email)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sender_classification_votes (
  account_email VARCHAR(320) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  sender_email VARCHAR(320) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  sender_domain VARCHAR(255) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  category VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (account_email, sender_email),
  KEY sender_classification_sender_idx (sender_email, category)
) ENGINE=InnoDB;

INSERT INTO sender_classification_votes
  (account_email, sender_email, sender_domain, category, updated_at)
SELECT account_email,
       sender_email,
       SUBSTRING_INDEX(sender_email, '@', -1),
       manual_category,
       updated_at
  FROM sender_preferences
 WHERE manual_category IS NOT NULL AND is_safe = 0
ON DUPLICATE KEY UPDATE
  sender_domain = VALUES(sender_domain),
  category = VALUES(category),
  updated_at = VALUES(updated_at);
