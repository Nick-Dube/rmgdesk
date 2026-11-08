-- migrate:up
-- Reference data taken from the live rmgdesk.com form and the Integrately routing flow (7 Nov 2026).
-- Confirm owners and recipients with RMG Estates before go-live; edit later in the admin console.

INSERT INTO organisations (code, name, type, email_domains, allow_self_signup) VALUES
  ('RMG',      'Royal Museums Greenwich',  'client',   'rmg.co.uk', TRUE),
  ('VERTEX',   'Vertex Services Group',    'provider', 'vertex.net,vertexltd.co.uk', TRUE),
  ('OCS',      'OCS (formerly FES)',       'partner',  'ocs.com,fes-group.co.uk', FALSE),
  ('BENUGO',   'Benugo',                   'partner',  'benugo.com', FALSE),
  ('GLENDALE', 'Glendale',                 'partner',  'glendale-services.co.uk', FALSE),
  ('TSS',      'TSS',                      'partner',  'tss-uk.com', FALSE);

INSERT INTO sites (code, name, sort_order) VALUES
  ('NMM', 'National Maritime Museum', 1),
  ('ROG', 'Royal Observatory Greenwich', 2),
  ('CS', 'Cutty Sark', 3),
  ('KB', 'Kidbrooke', 4),
  ('BF', 'Brass Foundry', 5);

INSERT INTO buildings (site_id, name, legacy_label, sort_order) VALUES
  ((SELECT id FROM sites WHERE code = 'BF'), 'Brass Foundry', 'BF ~ Brass Foundry', 1),
  ((SELECT id FROM sites WHERE code = 'CS'), 'Access Tower', 'CS ~ Access Tower', 2),
  ((SELECT id FROM sites WHERE code = 'CS'), 'Cutty Sark', 'CS ~ Cutty Sark', 3),
  ((SELECT id FROM sites WHERE code = 'KB'), 'Kidbrooke (PPMCC)', 'KB ~ Kidbrooke (PPMCC)', 4),
  ((SELECT id FROM sites WHERE code = 'KB'), 'Kidbrooke (Spurs)', 'KB ~ Kidbrooke (Spurs)', 5),
  ((SELECT id FROM sites WHERE code = 'NMM'), 'East Wing', 'NMM ~ East Wing', 6),
  ((SELECT id FROM sites WHERE code = 'NMM'), 'Neptune Court', 'NMM ~ Neptune Court', 7),
  ((SELECT id FROM sites WHERE code = 'NMM'), 'Park Row Wing', 'NMM ~ Park Row Wing', 8),
  ((SELECT id FROM sites WHERE code = 'NMM'), 'Queens House', 'NMM ~ Queens House', 9),
  ((SELECT id FROM sites WHERE code = 'NMM'), 'Sammy Ofer Wing', 'NMM ~ Sammy Ofer Wing', 10),
  ((SELECT id FROM sites WHERE code = 'NMM'), 'South West Wing', 'NMM ~ South West Wing', 11),
  ((SELECT id FROM sites WHERE code = 'NMM'), 'South Wing', 'NMM ~ South Wing', 12),
  ((SELECT id FROM sites WHERE code = 'NMM'), 'West Wing', 'NMM ~ West Wing', 13),
  ((SELECT id FROM sites WHERE code = 'ROG'), '(North) Flamsteed House', 'ROG ~ (North) Flamsteed House', 14),
  ((SELECT id FROM sites WHERE code = 'ROG'), '(North) GET', 'ROG ~ (North) GET', 15),
  ((SELECT id FROM sites WHERE code = 'ROG'), '(North) Meridian', 'ROG ~ (North) Meridian', 16),
  ((SELECT id FROM sites WHERE code = 'ROG'), '(South) Altazimuth', 'ROG ~ (South) Altazimuth', 17),
  ((SELECT id FROM sites WHERE code = 'ROG'), '(South) Astronomy Centre', 'ROG ~ (South) Astronomy Centre', 18),
  ((SELECT id FROM sites WHERE code = 'ROG'), '(South) PHP', 'ROG ~ (South) PHP', 19),
  ((SELECT id FROM sites WHERE code = 'ROG'), 'North Side', 'ROG ~ North Side', 20),
  ((SELECT id FROM sites WHERE code = 'ROG'), 'Planetarium', 'ROG ~ Planetarium', 21),
  ((SELECT id FROM sites WHERE code = 'ROG'), 'South Building', 'ROG ~ South Building', 22);

