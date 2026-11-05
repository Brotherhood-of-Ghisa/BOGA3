import { ChoiceMeta, details, SAVE_FAILED, type SectionProps } from '@/components/appearance/appearance-custom';
import { appearanceRoles, MODE_LABELS } from '@/components/appearance/chosen-theme';
import { FormSection, RadioRow } from '@/components/ui';
import { APPEARANCE_MODES } from '@/components/ui/theme-presets';

// Settings → Appearance → Mode, shown while a preset is the theme: Light (the
// default), Dark, or System, which takes the phone's mode each time the app
// opens. Each row's swatch is the preset drawn in that mode.
export function ModeSection({ appearance, pending, commit }: SectionProps) {
  return (
    <FormSection footnote="System applies the phone’s mode at launch" testID="settings-appearance-mode" title="Mode">
      {APPEARANCE_MODES.map((mode, index) => {
        const checked = appearance.mode === mode;
        const label = MODE_LABELS[mode];
        const detail = details(mode === 'light', checked, pending.mode);
        return (
          <RadioRow
            accessibilityLabel={[label, ...detail.map((word) => word.toLowerCase())].join(', ')}
            checked={checked}
            divider={index > 0}
            key={mode}
            label={label}
            meta={<ChoiceMeta details={detail} roles={appearanceRoles({ ...appearance, mode })} />}
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
