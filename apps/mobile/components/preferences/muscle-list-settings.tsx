import { useRouter } from 'expo-router';
import { ChoiceRow, FormSection } from '@/components/ui';
import { settingsMuscleHref } from '@/src/navigation/routes';
import { buildMuscleListSections } from '@/src/preferences/muscle-setup-view';
import { MuscleSetupShell } from './muscle-settings';

/**
 * Settings → Muscles → Muscles ([[muscle.report-groups]]): every muscle by
 * family, valued `Off`, `On` or its combined muscle's name; a row opens the
 * muscle's page.
 */
export function MuscleListPage() {
  const router = useRouter();
  return <MuscleSetupShell testID="settings-muscle-list-screen">
    {({ loaded }) => loaded ? buildMuscleListSections(loaded).map(section =>
      <FormSection key={section.family} testID={`settings-muscles-family-${section.family}`} title={section.showHeader ? section.family : undefined}>
        {section.muscles.map((muscle, index) => <ChoiceRow key={muscle.id} accessibilityLabel={`${muscle.label}, ${muscle.value}`}
          divider={index > 0} label={muscle.label} onPress={() => router.push(settingsMuscleHref(muscle.id))}
          testID={`settings-muscle-${muscle.id}`} value={muscle.value} />)}
      </FormSection>) : null}
  </MuscleSetupShell>;
}