INSERT INTO categories (name, label, sort_order) VALUES
  ('AC / Environmental Conditions', 'AC/ Environmental Conditions', 1),
  ('AV & Interactives', 'AV & Interactives', 2),
  ('Building Fabric', 'Building Fabric', 3),
  ('Building Plumbing', 'Building Plumbing', 4),
  ('Catering Equipment', 'Catering Equipment', 5),
  ('Catering Operations', 'Catering Operations', 6),
  ('Cleaning', 'Cleaning', 7),
  ('Controls', 'Building Controls', 8),
  ('2D Conservation (Paper, Textiles, Frames, Paintings)', '2D Conservation (Paper, Textiles, Frames, Paintings)', 9),
  ('3D Conservation (Objects, Preventive, Cutty Sark)', '3D Conservation (Objects, Preventive, Cutty Sark)', 10),
  ('Decoration', 'Decoration', 11),
  ('Automated Doors and Gates', 'Doors - Auto', 12),
  ('Manual Doors & Gates', 'Doors - Manual Doors & Gates', 13),
  ('Security: Access Control, Locks, Keys and Maglock', 'Doors - Access Control, Locks, Keys & Maglock', 14),
  ('Drainage', 'Drainage', 15),
  ('Electrical Power', 'Electrical Power', 16),
  ('Engagement', 'Engagement', 17),
  ('Escorting RMG Subcontractor', 'Escorting RMG Subcontractor', 18),
  ('Events - Core Hours Support', 'Events: Core Hours Support', 19),
  ('Events - Corp. Cover', 'Events: Corp. Cover', 20),
  ('Events - Learning Cover', 'Events: Learning Cover', 21),
  ('Events - Museum Cover', 'Events: Museum Cover', 22),
  ('Fabric & Furniture', 'Fabric & Furniture', 23),
  ('Fire Controls', 'Fire Controls', 24),
  ('Fire Extinguishers', 'Fire Extinguishers', 25),
  ('Floods/ Leaks', 'Floods/ Leaks', 26),
  ('Gallery Maintenance', 'Gallery Maintenance', 27),
  ('Grounds', 'Grounds', 28),
  ('Health and Safety', 'Health and Safety', 29),
  ('Heating & Gas', 'Heating & Gas', 30),
  ('Joinery', 'Joinery', 31),
  ('Lifts', 'Lifts', 32),
  ('Lighting', 'Lighting', 33),
  ('Lighting: In Case', 'Lighting: In Case', 34),
  ('Localised Plumbing', 'Localised Plumbing', 35),
  ('Loss of Water/ Power', 'Loss of Water/ Power', 36),
  ('Miscellaneous', 'Misc.', 37),
  ('Pests - Insects', 'Pests - Insects', 38),
  ('Pests - Mice & Other', 'Pests - Mice & Other', 39),
  ('Security Alarms', 'Security Alarms', 40),
  ('Signage (Marketing Only)', 'Signage (Marketing Only)', 41),
  ('Sump Pump Alarm', 'Sump Pump Alarm', 42),
  ('Telecomms', 'Telecomms', 43),
  ('Time Clock Adjustments', 'Time Clock Adjustments', 44),
  ('Vending Machines/Water Dispensers', 'Vending Machines/Water Dispensers', 45),
  ('Ventilation', 'Ventilation', 46),
  ('Visitor Experience Cutty Sark', 'Visitor Experience Cutty Sark', 47),
  ('Visitor Experience NMM', 'Visitor Experience NMM', 48),
  ('Visitor Experience ROG', 'Visitor Experience ROG', 49);

INSERT INTO service_lines (code, name, organisation_id, is_evolution_linked) VALUES
  ('VERTEX', 'Vertex M&E maintenance', (SELECT id FROM organisations WHERE code = 'VERTEX'), TRUE),
  ('OCS', 'OCS building fabric and plumbing', (SELECT id FROM organisations WHERE code = 'OCS'), FALSE),
  ('BENUGO', 'Benugo catering operations', (SELECT id FROM organisations WHERE code = 'BENUGO'), FALSE),
  ('RMG_CATERING', 'RMG catering equipment', (SELECT id FROM organisations WHERE code = 'RMG'), FALSE),
  ('RMG_CLEANING', 'RMG cleaning and vending', (SELECT id FROM organisations WHERE code = 'RMG'), FALSE),
  ('RMG_GROUNDS', 'RMG grounds (with Glendale)', (SELECT id FROM organisations WHERE code = 'RMG'), FALSE),
  ('RMG_SECURITY', 'RMG security', (SELECT id FROM organisations WHERE code = 'RMG'), FALSE),
  ('RMG_ESTATES', 'RMG Estates management', (SELECT id FROM organisations WHERE code = 'RMG'), FALSE),
  ('RMG_COLLECTIONS', 'RMG collections care and conservation', (SELECT id FROM organisations WHERE code = 'RMG'), FALSE),
  ('TSS', 'TSS pest control', (SELECT id FROM organisations WHERE code = 'TSS'), FALSE),
  ('RMG_IT', 'RMG IT (Technical Operations)', (SELECT id FROM organisations WHERE code = 'RMG'), FALSE),
  ('RMG_EXHIBITIONS', 'RMG exhibitions and gallery maintenance', (SELECT id FROM organisations WHERE code = 'RMG'), FALSE),
  ('RMG_LEARNING', 'RMG learning and engagement', (SELECT id FROM organisations WHERE code = 'RMG'), FALSE),
  ('RMG_VE_NMM', 'Visitor Experience NMM', (SELECT id FROM organisations WHERE code = 'RMG'), FALSE),
  ('RMG_VE_ROG', 'Visitor Experience ROG', (SELECT id FROM organisations WHERE code = 'RMG'), FALSE),
  ('RMG_VE_CS', 'Visitor Experience Cutty Sark', (SELECT id FROM organisations WHERE code = 'RMG'), FALSE),
  ('RMG_MARKETING', 'RMG marketing (signage)', (SELECT id FROM organisations WHERE code = 'RMG'), FALSE);

