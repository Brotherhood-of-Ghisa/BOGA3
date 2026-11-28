import { FormSection, SwitchRow } from '@/components/ui';
import { describeGroupWriteError } from '@/src/groups';
import { setPredictionSetting } from '@/src/groups/api';
import { useGroupAction } from '@/src/groups/use-group-action';
import { usePredictionSetting } from '@/src/groups/use-predictions';
import { GroupMissingDataState, pickInlineError } from './group-state-view';

/**
 * Group Edit's `Predictions` row for owners and admins: an online write through the setting RPC, read back
 * after it. The screen renders it only under `isDevMode()` until launch.
 */
export function PredictionsSettingRow({ groupId, userId }: { groupId: string; userId: string }) {
  const setting = usePredictionSetting(groupId, userId);
  const action = useGroupAction((enabled: boolean) => setPredictionSetting(groupId, enabled));
  const change = async (enabled: boolean) => {
    const result = await action.run(enabled);
    if (result.ok || result.error.code === 'FORBIDDEN' || result.error.code === 'CONFLICT') await setting.refresh();
  };
  if (!setting.data) {
    return <GroupMissingDataState error={pickInlineError(setting.error)} offline={setting.offline} onRetry={() => void setting.refresh()} testIDPrefix="group-edit-predictions" />;
  }
  return (
    <FormSection error={action.error ? describeGroupWriteError(action.error) : null} errorTestID="group-edit-predictions-error">
      <SwitchRow density="list" disabled={action.pending} label="Predictions" onValueChange={enabled => void change(enabled)}
        testID="group-edit-predictions" value={setting.data.enabled} />
    </FormSection>
  );
}
