/** @jest-environment node */
import { readFileSync } from 'fs';
import { join } from 'path';

const migration = readFileSync(join(__dirname,
  '../../../supabase/migrations/20261022201529_notification_moment_admission.sql'), 'utf8');

// Fast contract guards; notification-workout-events.sh executes the real SQL regressions.
describe('notification admission migration', () => {
  test('cutover schedules each source from its earliest unexpired moment', () => {
    const seed = migration.slice(migration.indexOf('insert into app_public.notification_moment_queue'));
    expect(seed).toContain("min(greatest(now(),event_at-interval '5 minutes'))");
    expect(seed).toContain("where event_at+interval '24 hours'>now()");
  });

  test('capture queues only unexpired non-null moments and reports the insert result', () => {
    const append = migration.split('create function app_public.notification_append_moment')[1].split('end $$;')[0];
    expect(append).toMatch(/insert into notification_moment_queue[\s\S]*event_at\+interval '24 hours'>now\(\);\s*return found;/);
  });

  test('transaction kick is consumed only by an actual dispatch', () => {
    const idleMigration = readFileSync(join(__dirname,
      '../../../supabase/migrations/20261022184807_notification_idle_work.sql'), 'utf8');
    const kick = idleMigration.split('create or replace function app_public.notification_kick_once')[1].split('end $$;')[0];
    expect(kick).toContain("if current_setting('boga.notification_kicked',true)='true' then return; end if;");
    expect(kick).toMatch(/if notification_sweep\(\) is not null then\s*perform set_config\('boga.notification_kicked','true',true\);\s*end if;/);
  });
});
