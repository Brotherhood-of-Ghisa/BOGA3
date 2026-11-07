import { StyleSheet, type TextStyle } from 'react-native';

import { textRoles, uiText, uiTextTone } from '@/components/ui/text-roles';
import { DEFAULT_APPEARANCE, type AppearanceChoice } from '@/components/ui/theme-presets';

import { rolesFor } from './helpers/theme';

// The text roles drawn in the colours a theme resolves to
// (`components/ui/text-roles.ts`): what a live screen reads through
// `useTextRoles()`, and what a `makeStyles` sheet spreads in.

const flat = (style: unknown): TextStyle => StyleSheet.flatten(style as never) as TextStyle;

const SLATE_DARK: AppearanceChoice = { theme: 'slate', mode: 'dark', custom: null };

describe('textRoles', () => {
  it('draws each role and tone in the colours of the roles it is given', () => {
    const roles = rolesFor(SLATE_DARK);
    const { text, tone } = textRoles(roles);
    expect(flat(text.body).color).toBe(roles.ink);
    expect(flat(text.meta).color).toBe(roles.inkMuted);
    expect(flat(tone.faint).color).toBe(roles.inkFaint);
    expect(flat(tone.record)).toEqual({ color: roles.record, fontWeight: '700' });
  });

  it('keeps the face, size and weight of a role whatever the theme', () => {
    const light = textRoles(rolesFor(DEFAULT_APPEARANCE)).text;
    const dark = textRoles(rolesFor(SLATE_DARK)).text;
    expect({ ...flat(dark.title), color: undefined }).toEqual({ ...flat(light.title), color: undefined });
    expect(flat(dark.title).color).not.toBe(flat(light.title).color);
  });

  it('builds one set per set of roles', () => {
    const roles = rolesFor(SLATE_DARK);
    expect(textRoles(roles)).toBe(textRoles(roles));
    expect(textRoles(rolesFor(DEFAULT_APPEARANCE))).not.toBe(textRoles(roles));
  });

  it('leaves the launch constants as the roles of the launch theme', () => {
    const launch = textRoles(rolesFor(DEFAULT_APPEARANCE));
    expect(uiText.body).toEqual(launch.text.body);
    expect(uiTextTone.danger).toEqual(launch.tone.danger);
  });
});
