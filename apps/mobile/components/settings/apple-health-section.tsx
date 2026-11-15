import { ActionButton, FormSection, Notice, SwitchRow } from '@/components/ui';
import { disableHealthImport, enableHealthImport, importHealthActivitiesNow, useHealthImport } from '@/src/health-import';

/**
 * Data & sync's Apple Health switch: the person's choice to import workouts
 * on this phone. iOS never says whether reading was allowed, so the switch
 * shows the choice only, never a verified connection. Shown on iPhone while
 * signed in; a failure is a Notice with Retry (the import again, or the
 * permission sheet when turning on failed) until one succeeds.
 */
export function AppleHealthSection() {
  const health = useHealthImport();
  if (!health.supported || !health.signedIn) return null;
  return (
    <>
      <FormSection testID="settings-health" title="Health">
        <SwitchRow
          density="list"
          disabled={health.enabling}
          label="Apple Health"
          onValueChange={(next) => {
            if (next) void enableHealthImport();
            else disableHealthImport();
          }}
          testID="settings-apple-health"
          value={health.enabled}
        />
      </FormSection>
      {health.error ? (
        <Notice
          action={<ActionButton disabled={health.busy || health.enabling} label="Retry" onPress={() => void (health.enabled ? importHealthActivitiesNow() : enableHealthImport())} variant="text" />}
          icon="warning" live message={health.error} testID="settings-apple-health-error" tone="danger" />
      ) : null}
    </>
  );
}
