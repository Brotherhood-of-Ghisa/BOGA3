import { Stack, useRouter } from 'expo-router';
import { Alert, Text } from 'react-native';
import { ActionRow, ChoiceRow, FormSection, IconButton, useUiText } from '@/components/ui';
import { applyBroadTemplate } from '@/src/data/muscle-report-settings';
import { settingsCombinedMuscleHref } from '@/src/navigation/routes';
import { buildCombinedMuscleSections } from '@/src/preferences/muscle-setup-view';
import { MuscleSetupShell } from './muscle-settings';

/**
 * Settings → Muscles → Combined muscles ([[muscle.report-groups]]): each by
 * family with its members, a row opening its editor; `+` in the header and
 * `New combined muscle` open a new one. `Start from Broad…` confirms, then
 * replaces every combined muscle with the Broad template's.
 */
export function CombinedMusclesPage() {
  const router = useRouter();
  const text = useUiText();
  const create = () => router.push(settingsCombinedMuscleHref());
  return <MuscleSetupShell testID="settings-combined-muscles-screen">
    {({ loaded, setup }) => {
      const sections = loaded ? buildCombinedMuscleSections(loaded) : [];
      const startFromBroad = () => Alert.alert('Replace every combined muscle?', undefined, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Start from Broad', style: 'destructive', onPress: () => { void setup.change(applyBroadTemplate); } },
      ]);
      return <>
        <Stack.Screen options={{ headerRight: () => <IconButton accessibilityLabel="New combined muscle" name="plus"
          nativeHeader onPress={create} testID="settings-combined-muscles-add" /> }} />
        {sections.map(section => <FormSection key={section.family} testID={`settings-combined-family-${section.family}`} title={section.family}>
          {section.muscles.map((muscle, index) => <ChoiceRow key={muscle.key}
            accessibilityLabel={muscle.members ? `${muscle.name}, ${muscle.members}` : muscle.name}
            description={muscle.members || undefined} divider={index > 0} label={muscle.name}
            onPress={() => router.push(settingsCombinedMuscleHref({ key: muscle.key }))} testID={`settings-combined-${muscle.key}`} />)}
        </FormSection>)}
        {loaded && sections.length === 0
          ? <Text allowFontScaling={false} style={text.meta} testID="settings-combined-muscles-empty">No combined muscles.</Text> : null}
        {loaded ? <FormSection>
          <ActionRow disabled={setup.busy} icon="plus" label="New combined muscle" onPress={create} testID="settings-combined-muscles-new" />
          <ActionRow disabled={setup.busy} divider kind="danger" label="Start from Broad…" onPress={startFromBroad}
            testID="settings-combined-muscles-broad" />
        </FormSection> : null}
      </>;
    }}
  </MuscleSetupShell>;
}
