import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, Text, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { Card, ListRow, Sheet, Stat, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui';

// The design-language primitives (`docs/specs/ui/design-language.md` §4–§6).
// No shipped screen adopts them yet, so these assertions are their only guard
// until the exercise page and session view do.

const flatStyle = (node: { props: { style?: unknown } }): ViewStyle & TextStyle =>
  StyleSheet.flatten(node.props.style as StyleProp<ViewStyle & TextStyle>) ?? {};

describe('Card', () => {
  it('is a surface on a rule hairline at the card radius, with no shadow', () => {
    render(
      <Card testID="card">
        <Text>Body</Text>
      </Card>,
    );

    const style = flatStyle(screen.getByTestId('card'));
    expect(style).toMatchObject({
      backgroundColor: uiRoles.surface,
      borderColor: uiRoles.rule,
      borderWidth: 1,
      borderRadius: uiGeometry.radius.card,
      overflow: 'hidden',
    });
    expect(style.shadowOpacity).toBeUndefined();
    expect(style.elevation).toBeUndefined();
    expect(screen.getByTestId('card').props.accessibilityRole).toBeUndefined();
  });

  it('becomes one labelled link target when given onPress', () => {
    const onPress = jest.fn();
    render(
      <Card accessibilityLabel="Open Barbell Bench Press" onPress={onPress} testID="card">
        <Text>Barbell Bench Press</Text>
      </Card>,
    );

    const card = screen.getByLabelText('Open Barbell Bench Press');
    expect(card.props.accessibilityRole).toBe('link');
    fireEvent.press(card);
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('Stat', () => {
  it('stacks a micro-label legend above a figure and reads as one element', () => {
    render(<Stat label="Volume" testID="stat" value="8420" />);

    const stat = screen.getByTestId('stat');
    expect(stat.props.accessibilityLabel).toBe('Volume 8420');

    expect(flatStyle(screen.getByText('Volume'))).toMatchObject({
      fontFamily: 'Archivo',
      fontWeight: '700',
      fontSize: uiTypography.size.xxs,
      letterSpacing: uiTypography.size.xxs * uiGeometry.microLabelTracking,
      textTransform: 'uppercase',
      color: uiRoles.inkFaint,
    });
    expect(flatStyle(screen.getByText('8420'))).toMatchObject({
      fontFamily: 'IBM Plex Mono',
      fontWeight: '700',
      fontSize: uiTypography.size.xl,
      color: uiRoles.ink,
    });
  });

  it('sets a text value in the body face', () => {
    render(<Stat kind="text" label="Gym" value="Iron Works" />);

    expect(flatStyle(screen.getByText('Iron Works'))).toMatchObject({
      fontFamily: 'Source Sans 3',
      fontWeight: '600',
    });
  });

  it('puts an inline value in the fixed-width, right-aligned metric column', () => {
    render(<Stat label="1RM" layout="inline" value="102.1" />);

    expect(flatStyle(screen.getByText('102.1'))).toMatchObject({
      width: uiGeometry.metricValueWidth,
      textAlign: 'right',
      fontFamily: 'IBM Plex Mono',
      fontWeight: '500',
      fontSize: uiTypography.size.sm,
      color: uiRoles.ink,
    });
  });

  it('sets the secondary inline value smaller and muted', () => {
    render(<Stat label="Vol" layout="inline" rank="secondary" value="2560" />);

    expect(flatStyle(screen.getByText('2560'))).toMatchObject({
      fontSize: uiTypography.size.xs,
      fontWeight: '500',
      color: uiRoles.inkMuted,
    });
  });

  it('marks an all-time best in bold record, the only emphasis', () => {
    render(
      <>
        <Stat emphasis="record" label="1RM" layout="inline" value="104.3" />
        <Stat emphasis="record" label="1RM" value="102.1" />
      </>,
    );

    expect(flatStyle(screen.getByText('104.3'))).toMatchObject({ fontWeight: '700', color: uiRoles.record });
    expect(flatStyle(screen.getByText('102.1'))).toMatchObject({
      fontWeight: '700',
      color: uiRoles.record,
    });
  });

  it('fades a planned value and ignores emphasis on it', () => {
    render(<Stat emphasis="record" label="1RM" layout="inline" state="planned" value="99.3" />);

    expect(flatStyle(screen.getByText('99.3'))).toMatchObject({
      fontWeight: '500',
      color: uiRoles.inkFaint,
    });
    expect(flatStyle(screen.getByText('1RM')).color).toBe(uiRoles.planned);
  });
});

describe('ListRow', () => {
  it('lays out leading, content, meta and a fixed-width control column', () => {
    render(
      <ListRow
        density="list"
        leading={<Text>RIR 2</Text>}
        meta={<Text>1RM 102.1</Text>}
        testID="row"
        trailing={<Text testID="control">✓</Text>}>
        <Text>80.0 × 8</Text>
      </ListRow>,
    );

    const row = screen.getByTestId('row');
    expect(flatStyle(row)).toMatchObject({
      flexDirection: 'row',
      minHeight: uiGeometry.tapTarget,
      borderTopColor: uiRoles.ruleSoft,
    });
    // Not pressable: the set row's control owns the action.
    expect(row.props.accessibilityRole).toBeUndefined();

    const controlColumn = screen.getByTestId('control').parent?.parent;
    expect(flatStyle(controlColumn as { props: { style?: unknown } }).width).toBe(uiGeometry.tapTarget);
    expect(screen.getByText('RIR 2')).toBeTruthy();
    expect(screen.getByText('1RM 102.1')).toBeTruthy();
  });

  it('gives a sheet row a roomy tap target and presses as one button', () => {
    const onPress = jest.fn();
    render(<ListRow label="Edit exercise" onPress={onPress} testID="row" />);

    const row = screen.getByLabelText('Edit exercise');
    expect(row.props.accessibilityRole).toBe('button');
    expect(flatStyle(row).minHeight).toBe(uiGeometry.tapTarget + uiSpace.sm * 2);
    expect(flatStyle(screen.getByText('Edit exercise'))).toMatchObject({
      fontFamily: 'Archivo',
      fontWeight: '600',
      fontSize: uiTypography.size.xl,
      color: uiRoles.ink,
    });

    fireEvent.press(row);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('shows the selected choice on an accent wash and exposes it as selected', () => {
    render(<ListRow label="RIR 1" onPress={jest.fn()} selected testID="row" />);

    const row = screen.getByLabelText('RIR 1');
    expect(row.props.accessibilityState).toMatchObject({ selected: true });
    expect(flatStyle(row).backgroundColor).toBe(uiRoles.accentWash);
    expect(flatStyle(screen.getByText('RIR 1'))).toMatchObject({
      fontWeight: '700',
      color: uiRoles.accent,
    });
  });

  it('colours a destructive label danger and omits the divider on request', () => {
    render(<ListRow divider={false} label="Remove from session" testID="row" tone="danger" />);

    expect(flatStyle(screen.getByText('Remove from session')).color).toBe(uiRoles.danger);
    expect(flatStyle(screen.getByTestId('row')).borderTopWidth).toBeUndefined();
  });

  it('does not fire onPress when disabled', () => {
    const onPress = jest.fn();
    render(<ListRow disabled label="Swap exercise" onPress={onPress} />);

    const row = screen.getByLabelText('Swap exercise');
    expect(row.props.accessibilityState).toMatchObject({ disabled: true });
    fireEvent.press(row);
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('Sheet', () => {
  it('renders a titled panel with a handle and dismisses on a backdrop tap — no Cancel', () => {
    const onDismiss = jest.fn();
    render(
      <Sheet dismissLabel="Dismiss options" onDismiss={onDismiss} testID="sheet" title="Barbell Bench Press" visible>
        <ListRow label="Edit exercise" onPress={jest.fn()} />
      </Sheet>,
    );

    const panel = screen.getByTestId('sheet');
    expect(flatStyle(panel)).toMatchObject({
      backgroundColor: uiRoles.surface,
      borderTopLeftRadius: uiGeometry.radius.sheet,
      borderTopRightRadius: uiGeometry.radius.sheet,
    });
    expect(screen.getByRole('header', { name: 'Barbell Bench Press' })).toBeTruthy();
    expect(screen.queryByText('Cancel')).toBeNull();

    // The panel is modal to VoiceOver, so the backdrop is hidden from it; a
    // sighted tap still reaches it.
    expect(screen.queryByLabelText('Dismiss options')).toBeNull();
    const backdrop = screen.getByLabelText('Dismiss options', { includeHiddenElements: true });
    expect(flatStyle(backdrop).backgroundColor).toBe(uiRoles.scrim);
    fireEvent.press(backdrop);
    expect(onDismiss).toHaveBeenCalledTimes(1);

    fireEvent(panel, 'accessibilityEscape');
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });

  it('pads the bottom by the larger of the home-indicator inset and the sheet padding', () => {
    const safeArea = jest.requireMock('react-native-safe-area-context');
    const spy = jest
      .spyOn(safeArea, 'useSafeAreaInsets')
      .mockReturnValue({ top: 0, right: 0, bottom: 34, left: 0 });

    const { rerender } = render(
      <Sheet dismissLabel="Dismiss" onDismiss={jest.fn()} testID="sheet" visible>
        <Text>Body</Text>
      </Sheet>,
    );
    expect(flatStyle(screen.getByTestId('sheet')).paddingBottom).toBe(34);

    spy.mockReturnValue({ top: 0, right: 0, bottom: 0, left: 0 });
    rerender(
      <Sheet dismissLabel="Dismiss" onDismiss={jest.fn()} testID="sheet" visible>
        <Text>Body</Text>
      </Sheet>,
    );
    expect(flatStyle(screen.getByTestId('sheet')).paddingBottom).toBe(uiSpace.xl);

    spy.mockRestore();
  });

  it('renders nothing while hidden', () => {
    render(
      <Sheet dismissLabel="Dismiss" onDismiss={jest.fn()} testID="sheet" visible={false}>
        <Text>Body</Text>
      </Sheet>,
    );

    expect(screen.queryByTestId('sheet')).toBeNull();
  });
});
