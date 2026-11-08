import { ChoiceMeta, SAVE_FAILED, type SectionProps } from '@/components/appearance/appearance-custom';
import { appearanceRoles, MODE_LABELS, usePhoneScheme } from '@/components/appearance/chosen-theme';
import { FormSection, RadioRow } from '@/components/ui';
import { APPEARANCE_MODES } from '@/components/ui/theme-presets';

// Settings → Appearance → Mode, shown while a preset is the theme: Light (the
// default), Dark, or System, which follows the phone's mode while the app
// runs. Each row's swatch is the preset drawn in that mode.
export function ModeSection({ appearance, commit }: SectionProps) {
  const phoneScheme = usePhoneScheme();
  return (
    <FormSection footnote="System follows the phone’s mode" testID="settings-appearance-mode" title="Mode">
      {APPEARANCE_MODES.map((mode, index) => {
        const checked = appearance.mode === mode;
        const label = MODE_LABELS[mode];
        const detail = mode === 'light' ? ['Default'] : [];
        return (
          <RadioRow
            accessibilityLabel={[label, ...detail.map((word) => word.toLowerCase())].join(', ')}
            checked={checked}
            divider={index > 0}
            key={mode}
            label={label}
            meta={<ChoiceMeta details={detail} roles={appearanceRoles({ ...appearance, mode }, phoneScheme)} />}
            onPress={() => {
              void commit({ mode }, { message: SAVE_FAILED, context: { mode } });
            }}
            testID={`settings-appearance-mode-${mode}`}
          />
        );
      })}
    </FormSection>
  );
}
