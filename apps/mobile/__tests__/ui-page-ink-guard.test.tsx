import { screen } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';

import { headerStyleOptions } from '@/components/navigation/header-style';
import { HeaderTitleMenu } from '@/components/ui/header-title-menu';
import { Icon } from '@/components/ui/icon';
import { Notice } from '@/components/ui/notice';
import { PageHeader, SectionHeader } from '@/components/ui/page-header';
import { SwipePages } from '@/components/ui/swipe-pages';
import { uiTextFor } from '@/components/ui/text-roles';
import type { AppearanceChoice } from '@/components/ui/theme-presets';

import { renderWithTheme, rolesFor, switchTheme } from './helpers/theme';

// Text drawn straight on the page takes the page inks (`design-language.md`
// §2): on Ink + paper the page is dark under light cards, so a page title,
// section heading, pager tab, header title or neutral notice drawn in `ink`,
// `inkMuted` or `inkFaint` would vanish. Each page-level component is drawn in
// Ink + paper and every colour it gives its words and glyphs is read back.

const INK_PAPER: AppearanceChoice = { theme: 'ink-paper', mode: 'light', custom: null };

const textColours = (): string[] =>
  screen.UNSAFE_getAllByType(Text).map((node) => StyleSheet.flatten(node.props.style)?.color as string);

const iconRoles = (): string[] => screen.UNSAFE_queryAllByType(Icon).map((node) => node.props.colorRole as string);

describe('page-level text on Ink + paper', () => {
  const roles = () => rolesFor(INK_PAPER);
  const pageInks = () => [roles().pageInk, roles().pageInkMuted, roles().pageInkFaint];
  const cardInks = () => [roles().ink, roles().inkMuted, roles().inkFaint];

  beforeEach(async () => {
    await switchTheme(INK_PAPER);
  });

  it('draws apart from the inks: the guard below can tell them apart', () => {
    for (const ink of cardInks()) expect(pageInks()).not.toContain(ink);
  });

  it.each([
    ['a page title', <PageHeader key="page" title="Sign in" />],
    ['a section heading', <SectionHeader key="section" title="Volume" />],
    ['a neutral notice', <Notice icon="offline" key="notice" message="You are offline." title="Offline" />],
    [
      'a pager’s tabs',
      <SwipePages
        key="pager"
        onPageChange={() => {}}
        page={0}
        pages={[
          { key: 'plan', label: 'Plan', render: () => null, tabTestID: 'tab-plan' },
          { key: 'you', label: 'You', render: () => null, tabTestID: 'tab-you' },
        ]}
        testID="pager"
      />,
    ],
    [
      'a header title menu',
      <HeaderTitleMenu currentId="a" key="menu" onChoose={() => {}} options={[{ id: 'a', label: 'Bench Press' }]} sheetTitle="Exercise" testID="menu" />,
    ],
  ])('draws %s in the page inks, never the inks', async (_name, ui) => {
    renderWithTheme(ui);
    await switchTheme(INK_PAPER);
    const colours = textColours();
    expect(colours.length).toBeGreaterThan(0);
    for (const colour of colours) {
      expect(pageInks()).toContain(colour);
      expect(cardInks()).not.toContain(colour);
    }
    for (const role of iconRoles()) expect(['pageInk', 'pageInkMuted', 'pageInkFaint']).toContain(role);
  });

  it('draws a header’s title and back arrow in `pageInk`', () => {
    const { title } = uiTextFor(roles());
    const options = headerStyleOptions(roles(), title);
    expect(options.headerTitleStyle.color).toBe(roles().pageInk);
    expect(options.headerTintColor).toBe(roles().pageInk);
    expect(options.headerStyle.backgroundColor).toBe(roles().paper);
  });

  it('stands a failed notice on a card, where `danger` reads', async () => {
    renderWithTheme(<Notice message="Could not save." testID="failed" tone="danger" />);
    await switchTheme(INK_PAPER);
    expect(StyleSheet.flatten(screen.getByTestId('failed').props.style).backgroundColor).toBe(roles().surface);
    expect(textColours()).toEqual([roles().danger]);
  });
});
