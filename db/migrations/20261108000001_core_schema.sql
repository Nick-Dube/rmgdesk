-- migrate:up

-- ============================================================ Organisations and people
CREATE TABLE organisations (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code            VARCHAR(20)  NOT NULL UNIQUE,
  name            VARCHAR(120) NOT NULL,
  type            ENUM('client','provider','partner') NOT NULL,
  email_domains   VARCHAR(500) NULL COMMENT 'Comma-separated, lower case, e.g. rmg.co.uk',
  allow_self_signup BOOLEAN NOT NULL DEFAULT FALSE,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB;

CREATE TABLE departments (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  organisation_id INT UNSIGNED NOT NULL,
  name            VARCHAR(120) NOT NULL,
  active          BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE KEY uq_department (organisation_id, name),
  CONSTRAINT fk_department_org FOREIGN KEY (organisation_id) REFERENCES organisations(id)
) ENGINE=InnoDB;

CREATE TABLE users (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  cognito_sub     CHAR(36)     NULL UNIQUE,
  email           VARCHAR(254) NOT NULL UNIQUE,
  full_name       VARCHAR(120) NOT NULL,
  phone           VARCHAR(30)  NULL,
  organisation_id INT UNSIGNED NOT NULL,
  department_id   INT UNSIGNED NULL,
  role            ENUM('requester','agent','lead','viewer','rmg_superuser','vertex_helpdesk','vertex_superuser')
                  NOT NULL DEFAULT 'requester',
  status          ENUM('invited','active','suspended','disabled') NOT NULL DEFAULT 'active',
  notify_mode     ENUM('instant','digest','off') NOT NULL DEFAULT 'instant',
  last_sign_in_at DATETIME(3)  NULL,
  created_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY ix_users_org (organisation_id),
  CONSTRAINT fk_user_org  FOREIGN KEY (organisation_id) REFERENCES organisations(id),
  CONSTRAINT fk_user_dept FOREIGN KEY (department_id)   REFERENCES departments(id)
) ENGINE=InnoDB;

-- ============================================================ Estate
CREATE TABLE sites (
  id        INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code      VARCHAR(10)  NOT NULL UNIQUE,
  name      VARCHAR(120) NOT NULL,
  sort_order INT NOT NULL DEFAULT 0
) ENGINE=InnoDB;

CREATE TABLE buildings (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  site_id       INT UNSIGNED NOT NULL,
  name          VARCHAR(120) NOT NULL,
  legacy_label  VARCHAR(120) NULL UNIQUE COMMENT 'Value used by the old rmgdesk.com form, e.g. "NMM ~ East Wing"',
  evolution_ref VARCHAR(60)  NULL,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order    INT NOT NULL DEFAULT 0,
  UNIQUE KEY uq_building (site_id, name),
  CONSTRAINT fk_building_site FOREIGN KEY (site_id) REFERENCES sites(id)
) ENGINE=InnoDB;

CREATE TABLE locations (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  building_id   INT UNSIGNED NOT NULL,
  parent_id     INT UNSIGNED NULL,
  name          VARCHAR(160) NOT NULL,
  kind          ENUM('floor','room','area','external','other') NOT NULL DEFAULT 'room',
  evolution_ref VARCHAR(60)  NULL,
  qr_code       VARCHAR(40)  NULL UNIQUE,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  KEY ix_location_building (building_id),
  CONSTRAINT fk_location_building FOREIGN KEY (building_id) REFERENCES buildings(id),
  CONSTRAINT fk_location_parent   FOREIGN KEY (parent_id)   REFERENCES locations(id)
) ENGINE=InnoDB;

CREATE TABLE assets (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  location_id   INT UNSIGNED NULL,
  building_id   INT UNSIGNED NULL,
  name          VARCHAR(200) NOT NULL,
  asset_type    VARCHAR(120) NULL,
  evolution_ref VARCHAR(60)  NULL UNIQUE,
  qr_code       VARCHAR(40)  NULL UNIQUE,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT fk_asset_location FOREIGN KEY (location_id) REFERENCES locations(id),
  CONSTRAINT fk_asset_building FOREIGN KEY (building_id) REFERENCES buildings(id)
) ENGINE=InnoDB;

-- ============================================================ Service lines and routing
CREATE TABLE service_lines (
  id                  INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code                VARCHAR(30)  NOT NULL UNIQUE,
  name                VARCHAR(120) NOT NULL,
  organisation_id     INT UNSIGNED NOT NULL,
  is_evolution_linked BOOLEAN NOT NULL DEFAULT FALSE,
  hours_profile       ENUM('24x7','business') NOT NULL DEFAULT '24x7',
  active              BOOLEAN NOT NULL DEFAULT TRUE,
  CONSTRAINT fk_sl_org FOREIGN KEY (organisation_id) REFERENCES organisations(id)
) ENGINE=InnoDB;

CREATE TABLE user_scopes (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id         INT UNSIGNED NOT NULL,
  service_line_id INT UNSIGNED NULL,
  site_id         INT UNSIGNED NULL,
  KEY ix_scope_user (user_id),
  CONSTRAINT fk_scope_user FOREIGN KEY (user_id)         REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_scope_sl   FOREIGN KEY (service_line_id) REFERENCES service_lines(id),
  CONSTRAINT fk_scope_site FOREIGN KEY (site_id)         REFERENCES sites(id)
) ENGINE=InnoDB;

CREATE TABLE categories (
  id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name             VARCHAR(120) NOT NULL UNIQUE COMMENT 'Value used by the old form and Integrately',
  label            VARCHAR(120) NOT NULL COMMENT 'What users see',
  default_priority ENUM('P1','P2','P3','P4') NULL,
  active           BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order       INT NOT NULL DEFAULT 0
) ENGINE=InnoDB;

CREATE TABLE routing_rules (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  category_id     INT UNSIGNED NOT NULL,
  service_line_id INT UNSIGNED NOT NULL,
  site_id         INT UNSIGNED NULL COMMENT 'NULL = every site; a site-specific rule wins',
  effective_from  DATE NOT NULL,
  effective_to    DATE NULL,
  notes           VARCHAR(255) NULL,
  KEY ix_routing_category (category_id),
  CONSTRAINT fk_rr_category FOREIGN KEY (category_id)     REFERENCES categories(id),
  CONSTRAINT fk_rr_sl       FOREIGN KEY (service_line_id) REFERENCES service_lines(id),
  CONSTRAINT fk_rr_site     FOREIGN KEY (site_id)         REFERENCES sites(id)
) ENGINE=InnoDB;

CREATE TABLE routing_recipients (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  routing_rule_id INT UNSIGNED NOT NULL,
  user_id         INT UNSIGNED NULL,
  email           VARCHAR(254) NULL,
  kind            ENUM('to','cc') NOT NULL DEFAULT 'to',
  KEY ix_recipient_rule (routing_rule_id),
  CONSTRAINT fk_rrec_rule FOREIGN KEY (routing_rule_id) REFERENCES routing_rules(id) ON DELETE CASCADE,
  CONSTRAINT fk_rrec_user FOREIGN KEY (user_id)         REFERENCES users(id),
  CONSTRAINT chk_rrec_target CHECK (user_id IS NOT NULL OR email IS NOT NULL)
) ENGINE=InnoDB;

-- ============================================================ Tickets
CREATE TABLE problems (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  reference   VARCHAR(20)  NULL UNIQUE,
  title       VARCHAR(200) NOT NULL,
  owner_id    INT UNSIGNED NULL,
  status      ENUM('open','investigating','fix_planned','fixed','closed') NOT NULL DEFAULT 'open',
  cause       TEXT NULL,
  fix         TEXT NULL,
  fixed_at    DATETIME(3) NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_problem_owner FOREIGN KEY (owner_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE tickets (
  id                INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  reference         VARCHAR(20)  NULL UNIQUE COMMENT 'Set after insert, e.g. RMG-000123',
  requester_id      INT UNSIGNED NULL COMMENT 'NULL only for legacy imports',
  organisation_id   INT UNSIGNED NULL,
  department_name   VARCHAR(120) NULL,
  site_id           INT UNSIGNED NOT NULL,
  building_id       INT UNSIGNED NOT NULL,
  location_id       INT UNSIGNED NULL,
  location_text     VARCHAR(200) NULL,
  asset_id          INT UNSIGNED NULL,
  category_id       INT UNSIGNED NOT NULL,
  service_line_id   INT UNSIGNED NULL,
  routing_rule_id   INT UNSIGNED NULL,
  priority          ENUM('P1','P2','P3','P4') NOT NULL,
  status            ENUM('new','triaged','assigned','attending','made_safe','on_hold','resolved','closed','reopened','cancelled')
                    NOT NULL DEFAULT 'new',
  hold_reason       VARCHAR(120) NULL,
  title             VARCHAR(100) NOT NULL,
  description       TEXT NOT NULL,
  contact_phone     VARCHAR(30)  NULL,
  source            ENUM('web','mobile','email','qr','evolution','legacy') NOT NULL DEFAULT 'web',
  evolution_task_no VARCHAR(40)  NULL,
  problem_id        INT UNSIGNED NULL,
  duplicate_of_id   INT UNSIGNED NULL,
  root_cause        ENUM('wear_and_tear','user_damage','design_fault','installation_fault','supplier_fault','weather','vandalism','unknown') NULL,
  satisfaction      TINYINT UNSIGNED NULL,
  resolved_at       DATETIME(3) NULL,
  closed_at         DATETIME(3) NULL,
  created_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at        DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY ix_ticket_requester (requester_id, created_at),
  KEY ix_ticket_sl_status (service_line_id, status),
  KEY ix_ticket_status (status, created_at),
  KEY ix_ticket_building_cat (building_id, category_id, created_at),
  KEY ix_ticket_evolution (evolution_task_no),
  CONSTRAINT fk_ticket_requester FOREIGN KEY (requester_id)    REFERENCES users(id),
  CONSTRAINT fk_ticket_org       FOREIGN KEY (organisation_id) REFERENCES organisations(id),
  CONSTRAINT fk_ticket_site      FOREIGN KEY (site_id)         REFERENCES sites(id),
  CONSTRAINT fk_ticket_building  FOREIGN KEY (building_id)     REFERENCES buildings(id),
  CONSTRAINT fk_ticket_location  FOREIGN KEY (location_id)     REFERENCES locations(id),
  CONSTRAINT fk_ticket_asset     FOREIGN KEY (asset_id)        REFERENCES assets(id),
  CONSTRAINT fk_ticket_category  FOREIGN KEY (category_id)     REFERENCES categories(id),
  CONSTRAINT fk_ticket_sl        FOREIGN KEY (service_line_id) REFERENCES service_lines(id),
  CONSTRAINT fk_ticket_rule      FOREIGN KEY (routing_rule_id) REFERENCES routing_rules(id),
  CONSTRAINT fk_ticket_problem   FOREIGN KEY (problem_id)      REFERENCES problems(id),
  CONSTRAINT fk_ticket_duplicate FOREIGN KEY (duplicate_of_id) REFERENCES tickets(id),
  CONSTRAINT chk_satisfaction CHECK (satisfaction IS NULL OR satisfaction BETWEEN 1 AND 5)
) ENGINE=InnoDB;

-- The timeline. Append-only: rows are never updated or deleted by the application.
CREATE TABLE ticket_events (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ticket_id   INT UNSIGNED NOT NULL,
  actor_id    INT UNSIGNED NULL COMMENT 'NULL = system or integration',
  type        ENUM('created','status_changed','comment','internal_note','assigned','priority_changed',
                   'email_sent','email_received','integration','sla','attachment','ai') NOT NULL,
  body        TEXT NULL,
  data        JSON NULL,
  is_internal BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_event_ticket (ticket_id, created_at),
  CONSTRAINT fk_event_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id),
  CONSTRAINT fk_event_actor  FOREIGN KEY (actor_id)  REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE attachments (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ticket_id     INT UNSIGNED NOT NULL,
  event_id      BIGINT UNSIGNED NULL,
  s3_key        VARCHAR(300) NOT NULL UNIQUE,
  file_name     VARCHAR(200) NOT NULL,
  content_type  VARCHAR(100) NOT NULL,
  size_bytes    INT UNSIGNED NOT NULL,
  stage         ENUM('report','before','after','other') NOT NULL DEFAULT 'report',
  uploaded_by   INT UNSIGNED NULL,
  created_at    DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_attachment_ticket (ticket_id),
  CONSTRAINT fk_att_ticket FOREIGN KEY (ticket_id)   REFERENCES tickets(id),
  CONSTRAINT fk_att_event  FOREIGN KEY (event_id)    REFERENCES ticket_events(id),
  CONSTRAINT fk_att_user   FOREIGN KEY (uploaded_by) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE ticket_followers (
  ticket_id  INT UNSIGNED NOT NULL,
  user_id    INT UNSIGNED NOT NULL,
  reason     ENUM('requester','affected','follower','assignee') NOT NULL DEFAULT 'follower',
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (ticket_id, user_id),
  KEY ix_follower_user (user_id),
  CONSTRAINT fk_follow_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id),
  CONSTRAINT fk_follow_user   FOREIGN KEY (user_id)   REFERENCES users(id)
) ENGINE=InnoDB;

-- ============================================================ SLAs
CREATE TABLE sla_policies (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  priority        ENUM('P1','P2','P3','P4') NOT NULL,
  stage           ENUM('attend','make_safe','fix') NOT NULL,
  site_id         INT UNSIGNED NULL,
  service_line_id INT UNSIGNED NULL,
  target_minutes  INT UNSIGNED NOT NULL,
  calendar        ENUM('24x7','business') NOT NULL DEFAULT '24x7',
  effective_from  DATE NOT NULL,
  effective_to    DATE NULL,
  source_note     VARCHAR(255) NULL,
  KEY ix_sla_lookup (priority, stage, site_id, service_line_id),
  CONSTRAINT fk_sla_site FOREIGN KEY (site_id)         REFERENCES sites(id),
  CONSTRAINT fk_sla_sl   FOREIGN KEY (service_line_id) REFERENCES service_lines(id)
) ENGINE=InnoDB;

CREATE TABLE sla_clocks (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ticket_id       INT UNSIGNED NOT NULL,
  stage           ENUM('attend','make_safe','fix') NOT NULL,
  sla_policy_id   INT UNSIGNED NULL,
  due_at          DATETIME(3) NOT NULL,
  paused_at       DATETIME(3) NULL,
  paused_seconds  INT UNSIGNED NOT NULL DEFAULT 0,
  warned_at       DATETIME(3) NULL,
  met_at          DATETIME(3) NULL,
  breached        BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE KEY uq_clock (ticket_id, stage),
  KEY ix_clock_due (met_at, due_at),
  CONSTRAINT fk_clock_ticket FOREIGN KEY (ticket_id)     REFERENCES tickets(id),
  CONSTRAINT fk_clock_policy FOREIGN KEY (sla_policy_id) REFERENCES sla_policies(id)
) ENGINE=InnoDB;

-- ============================================================ Communications, integrations, audit
CREATE TABLE announcements (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  site_id     INT UNSIGNED NULL,
  building_id INT UNSIGNED NULL,
  message     VARCHAR(500) NOT NULL,
  starts_at   DATETIME(3) NOT NULL,
  ends_at     DATETIME(3) NULL,
  created_by  INT UNSIGNED NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  CONSTRAINT fk_ann_site     FOREIGN KEY (site_id)     REFERENCES sites(id),
  CONSTRAINT fk_ann_building FOREIGN KEY (building_id) REFERENCES buildings(id),
  CONSTRAINT fk_ann_user     FOREIGN KEY (created_by)  REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE integration_jobs (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ticket_id   INT UNSIGNED NOT NULL,
  target      ENUM('evolution') NOT NULL,
  action      VARCHAR(40) NOT NULL,
  status      ENUM('queued','sent','succeeded','failed','skipped') NOT NULL DEFAULT 'queued',
  attempts    INT UNSIGNED NOT NULL DEFAULT 0,
  request     MEDIUMTEXT NULL,
  response    MEDIUMTEXT NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY ix_job_ticket (ticket_id),
  KEY ix_job_status (status, created_at),
  CONSTRAINT fk_job_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id)
) ENGINE=InnoDB;

CREATE TABLE email_messages (
  id             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ticket_id      INT UNSIGNED NULL,
  direction      ENUM('out','in') NOT NULL,
  template       VARCHAR(60) NULL,
  to_addresses   TEXT NOT NULL,
  subject        VARCHAR(300) NOT NULL,
  ses_message_id VARCHAR(120) NULL,
  status         ENUM('queued','sent','delivered','bounced','complained','failed','received') NOT NULL DEFAULT 'queued',
  created_at     DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_email_ticket (ticket_id),
  CONSTRAINT fk_email_ticket FOREIGN KEY (ticket_id) REFERENCES tickets(id)
) ENGINE=InnoDB;

CREATE TABLE audit_log (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  actor_id    INT UNSIGNED NULL,
  action      VARCHAR(60) NOT NULL,
  entity      VARCHAR(40) NOT NULL,
  entity_id   VARCHAR(40) NULL,
  before_data JSON NULL,
  after_data  JSON NULL,
  ip          VARCHAR(45) NULL,
  user_agent  VARCHAR(300) NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_audit_entity (entity, entity_id),
  KEY ix_audit_actor (actor_id, created_at)
) ENGINE=InnoDB;

CREATE TABLE ai_suggestions (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  ticket_id   INT UNSIGNED NULL,
  feature     ENUM('triage','duplicate','root_cause','digest','ask') NOT NULL,
  model       VARCHAR(80) NOT NULL,
  suggestion  JSON NOT NULL,
  accepted    BOOLEAN NULL,
  decided_by  INT UNSIGNED NULL,
  input_tokens  INT UNSIGNED NULL,
  output_tokens INT UNSIGNED NULL,
  created_at  DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY ix_ai_ticket (ticket_id),
  CONSTRAINT fk_ai_ticket FOREIGN KEY (ticket_id)  REFERENCES tickets(id),
  CONSTRAINT fk_ai_user   FOREIGN KEY (decided_by) REFERENCES users(id)
) ENGINE=InnoDB;

-- migrate:down
DROP TABLE IF EXISTS ai_suggestions;
DROP TABLE IF EXISTS audit_log;
DROP TABLE IF EXISTS email_messages;
DROP TABLE IF EXISTS integration_jobs;
DROP TABLE IF EXISTS announcements;
DROP TABLE IF EXISTS sla_clocks;
DROP TABLE IF EXISTS sla_policies;
DROP TABLE IF EXISTS ticket_followers;
DROP TABLE IF EXISTS attachments;
DROP TABLE IF EXISTS ticket_events;
DROP TABLE IF EXISTS tickets;
DROP TABLE IF EXISTS problems;
DROP TABLE IF EXISTS routing_recipients;
DROP TABLE IF EXISTS routing_rules;
DROP TABLE IF EXISTS categories;
DROP TABLE IF EXISTS user_scopes;
DROP TABLE IF EXISTS service_lines;
DROP TABLE IF EXISTS assets;
DROP TABLE IF EXISTS locations;
DROP TABLE IF EXISTS buildings;
DROP TABLE IF EXISTS sites;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS departments;
DROP TABLE IF EXISTS organisations;
