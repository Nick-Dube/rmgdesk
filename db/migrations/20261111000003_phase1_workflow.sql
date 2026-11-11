-- migrate:up

-- Who is working the ticket, and the timestamps the SLA engine (Phase 2) will measure against.
ALTER TABLE tickets
  ADD COLUMN assignee_id     INT UNSIGNED NULL AFTER service_line_id,
  ADD COLUMN acknowledged_at DATETIME(3) NULL AFTER hold_reason,
  ADD COLUMN attended_at     DATETIME(3) NULL AFTER acknowledged_at,
  ADD COLUMN made_safe_at    DATETIME(3) NULL AFTER attended_at,
  ADD COLUMN resolution_note TEXT NULL AFTER made_safe_at,
  ADD COLUMN closed_reason   ENUM('confirmed','auto_closed','cancelled','duplicate') NULL AFTER closed_at,
  ADD COLUMN reopen_count    INT UNSIGNED NOT NULL DEFAULT 0 AFTER closed_reason,
  ADD KEY ix_ticket_assignee (assignee_id, status),
  ADD KEY ix_ticket_resolved (status, resolved_at),
  ADD CONSTRAINT fk_ticket_assignee FOREIGN KEY (assignee_id) REFERENCES users(id);

-- New timeline event kinds: a re-route to another category or team, and the requester's rating.
ALTER TABLE ticket_events
  MODIFY COLUMN type ENUM('created','status_changed','comment','internal_note','assigned','priority_changed',
                          'category_changed','rating','email_sent','email_received','integration','sla',
                          'attachment','ai') NOT NULL;

-- Who invited whom (shown in the admin console).
ALTER TABLE users
  ADD COLUMN invited_by INT UNSIGNED NULL AFTER status,
  ADD COLUMN invited_at DATETIME(3) NULL AFTER invited_by,
  ADD CONSTRAINT fk_user_invited_by FOREIGN KEY (invited_by) REFERENCES users(id);

-- migrate:down
ALTER TABLE users
  DROP FOREIGN KEY fk_user_invited_by,
  DROP COLUMN invited_at,
  DROP COLUMN invited_by;

ALTER TABLE ticket_events
  MODIFY COLUMN type ENUM('created','status_changed','comment','internal_note','assigned','priority_changed',
                          'email_sent','email_received','integration','sla','attachment','ai') NOT NULL;

ALTER TABLE tickets
  DROP FOREIGN KEY fk_ticket_assignee,
  DROP KEY ix_ticket_assignee,
  DROP KEY ix_ticket_resolved,
  DROP COLUMN reopen_count,
  DROP COLUMN closed_reason,
  DROP COLUMN resolution_note,
  DROP COLUMN made_safe_at,
  DROP COLUMN attended_at,
  DROP COLUMN acknowledged_at,
  DROP COLUMN assignee_id;
