-- migrate:up
-- Status changes and engineer events sent to RMG Desk by MRI Evolution workflows (assigned, paused, completed ...).
-- Every call is kept, whatever happened to it, so a missing update can be traced from either side.
-- The unique key makes a repeated call (Evolution retrying, or the workflow running twice) harmless.
CREATE TABLE integration_inbound (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  source       ENUM('evolution') NOT NULL,
  dedupe_key   VARCHAR(190) NOT NULL COMMENT 'task + status + time, built by the receiver',
  ticket_id    INT UNSIGNED NULL,
  external_ref VARCHAR(60) NULL COMMENT 'Evolution task number',
  status       VARCHAR(60) NULL COMMENT 'Evolution TA_STATUS or event name, as sent',
  event_at     DATETIME(3) NULL COMMENT 'when it happened in Evolution (UTC); used to spot late arrivals',
  result       ENUM('applied','noted','duplicate','ignored','unmatched','rejected') NOT NULL,
  detail       VARCHAR(500) NULL,
  payload      MEDIUMTEXT NULL,
  received_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  UNIQUE KEY ux_inbound_dedupe (source, dedupe_key),
  KEY ix_inbound_ticket (ticket_id, received_at),
  KEY ix_inbound_applied (ticket_id, result, event_at),
  KEY ix_inbound_received (received_at),
  CONSTRAINT fk_inbound_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id)
) ENGINE=InnoDB;

-- migrate:down
DROP TABLE integration_inbound;
