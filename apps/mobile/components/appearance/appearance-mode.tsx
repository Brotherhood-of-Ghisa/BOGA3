import {
  ChoiceMeta,
  details,
  SAVE_FAILED,
  type SectionProps,
} from '@/components/appearance/appearance-neutrals';
import { appearanceRoles, MODE_LABELS } from '@/components/appearance/chosen-theme';
import { FormSection, RadioRow } from '@/components/ui';
import { APPEARANCE_MODES } from '@/components/ui/theme-presets';

// Settings → Appearance → Mode: Light (the default), Dark, or System, which
// takes the phone's mode each time the app opens. Each row's swatch is the
// choice drawn in that mode.
export function ModeSection({ appearance, pending, commit }: Omit<SectionProps, 'footnote'>) {
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
