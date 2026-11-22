-- Older builds could have pulled Health rows before understanding their new
-- source fields. Mark them read-only immediately. Pull hydrates missing source
-- metadata even beside an unsent value edit, retaining its clock and dirty bit.
UPDATE body_weight_measurements SET source = 'apple_health'
WHERE id LIKE 'apple-health-weight:%' AND external_id IS NULL;
--> statement-breakpoint
UPDATE sync_runtime_state SET pull_cursor = '{}';
