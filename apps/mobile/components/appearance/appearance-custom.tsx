import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { CUSTOM_PART_LABELS, customPartLabel } from '@/components/appearance/chosen-theme';
import type { CommitFailure, CommitOutcome } from '@/components/appearance/use-appearance-commit';
import { ChoiceRow, FormSection, uiBorder, uiGeometry, uiSpace, useUiText, useUiTextTone } from '@/components/ui';
import type { UiRoles } from '@/components/ui/theme';
import { CUSTOM_PARTS } from '@/components/ui/theme-custom';
import type { AppearanceChoice } from '@/components/ui/theme-presets';
import { themeCustomHref } from '@/src/navigation/routes';

export type CommitChoice = (part: Partial<AppearanceChoice>, failure: CommitFailure) => Promise<CommitOutcome>;

export type SectionProps = {
  appearance: AppearanceChoice;
  commit: CommitChoice;
};

export const SAVE_FAILED = 'Couldn’t save the theme. Nothing changed.';

// Settings → Appearance → Custom colours, shown while Custom is the theme: one
// row per part, each opening its picker.
export function CustomSection({ appearance }: Omit<SectionProps, 'commit'>) {
  const router = useRouter();
  return (
    <FormSection testID="settings-appearance-custom" title="Custom colours">
      {CUSTOM_PARTS.map((part, index) => (
        <ChoiceRow
          accessibilityLabel={`${CUSTOM_PART_LABELS[part]}, ${customPartLabel(appearance, part)}`}
          divider={index > 0}
          key={part}
          label={CUSTOM_PART_LABELS[part]}
          onPress={() => router.push(themeCustomHref(part))}
          testID={`settings-appearance-custom-${part}`}
          value={customPartLabel(appearance, part)}
        />
      ))}
    </FormSection>
  );
}

// A choice's words, then its swatch.
export function ChoiceMeta({ details: words, roles, swatchTestID }: { details: string[]; roles: UiRoles; swatchTestID?: string }) {
  const text = useUiText();
  const tone = useUiTextTone();
  return (
    <View style={styles.meta}>
      {words.length > 0 ? (
        <Text allowFontScaling={false} style={[text.meta, tone.muted]}>
          {words.join(' · ')}
        </Text>
      ) : null}
      <Swatch roles={roles} testID={swatchTestID} />
    </View>
  );
}

// A choice as its own colours: `ink`, `accent`, `record` and the ramp's third
// step on its `paper`. These are another theme's values, so they cannot be
// roles of this one.
function Swatch({ roles, testID }: { roles: UiRoles; testID?: string }) {
  return (
    <View
      importantForAccessibility="no-hide-descendants"
      style={[styles.swatch, { backgroundColor: roles.paper, borderColor: roles.rule }]}
      testID={testID}>
      {[roles.ink, roles.accent, roles.record, roles.viz3].map((colour, index) => (
        <View key={index} style={[styles.swatchMark, { backgroundColor: colour }]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
  },
  swatch: {
    flexDirection: 'row',
    gap: uiSpace.xs,
    padding: uiSpace.xs,
    borderWidth: uiBorder.width,
    borderRadius: uiGeometry.radius.control,
  },
  swatchMark: {
    width: uiSpace.md,
    height: uiSpace.xl,
    borderRadius: uiGeometry.radius.control / 2,
  },
});
