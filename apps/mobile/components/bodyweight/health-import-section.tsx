import { ActionButton, FormSection, Notice, SwitchRow } from '@/components/ui';
import { disableBodyWeightImport, enableBodyWeightImport, importBodyWeightsNow,
  useBodyWeightImport } from '@/src/health-import/bodyweight-lifecycle';

/** Independent, device/account-local choice to read measurements from first enable onward. */
export function BodyWeightHealthImportSection() {
  const health = useBodyWeightImport();
  if (!health.supported || !health.signedIn) return null;
  return <>
    <FormSection title="Health">
      <SwitchRow label="Import from Apple Health" density="list" value={health.enabled}
        disabled={health.enabling} testID="body-weight-health-import"
        onValueChange={enabled => { if (enabled) void enableBodyWeightImport(); else disableBodyWeightImport(); }} />
    </FormSection>
    {health.error ? <Notice live tone="danger" message={health.error} testID="body-weight-health-error"
      action={<ActionButton label="Retry" variant="text" disabled={health.busy || health.enabling}
        onPress={() => void (health.enabled ? importBodyWeightsNow() : enableBodyWeightImport())} />} /> : null}
  </>;
}
