import { fireEvent, screen, within } from '@testing-library/react-native';
import { SummaryTile, Stat, uiSpace } from '@/components/ui';
import { GroupWeekTotalsFigures } from '@/components/groups/group-week-totals';
import { SummaryGallery } from '@/components/pattern-gallery/summary-gallery';
import { SUMMARY_STATES } from '@/components/pattern-gallery/summary-fixtures';
import { uiTextFor, uiTextToneFor } from '@/components/ui/text-roles';
import { DEFAULT_APPEARANCE } from '@/components/ui/theme-presets';

import { renderWithTheme as render, rolesFor } from './helpers/theme';

const roles = rolesFor(DEFAULT_APPEARANCE);
const textRoles = uiTextFor(roles);
const textTones = uiTextToneFor(roles);

it('owns the reference inset and header gap, reusing the shared header and existing metric roles', () => {
  render(<SummaryTile title="Group stats" titleTestID="title" testID="tile" metrics={<Stat label="Sets" value="178" testID="metric" />} />);
  expect(screen.getByTestId('tile')).toHaveStyle({ padding: uiSpace.md, gap: uiSpace.sm });
  expect(screen.getByTestId('title')).toHaveStyle({ ...textRoles.label, ...textTones.ink });
  expect(screen.getByTestId('title').props.accessibilityRole).toBe('header');
  expect(within(screen.getByTestId('metric')).getByText('178')).toHaveStyle(textRoles.figureStat);
  expect(screen.getByTestId('tile').props.accessible).not.toBe(true);
});

it.each([0, 6, 123456])('keeps both WeekFigure metrics, existing comparison bars and record emphasis for %s', current => {
  render(<SummaryTile title="Group stats" metrics={<GroupWeekTotalsFigures current={{ sets: current, prs: current }} previous={{ sets: 152, prs: 4 }} offset={0} />} />);
  for (const metric of ['sets', 'prs']) expect(screen.getByTestId(`group-week-totals-${metric}-value`)).toHaveTextContent(String(current));
  expect(screen.getByTestId('group-week-totals-sets-previous')).toHaveTextContent('vs 152 last wk');
  expect(screen.getByTestId('group-week-totals-prs').props.accessibilityLabel).toBe(`Group records ${current}, vs 4 last week`);
  expect(screen.getByTestId('group-week-totals-sets-value')).toHaveStyle(textRoles.figureHero);
});

it('keeps the page metric scoped to the board/chart and the period scoped to the whole page', () => {
  render(<SummaryGallery review />);
  const totals = screen.getByTestId('group-week-totals-card');
  const before = within(totals).getByTestId('group-week-totals-sets-value').props.children;
  fireEvent.press(screen.getByTestId('groups-filter-metric'));
  expect(screen.getByTestId('groups-filter-metric')).toHaveTextContent('GR');
  expect(within(totals).getByTestId('group-week-totals-sets-value').props.children).toBe(before);
  expect(within(totals).getByTestId('group-week-totals-prs-value')).toHaveTextContent('6');
  fireEvent.press(screen.getByTestId('group-home-period-earlier'));
  expect(screen.getByTestId('group-home-period-title')).toHaveTextContent('Last week');
  expect(screen.getByTestId('group-week-totals-sets-previous')).toHaveTextContent(/wk before/);
});

it.each(SUMMARY_STATES.map(item => item.value))('renders the %s reference fixture and keeps recovery reachable', state => {
  render(<SummaryGallery initialState={state} initialLong />);
  expect(screen.getByTestId(`ui-gallery-summary-${state}-long`)).toBeTruthy();
  if (state === 'error') {
    fireEvent.press(screen.getByTestId('group-glance-error-state-retry'));
    expect(screen.getByTestId('group-week-totals-card')).toBeTruthy();
    expect(screen.getByTestId('ui-gallery-summary-action')).toHaveTextContent('Retry');
  }
  if (state === 'zero') expect(screen.getByTestId('group-week-totals-prs-value')).toHaveTextContent('0');
  if (state === 'offline') expect(screen.getByTestId('groups-offline-banner')).toBeTruthy();
});

it('cycles states, toggles long content and normalizes unknown state input', () => {
  render(<SummaryGallery initialState="unknown" />);
  fireEvent.press(screen.getByTestId('ui-gallery-summary-long'));
  expect(screen.getByTestId('group-week-totals-sets-value')).toHaveTextContent('123456');
  expect(screen.getByTestId('ui-gallery-summary-controls')).toHaveStyle({ flexDirection: 'row' });
  fireEvent.press(within(screen.getByTestId('ui-gallery-summary-controls')).getByTestId('ui-gallery-summary-state'));
  expect(screen.getByTestId('ui-gallery-summary-past-long')).toBeTruthy();
});