-- One rule per category. Recipients are attached to each rule.
INSERT INTO routing_rules (category_id, service_line_id, effective_from, notes) VALUES ((SELECT id FROM categories WHERE name = 'AC / Environmental Conditions'), (SELECT id FROM service_lines WHERE code = 'VERTEX'), '2026-11-07', 'From Integrately flow');
SET @rule := LAST_INSERT_ID();
INSERT INTO routing_recipients (routing_rule_id, email, kind) VALUES (@rule, 'cafmhelpdesk@vertex.net', 'to');
INSERT INTO routing_rules (category_id, service_line_id, effective_from, notes) VALUES ((SELECT id FROM categories WHERE name = 'Automated Doors and Gates'), (SELECT id FROM service_lines WHERE code = 'VERTEX'), '2026-11-07', 'From Integrately flow');
SET @rule := LAST_INSERT_ID();
INSERT INTO routing_recipients (routing_rule_id, email, kind) VALUES (@rule, 'cafmhelpdesk@vertex.net', 'to');
INSERT INTO routing_rules (category_id, service_line_id, effective_from, notes) VALUES ((SELECT id FROM categories WHERE name = 'Controls'), (SELECT id FROM service_lines WHERE code = 'VERTEX'), '2026-11-07', 'From Integrately flow');
SET @rule := LAST_INSERT_ID();
INSERT INTO routing_recipients (routing_rule_id, email, kind) VALUES (@rule, 'cafmhelpdesk@vertex.net', 'to');
INSERT INTO routing_rules (category_id, service_line_id, effective_from, notes) VALUES ((SELECT id FROM categories WHERE name = 'Electrical Power'), (SELECT id FROM service_lines WHERE code = 'VERTEX'), '2026-11-07', 'From Integrately flow');
SET @rule := LAST_INSERT_ID();
INSERT INTO routing_recipients (routing_rule_id, email, kind) VALUES (@rule, 'cafmhelpdesk@vertex.net', 'to');
INSERT INTO routing_rules (category_id, service_line_id, effective_from, notes) VALUES ((SELECT id FROM categories WHERE name = 'Escorting RMG Subcontractor'), (SELECT id FROM service_lines WHERE code = 'VERTEX'), '2026-11-07', 'From Integrately flow');
SET @rule := LAST_INSERT_ID();
INSERT INTO routing_recipients (routing_rule_id, email, kind) VALUES (@rule, 'cafmhelpdesk@vertex.net', 'to');
INSERT INTO routing_rules (category_id, service_line_id, effective_from, notes) VALUES ((SELECT id FROM categories WHERE name = 'Events - Core Hours Support'), (SELECT id FROM service_lines WHERE code = 'VERTEX'), '2026-11-07', 'From Integrately flow');
SET @rule := LAST_INSERT_ID();
INSERT INTO routing_recipients (routing_rule_id, email, kind) VALUES (@rule, 'cafmhelpdesk@vertex.net', 'to');
INSERT INTO routing_rules (category_id, service_line_id, effective_from, notes) VALUES ((SELECT id FROM categories WHERE name = 'Events - Corp. Cover'), (SELECT id FROM service_lines WHERE code = 'VERTEX'), '2026-11-07', 'From Integrately flow');
SET @rule := LAST_INSERT_ID();
INSERT INTO routing_recipients (routing_rule_id, email, kind) VALUES (@rule, 'cafmhelpdesk@vertex.net', 'to');
INSERT INTO routing_rules (category_id, service_line_id, effective_from, notes) VALUES ((SELECT id FROM categories WHERE name = 'Events - Learning Cover'), (SELECT id FROM service_lines WHERE code = 'VERTEX'), '2026-11-07', 'From Integrately flow');
SET @rule := LAST_INSERT_ID();
INSERT INTO routing_recipients (routing_rule_id, email, kind) VALUES (@rule, 'cafmhelpdesk@vertex.net', 'to');
INSERT INTO routing_rules (category_id, service_line_id, effective_from, notes) VALUES ((SELECT id FROM categories WHERE name = 'Events - Museum Cover'), (SELECT id FROM service_lines WHERE code = 'VERTEX'), '2026-11-07', 'From Integrately flow');
SET @rule := LAST_INSERT_ID();
INSERT INTO routing_recipients (routing_rule_id, email, kind) VALUES (@rule, 'cafmhelpdesk@vertex.net', 'to');
INSERT INTO routing_rules (category_id, service_line_id, effective_from, notes) VALUES ((SELECT id FROM categories WHERE name = 'Heating & Gas'), (SELECT id FROM service_lines WHERE code = 'VERTEX'), '2026-11-07', 'From Integrately flow');
SET @rule := LAST_INSERT_ID();
INSERT INTO routing_recipients (routing_rule_id, email, kind) VALUES (@rule, 'cafmhelpdesk@vertex.net', 'to');
INSERT INTO routing_rules (category_id, service_line_id, effective_from, notes) VALUES ((SELECT id FROM categories WHERE name = 'Lighting'), (SELECT id FROM service_lines WHERE code = 'VERTEX'), '2026-11-07', 'From Integrately flow');
SET @rule := LAST_INSERT_ID();
INSERT INTO routing_recipients (routing_rule_id, email, kind) VALUES (@rule, 'cafmhelpdesk@vertex.net', 'to');
INSERT INTO routing_rules (category_id, service_line_id, effective_from, notes) VALUES ((SELECT id FROM categories WHERE name = 'Time Clock Adjustments'), (SELECT id FROM service_lines WHERE code = 'VERTEX'), '2026-11-07', 'From Integrately flow');
SET @rule := LAST_INSERT_ID();
INSERT INTO routing_recipients (routing_rule_id, email, kind) VALUES (@rule, 'cafmhelpdesk@vertex.net', 'to');
INSERT INTO routing_rules (category_id, service_line_id, effective_from, notes) VALUES ((SELECT id FROM categories WHERE name = 'Ventilation'), (SELECT id FROM service_lines WHERE code = 'VERTEX'), '2026-11-07', 'From Integrately flow');
SET @rule := LAST_INSERT_ID();
INSERT INTO routing_recipients (routing_rule_id, email, kind) VALUES (@rule, 'cafmhelpdesk@vertex.net', 'to');
INSERT INTO routing_rules (category_id, service_line_id, effective_from, notes) VALUES ((SELECT id FROM categories WHERE name = 'Loss of Water/ Power'), (SELECT id FROM service_lines WHERE code = 'VERTEX'), '2026-11-07', 'From Integrately flow');
SET @rule := LAST_INSERT_ID();
INSERT INTO routing_recipients (routing_rule_id, email, kind) VALUES (@rule, 'cafmhelpdesk@vertex.net', 'to');
INSERT INTO routing_rules (category_id, service_line_id, effective_from, notes) VALUES ((SELECT id FROM categories WHERE name = 'Sump Pump Alarm'), (SELECT id FROM service_lines WHERE code = 'VERTEX'), '2026-11-07', 'From Integrately flow');
SET @rule := LAST_INSERT_ID();
INSERT INTO routing_recipients (routing_rule_id, email, kind) VALUES (@rule, 'cafmhelpdesk@vertex.net', 'to');
INSERT INTO routing_rules (category_id, service_line_id, effective_from, notes) VALUES ((SELECT id FROM categories WHERE name = 'Building Fabric'), (SELECT id FROM service_lines WHERE code = 'OCS'), '2026-11-07', 'From Integrately flow');
SET @rule := LAST_INSERT_ID();
INSERT INTO routing_recipients (routing_rule_id, email, kind) VALUES (@rule, 'uk.fes.helpdesk@ocs.com', 'to'), (@rule, 'darren.wood@ocs.com', 'to'), (@rule, 'dfhayler@rmg.co.uk', 'cc'), (@rule, 'grawlings@rmg.co.uk', 'cc'), (@rule, 'mwroblewski@rmg.co.uk', 'cc');
INSERT INTO routing_rules (category_id, service_line_id, effective_from, notes) VALUES ((SELECT id FROM categories WHERE name = 'Decoration'), (SELECT id FROM service_lines WHERE code = 'OCS'), '2026-11-07', 'From Integrately flow');
SET @rule := LAST_INSERT_ID();
INSERT INTO routing_recipients (routing_rule_id, email, kind) VALUES (@rule, 'uk.fes.helpdesk@ocs.com', 'to'), (@rule, 'darren.wood@ocs.com', 'to'), (@rule, 'dfhayler@rmg.co.uk', 'cc'), (@rule, 'grawlings@rmg.co.uk', 'cc'), (@rule, 'mwroblewski@rmg.co.uk', 'cc');
INSERT INTO routing_rules (category_id, service_line_id, effective_from, notes) VALUES ((SELECT id FROM categories WHERE name = 'Drainage'), (SELECT id FROM service_lines WHERE code = 'OCS'), '2026-11-07', 'From Integrately flow');
SET @rule := LAST_INSERT_ID();
INSERT INTO routing_recipients (routing_rule_id, email, kind) VALUES (@rule, 'uk.fes.helpdesk@ocs.com', 'to'), (@rule, 'darren.wood@ocs.com', 'to'), (@rule, 'dfhayler@rmg.co.uk', 'cc'), (@rule, 'grawlings@rmg.co.uk', 'cc'), (@rule, 'mwroblewski@rmg.co.uk', 'cc');
INSERT INTO routing_rules (category_id, service_line_id, effective_from, notes) VALUES ((SELECT id FROM categories WHERE name = 'Floods/ Leaks'), (SELECT id FROM service_lines WHERE code = 'OCS'), '2026-11-07', 'From Integrately flow');
SET @rule := LAST_INSERT_ID();
INSERT INTO routing_recipients (routing_rule_id, email, kind) VALUES (@rule, 'uk.fes.helpdesk@ocs.com', 'to'), (@rule, 'darren.wood@ocs.com', 'to'), (@rule, 'dfhayler@rmg.co.uk', 'cc'), (@rule, 'grawlings@rmg.co.uk', 'cc'), (@rule, 'mwroblewski@rmg.co.uk', 'cc');
INSERT INTO routing_rules (category_id, service_line_id, effective_from, notes) VALUES ((SELECT id FROM categories WHERE name = 'Joinery'), (SELECT id FROM service_lines WHERE code = 'OCS'), '2026-11-07', 'From Integrately flow');
SET @rule := LAST_INSERT_ID();
INSERT INTO routing_recipients (routing_rule_id, email, kind) VALUES (@rule, 'uk.fes.helpdesk@ocs.com', 'to'), (@rule, 'darren.wood@ocs.com', 'to'), (@rule, 'dfhayler@rmg.co.uk', 'cc'), (@rule, 'grawlings@rmg.co.uk', 'cc'), (@rule, 'mwroblewski@rmg.co.uk', 'cc');
INSERT INTO routing_rules (category_id, service_line_id, effective_from, notes) VALUES ((SELECT id FROM categories WHERE name = 'Manual Doors & Gates'), (SELECT id FROM service_lines WHERE code = 'OCS'), '2026-11-07', 'From Integrately flow');
SET @rule := LAST_INSERT_ID();
INSERT INTO routing_recipients (routing_rule_id, email, kind) VALUES (@rule, 'uk.fes.helpdesk@ocs.com', 'to'), (@rule, 'darren.wood@ocs.com', 'to'), (@rule, 'dfhayler@rmg.co.uk', 'cc'), (@rule, 'grawlings@rmg.co.uk', 'cc'), (@rule, 'mwroblewski@rmg.co.uk', 'cc');
INSERT INTO routing_rules (category_id, service_line_id, effective_from, notes) VALUES ((SELECT id FROM categories WHERE name = 'Building Plumbing'), (SELECT id FROM service_lines WHERE code = 'OCS'), '2026-11-07', 'From Integrately flow');
SET @rule := LAST_INSERT_ID();
INSERT INTO routing_recipients (routing_rule_id, email, kind) VALUES (@rule, 'uk.fes.helpdesk@ocs.com', 'to'), (@rule, 'darren.wood@ocs.com', 'to'), (@rule, 'dfhayler@rmg.co.uk', 'cc'), (@rule, 'grawlings@rmg.co.uk', 'cc'), (@rule, 'mwroblewski@rmg.co.uk', 'cc');
INSERT INTO routing_rules (category_id, service_line_id, effective_from, notes) VALUES ((SELECT id FROM categories WHERE name = 'Localised Plumbing'), (SELECT id FROM service_lines WHERE code = 'OCS'), '2026-11-07', 'From Integrately flow');
SET @rule := LAST_INSERT_ID();
INSERT INTO routing_recipients (routing_rule_id, email, kind) VALUES (@rule, 'uk.fes.helpdesk@ocs.com', 'to'), (@rule, 'darren.wood@ocs.com', 'to'), (@rule, 'dfhayler@rmg.co.uk', 'cc'), (@rule, 'grawlings@rmg.co.uk', 'cc'), (@rule, 'mwroblewski@rmg.co.uk', 'cc');
INSERT INTO routing_rules (category_id, service_line_id, effective_from, notes) VALUES ((SELECT id FROM categories WHERE name = 'Fabric & Furniture'), (SELECT id FROM service_lines WHERE code = 'OCS'), '2026-11-07', 'From Integrately flow');
SET @rule := LAST_INSERT_ID();
INSERT INTO routing_recipients (routing_rule_id, email, kind) VALUES (@rule, 'uk.fes.helpdesk@ocs.com', 'to'), (@rule, 'darren.wood@ocs.com', 'to'), (@rule, 'dfhayler@rmg.co.uk', 'cc'), (@rule, 'grawlings@rmg.co.uk', 'cc'), (@rule, 'mwroblewski@rmg.co.uk', 'cc');
INSERT INTO routing_rules (category_id, service_line_id, effective_from, notes) VALUES ((SELECT id FROM categories WHERE name = 'Catering Operations'), (SELECT id FROM service_lines WHERE code = 'BENUGO'), '2026-11-07', 'From Integrately flow');
SET @rule := LAST_INSERT_ID();
INSERT INTO routing_recipients (routing_rule_id, email, kind) VALUES (@rule, 'rmg@benugo.com', 'to');
INSERT INTO routing_rules (category_id, service_line_id, effective_from, notes) VALUES ((SELECT id FROM categories WHERE name = 'Catering Equipment'), (SELECT id FROM service_lines WHERE code = 'RMG_CATERING'), '2026-11-07', 'From Integrately flow');
SET @rule := LAST_INSERT_ID();
INSERT INTO routing_recipients (routing_rule_id, email, kind) VALUES (@rule, 'ketuxford@rmg.co.uk', 'to');
INSERT INTO routing_rules (category_id, service_line_id, effective_from, notes) VALUES ((SELECT id FROM categories WHERE name = 'Cleaning'), (SELECT id FROM service_lines WHERE code = 'RMG_CLEANING'), '2026-11-07', 'From Integrately flow');
SET @rule := LAST_INSERT_ID();
INSERT INTO routing_recipients (routing_rule_id, email, kind) VALUES (@rule, 'jnewcombe@rmg.co.uk', 'to'), (@rule, 'dsekmokiene@rmg.co.uk', 'to'), (@rule, 'kdowns@rmg.co.uk', 'cc');
INSERT INTO routing_rules (category_id, service_line_id, effective_from, notes) VALUES ((SELECT id FROM categories WHERE name = 'Vending Machines/Water Dispensers'), (SELECT id FROM service_lines WHERE code = 'RMG_CLEANING'), '2026-11-07', 'From Integrately flow');
SET @rule := LAST_INSERT_ID();
INSERT INTO routing_recipients (routing_rule_id, email, kind) VALUES (@rule, 'jnewcombe@rmg.co.uk', 'to'), (@rule, 'dsekmokiene@rmg.co.uk', 'to'), (@rule, 'kdowns@rmg.co.uk', 'cc');
INSERT INTO routing_rules (category_id, service_line_id, effective_from, notes) VALUES ((SELECT id FROM categories WHERE name = 'Grounds'), (SELECT id FROM service_lines WHERE code = 'RMG_GROUNDS'), '2026-11-07', 'From Integrately flow');
SET @rule := LAST_INSERT_ID();
INSERT INTO routing_recipients (routing_rule_id, email, kind) VALUES (@rule, 'mwroblewski@rmg.co.uk', 'to'), (@rule, 'chris.mcginty@glendale-services.co.uk', 'to'), (@rule, 'rmg.glive1@glendale-services.co.uk', 'to'), (@rule, 'rmg.glive2@glendale-services.co.uk', 'to'), (@rule, 'dfhayler@rmg.co.uk', 'cc');
INSERT INTO routing_rules (category_id, service_line_id, effective_from, notes) VALUES ((SELECT id FROM categories WHERE name = 'Security: Access Control, Locks, Keys and Maglock'), (SELECT id FROM service_lines WHERE code = 'RMG_SECURITY'), '2026-11-07', 'From Integrately flow');
SET @rule := LAST_INSERT_ID();
INSERT INTO routing_recipients (routing_rule_id, email, kind) VALUES (@rule, 'drussell@rmg.co.uk', 'to'), (@rule, 'mgrover@rmg.co.uk', 'to'), (@rule, 'darren.wood@ocs.com', 'cc'), (@rule, 'kdowns@rmg.co.uk', 'cc');
INSERT INTO routing_rules (category_id, service_line_id, effective_from, notes) VALUES ((SELECT id FROM categories WHERE name = 'Security Alarms'), (SELECT id FROM service_lines WHERE code = 'RMG_SECURITY'), '2026-11-07', 'From Integrately flow');
SET @rule := LAST_INSERT_ID();
INSERT INTO routing_recipients (routing_rule_id, email, kind) VALUES (@rule, 'drussell@rmg.co.uk', 'to'), (@rule, 'kdowns@rmg.co.uk', 'to'), (@rule, 'mwroblewski@rmg.co.uk', 'cc');
INSERT INTO routing_rules (category_id, service_line_id, effective_from, notes) VALUES ((SELECT id FROM categories WHERE name = 'Fire Controls'), (SELECT id FROM service_lines WHERE code = 'RMG_ESTATES'), '2026-11-07', 'From Integrately flow');
SET @rule := LAST_INSERT_ID();
INSERT INTO routing_recipients (routing_rule_id, email, kind) VALUES (@rule, 'kkapusta@rmg.co.uk', 'to'), (@rule, 'jmata@rmg.co.uk', 'to'), (@rule, 'mwroblewski@rmg.co.uk', 'cc');
INSERT INTO routing_rules (category_id, service_line_id, effective_from, notes) VALUES ((SELECT id FROM categories WHERE name = 'Lifts'), (SELECT id FROM service_lines WHERE code = 'RMG_ESTATES'), '2026-11-07', 'From Integrately flow');
SET @rule := LAST_INSERT_ID();
INSERT INTO routing_recipients (routing_rule_id, email, kind) VALUES (@rule, 'kkapusta@rmg.co.uk', 'to'), (@rule, 'jmata@rmg.co.uk', 'to'), (@rule, 'mwroblewski@rmg.co.uk', 'cc');
INSERT INTO routing_rules (category_id, service_line_id, effective_from, notes) VALUES ((SELECT id FROM categories WHERE name = 'Fire Extinguishers'), (SELECT id FROM service_lines WHERE code = 'RMG_ESTATES'), '2026-11-07', 'From Integrately flow');
SET @rule := LAST_INSERT_ID();
INSERT INTO routing_recipients (routing_rule_id, email, kind) VALUES (@rule, 'dfhayler@rmg.co.uk', 'to'), (@rule, 'rsaggers@rmg.co.uk', 'to');
INSERT INTO routing_rules (category_id, service_line_id, effective_from, notes) VALUES ((SELECT id FROM categories WHERE name = 'Health and Safety'), (SELECT id FROM service_lines WHERE code = 'RMG_ESTATES'), '2026-11-07', 'From Integrately flow');
SET @rule := LAST_INSERT_ID();
INSERT INTO routing_recipients (routing_rule_id, email, kind) VALUES (@rule, 'dfhayler@rmg.co.uk', 'to'), (@rule, 'rsaggers@rmg.co.uk', 'to');
INSERT INTO routing_rules (category_id, service_line_id, effective_from, notes) VALUES ((SELECT id FROM categories WHERE name = 'Miscellaneous'), (SELECT id FROM service_lines WHERE code = 'RMG_ESTATES'), '2026-11-07', 'From Integrately flow');
SET @rule := LAST_INSERT_ID();
INSERT INTO routing_recipients (routing_rule_id, email, kind) VALUES (@rule, 'dfhayler@rmg.co.uk', 'to'), (@rule, 'mwroblewski@rmg.co.uk', 'to');
INSERT INTO routing_rules (category_id, service_line_id, effective_from, notes) VALUES ((SELECT id FROM categories WHERE name = 'Pests - Insects'), (SELECT id FROM service_lines WHERE code = 'RMG_COLLECTIONS'), '2026-11-07', 'From Integrately flow');
SET @rule := LAST_INSERT_ID();
INSERT INTO routing_recipients (routing_rule_id, email, kind) VALUES (@rule, 'fwhymark@rmg.co.uk', 'to'), (@rule, 'dfhayler@rmg.co.uk', 'cc'), (@rule, 'mwroblewski@rmg.co.uk', 'cc');
INSERT INTO routing_rules (category_id, service_line_id, effective_from, notes) VALUES ((SELECT id FROM categories WHERE name = '2D Conservation (Paper, Textiles, Frames, Paintings)'), (SELECT id FROM service_lines WHERE code = 'RMG_COLLECTIONS'), '2026-11-07', 'From Integrately flow');
SET @rule := LAST_INSERT_ID();
INSERT INTO routing_recipients (routing_rule_id, email, kind) VALUES (@rule, 'fwhymark@rmg.co.uk', 'to'), (@rule, 'iabirkett@rmg.co.uk', 'to');
INSERT INTO routing_rules (category_id, service_line_id, effective_from, notes) VALUES ((SELECT id FROM categories WHERE name = '3D Conservation (Objects, Preventive, Cutty Sark)'), (SELECT id FROM service_lines WHERE code = 'RMG_COLLECTIONS'), '2026-11-07', 'From Integrately flow');
SET @rule := LAST_INSERT_ID();
INSERT INTO routing_recipients (routing_rule_id, email, kind) VALUES (@rule, 'fwhymark@rmg.co.uk', 'to'), (@rule, 'iabirkett@rmg.co.uk', 'to');
INSERT INTO routing_rules (category_id, service_line_id, effective_from, notes) VALUES ((SELECT id FROM categories WHERE name = 'Pests - Mice & Other'), (SELECT id FROM service_lines WHERE code = 'TSS'), '2026-11-07', 'From Integrately flow');
SET @rule := LAST_INSERT_ID();
INSERT INTO routing_recipients (routing_rule_id, email, kind) VALUES (@rule, 'gfee@tss-uk.com', 'to'), (@rule, 'fwhymark@rmg.co.uk', 'cc'), (@rule, 'dfhayler@rmg.co.uk', 'cc'), (@rule, 'mwroblewski@rmg.co.uk', 'cc');
INSERT INTO routing_rules (category_id, service_line_id, effective_from, notes) VALUES ((SELECT id FROM categories WHERE name = 'Lighting: In Case'), (SELECT id FROM service_lines WHERE code = 'RMG_IT'), '2026-11-07', 'From Integrately flow');
SET @rule := LAST_INSERT_ID();
INSERT INTO routing_recipients (routing_rule_id, email, kind) VALUES (@rule, 'techops@rmg.co.uk', 'to');
INSERT INTO routing_rules (category_id, service_line_id, effective_from, notes) VALUES ((SELECT id FROM categories WHERE name = 'Telecomms'), (SELECT id FROM service_lines WHERE code = 'RMG_IT'), '2026-11-07', 'From Integrately flow');
SET @rule := LAST_INSERT_ID();
INSERT INTO routing_recipients (routing_rule_id, email, kind) VALUES (@rule, 'techops@rmg.co.uk', 'to');
INSERT INTO routing_rules (category_id, service_line_id, effective_from, notes) VALUES ((SELECT id FROM categories WHERE name = 'AV & Interactives'), (SELECT id FROM service_lines WHERE code = 'RMG_IT'), '2026-11-07', 'From Integrately flow');
SET @rule := LAST_INSERT_ID();
INSERT INTO routing_recipients (routing_rule_id, email, kind) VALUES (@rule, 'techops@rmg.co.uk', 'to');
INSERT INTO routing_rules (category_id, service_line_id, effective_from, notes) VALUES ((SELECT id FROM categories WHERE name = 'Gallery Maintenance'), (SELECT id FROM service_lines WHERE code = 'RMG_EXHIBITIONS'), '2026-11-07', 'From Integrately flow');
SET @rule := LAST_INSERT_ID();
INSERT INTO routing_recipients (routing_rule_id, email, kind) VALUES (@rule, 'jbrintgutierrez@rmg.co.uk', 'to'), (@rule, 'exhibitions@rmg.co.uk', 'to'), (@rule, 'bmckinnie@rmg.co.uk', 'cc');
INSERT INTO routing_rules (category_id, service_line_id, effective_from, notes) VALUES ((SELECT id FROM categories WHERE name = 'Engagement'), (SELECT id FROM service_lines WHERE code = 'RMG_LEARNING'), '2026-11-07', 'From Integrately flow');
SET @rule := LAST_INSERT_ID();
INSERT INTO routing_recipients (routing_rule_id, email, kind) VALUES (@rule, 'dprosser@rmg.co.uk', 'to'), (@rule, 'cadeneye@rmg.co.uk', 'to');
INSERT INTO routing_rules (category_id, service_line_id, effective_from, notes) VALUES ((SELECT id FROM categories WHERE name = 'Visitor Experience NMM'), (SELECT id FROM service_lines WHERE code = 'RMG_VE_NMM'), '2026-11-07', 'From Integrately flow');
SET @rule := LAST_INSERT_ID();
INSERT INTO routing_recipients (routing_rule_id, email, kind) VALUES (@rule, 'edixson@rmg.co.uk', 'to'), (@rule, 'rkaraliene@rmg.co.uk', 'to'), (@rule, 'akumar@rmg.co.uk', 'to'), (@rule, 'mmangat@rmg.co.uk', 'to'), (@rule, 'vpoulia@rmg.co.uk', 'to'), (@rule, 'co''keefe@rmg.co.uk', 'to'), (@rule, 'sdunlop@rmg.co.uk', 'to'), (@rule, 'fsciarotta@rmg.co.uk', 'to'), (@rule, 'ahewett@rmg.co.uk', 'to');
INSERT INTO routing_rules (category_id, service_line_id, effective_from, notes) VALUES ((SELECT id FROM categories WHERE name = 'Visitor Experience ROG'), (SELECT id FROM service_lines WHERE code = 'RMG_VE_ROG'), '2026-11-07', 'From Integrately flow');
SET @rule := LAST_INSERT_ID();
INSERT INTO routing_recipients (routing_rule_id, email, kind) VALUES (@rule, 'lbourne@rmg.co.uk', 'to'), (@rule, 'hhughes@rmg.co.uk', 'to');
INSERT INTO routing_rules (category_id, service_line_id, effective_from, notes) VALUES ((SELECT id FROM categories WHERE name = 'Visitor Experience Cutty Sark'), (SELECT id FROM service_lines WHERE code = 'RMG_VE_CS'), '2026-11-07', 'From Integrately flow');
SET @rule := LAST_INSERT_ID();
INSERT INTO routing_recipients (routing_rule_id, email, kind) VALUES (@rule, 'emassoud@rmg.co.uk', 'to'), (@rule, 'lseris@rmg.co.uk', 'to'), (@rule, 'shwright@rmg.co.uk', 'to');
INSERT INTO routing_rules (category_id, service_line_id, effective_from, notes) VALUES ((SELECT id FROM categories WHERE name = 'Signage (Marketing Only)'), (SELECT id FROM service_lines WHERE code = 'RMG_MARKETING'), '2026-11-07', 'From Integrately flow');
SET @rule := LAST_INSERT_ID();
INSERT INTO routing_recipients (routing_rule_id, email, kind) VALUES (@rule, 'zvirani@rmg.co.uk', 'to');

