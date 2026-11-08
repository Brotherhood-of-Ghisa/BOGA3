import { screen } from '@testing-library/react-native';
import { StyleSheet, Switch, Text, type StyleProp } from 'react-native';

import {
  ActionButton,
  Card,
  FormField,
  ListRow,
  Notice,
  SearchField,
  SegmentedControl,
  Sheet,
  Stat,
  StatePanel,
  SwitchRow,
  Tag,
  ToggleChip,
  uiTextFor,
  useUiText,
} from '@/components/ui';
import type { AppearanceChoice } from '@/components/ui/theme-presets';

import { renderWithTheme, rolesFor, switchTheme } from './helpers/theme';

// The primitives in `components/ui/` draw in the theme the app is in now: a
// saved choice repaints each one without a remount. Each case renders one
// primitive in the provider, switches the theme and reads the colour back from
// `rolesFor(...)`, not from a constant.

const LIGHT: AppearanceChoice = { theme: 'warm', mode: 'light', custom: null };
const SLATE_DARK: AppearanceChoice = { theme: 'slate', mode: 'dark', custom: null };

const style = (id: string) => StyleSheet.flatten(screen.getByTestId(id).props.style as StyleProp<object>) as Record<string, unknown>;

async function repaints(read: () => unknown, role: (roles: ReturnType<typeof rolesFor>) => unknown) {
  expect(read()).toBe(role(rolesFor(LIGHT)));
  await switchTheme(SLATE_DARK);
  expect(role(rolesFor(SLATE_DARK))).not.toBe(role(rolesFor(LIGHT)));
  expect(read()).toBe(role(rolesFor(SLATE_DARK)));
}

describe('components/ui repaints when the theme changes', () => {
  it('Card: surface and rule', async () => {
    renderWithTheme(<Card testID="card">{null}</Card>);
    await repaints(() => style('card').backgroundColor, (roles) => roles.surface);
    expect(style('card').borderColor).toBe(rolesFor(SLATE_DARK).rule);
  });

  it('ActionButton: the primary fill and its label', async () => {
    renderWithTheme(<ActionButton label="Save" onPress={() => {}} testID="save" variant="primary" />);
    await repaints(() => style('save').backgroundColor, (roles) => roles.accent);
    expect(StyleSheet.flatten(screen.getByText('Save').props.style).color).toBe(rolesFor(SLATE_DARK).onAccent);
  });

  it('Notice: the band and a danger message', async () => {
    renderWithTheme(<Notice message="Could not save" testID="notice" tone="danger" />);
    await repaints(() => style('notice').backgroundColor, (roles) => roles.paper);
    expect(style('notice').borderColor).toBe(rolesFor(SLATE_DARK).danger);
    expect(StyleSheet.flatten(screen.getByText('Could not save').props.style).color).toBe(rolesFor(SLATE_DARK).danger);
  });

  it('FormField: the placeholder, the field and its error', async () => {
    renderWithTheme(<FormField error="Required" label="Weight" onChangeText={() => {}} testID="weight" value="" />);
    await repaints(() => screen.getByTestId('weight').props.placeholderTextColor, (roles) => roles.inkGhost);
    expect(StyleSheet.flatten(screen.getByText('Required').props.style).color).toBe(rolesFor(SLATE_DARK).danger);
  });

  it('SearchField: the placeholder', async () => {
    renderWithTheme(<SearchField accessibilityLabel="Filter" onChangeText={() => {}} testID="search" value="" />);
    await repaints(() => screen.getByTestId('search').props.placeholderTextColor, (roles) => roles.inkFaint);
  });

  it('SwitchRow: the switch track', async () => {
    renderWithTheme(<SwitchRow label="Sound" onValueChange={() => {}} testID="sound" value />);
    await repaints(() => screen.UNSAFE_getByType(Switch).props.trackColor.true, (roles) => roles.accent);
  });

  it('SegmentedControl: the selected segment', async () => {
    renderWithTheme(
      <SegmentedControl
        onChange={() => {}}
        options={[
          { value: 'a', label: 'A' },
          { value: 'b', label: 'B' },
        ]}
        testIDPrefix="seg"
        value="a"
      />,
    );
    const flat = () => StyleSheet.flatten(screen.getByTestId('seg-a').props.style as StyleProp<object>) as Record<string, unknown>;
    await repaints(() => flat().backgroundColor, (roles) => roles.ink);
  });

  it('ListRow: the selected wash and a danger label', async () => {
    renderWithTheme(
      <>
        <ListRow label="Pick" selected testID="row" />
        <ListRow label="Delete" tone="danger" />
      </>,
    );
    await repaints(() => style('row').backgroundColor, (roles) => roles.accentWash);
    expect(StyleSheet.flatten(screen.getByText('Delete').props.style).color).toBe(rolesFor(SLATE_DARK).danger);
  });

  it('StatePanel: its words', async () => {
    renderWithTheme(<StatePanel body="Nothing here" kind="message" title="Empty" />);
    const body = () => StyleSheet.flatten(screen.getByText('Nothing here').props.style).color;
    await repaints(body, (roles) => roles.inkMuted);
  });

  it('Stat: the legend and a record figure', async () => {
    renderWithTheme(<Stat emphasis="record" label="1RM" value="120" />);
    const figure = () => StyleSheet.flatten(screen.getByText('120').props.style).color;
    await repaints(figure, (roles) => roles.record);
    expect(StyleSheet.flatten(screen.getByText('1RM').props.style).color).toBe(rolesFor(SLATE_DARK).inkFaint);
  });

  it('Tag and ToggleChip: surface and rule', async () => {
    renderWithTheme(
      <>
        <Tag label="PR" testID="tag" />
        <ToggleChip accessibilityLabel="Unit" onChange={() => {}} options={[{ value: 1, label: 'kg' }, { value: 2, label: 'lb' }]} testID="chip" value={1} />
      </>,
    );
    await repaints(() => style('tag').backgroundColor, (roles) => roles.surface);
    expect(style('chip').borderColor).toBe(rolesFor(SLATE_DARK).rule);
  });

  it('Sheet: the surface behind its title', async () => {
    renderWithTheme(
      <Sheet dismissLabel="Dismiss" onDismiss={() => {}} testID="sheet" title="Pick" visible>
        {null}
      </Sheet>,
    );
    await repaints(() => style('sheet').backgroundColor, (roles) => roles.surface);
  });
});

describe('text roles take the roles they are drawn in', () => {
  it('builds each sheet once per set of roles, in the colours of those roles', () => {
    const light = rolesFor(LIGHT);
    const dark = rolesFor(SLATE_DARK);
    expect(uiTextFor(light)).toBe(uiTextFor(light));
    expect(uiTextFor(light).body.color).toBe(light.ink);
    expect(uiTextFor(dark).body.color).toBe(dark.ink);
    expect(uiTextFor(dark).meta.color).toBe(dark.inkMuted);
  });

  it('useUiText follows the theme', async () => {
    function Probe() {
      return <Text testID="probe" style={useUiText().title} />;
    }
    renderWithTheme(<Probe />);
    await repaints(() => style('probe').color, (roles) => roles.ink);
  });
});
