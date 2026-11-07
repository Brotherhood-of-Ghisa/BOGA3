import { Text } from 'react-native';
import { screen } from '@testing-library/react-native';

import { changeToneColour, changeToneColourIn } from '@/components/ui/change-tone';
import { uiText, uiTextTone, useUiText, useUiTextTone } from '@/components/ui/text-roles';
import { DEFAULT_APPEARANCE, type AppearanceChoice } from '@/components/ui/theme-presets';

import { renderWithTheme, rolesFor, switchTheme } from './helpers/theme';

const SLATE_DARK: AppearanceChoice = { theme: 'slate', mode: 'dark', custom: null };

function Probe() {
  const text = useUiText();
  const tone = useUiTextTone();
  return (
    <Text testID="probe" style={[text.label, tone.accent]}>
      Sets
    </Text>
  );
}

describe('live text roles', () => {
  it('draw the launch colours until a theme is saved, then the saved theme', async () => {
    await switchTheme(DEFAULT_APPEARANCE);
    renderWithTheme(<Probe />);
    const colour = () => (screen.getByTestId('probe').props.style as { color?: string }[]).map((s) => s.color).pop();
    expect(colour()).toBe(rolesFor(DEFAULT_APPEARANCE).accent);

    await switchTheme(SLATE_DARK);

    expect(colour()).toBe(rolesFor(SLATE_DARK).accent);
    expect(colour()).not.toBe(rolesFor(DEFAULT_APPEARANCE).accent);
  });

  it('keep the launch constants equal in value to the live sheets at launch', () => {
    const roles = rolesFor(DEFAULT_APPEARANCE);
    expect(uiText.title.color).toBe(roles.ink);
    expect(uiTextTone.record).toMatchObject({ color: roles.record, fontWeight: '700' });
  });
});

describe('changeToneColourIn', () => {
  it.each([
    ['positive', 'gain'],
    ['new', 'gain'],
    ['negative', 'loss'],
    ['neutral', 'ink'],
  ] as const)('draws %s in the %s role of the given roles', (tone, role) => {
    const roles = rolesFor(SLATE_DARK);
    expect(changeToneColourIn(roles, tone)).toBe(roles[role]);
    expect(changeToneColour(tone)).toBe(changeToneColourIn(rolesFor(DEFAULT_APPEARANCE), tone));
  });
});
