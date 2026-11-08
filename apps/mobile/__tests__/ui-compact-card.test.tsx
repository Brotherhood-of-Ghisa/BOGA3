import { fireEvent, render, renderHook, screen, within } from '@testing-library/react-native';
import { Text } from 'react-native';
import { CompactCard, CompactHeader, uiSpace, uiText, uiTextTone, useUiText, useUiTextTone } from '@/components/ui';
import { AppThemeProvider } from '@/components/ui/theme-context';
import { CoWResultHeading } from '@/components/groups/cow-preview';
import { GroupStreamSessionCard } from '@/components/groups/stream-session-card';
import { gallerySession } from '@/components/pattern-gallery/fixtures';
import { cowResult } from './helpers/cow-fixtures';
import { coWAccessibleDates } from '@/src/groups/cow-presentation';
import { renderWithTheme } from './helpers/theme';

// The live text roles for the Groups cases, read once before any render under
// test: `renderHook` would otherwise take over `screen`.
let liveText!: ReturnType<typeof useUiText>;
let liveTone!: ReturnType<typeof useUiTextTone>;
beforeAll(() => {
  ({ text: liveText, tone: liveTone } = renderHook(() => ({ text: useUiText(), tone: useUiTextTone() }), { wrapper: AppThemeProvider }).result.current);
});

it('keeps compact insets fixed while retaining the Card link and accessibility action contract', () => {
  const onPress = jest.fn();
  const onAccessibilityAction = jest.fn();
  render(<CompactCard accessibilityLabel="Open session" accessibilityActions={[{ name: 'record', label: 'Open record' }]}
    onPress={onPress} onAccessibilityAction={onAccessibilityAction} testID="card">
    <Text>Facts</Text>
  </CompactCard>);
  const card = screen.getByRole('link', { name: 'Open session' });
  expect(card).toHaveStyle({ paddingHorizontal: uiSpace.md, paddingVertical: uiSpace.sm, gap: uiSpace.xs });
  fireEvent.press(card);
  fireEvent(card, 'accessibilityAction', { nativeEvent: { actionName: 'record' } });
  expect(onPress).toHaveBeenCalledTimes(1);
  expect(onAccessibilityAction).toHaveBeenCalledWith({ nativeEvent: { actionName: 'record' } });
});

it('does not accept a local density override even if an untyped caller provides one', () => {
  render(<CompactCard {...({ style: { paddingVertical: 999 } } as object)} testID="card"><Text>Facts</Text></CompactCard>);
  expect(screen.getByTestId('card')).toHaveStyle({ paddingVertical: uiSpace.sm });
  expect(screen.getByTestId('card').props.accessibilityRole).toBeUndefined();
});

it.each(['ink', 'record', 'muted'] as const)('pairs a %s label with quiet, right-aligned metadata on one wrapping baseline', tone => {
  render(<CompactHeader label="Training now" tone={tone} icon="set-current" metadata="30-10-2026" metadataAccessibilityLabel="30 October 2026"
    testID="heading" labelTestID="label" metadataTestID="date" />);
  expect(screen.getByTestId('heading')).toHaveStyle({ alignItems: 'baseline', flexWrap: 'wrap', gap: uiSpace.xs });
  const labelRow = screen.getByTestId('heading-label-row');
  expect(labelRow).toHaveStyle({ flexDirection: 'row-reverse' });
  // Yoga takes the first child's baseline; an icon first can overlap wrapped metadata.
  expect(labelRow.children[0]).toMatchObject({ props: { testID: 'label' } });
  expect(screen.getByTestId('label')).toHaveStyle({ ...uiText.label, ...uiTextTone[tone], flexShrink: 1 });
  const date = screen.getByTestId('date');
  expect(date).toHaveStyle({ ...uiText.meta, textAlign: 'right', marginLeft: 'auto' });
  expect(date.props.accessibilityLabel).toBe('30 October 2026');
  expect(within(date).getByText('30-10-2026')).toHaveStyle(uiText.inlineFigure);
});

it('omits absent metadata without drawing a placeholder or a second card', () => {
  render(<CompactHeader label="Current CoW" metadataTestID="date" testID="header" />);
  expect(screen.queryByTestId('date')).toBeNull();
  expect(screen.getByText('Current CoW')).toHaveStyle({ ...uiText.label, ...uiTextTone.ink });
});

it('can keep list context beside the label while retaining its metadata role and wrapping', () => {
  render(<CompactHeader label="This week" metadata="26 Oct – 1 Nov 26" metadataPlacement="inline"
    testID="heading" metadataTestID="date" />);
  expect(screen.getByTestId('heading')).toHaveStyle({ justifyContent: 'flex-start', gap: uiSpace.sm, flexWrap: 'wrap', alignItems: 'baseline' });
  expect(screen.getByTestId('date')).toHaveStyle({ ...uiText.meta, marginLeft: 0, textAlign: 'left' });
});

it.each([false, true])('keeps the corrected CoW heading/date roles for previous=%s; the old title-role arrangement fails', previous => {
  const result = cowResult();
  renderWithTheme(<CoWResultHeading result={result} previous={previous} today dateFormat="DD-MM-YYYY" />);
  expect(screen.getByText('CoW')).toHaveStyle({ ...liveText.label, ...liveTone.ink });
  expect(screen.getByText('Pull-up')).toHaveStyle(liveText.bodyStrong);
  expect(screen.getByLabelText(coWAccessibleDates(result.cow.week_start, 'DD-MM-YYYY'))).toHaveStyle(liveText.meta);
  expect(screen.getByText(previous ? 'Last week · Final' : 'Live')).toHaveStyle(liveText.meta);
});

it('keeps session activation and every record action distinct for touch and the VoiceOver action menu', () => {
  const onPress = jest.fn();
  const onPressRecord = jest.fn();
  const card = { ...gallerySession, records: [...gallerySession.records,
    { ...gallerySession.records[0], key: 'second', exercise: 'Squat', accessibilityLabel: 'Squat record' }] };
  renderWithTheme(<GroupStreamSessionCard card={card} showGroupNames onPress={onPress} onPressRecord={onPressRecord} />);
  const root = screen.getByTestId('group-stream-session-card-reference');
  fireEvent.press(root);
  expect(onPress).toHaveBeenCalledWith(card);
  for (const record of card.records) {
    expect(root.props.accessibilityActions).toContainEqual({ name: `record-${record.key}`, label: `Open ${record.accessibilityLabel}` });
    fireEvent.press(screen.getByTestId(`group-stream-session-card-reference-record-${record.key}`));
    fireEvent(root, 'accessibilityAction', { nativeEvent: { actionName: `record-${record.key}` } });
    expect(onPressRecord).toHaveBeenCalledWith(record.key);
  }
  expect(onPressRecord).toHaveBeenCalledTimes(4);
  fireEvent(root, 'accessibilityAction', { nativeEvent: { actionName: 'unknown' } });
  expect(onPressRecord).toHaveBeenCalledTimes(4);
  expect(onPress).toHaveBeenCalledTimes(1);
});

it('exposes no record action when the feature supplies no record callback', () => {
  renderWithTheme(<GroupStreamSessionCard card={gallerySession} showGroupNames={false} onPress={jest.fn()} />);
  const card = screen.getByTestId('group-stream-session-card-reference');
  expect(card.props.accessibilityActions).toBeUndefined();
  expect(card.props.onAccessibilityAction).toBeUndefined();
  expect(screen.getByTestId('group-stream-session-card-reference-record-record')).toBeDisabled();
});
