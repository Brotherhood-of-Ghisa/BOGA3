import { screen, within } from '@testing-library/react-native';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';
import { StyleSheet, Text } from 'react-native';

import { GroupBoardTitle } from '@/components/groups/group-board-title';
import { GroupsTitle } from '@/components/groups/group-screen-header';
import { headerStyleOptions } from '@/components/navigation/header-style';
import { SessionInsightPresentation } from '@/components/session-recorder/session-insight-presentation';
import { SessionTopBar } from '@/components/session-view/session-top-bar';
import { ActionButton } from '@/components/ui/action-button';
import { Card } from '@/components/ui/card';
import { FormSection } from '@/components/ui/form-section';
import { HeaderTitleMenu } from '@/components/ui/header-title-menu';
import { Icon } from '@/components/ui/icon';
import { IconButton } from '@/components/ui/icon-button';
import { Notice } from '@/components/ui/notice';
import { HistoryTitle } from '@/components/stats/history-title';
import { PageHeader, SectionHeader } from '@/components/ui/page-header';
import { StatePanel } from '@/components/ui/state-panel';
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
    ['a form section’s heading and footnote', <FormSection footnote="System follows the phone’s mode." key="form" title="Mode">{null}</FormSection>],
    ['a screen’s state panel', <StatePanel body="Groups need an account." key="state" title="Sign in to use groups" />],
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
    ['a history page’s header title', <HistoryTitle key="history" title="Bench Press" />],
    ['a group board’s header title', <GroupBoardTitle key="board" name="Bench Press" testID="board-title" view="1RM leaderboard" />],
    ['the Groups header title', <GroupsTitle canSwitch key="groups" maxWidth={220} name="Iron Crew" onPress={() => {}} />],
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

  it.each([
    ['a form section’s heading and footnote', <FormSection footnote="Shown on the card." key="form" title="Inline">{null}</FormSection>],
    ['an inline state panel', <StatePanel body="Nothing logged yet." fill={false} key="state" title="No sets" />],
    ['a section heading', <SectionHeader key="section" title="Volume" />],
  ])('draws %s inside a card in the inks, never the page inks', async (_name, ui) => {
    renderWithTheme(<Card>{ui}</Card>);
    await switchTheme(INK_PAPER);
    const colours = textColours();
    expect(colours.length).toBeGreaterThan(0);
    for (const colour of colours) expect(pageInks()).not.toContain(colour);
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

// `paper` is the page and nothing on it (`design-language.md` §2): a pressed
// row or control, the row that is mine, an action strip or a quieter panel
// inside a card sinks to `inset`, so on Ink + paper the card's inks still read
// on it. The files below draw a page, or read the page's colour for what it
// draws (the theme files, the preview and swatch of another theme, the status
// bar and headers, the 3D body's neutral and a page-level control's press).
// Any other file that names `paper` is drawing on the page from inside a card.
describe('`paper` is the page', () => {
  const MOBILE_ROOT = join(__dirname, '..');
  const PAGE_FILES = [
    'app/(tabs)/_layout.tsx',
    'app/(tabs)/groups.tsx',
    'app/completed-session/[sessionId].tsx',
    'app/dev-logs.tsx',
    'app/sign-in.tsx',
    'components/appearance/appearance-custom.tsx',
    'components/appearance/theme-preview.tsx',
    'components/exercise-page/exercise-page-screen.tsx',
    'components/groups/screen-styles.ts',
    'components/navigation/header-style.ts',
    'components/navigation/main-tab-bar.tsx',
    'components/navigation/navigation-theme.ts',
    'components/navigation/notification-tap-bridge.tsx',
    'components/navigation/tab-owned-page.tsx',
    'components/session-complete/session-completion-screen.tsx',
    'components/session-complete/session-share-sheet.tsx',
    'components/session-list/history-list.tsx',
    'components/stats/muscle-body-projection.ts',
    'components/stats/muscle-wireframe-renderer.ts',
    'components/ui/action-button.tsx',
    'components/ui/icon-button.tsx',
    'components/ui/notice.tsx',
    'components/ui/screen.tsx',
    'components/ui/swipe-pages.tsx',
    'components/ui/theme-custom.ts',
    'components/ui/theme.ts',
    'components/view-session/view-session-screen.tsx',
  ];
  const sourceFiles = (directory: string): string[] =>
    readdirSync(directory).flatMap((name) => {
      const path = join(directory, name);
      if (statSync(path).isDirectory()) return sourceFiles(path);
      return /\.tsx?$/.test(name) ? [path] : [];
    });

  it('is named only by the files that draw a page', () => {
    const naming = ['app', 'components']
      .flatMap((directory) => sourceFiles(join(MOBILE_ROOT, directory)))
      .filter((path) => /\.paper\b/.test(readFileSync(path, 'utf8')))
      .map((path) => relative(MOBILE_ROOT, path))
      .filter((path) => !PAGE_FILES.includes(path));
    expect(naming).toEqual([]);
  });
});

describe('a text or link button on Ink + paper', () => {
  const INK = { theme: 'ink-paper', mode: 'light', custom: null } as const;

  it.each(['text', 'link'] as const)('draws a %s button on the page in the page inks, and on a card in the inks', async (variant) => {
    renderWithTheme(
      <>
        <ActionButton label="On page" onPress={() => {}} testID="on-page" variant={variant} />
        <Card>
          <ActionButton label="On card" onPress={() => {}} testID="on-card" variant={variant} />
        </Card>
      </>,
    );
    await switchTheme(INK);
    const roles = rolesFor(INK);
    const colour = (label: string) => StyleSheet.flatten(screen.getByText(label).props.style).color;
    expect([roles.pageInk, roles.pageInkMuted]).toContain(colour('On page'));
    expect([roles.ink, roles.inkMuted]).toContain(colour('On card'));
  });
});

describe('an icon button on Ink + paper', () => {
  const INK = { theme: 'ink-paper', mode: 'light', custom: null } as const;

  it('draws its glyph in the page inks on the page, and in the inks on a card or a light bar', async () => {
    renderWithTheme(
      <>
        <IconButton accessibilityLabel="Back" name="chevron-left" onPress={() => {}} testID="on-page" />
        <IconButton accessibilityLabel="Options" name="more-vertical" onPress={() => {}} testID="on-page-muted" tone="muted" />
        <Card>
          <IconButton accessibilityLabel="Card options" name="more-vertical" onPress={() => {}} testID="on-card" />
        </Card>
        <SessionTopBar mode="active" onFinish={() => {}} onOpenOptions={() => {}} startedAt={new Date(0)} />
      </>,
    );
    await switchTheme(INK);
    const role = (id: string) => within(screen.getByTestId(id)).UNSAFE_getByType(Icon).props.colorRole;
    expect(role('on-page')).toBe('pageInk');
    expect(role('on-page-muted')).toBe('pageInkMuted');
    expect(role('on-card')).toBe('ink');
    expect(role('session-view-options-button')).toBe('ink');
  });
});

describe('the remaining page-level words on Ink + paper', () => {
  const INK = { theme: 'ink-paper', mode: 'light', custom: null } as const;

  it('draws a neutral notice inside a card on the inset, in the inks', async () => {
    renderWithTheme(<Card><Notice message="Blocked by an injury." testID="in-card" /></Card>);
    await switchTheme(INK);
    const roles = rolesFor(INK);
    expect(StyleSheet.flatten(screen.getByTestId('in-card').props.style).backgroundColor).toBe(roles.inset);
    expect(StyleSheet.flatten(screen.getByText('Blocked by an injury.').props.style).color).toBe(roles.ink);
  });

  it('draws the Volume section’s waiting line in `pageInkMuted` on the page, and in `inkMuted` inside a card', async () => {
    renderWithTheme(<SessionInsightPresentation exerciseComparisons={[]} historyState="loading" />);
    await switchTheme(INK);
    const roles = rolesFor(INK);
    expect(StyleSheet.flatten(screen.getByTestId('session-insight-empty').props.style).color).toBe(roles.pageInkMuted);
    screen.unmount();
    renderWithTheme(<Card><SessionInsightPresentation exerciseComparisons={[]} historyState="loading" /></Card>);
    expect(StyleSheet.flatten(screen.getByTestId('session-insight-empty').props.style).color).toBe(roles.inkMuted);
  });
});
