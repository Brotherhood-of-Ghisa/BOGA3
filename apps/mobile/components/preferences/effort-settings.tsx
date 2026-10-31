import { StyleSheet, View } from 'react-native';
import { CheckRow, FormSection, uiSpace } from '@/components/ui';
import { EFFORT_CHOICES, type EffortChoice } from '@/src/exercise-calculations/effort-policy';
import { updatePreferences } from '@/src/preferences/hooks';
import type { AccountLocalPreferences } from '@/src/preferences/model';

const sections = [
  { field: 'displayEfforts', title: 'Display' },
  { field: 'workingSetEfforts', title: 'Working set' },
  { field: 'volumeEfforts', title: 'Volume' },
] as const;

// The effort page: Display, Working set and Volume, each a section of one
// check row per effort choice.
export function EffortSettings({ values }: { values: AccountLocalPreferences }) {
  const toggle = (field: typeof sections[number]['field'], id: EffortChoice) => {
    const selected = values[field];
    updatePreferences({ [field]: selected.includes(id) ? selected.filter(value => value !== id) : [...selected, id] });
  };
  return <View style={styles.page} testID="settings-effort-selections">
    {sections.map(({ field, title }) => <FormSection key={field} title={title}>
      {EFFORT_CHOICES.map((choice, index) => <CheckRow key={choice.id} accessibilityLabel={`${choice.label}, ${title}`}
        checked={values[field].includes(choice.id)} divider={index > 0} label={choice.label}
        onPress={() => toggle(field, choice.id)} testID={`settings-effort-${choice.id}-${field}`} />)}
    </FormSection>)}
  </View>;
}

const styles = StyleSheet.create({
  page: { gap: uiSpace.md },
});
