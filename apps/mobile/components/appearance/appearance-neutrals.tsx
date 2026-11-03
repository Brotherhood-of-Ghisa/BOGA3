import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { appearanceRoles, BACKGROUND_TINT_LABELS, type PendingAppearance } from '@/components/appearance/chosen-theme';
import type { CommitFailure, CommitOutcome } from '@/components/appearance/use-appearance-commit';
import { ChoiceRow, FormSection, RadioRow, uiBorder, uiGeometry, uiSpace, uiText, uiTextTone } from '@/components/ui';
import { hueName } from '@/components/ui/theme-hue';
import { backgroundSwatches, textInks } from '@/components/ui/theme-neutrals';
import type { AppearanceChoice } from '@/components/ui/theme-presets';
import type { UiRoles } from '@/components/ui/theme';
import { THEME_BACKGROUND_ROUTE } from '@/src/navigation/routes';

export type CommitChoice = (part: Partial<AppearanceChoice>, failure: CommitFailure) => Promise<CommitOutcome>;

type SectionProps = {
  appearance: AppearanceChoice;
  pending: PendingAppearance;
  commit: CommitChoice;
  footnote?: string;
};

const SAVE_FAILED = 'Couldn’t save the theme. Nothing changed.';

// The words beside a choice's name: `Default` on the theme's own neutral, and
// `Next launch` on the chosen row while it waits for the next launch.
function details(isDefault: boolean, checked: boolean, pending: boolean): string[] {
  return [...(isDefault ? ['Default'] : []), ...(checked && pending ? ['Next launch'] : [])];
}

// Settings → Appearance → Background: the theme's own neutral, five swatches,
// then Custom, which opens the hue ring and tint.
export function BackgroundSection({ appearance, pending, commit, footnote }: SectionProps) {
  const router = useRouter();
  const { background } = appearance;
  const choices = [{ id: 'match' as const, label: 'Match theme' }, ...backgroundSwatches];
  return (
    <FormSection footnote={footnote} testID="settings-appearance-background" title="Background">
      {choices.map((choice, index) => {
        const checked = background === choice.id;
        const detail = details(choice.id === 'match', checked, pending.background);
        return (
          <RadioRow
            accessibilityLabel={[choice.label, ...detail.map((word) => word.toLowerCase())].join(', ')}
            checked={checked}
            divider={index > 0}
            key={choice.id}
            label={choice.label}
            meta={<Meta details={detail} roles={appearanceRoles({ ...appearance, background: choice.id })} />}
            onPress={() => {
              void commit({ background: choice.id }, { message: SAVE_FAILED, context: { background: choice.id } });
            }}
            testID={`settings-appearance-background-${choice.id}`}
          />
        );
      })}
      <ChoiceRow
        accessibilityLabel={typeof background === 'object' ? undefined : 'Custom background'}
        divider
        label="Custom background"
        onPress={() => router.push(THEME_BACKGROUND_ROUTE)}
        testID="settings-appearance-background-custom"
        value={typeof background === 'object' ? customBackgroundValue(background, pending.background) : undefined}
      />
    </FormSection>
  );
}

function customBackgroundValue(background: Exclude<AppearanceChoice['background'], string>, pending: boolean): string {
  return `${hueName(background.hue)}, ${BACKGROUND_TINT_LABELS[background.tint]}${pending ? ' · Next launch' : ''}`;
}

// Settings → Appearance → Text: the background's own tint, or one of four
// tinted inks.
export function TextSection({ appearance, pending, commit, footnote }: SectionProps) {
  const choices = [{ id: 'match' as const, label: 'Match background' }, ...textInks];
  return (
    <FormSection footnote={footnote} testID="settings-appearance-text" title="Text">
      {choices.map((choice, index) => {
        const checked = appearance.text === choice.id;
        const detail = details(choice.id === 'match', checked, pending.text);
        return (
          <RadioRow
            accessibilityLabel={[choice.label, ...detail.map((word) => word.toLowerCase())].join(', ')}
            checked={checked}
            divider={index > 0}
            key={choice.id}
            label={choice.label}
            meta={<Meta details={detail} roles={appearanceRoles({ ...appearance, text: choice.id })} />}
            onPress={() => {
              void commit({ text: choice.id }, { message: SAVE_FAILED, context: { text: choice.id } });
            }}
            testID={`settings-appearance-text-${choice.id}`}
          />
        );
      })}
    </FormSection>
  );
}

function Meta({ details: words, roles }: { details: string[]; roles: UiRoles }) {
  return (
    <View style={styles.meta}>
      {words.length > 0 ? (
        <Text allowFontScaling={false} style={[uiText.meta, uiTextTone.muted]}>
          {words.join(' · ')}
        </Text>
      ) : null}
      <NeutralSwatch roles={roles} />
    </View>
  );
}

// A choice as its own colours: the page it draws, a hairline in its `rule`, and
// its inks. These are another theme's values, so they cannot be roles of this one.
function NeutralSwatch({ roles }: { roles: UiRoles }) {
  return (
    <View
      importantForAccessibility="no-hide-descendants"
      style={[styles.swatch, { backgroundColor: roles.paper, borderColor: roles.rule }]}>
      {[roles.ruleSoft, roles.rule, roles.inkGhost, roles.inkMuted, roles.ink].map((colour, index) => (
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
    width: uiSpace.sm,
    height: uiSpace.xl,
    borderRadius: uiGeometry.radius.control / 2,
  },
});
