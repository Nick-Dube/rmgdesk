-- migrate:up
-- Imported history, part 1: categories used by the old form that are no longer offered. Kept (inactive) so imported history
-- shows the category it was raised under. They never appear on the request form.
INSERT INTO categories (name, label, active, sort_order) VALUES
  ('Learning', 'Learning (old category)', FALSE, 900),
  ('Pest', 'Pest (old category)', FALSE, 901),
  ('Security: Locks & Keys', 'Security: Locks & Keys (old category)', FALSE, 902);

-- Service requests (event cover, escorting, clock changes ...) are not faults. Insights leaves them out
-- of "repeat problems", where 86 bookings of event cover at the Cutty Sark would drown out real repeat faults.
ALTER TABLE categories ADD COLUMN is_fault BOOLEAN NOT NULL DEFAULT TRUE AFTER active;
UPDATE categories SET is_fault = FALSE
 WHERE name LIKE 'Events - %'
    OR name IN ('Escorting RMG Subcontractor', 'Time Clock Adjustments', 'Signage (Marketing Only)', 'Catering Operations',
                'Engagement', 'Learning', 'Visitor Experience NMM', 'Visitor Experience ROG', 'Visitor Experience Cutty Sark');

-- migrate:down
ALTER TABLE categories DROP COLUMN is_fault;
DELETE FROM categories WHERE name IN ('Learning', 'Pest', 'Security: Locks & Keys')
  AND NOT EXISTS (SELECT 1 FROM tickets t WHERE t.category_id = categories.id);
