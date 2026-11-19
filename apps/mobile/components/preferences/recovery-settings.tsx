import { FormSection, SegmentRow } from '@/components/ui';
import type { AccountLocalPreferenceState } from '@/src/preferences/account-local';
import { updatePreferences } from '@/src/preferences/hooks';

const OPTIONS = [{ value: 4, label: '4 days' }, { value: 7, label: '7 days' }] as const;

// Draw the durable selection; Data & sync's Refresh retries a failed write.
export function RecoverySettings({ state }: { state: AccountLocalPreferenceState }) {
  return <FormSection>
    <SegmentRow label="Recovery Days" options={OPTIONS} value={state.values.recoveryDays}
      onChange={recoveryDays => updatePreferences({ recoveryDays })} testIDPrefix="settings-recovery-days" />
  </FormSection>;
}