-- SLA targets from the 2021 'M&E Service: Work Prioritisation' matrix. CONFIRM against the retained contract.
INSERT INTO sla_policies (priority, stage, site_id, service_line_id, target_minutes, calendar, effective_from, source_note) VALUES
  ('P1', 'attend', (SELECT id FROM sites WHERE code = 'NMM'), (SELECT id FROM service_lines WHERE code = 'VERTEX'), 20, '24x7', '2021-03-01', '2021 deck slide 14'),
  ('P1', 'attend', (SELECT id FROM sites WHERE code = 'ROG'), (SELECT id FROM service_lines WHERE code = 'VERTEX'), 30, '24x7', '2021-03-01', '2021 deck slide 14'),
  ('P1', 'attend', (SELECT id FROM sites WHERE code = 'CS'), (SELECT id FROM service_lines WHERE code = 'VERTEX'), 30, '24x7', '2021-03-01', '2021 deck slide 14'),
  ('P1', 'attend', (SELECT id FROM sites WHERE code = 'KB'), (SELECT id FROM service_lines WHERE code = 'VERTEX'), 60, '24x7', '2021-03-01', '2021 deck slide 14'),
  ('P1', 'attend', (SELECT id FROM sites WHERE code = 'BF'), (SELECT id FROM service_lines WHERE code = 'VERTEX'), 60, '24x7', '2021-03-01', '2021 deck slide 14'),
  ('P1', 'make_safe', (SELECT id FROM sites WHERE code = 'NMM'), (SELECT id FROM service_lines WHERE code = 'VERTEX'), 120, '24x7', '2021-03-01', '2021 deck slide 14'),
  ('P1', 'make_safe', (SELECT id FROM sites WHERE code = 'ROG'), (SELECT id FROM service_lines WHERE code = 'VERTEX'), 120, '24x7', '2021-03-01', '2021 deck slide 14'),
  ('P1', 'make_safe', (SELECT id FROM sites WHERE code = 'CS'), (SELECT id FROM service_lines WHERE code = 'VERTEX'), 120, '24x7', '2021-03-01', '2021 deck slide 14'),
  ('P1', 'make_safe', (SELECT id FROM sites WHERE code = 'KB'), (SELECT id FROM service_lines WHERE code = 'VERTEX'), 180, '24x7', '2021-03-01', '2021 deck slide 14'),
  ('P1', 'make_safe', (SELECT id FROM sites WHERE code = 'BF'), (SELECT id FROM service_lines WHERE code = 'VERTEX'), 180, '24x7', '2021-03-01', '2021 deck slide 14'),
  ('P1', 'fix', (SELECT id FROM sites WHERE code = 'NMM'), (SELECT id FROM service_lines WHERE code = 'VERTEX'), 1440, '24x7', '2021-03-01', '2021 deck slide 14'),
  ('P1', 'fix', (SELECT id FROM sites WHERE code = 'ROG'), (SELECT id FROM service_lines WHERE code = 'VERTEX'), 1440, '24x7', '2021-03-01', '2021 deck slide 14'),
  ('P1', 'fix', (SELECT id FROM sites WHERE code = 'CS'), (SELECT id FROM service_lines WHERE code = 'VERTEX'), 1440, '24x7', '2021-03-01', '2021 deck slide 14'),
  ('P1', 'fix', (SELECT id FROM sites WHERE code = 'KB'), (SELECT id FROM service_lines WHERE code = 'VERTEX'), 1440, '24x7', '2021-03-01', '2021 deck slide 14'),
  ('P1', 'fix', (SELECT id FROM sites WHERE code = 'BF'), (SELECT id FROM service_lines WHERE code = 'VERTEX'), 1440, '24x7', '2021-03-01', '2021 deck slide 14'),
  ('P2', 'attend', (SELECT id FROM sites WHERE code = 'NMM'), (SELECT id FROM service_lines WHERE code = 'VERTEX'), 60, '24x7', '2021-03-01', '2021 deck slide 14'),
  ('P2', 'attend', (SELECT id FROM sites WHERE code = 'ROG'), (SELECT id FROM service_lines WHERE code = 'VERTEX'), 90, '24x7', '2021-03-01', '2021 deck slide 14'),
  ('P2', 'attend', (SELECT id FROM sites WHERE code = 'CS'), (SELECT id FROM service_lines WHERE code = 'VERTEX'), 90, '24x7', '2021-03-01', '2021 deck slide 14'),
  ('P2', 'attend', (SELECT id FROM sites WHERE code = 'KB'), (SELECT id FROM service_lines WHERE code = 'VERTEX'), 150, '24x7', '2021-03-01', '2021 deck slide 14'),
  ('P2', 'attend', (SELECT id FROM sites WHERE code = 'BF'), (SELECT id FROM service_lines WHERE code = 'VERTEX'), 150, '24x7', '2021-03-01', '2021 deck slide 14'),
  ('P2', 'make_safe', (SELECT id FROM sites WHERE code = 'NMM'), (SELECT id FROM service_lines WHERE code = 'VERTEX'), 300, '24x7', '2021-03-01', '2021 deck slide 14'),
  ('P2', 'make_safe', (SELECT id FROM sites WHERE code = 'ROG'), (SELECT id FROM service_lines WHERE code = 'VERTEX'), 300, '24x7', '2021-03-01', '2021 deck slide 14'),
  ('P2', 'make_safe', (SELECT id FROM sites WHERE code = 'CS'), (SELECT id FROM service_lines WHERE code = 'VERTEX'), 300, '24x7', '2021-03-01', '2021 deck slide 14'),
  ('P2', 'make_safe', (SELECT id FROM sites WHERE code = 'KB'), (SELECT id FROM service_lines WHERE code = 'VERTEX'), 360, '24x7', '2021-03-01', '2021 deck slide 14'),
  ('P2', 'make_safe', (SELECT id FROM sites WHERE code = 'BF'), (SELECT id FROM service_lines WHERE code = 'VERTEX'), 360, '24x7', '2021-03-01', '2021 deck slide 14'),
  ('P2', 'fix', (SELECT id FROM sites WHERE code = 'NMM'), (SELECT id FROM service_lines WHERE code = 'VERTEX'), 2880, '24x7', '2021-03-01', '2021 deck slide 14'),
  ('P2', 'fix', (SELECT id FROM sites WHERE code = 'ROG'), (SELECT id FROM service_lines WHERE code = 'VERTEX'), 2880, '24x7', '2021-03-01', '2021 deck slide 14'),
  ('P2', 'fix', (SELECT id FROM sites WHERE code = 'CS'), (SELECT id FROM service_lines WHERE code = 'VERTEX'), 2880, '24x7', '2021-03-01', '2021 deck slide 14'),
  ('P2', 'fix', (SELECT id FROM sites WHERE code = 'KB'), (SELECT id FROM service_lines WHERE code = 'VERTEX'), 4320, '24x7', '2021-03-01', '2021 deck slide 14'),
  ('P2', 'fix', (SELECT id FROM sites WHERE code = 'BF'), (SELECT id FROM service_lines WHERE code = 'VERTEX'), 4320, '24x7', '2021-03-01', '2021 deck slide 14'),
  ('P3', 'attend', (SELECT id FROM sites WHERE code = 'NMM'), (SELECT id FROM service_lines WHERE code = 'VERTEX'), 2880, '24x7', '2021-03-01', '2021 deck slide 14'),
  ('P3', 'attend', (SELECT id FROM sites WHERE code = 'ROG'), (SELECT id FROM service_lines WHERE code = 'VERTEX'), 2880, '24x7', '2021-03-01', '2021 deck slide 14'),
  ('P3', 'attend', (SELECT id FROM sites WHERE code = 'CS'), (SELECT id FROM service_lines WHERE code = 'VERTEX'), 2880, '24x7', '2021-03-01', '2021 deck slide 14'),
  ('P3', 'attend', (SELECT id FROM sites WHERE code = 'KB'), (SELECT id FROM service_lines WHERE code = 'VERTEX'), 2880, '24x7', '2021-03-01', '2021 deck slide 14'),
  ('P3', 'attend', (SELECT id FROM sites WHERE code = 'BF'), (SELECT id FROM service_lines WHERE code = 'VERTEX'), 2880, '24x7', '2021-03-01', '2021 deck slide 14'),
  ('P3', 'fix', (SELECT id FROM sites WHERE code = 'NMM'), (SELECT id FROM service_lines WHERE code = 'VERTEX'), 4320, '24x7', '2021-03-01', '2021 deck slide 14'),
  ('P3', 'fix', (SELECT id FROM sites WHERE code = 'ROG'), (SELECT id FROM service_lines WHERE code = 'VERTEX'), 4320, '24x7', '2021-03-01', '2021 deck slide 14'),
  ('P3', 'fix', (SELECT id FROM sites WHERE code = 'CS'), (SELECT id FROM service_lines WHERE code = 'VERTEX'), 4320, '24x7', '2021-03-01', '2021 deck slide 14'),
  ('P3', 'fix', (SELECT id FROM sites WHERE code = 'KB'), (SELECT id FROM service_lines WHERE code = 'VERTEX'), 4320, '24x7', '2021-03-01', '2021 deck slide 14'),
  ('P3', 'fix', (SELECT id FROM sites WHERE code = 'BF'), (SELECT id FROM service_lines WHERE code = 'VERTEX'), 4320, '24x7', '2021-03-01', '2021 deck slide 14');

-- migrate:down
DELETE FROM sla_policies;
DELETE FROM routing_recipients;
DELETE FROM routing_rules;
DELETE FROM service_lines;
DELETE FROM categories;
DELETE FROM buildings;
DELETE FROM sites;
DELETE FROM organisations;
