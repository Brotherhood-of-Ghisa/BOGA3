import { Stack, useRouter } from 'expo-router';
import { Text } from 'react-native';
import { ActionRow, FormSection, RadioRow, useUiText } from '@/components/ui';
import type { MuscleReportRow } from '@/src/data/combined-muscles';
import { setMuscleState, setMuscleTracked, type MuscleSetupChange } from '@/src/data/muscle-report-settings';
import { settingsCombinedMuscleHref } from '@/src/navigation/routes';
import {
  combinedMusclesOfFamily, isSameChoice, muscleChoiceOf, muscleChoiceWrite, type MuscleChoice,
} from '@/src/preferences/muscle-setup-view';
import { MuscleSetupShell, type MuscleSetupState } from './muscle-settings';

/**
 * One muscle's page ([[muscle.report-groups]]), titled with its name: one
 * choice of Off, On, or a combined muscle of its family ("Combine into"), each
 * saved at once; `New combined muscle…` opens the editor for its family with
 * this muscle ticked.
 */
export function MuscleChoicePage({ muscleId }: { muscleId: string }) {
  return <MuscleSetupShell testID="settings-muscle-screen">
    {({ loaded, setup }) => loaded ? <MuscleChoices loaded={loaded} muscleId={muscleId} setup={setup} /> : null}
  </MuscleSetupShell>;
}

function MuscleChoices({ loaded, muscleId, setup }: { loaded: MuscleSetupChange; muscleId: string; setup: MuscleSetupState }) {
  const router = useRouter();
  const text = useUiText();
  const row = loaded.rows.find(candidate => candidate.id === muscleId);
  if (!row) return <Text allowFontScaling={false} style={text.meta} testID="settings-muscle-missing">No such muscle.</Text>;
  const current = muscleChoiceOf(row);
  const choose = (next: MuscleChoice) => { if (muscleChoiceWrite(row, next)) void setup.change(() => writeChoice(row, next)); };
  const combined = combinedMusclesOfFamily(loaded, row.familyName);
  return <>
    <Stack.Screen options={{ title: row.displayName }} />
    <FormSection>
      <RadioRow checked={current === 'off'} disabled={setup.busy} label="Off" onPress={() => choose('off')} testID="settings-muscle-off" />
      <RadioRow checked={current === 'own'} disabled={setup.busy} divider label="On" onPress={() => choose('own')} testID="settings-muscle-on" />
    </FormSection>
    <FormSection title="Combine into">
      {combined.map((muscle, index) => <RadioRow key={muscle.key} checked={isSameChoice(current, { key: muscle.key })}
        description={muscle.members || undefined} disabled={setup.busy} divider={index > 0} label={muscle.name}
        onPress={() => choose({ key: muscle.key })} testID={`settings-muscle-combine-${muscle.key}`} />)}
      <ActionRow disabled={setup.busy} divider={combined.length > 0} icon="plus" label="New combined muscle…"
        onPress={() => router.push(settingsCombinedMuscleHref({ family: row.familyName, memberId: row.id }))}
        testID="settings-muscle-new-combined" />
    </FormSection>
  </>;
}

const writeChoice = async (row: MuscleReportRow, next: MuscleChoice): Promise<void> => {
  const write = muscleChoiceWrite(row, next);
  if (write?.kind === 'tracked') await setMuscleTracked([row.id], write.tracked);
  if (write?.kind === 'state') await setMuscleState([row.id], write.state);
};
