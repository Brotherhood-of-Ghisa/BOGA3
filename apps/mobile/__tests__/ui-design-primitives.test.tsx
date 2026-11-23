import { act, fireEvent, screen, within } from '@testing-library/react-native';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import { MainTabs } from '@/components/navigation/main-tabs';
import { ActionButton, Card, ChipGroup, Icon, FormField, FormSection, IconButton, InputRow, ListRow, Notice, PageHeader, ScreenScroll, SearchField, SectionHeader, SegmentedControl, Sheet, SliderRow, Stat, StatePanel, SwitchRow, Tag, ToggleChip, uiCardSlice, uiCorner, uiEdge, uiMark, uiGeometry, uiHairline, uiSpace, uiTypography, uiWell } from '@/components/ui';
import { withAlpha } from '@/components/ui/lch';
import { uiTextFor } from '@/components/ui/text-roles';
import { generateRoles, defaultThemeSeeds } from '@/components/ui/theme';
import { DEFAULT_APPEARANCE } from '@/components/ui/theme-presets';

import { renderWithTheme as render, rolesFor } from './helpers/theme';

const roles = rolesFor(DEFAULT_APPEARANCE);
const textRoles = uiTextFor(roles);

// The design-language primitives (`docs/specs/ui/design-language.md` §4–§6),
// asserted on their own; the screens that adopt them have their own tests.

const flatStyle = (node: { props: { style?: unknown } }): ViewStyle & TextStyle =>
  (StyleSheet.flatten(node.props.style as any) ?? {}) as ViewStyle & TextStyle;

// The edge in the default light theme: a 1pt `rule` hairline and a lift 1pt
// down and 2pt soft in `ink` at 5%; a well is `well` with an inner shade in
// `ink` at 9% from its top edge.
const LIFT = [{ offsetX: 0, offsetY: 1, blurRadius: 2, color: withAlpha(roles.ink, 0.05) }];
const WELL_SHADE = [{ offsetX: 0, offsetY: 1, blurRadius: 2, inset: true, color: withAlpha(roles.ink, 0.09) }];

// A node draws the edge: the hairline and the lift.
function expectEdge(node: { props: { style?: unknown } }) {
  expect(flatStyle(node)).toMatchObject({ borderWidth: 1, borderColor: roles.rule, boxShadow: LIFT });
}

// The nearest of a node and its ancestors that draws a shadow: the frame a
// field's input or a row's label sits in.
type HostNode = { props: { style?: unknown }; parent: HostNode | null };
function framed(node: HostNode): HostNode {
  let at: HostNode | null = node;
  while (at && flatStyle(at).boxShadow === undefined) at = at.parent;
  if (!at) throw new Error('no framed ancestor');
  return at;
}

// A node draws a sunken well.
function expectWell(node: { props: { style?: unknown } }) {
  expect(flatStyle(node)).toMatchObject({ backgroundColor: roles.well, boxShadow: WELL_SHADE });
}

describe('the edge (`edge.ts`)', () => {
  it('lifts in light mode by 1pt in ink at 5%, behind a rule hairline', () => {
    expect(uiEdge(roles, 'light')).toEqual({ borderWidth: 1, borderColor: roles.rule, boxShadow: LIFT });
  });

  it('lifts in dark mode with black at 45%, since a shadow reads less on a dark ground', () => {
    const dark = generateRoles(defaultThemeSeeds, 'dark');
    expect(uiEdge(dark, 'dark')).toEqual({
      borderWidth: 1,
      borderColor: dark.rule,
      boxShadow: [{ offsetX: 0, offsetY: 1, blurRadius: 2, color: 'rgba(0, 0, 0, 0.45)' }],
    });
  });

  it('sinks a well with an inner shade from its top edge, stronger and softer in dark', () => {
    expect(uiWell(roles, 'light')).toEqual({ backgroundColor: roles.well, boxShadow: WELL_SHADE });
    const dark = generateRoles(defaultThemeSeeds, 'dark');
    expect(uiWell(dark, 'dark')).toEqual({
      backgroundColor: dark.well,
      boxShadow: [{ offsetX: 0, offsetY: 1, blurRadius: 3, inset: true, color: 'rgba(0, 0, 0, 0.6)' }],
    });
  });

  it('offers the hairline alone, with no shadow', () => {
    expect(uiHairline(roles)).toEqual({ borderWidth: 1, borderColor: roles.rule });
  });

  it('draws the corner of a shape: card and control 4, pill fully rounded', () => {
    expect(uiEdge(roles, 'light', { shape: 'card' })).toMatchObject({ borderRadius: 4, boxShadow: LIFT });
    expect(uiHairline(roles, { shape: 'control' })).toEqual({ borderWidth: 1, borderColor: roles.rule, borderRadius: 4 });
    expect(uiHairline(roles, { shape: 'pill' })).toMatchObject({ borderRadius: 999 });
    expect(uiWell(roles, 'light', { shape: 'control' })).toEqual({ backgroundColor: roles.well, boxShadow: WELL_SHADE, borderRadius: 4 });
  });

  it('recolours the hairline by role and dashes an absent thing, leaving the lift alone', () => {
    expect(uiEdge(roles, 'light', { tone: 'danger' })).toEqual({ borderWidth: 1, borderColor: roles.danger, boxShadow: LIFT });
    expect(uiHairline(roles, { tone: 'ruleSoft', dashed: true })).toEqual({
      borderWidth: 1,
      borderColor: roles.ruleSoft,
      borderStyle: 'dashed',
    });
  });
});

describe('the corner and the card slice (`edge.ts`)', () => {
  it('uiCorner is the corner of a shape and nothing else', () => {
    expect(uiCorner('control')).toEqual({ borderRadius: uiGeometry.radius.control });
    expect(uiCorner('card')).toEqual({ borderRadius: uiGeometry.radius.card });
    expect(uiCorner('pill')).toEqual({ borderRadius: uiGeometry.radius.pill });
  });

  it('uiCardSlice draws the card sides on every cell and the corners and cap on the first and last', () => {
    const [first, middle, last, only] = [uiCardSlice(roles, 0, 3), uiCardSlice(roles, 1, 3), uiCardSlice(roles, 2, 3), uiCardSlice(roles, 0, 1)];
    const sides = { overflow: 'hidden', backgroundColor: roles.surface, borderLeftWidth: 1, borderRightWidth: 1, borderColor: roles.rule };

    expect(middle).toEqual(sides);
    expect(first).toEqual({ ...sides, borderTopWidth: 1, borderTopLeftRadius: 4, borderTopRightRadius: 4 });
    expect(last).toEqual({ ...sides, borderBottomWidth: 1, borderBottomLeftRadius: 4, borderBottomRightRadius: 4 });
    expect(only).toMatchObject({ borderTopWidth: 1, borderBottomWidth: 1, borderTopLeftRadius: 4, borderBottomRightRadius: 4 });
  });
});

describe('uiMark (`marks.ts`)', () => {
  it('rounds a bar like a control, and a dot or disc to a circle of its size', () => {
    expect(uiMark.bar).toEqual({ borderRadius: 4 });
    expect(uiMark.round(12)).toEqual({ width: 12, height: 12, borderRadius: 6 });
  });

  it('outlines a ring in a colour, one hairline thick unless told otherwise', () => {
    expect(uiMark.ring(roles.ink, 12)).toEqual({ width: 12, height: 12, borderRadius: 6, borderWidth: 1, borderColor: roles.ink });
    expect(uiMark.ring(roles.onInk, 16, 2)).toMatchObject({ borderWidth: 2, borderColor: roles.onInk, borderRadius: 8 });
  });
});

describe('Card', () => {
  it('is a surface inside the edge at the card radius: a rule hairline and a lift', () => {
    render(
      <Card testID="card">
        <Text>Body</Text>
      </Card>,
    );

    const card = screen.getByTestId('card');
    expect(flatStyle(card)).toMatchObject({
      backgroundColor: roles.surface,
      borderRadius: uiGeometry.radius.card,
      overflow: 'hidden',
    });
    expectEdge(card);
    expect(flatStyle(card).elevation).toBeUndefined();
    expect(card.props.accessibilityRole).toBeUndefined();
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

  it('lifts a pressable card on a plain view around it, so no view is both a clipping accessibility element and a shadow', () => {
    render(
      <Card accessibilityLabel="Open session" onPress={jest.fn()} style={{ marginHorizontal: 16, flex: 1, padding: 8, gap: 4 }} testID="card">
        <Text testID="card-child">Body</Text>
      </Card>,
    );

    const card = screen.getByTestId('card');
    const lift = framed(card.parent as HostNode);
    expect(flatStyle(card)).toMatchObject({ overflow: 'hidden', borderWidth: 1, borderColor: roles.rule, borderRadius: uiGeometry.radius.card, padding: 8, gap: 4 });
    expect(flatStyle(card).boxShadow).toBeUndefined();
    expect(lift).not.toBe(card);
    expect((lift.props as { testID?: string }).testID).toBeUndefined();
    expect(flatStyle(lift)).toMatchObject({ borderRadius: uiGeometry.radius.card, marginHorizontal: 16, flex: 1 });
    expect(flatStyle(lift).boxShadow).toHaveLength(1);
    expect(flatStyle(lift).overflow).toBeUndefined();
    expect(within(card).getByTestId('card-child')).toBeTruthy();
  });
});

describe('Stat', () => {
  it.each(['inline', 'stacked'] as const)('retains the full spoken unit when %s uses an abbreviated visible value', (layout) => {
    render(<Stat label="1RM" layout={layout} value="28.8%" spokenValue="28.8 %BW" testID="spoken" />);
    expect(screen.getByTestId('spoken')).toHaveProp('accessibilityLabel', '1RM 28.8 %BW');
    expect(screen.getByText('28.8%')).toBeTruthy();
    expect(screen.queryByText('28.8 %BW')).toBeNull();
  });

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
      color: roles.inkFaint,
    });
    expect(flatStyle(screen.getByText('8420'))).toMatchObject({
      fontFamily: 'IBM Plex Mono',
      fontWeight: '700',
      fontSize: uiTypography.size.xl,
      color: roles.ink,
    });
  });

  it('sets a text value in the body face', () => {
    render(<Stat kind="text" label="Gym" value="Iron Works" />);

    expect(flatStyle(screen.getByText('Iron Works'))).toMatchObject(textRoles.bodyStrong);
  });

  it('puts an inline value in the fixed-width, right-aligned metric column', () => {
    render(<Stat label="1RM" layout="inline" value="102.1" />);

    expect(flatStyle(screen.getByText('102.1'))).toMatchObject({
      width: uiGeometry.metricValueWidth,
      textAlign: 'right',
      fontFamily: 'IBM Plex Mono',
      fontWeight: '500',
      fontSize: uiTypography.size.sm,
      color: roles.ink,
    });
  });

  it('lets an inline value hug its legend for a caller that sizes the column', () => {
    render(<Stat label="1RM" layout="inline" value="102.1" valueWidth="hug" />);

    expect(flatStyle(screen.getByText('102.1'))).toMatchObject({ flexShrink: 1 });
    expect(flatStyle(screen.getByText('102.1')).width).toBeUndefined();
    expect(screen.getByLabelText('1RM 102.1')).toHaveStyle({ maxWidth: '100%' });
  });

  it('sets a heading value in the card-title face on the headline figure line', () => {
    render(<Stat kind="heading" label="Gym" value="Maestro Block History Gym" />);

    expect(flatStyle(screen.getByText('Maestro Block History Gym'))).toMatchObject({
      ...textRoles.title,
      lineHeight: textRoles.figureStat.lineHeight,
    });
    expect(screen.getByText('Maestro Block History Gym')).toHaveProp('numberOfLines', 1);
  });

  it('sets the secondary inline value as the quiet figureSmall, muted beside the ink 1RM', () => {
    render(<Stat label="Vol" layout="inline" rank="secondary" value="2560" />);

    expect(flatStyle(screen.getByText('2560'))).toMatchObject({ ...textRoles.figureSmall, color: roles.inkMuted });
  });

  it('sets a secondary stacked figure as the row figure, lighter than a headline', () => {
    render(<Stat align="end" label="Sets" rank="secondary" value="10 (8)" />);

    expect(flatStyle(screen.getByText('10 (8)'))).toMatchObject({ ...textRoles.figure, color: roles.ink });
  });

  it('turns the legend ink on a data-viz ground, where ink-faint is illegible', () => {
    render(<Stat ground="viz" label="Sets" rank="secondary" value="10 (8)" />);

    expect(flatStyle(screen.getByText('Sets')).color).toBe(roles.ink);
  });

  it('marks an all-time best in bold record, the only emphasis', () => {
    render(
      <>
        <Stat emphasis="record" label="1RM" layout="inline" value="104.3" />
        <Stat emphasis="record" label="1RM" value="102.1" />
      </>,
    );

    expect(flatStyle(screen.getByText('104.3'))).toMatchObject({ fontWeight: '700', color: roles.record });
    expect(flatStyle(screen.getByText('102.1'))).toMatchObject({
      fontWeight: '700',
      color: roles.record,
    });
  });

  it('fades a planned value and ignores emphasis on it', () => {
    render(<Stat emphasis="record" label="1RM" layout="inline" state="planned" value="99.3" />);

    expect(flatStyle(screen.getByText('99.3'))).toMatchObject({
      fontWeight: '500',
      color: roles.inkFaint,
    });
    expect(flatStyle(screen.getByText('1RM')).color).toBe(roles.inkGhost);
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
      borderTopColor: roles.ruleSoft,
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
      color: roles.ink,
    });

    fireEvent.press(row);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('shows the selected choice on an accent wash and exposes it as selected', () => {
    render(<ListRow label="RIR 1" onPress={jest.fn()} selected testID="row" />);

    const row = screen.getByLabelText('RIR 1');
    expect(row.props.accessibilityState).toMatchObject({ selected: true });
    expect(flatStyle(row).backgroundColor).toBe(roles.accentWash);
    expect(flatStyle(screen.getByText('RIR 1'))).toMatchObject({
      fontWeight: '700',
      color: roles.accent,
    });
  });

  it('colours a destructive label danger and omits the divider on request', () => {
    render(<ListRow divider={false} label="Remove from session" testID="row" tone="danger" />);

    expect(flatStyle(screen.getByText('Remove from session')).color).toBe(roles.danger);
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

  it('sets a description under the label in ink-muted body text', () => {
    render(<ListRow density="list" description="Search, create, edit." label="Exercise database" />);

    expect(flatStyle(screen.getByText('Search, create, edit.'))).toMatchObject({
      fontFamily: 'Source Sans 3',
      fontWeight: '400',
      color: roles.inkMuted,
    });
  });

  it('exposes a row that leaves the app as a link', () => {
    render(<ListRow accessibilityRole="link" label="Connect an AI coach" onPress={jest.fn()} />);

    expect(screen.getByLabelText('Connect an AI coach').props.accessibilityRole).toBe('link');
  });
  it('announces a disclosure row as expanded or collapsed only when it is one', () => {
    const { rerender } = render(<ListRow expanded={false} label="Chest" onPress={jest.fn()} testID="row" />);
    expect(screen.getByTestId('row').props.accessibilityState).toEqual({
      selected: false,
      disabled: false,
      expanded: false,
    });

    rerender(<ListRow expanded label="Chest" onPress={jest.fn()} testID="row" />);
    expect(screen.getByTestId('row').props.accessibilityState.expanded).toBe(true);

    rerender(<ListRow label="Chest" onPress={jest.fn()} testID="row" />);
    expect(screen.getByTestId('row').props.accessibilityState).toEqual({ selected: false, disabled: false });
  });

  it('is a radio when given checked: announced checked, with no ground change', () => {
    const { rerender } = render(<ListRow checked label="Bench Press" onPress={jest.fn()} testID="row" />);
    const row = screen.getByTestId('row');
    expect(row.props.accessibilityRole).toBe('radio');
    expect(row.props.accessibilityState).toEqual({ checked: true });
    expect(flatStyle(row).backgroundColor).toBeUndefined();
    expect(flatStyle(screen.getByText('Bench Press')).color).toBe(roles.ink);

    rerender(<ListRow checked={false} disabled label="Bench Press" onPress={jest.fn()} testID="row" />);
    expect(screen.getByTestId('row').props.accessibilityState).toEqual({ checked: false, disabled: true });
  });

  it('reads a row without onPress as one element when accessible, and hands out its host view', () => {
    const ref = { current: null };
    render(
      <ListRow accessibilityLabel="Bench, Total load, Not linked" accessible ref={ref} testID="row">
        <Text>Bench</Text>
      </ListRow>,
    );
    const row = screen.getByTestId('row');
    expect(row.props.accessible).toBe(true);
    expect(row.props.accessibilityLabel).toBe('Bench, Total load, Not linked');
    expect(ref.current).not.toBeNull();
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
      backgroundColor: roles.surface,
      borderTopLeftRadius: uiGeometry.radius.sheet,
      borderTopRightRadius: uiGeometry.radius.sheet,
    });
    // A sheet keeps its 16 top corners and draws no hairline or lift: the
    // scrim sets it apart.
    expect(flatStyle(panel).borderWidth).toBeUndefined();
    expect(flatStyle(panel).boxShadow).toBeUndefined();
    expect(screen.getByRole('header', { name: 'Barbell Bench Press' })).toBeTruthy();
    expect(screen.queryByText('Cancel')).toBeNull();

    // The panel is modal to VoiceOver, so the backdrop is hidden from it; a
    // sighted tap still reaches it.
    expect(screen.queryByLabelText('Dismiss options')).toBeNull();
    const backdrop = screen.getByLabelText('Dismiss options', { includeHiddenElements: true });
    // The tappable backdrop occupies only the exposed area above the panel;
    // even long scrollable content must leave a usable dismissal target.
    expect(flatStyle(backdrop).minHeight).toBe(uiGeometry.tapTarget);
    fireEvent.press(backdrop);
    expect(onDismiss).toHaveBeenCalledTimes(1);

    fireEvent(panel, 'accessibilityEscape');
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });

  describe('onDismissed', () => {
    const sheetModal = () => screen.UNSAFE_getByType(Modal);
    const renderSheet = (visible: boolean, onDismissed: () => void) => (
      <Sheet dismissLabel="Dismiss" onDismiss={jest.fn()} onDismissed={onDismissed} testID="sheet" visible={visible}>
        <Text>Body</Text>
      </Sheet>
    );

    it('fires on iOS from the native modal once it has gone, not when visible turns false', () => {
      const onDismissed = jest.fn();
      const { rerender } = render(renderSheet(true, onDismissed));
      expect(sheetModal().props.testID).toBe('sheet-modal');

      rerender(renderSheet(false, onDismissed));
      expect(onDismissed).not.toHaveBeenCalled();
      act(() => sheetModal().props.onDismiss());
      expect(onDismissed).toHaveBeenCalledTimes(1);
    });

    it('fires at once on Android, which has no Modal.onDismiss', () => {
      const os = jest.replaceProperty(Platform, 'OS', 'android');
      const onDismissed = jest.fn();
      const { rerender } = render(renderSheet(true, onDismissed));
      expect(sheetModal().props.onDismiss).toBeUndefined();
      expect(onDismissed).not.toHaveBeenCalled();

      rerender(renderSheet(false, onDismissed));
      expect(onDismissed).toHaveBeenCalledTimes(1);
      // Staying hidden does not fire it again.
      rerender(renderSheet(false, onDismissed));
      expect(onDismissed).toHaveBeenCalledTimes(1);
      os.restore();
    });
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

  it('puts header actions on the title row, after the title', () => {
    const onOptions = jest.fn();
    render(
      <Sheet
        dismissLabel="Dismiss"
        headerActions={<IconButton accessibilityLabel="Options" name="more-vertical" onPress={onOptions} />}
        onDismiss={jest.fn()}
        testID="sheet"
        title="Select Exercise"
        visible>
        <Text>Body</Text>
      </Sheet>,
    );

    const header = within(screen.getByTestId('sheet-header'));
    expect(header.getByRole('header', { name: 'Select Exercise' })).toBeTruthy();
    expect(flatStyle(screen.getByTestId('sheet-header')).flexDirection).toBe('row');
    fireEvent.press(header.getByLabelText('Options'));
    expect(onOptions).toHaveBeenCalledTimes(1);
  });

  it('puts a leading control before the title (a panel inside the sheet goes back with it)', () => {
    const onBack = jest.fn();
    render(
      <Sheet
        dismissLabel="Dismiss"
        headerLeading={<IconButton accessibilityLabel="Back to exercise" name="chevron-left" onPress={onBack} testID="back" />}
        onDismiss={jest.fn()}
        testID="sheet"
        title="Select primary muscle"
        visible>
        <Text>Body</Text>
      </Sheet>,
    );

    const headerNode = screen.getByTestId('sheet-header');
    const [first] = headerNode.children;
    expect(typeof first === 'string' ? first : first.props.testID).toBe('back');
    expect(within(headerNode).getByRole('header', { name: 'Select primary muscle' })).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Back to exercise'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('avoids the keyboard only when asked', () => {
    const { rerender, UNSAFE_queryByType } = render(
      <Sheet dismissLabel="Dismiss" onDismiss={jest.fn()} testID="sheet" visible>
        <Text>Body</Text>
      </Sheet>,
    );
    expect(UNSAFE_queryByType(KeyboardAvoidingView)).toBeNull();

    rerender(
      <Sheet dismissLabel="Dismiss" keyboardAvoiding onDismiss={jest.fn()} testID="sheet" visible>
        <Text>Body</Text>
      </Sheet>,
    );
    expect(UNSAFE_queryByType(KeyboardAvoidingView)).not.toBeNull();
    // Still one panel that shrinks rather than growing past the screen.
    expect(flatStyle(screen.getByTestId('sheet')).flexShrink).toBe(1);
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

describe('ActionButton', () => {
  it('enlarges the fullscreen primary action using the house tokens', () => {
    render(<ActionButton label="Pause" onPress={jest.fn()} size="large" testID="large" variant="primary" />);
    expect(flatStyle(screen.getByTestId('large')).minHeight).toBe(uiGeometry.tapTarget + uiSpace.xl);
    expect(flatStyle(screen.getByText('Pause'))).toMatchObject({ fontSize: uiTypography.size.xxl, lineHeight: uiTypography.lineHeight.xxl });
  });
  it('draws the one primary on accent, at the control radius and tap-target height', () => {
    const onPress = jest.fn();
    render(<ActionButton label="Edit" onPress={onPress} testID="button" variant="primary" />);

    const button = screen.getByTestId('button');
    expect(flatStyle(button)).toMatchObject({
      backgroundColor: roles.accent,
      borderRadius: uiGeometry.radius.control,
      minHeight: uiGeometry.tapTarget,
    });
    expect(button.props.accessibilityRole).toBe('button');
    expect(flatStyle(screen.getByText('Edit'))).toMatchObject({ color: roles.onAccent, textTransform: 'uppercase' });
    // A filled primary has no edge.
    expect(flatStyle(button).boxShadow).toBeUndefined();
    fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('draws a secondary action inside the edge with an ink label, and a danger one in danger', () => {
    render(
      <>
        <ActionButton label="+ Add exercise" onPress={jest.fn()} testID="outline" variant="outline" />
        <ActionButton label="Archive" onPress={jest.fn()} testID="danger" tone="danger" variant="outline" />
      </>,
    );

    expectEdge(screen.getByTestId('outline'));
    expect(flatStyle(screen.getByTestId('outline')).backgroundColor).toBe(roles.surface);
    expect(flatStyle(screen.getByTestId('danger'))).toMatchObject({ borderColor: roles.danger, boxShadow: LIFT });
    expect(flatStyle(screen.getByText('Archive')).color).toBe(roles.danger);
  });

  it('draws a compact row action 28 tall, with hit slop keeping its 44 tap target', () => {
    const { rerender } = render(<ActionButton label="Certify" onPress={jest.fn()} size="compact" testID="compact" variant="outline" />);
    const compact = screen.getByTestId('compact');
    expect(flatStyle(compact).minHeight).toBe(uiGeometry.compactControlHeight);
    const slop = (uiGeometry.tapTarget - uiGeometry.compactControlHeight) / 2;
    expect(compact.props.hitSlop).toBe(slop);
    expect(uiGeometry.compactControlHeight + 2 * slop).toBe(uiGeometry.tapTarget);
    rerender(<ActionButton label="Certify" onPress={jest.fn()} testID="compact" variant="outline" />);
    expect(flatStyle(screen.getByTestId('compact')).minHeight).toBe(uiGeometry.tapTarget);
    expect(screen.getByTestId('compact').props.hitSlop).toBeUndefined();
  });

  it('draws a link as a muted micro-label with a chevron, compact with a 44 tap target', () => {
    const onPress = jest.fn();
    render(<ActionButton label="Sessions" onPress={onPress} testID="link" variant="link" />);
    const link = screen.getByTestId('link');
    expect(flatStyle(screen.getByText('Sessions'))).toMatchObject({
      fontSize: uiTypography.size.xxs,
      textTransform: 'uppercase',
      color: roles.inkMuted,
    });
    expect(flatStyle(link).minHeight).toBe(uiGeometry.compactControlHeight);
    expect(uiGeometry.compactControlHeight + 2 * link.props.hitSlop).toBe(uiGeometry.tapTarget);
    expect(within(link).UNSAFE_getAllByType(Icon)).toHaveLength(1);
    fireEvent.press(link);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('fades when disabled and ignores presses', () => {
    const onPress = jest.fn();
    render(<ActionButton disabled label="Done" onPress={onPress} testID="button" variant="primary" />);

    const button = screen.getByTestId('button');
    expect(flatStyle(button).backgroundColor).toBe(roles.inkGhost);
    expect(button.props.accessibilityState).toMatchObject({ disabled: true });
    fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  it('announces a view toggle as checked only when asked', () => {
    const { rerender } = render(<ActionButton label="Show deleted" onPress={jest.fn()} testID="toggle" variant="text" />);
    expect(screen.getByTestId('toggle').props.accessibilityState).toEqual({ disabled: false });

    rerender(<ActionButton checked label="Hide deleted" onPress={jest.fn()} testID="toggle" variant="text" />);
    expect(screen.getByTestId('toggle').props.accessibilityState).toEqual({ disabled: false, checked: true });
  });

  it('dims and applies paper ground when pressed', () => {
    render(<ActionButton label="Outline" onPress={jest.fn()} testID="button" variant="outline" />);
    const button = screen.getByTestId('button');
    fireEvent(button, 'responderGrant', { nativeEvent: { timestamp: Date.now() }, persist: () => {} });
    expect(flatStyle(button)).toMatchObject({
      backgroundColor: roles.paper,
      opacity: 0.7,
    });
  });
});

describe('IconButton', () => {
  it.each([false, true])('is one labelled 44pt button whose glyph is decoration (native header: %s)', (nativeHeader) => {
    const onPress = jest.fn();
    render(<IconButton nativeHeader={nativeHeader} accessibilityLabel="Session options" name="more-vertical" onPress={onPress} testID="more" />);

    const button = screen.getByRole('button', { name: 'Session options' });
    expect(flatStyle(button)).toMatchObject({ width: uiGeometry.tapTarget, height: uiGeometry.tapTarget });
    expect(screen.queryByRole('image')).toBeNull();
    fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])('draws the accent tone and ignores disabled presses (native header: %s)', (nativeHeader) => {
    const onPress = jest.fn();
    const { rerender } = render(
      <IconButton nativeHeader={nativeHeader} accessibilityLabel="New exercise" name="plus" onPress={onPress} testID="add" tone="accent" />,
    );
    expect(flatStyle(screen.getByTestId('add')).backgroundColor).toBe(roles.accent);

    rerender(<IconButton nativeHeader={nativeHeader} accessibilityLabel="New exercise" disabled name="plus" onPress={onPress} testID="add" tone="accent" />);
    fireEvent.press(screen.getByTestId('add'));
    expect(onPress).not.toHaveBeenCalled();
    expect(screen.getByTestId('add').props.accessibilityState).toMatchObject({ disabled: true });
  });
});

describe('StatePanel', () => {
  it('centres a title, body and one outline action', () => {
    const onRetry = jest.fn();
    render(
      <StatePanel
        action={{ label: 'Retry', onPress: onRetry, testID: 'retry' }}
        body="Check your connection."
        kind="error"
        testID="panel"
        title="Couldn't load this"
      />,
    );

    expect(flatStyle(screen.getByTestId('panel'))).toMatchObject({ flex: 1, alignItems: 'center' });
    expect(screen.getByTestId('panel').props.accessibilityLiveRegion).toBe('polite');
    expect(flatStyle(screen.getByText("Couldn't load this"))).toMatchObject({ fontFamily: 'Archivo', color: roles.ink });
    expect(flatStyle(screen.getByText('Check your connection.')).color).toBe(roles.inkMuted);
    // An outline, never the screen's primary.
    expect(flatStyle(screen.getByTestId('retry')).borderColor).toBe(roles.rule);
    fireEvent.press(screen.getByTestId('retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('sits inline when not filling, and shows a spinner while loading', () => {
    render(<StatePanel fill={false} kind="loading" testID="panel" title="Loading…" />);
    expect(flatStyle(screen.getByTestId('panel')).flex).toBeUndefined();
    expect(screen.UNSAFE_getByType(ActivityIndicator)).toBeTruthy();
  });
});

describe('ScreenScroll', () => {
  it('lays content on paper at the page gutter, or the md gutter when asked', () => {
    const { rerender } = render(
      <ScreenScroll testID="scroll">
        <Text>Body</Text>
      </ScreenScroll>,
    );
    const scroll = screen.getByTestId('scroll');
    expect(flatStyle(scroll).backgroundColor).toBe(roles.paper);
    expect(StyleSheet.flatten(scroll.props.contentContainerStyle)).toMatchObject({ padding: uiSpace.lg, gap: uiSpace.md });

    rerender(
      <ScreenScroll gutter="md" testID="scroll">
        <Text>Body</Text>
      </ScreenScroll>,
    );
    expect(StyleSheet.flatten(screen.getByTestId('scroll').props.contentContainerStyle).padding).toBe(uiSpace.md);
  });
});

describe('FormField', () => {
  it('labels a field one field-height tall and shows its error below in danger', () => {
    const { rerender } = render(<FormField label="Start" onChangeText={jest.fn()} testID="start" value="" />);
    expect(flatStyle(screen.getByText('Start'))).toMatchObject({ textTransform: 'uppercase', color: roles.inkFaint });
    expect(screen.getByTestId('start').props.placeholderTextColor).toBe(roles.inkGhost);
    expect(flatStyle(screen.getByTestId('start')).fontFamily).toBe('IBM Plex Mono');
    expect(screen.queryByTestId('start-error')).toBeNull();

    rerender(<FormField error="Use YYYY-MM-DD HH:mm" face="text" label="Start" onChangeText={jest.fn()} testID="start" value="x" />);
    expect(flatStyle(screen.getByTestId('start-error')).color).toBe(roles.danger);
    expect(flatStyle(screen.getByTestId('start')).fontFamily).toBe('Source Sans 3');
    const field = screen.getByTestId('start').parent?.parent;
    expect(field && flatStyle(field)).toMatchObject({
      height: uiGeometry.fieldHeight,
      backgroundColor: roles.raised,
      borderColor: roles.danger,
      borderRadius: uiGeometry.radius.control,
      boxShadow: LIFT,
    });
  });

  it('draws a valid field raised inside the edge', () => {
    render(<FormField label="Start" onChangeText={jest.fn()} testID="start" value="" />);
    const field = screen.getByTestId('start').parent!.parent!;
    expect(flatStyle(field).backgroundColor).toBe(roles.raised);
    expectEdge(field);
  });

  it('takes an explicit error testID and a hint', () => {
    render(
      <FormField
        error="Name is required."
        errorTestID="editor-name-error"
        hint="12/280"
        label="Name"
        onChangeText={jest.fn()}
        testID="editor-name-input"
        value=""
      />,
    );
    expect(screen.getByTestId('editor-name-error')).toBeTruthy();
    expect(screen.getByText('12/280')).toBeTruthy();
  });
});

describe('SearchField', () => {
  it('keeps its accessibility label and clears through its own control', () => {
    const onChangeText = jest.fn();
    const { rerender } = render(
      <SearchField accessibilityLabel="Exercise filter input" onChangeText={onChangeText} testID="search" value="" />,
    );
    expect(screen.getByLabelText('Exercise filter input')).toBeTruthy();
    expect(screen.queryByTestId('search-clear')).toBeNull();

    rerender(<SearchField accessibilityLabel="Exercise filter input" onChangeText={onChangeText} testID="search" value="bench" />);
    fireEvent.press(screen.getByRole('button', { name: 'Clear search' }));
    expect(onChangeText).toHaveBeenCalledWith('');
  });

  it('is raised inside the edge', () => {
    render(<SearchField accessibilityLabel="Exercise filter input" onChangeText={jest.fn()} testID="search" value="" />);
    const field = framed(screen.getByTestId('search') as never);
    expect(flatStyle(field).backgroundColor).toBe(roles.raised);
    expectEdge(field);
  });
});

describe('FormSection', () => {
  it('draws its rows on a card inside the edge, and a typed figure raised inside the edge', () => {
    render(
      <FormSection testID="section" title="Rest">
        <InputRow label="Seconds" onChangeText={jest.fn()} testID="seconds" value="90" />
      </FormSection>,
    );
    const card = framed(screen.getByText('Seconds') as never);
    expect(flatStyle(card).backgroundColor).toBe(roles.surface);
    expectEdge(card);
    const input = screen.getByTestId('seconds');
    expect(flatStyle(input).backgroundColor).toBe(roles.raised);
    expectEdge(input);
  });
});

describe('SegmentedControl', () => {
  const OPTIONS = [
    { value: 'records', label: 'Records' },
    { value: 'last', label: 'Last' },
  ] as const;

  it('is a tab list with the segmented-chips testID contract; the selected segment is ink', () => {
    const onChange = jest.fn();
    render(<SegmentedControl onChange={onChange} options={OPTIONS} testIDPrefix="view" value="records" />);

    expect(screen.getByTestId('view-row').props.accessibilityRole).toBe('tablist');
    expect(screen.getByTestId('view-records').props.accessibilityState).toEqual({ selected: true });
    expect(flatStyle(screen.getByTestId('view-records')).backgroundColor).toBe(roles.ink);
    // The others show the track: a sunken well inside the rule hairline.
    expect(flatStyle(screen.getByTestId('view-last')).backgroundColor).toBeUndefined();
    const track = screen.getByTestId('view-row');
    expectWell(track);
    expect(flatStyle(track)).toMatchObject({ borderWidth: 1, borderColor: roles.rule, borderRadius: uiGeometry.radius.control });

    fireEvent.press(screen.getByTestId('view-records'));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('view-last'));
    expect(onChange).toHaveBeenCalledWith('last');
  });

  it('optionally handles a selected tap separately and stays inert when disabled', () => {
    const onChange = jest.fn();
    const onReselect = jest.fn();
    const page = render(<SegmentedControl onChange={onChange} onReselect={onReselect}
      options={OPTIONS} testIDPrefix="view" value="records" />);
    fireEvent.press(screen.getByTestId('view-records'));
    expect(onReselect).toHaveBeenCalledWith('records');
    expect(onChange).not.toHaveBeenCalled();
    onReselect.mockClear();
    fireEvent.press(screen.getByTestId('view-last'));
    expect(onChange).toHaveBeenCalledWith('last');
    expect(onReselect).not.toHaveBeenCalled();

    page.rerender(<SegmentedControl disabled onChange={onChange} onReselect={onReselect}
      options={OPTIONS} testIDPrefix="view" value="records" />);
    fireEvent.press(screen.getByTestId('view-records'));
    expect(onReselect).not.toHaveBeenCalled();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('reuses filter segments as repeatable links and returns the native launcher', () => {
    const onNavigate = jest.fn();
    const target = { nativeTag: 88 };
    const page = render(<SegmentedControl onNavigate={onNavigate} options={OPTIONS} testIDPrefix="link" density="compact" layout="inline" />);
    const link = screen.getByTestId('link-records');
    expect(link.props.accessibilityRole).toBe('link');
    expect(link.props.accessibilityState?.selected).toBeUndefined();
    fireEvent.press(link, { currentTarget: target });
    fireEvent.press(link, { currentTarget: target });
    expect(onNavigate).toHaveBeenCalledTimes(2);
    expect(onNavigate).toHaveBeenLastCalledWith('records', target);
    page.rerender(<SegmentedControl onNavigate={onNavigate} options={OPTIONS} testIDPrefix="link" disabled />);
    fireEvent.press(screen.getByTestId('link-records'));
    expect(onNavigate).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId('link-records').props.accessibilityState).toEqual({ disabled: true });
  });

  it('fills the row with equal segments unless inline', () => {
    const { rerender } = render(<SegmentedControl onChange={jest.fn()} options={OPTIONS} testIDPrefix="view" value="last" />);
    expect(flatStyle(screen.getByTestId('view-last')).flex).toBe(1);

    rerender(<SegmentedControl layout="inline" onChange={jest.fn()} options={OPTIONS} testIDPrefix="view" value="last" />);
    expect(flatStyle(screen.getByTestId('view-last')).flex).toBeUndefined();
  });

  it('uses fixed black and white for filters, retaining disabled styling', () => {
    const onChange = jest.fn();
    const { rerender } = render(<SegmentedControl selectedGround="selection" onChange={onChange}
      options={OPTIONS} testIDPrefix="view" value="records" />);
    expect(flatStyle(screen.getByTestId('view-records')).backgroundColor).toBe('#000000');
    expect(flatStyle(within(screen.getByTestId('view-records')).getByText('Records')).color).toBe(roles.onSelection);
    expect(flatStyle(screen.getByTestId('view-last')).backgroundColor).toBeUndefined();
    expect(screen.getByTestId('view-records')).toHaveProp('accessibilityState', { selected: true });
    fireEvent.press(screen.getByTestId('view-last'));
    expect(onChange).toHaveBeenCalledWith('last');

    onChange.mockClear();
    rerender(<SegmentedControl disabled selectedGround="selection" onChange={onChange}
      options={OPTIONS} testIDPrefix="view" value="records" />);
    expect(flatStyle(screen.getByTestId('view-records')).backgroundColor).toBe(roles.inkGhost);
    fireEvent.press(screen.getByTestId('view-last'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('spans the row with label-sized segments that share the rest when fit', () => {
    render(<SegmentedControl layout="fit" onChange={jest.fn()} options={OPTIONS} testIDPrefix="view" value="last" />);
    expect(flatStyle(screen.getByTestId('view-last'))).toMatchObject({ flexGrow: 1 });
    expect(flatStyle(screen.getByTestId('view-last')).flex).toBeUndefined();
    expect(flatStyle(screen.getByTestId('view-row')).alignSelf).toBe('stretch');
  });

  it('ignores presses and fades while disabled', () => {
    const onChange = jest.fn();
    render(<SegmentedControl disabled onChange={onChange} options={OPTIONS} testIDPrefix="view" value="records" />);

    expect(screen.getByTestId('view-records').props.accessibilityState).toEqual({ selected: true, disabled: true });
    expect(screen.getByTestId('view-last').props.accessibilityState).toEqual({ selected: false, disabled: true });
    expect(flatStyle(screen.getByTestId('view-records')).backgroundColor).toBe(roles.inkGhost);
    fireEvent.press(screen.getByTestId('view-last'));
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('ToggleChip', () => {
  const OPTIONS = [
    { value: 'workingSetCount', label: 'Sets' },
    { value: 'totalVolume', label: 'Volume', accessibilityLabel: 'Volume, kg·reps' },
  ] as const;

  it('shows the value in force and swaps it for the other on one press', () => {
    const onChange = jest.fn();
    const { rerender } = render(<ToggleChip accessibilityLabel="Progress metric" onChange={onChange}
      options={OPTIONS} testID="metric" value="workingSetCount" />);

    expect(screen.getByTestId('metric')).toHaveTextContent('Sets');
    expect(screen.queryByText('Volume')).toBeNull();
    expect(screen.getByTestId('metric').props.accessibilityRole).toBe('button');
    expect(screen.getByTestId('metric').props.accessibilityLabel)
      .toBe('Progress metric: Sets. Activate to show Volume.');
    fireEvent.press(screen.getByTestId('metric'));
    expect(onChange).toHaveBeenCalledWith('totalVolume');

    rerender(<ToggleChip accessibilityLabel="Progress metric" onChange={onChange}
      options={OPTIONS} testID="metric" value="totalVolume" />);
    // An option's own label is what assistive tech reads for the value in force.
    expect(screen.getByTestId('metric').props.accessibilityLabel)
      .toBe('Progress metric: Volume, kg·reps. Activate to show Sets.');
    fireEvent.press(screen.getByTestId('metric'));
    expect(onChange).toHaveBeenLastCalledWith('workingSetCount');
  });

  it('steps through more than two values in order, wrapping from the last to the first', () => {
    const four = [
      { value: 'totalVolume', label: 'Volume' }, { value: 'workingSetCount', label: 'Sets' },
      { value: 'estimatedRM1', label: '1RM' }, { value: 'highestWeight', label: 'Top weight' },
    ] as const;
    const onChange = jest.fn();
    const { rerender } = render(<ToggleChip accessibilityLabel="Effort metric" onChange={onChange}
      options={four} testID="metric" value="estimatedRM1" />);
    expect(screen.getByTestId('metric').props.accessibilityLabel).toBe('Effort metric: 1RM. Activate to show Top weight.');
    fireEvent.press(screen.getByTestId('metric'));
    expect(onChange).toHaveBeenLastCalledWith('highestWeight');
    rerender(<ToggleChip accessibilityLabel="Effort metric" onChange={onChange}
      options={four} testID="metric" value="highestWeight" />);
    fireEvent.press(screen.getByTestId('metric'));
    expect(onChange).toHaveBeenLastCalledWith('totalVolume');
  });

  it('is an equal-width outline control that keeps a 44pt target at 28pt drawn', () => {
    render(<ToggleChip accessibilityLabel="Progress metric" onChange={jest.fn()}
      options={OPTIONS} testID="metric" value="workingSetCount" />);
    const chip = screen.getByTestId('metric');
    expect(flatStyle(chip)).toMatchObject({
      flex: 1, minHeight: uiGeometry.compactControlHeight,
      backgroundColor: roles.surface,
    });
    expectEdge(chip);
    expect(chip.props.hitSlop).toBe((uiGeometry.tapTarget - uiGeometry.compactControlHeight) / 2);
    expect(flatStyle(within(chip).getByText('Sets')).color).toBe(roles.ink);
    expect(within(chip).getByText('Sets').props.allowFontScaling).toBe(false);
    // The swap glyph says a tap replaces the value rather than opening a menu.
    expect(within(chip).UNSAFE_getByType(Icon).props.name).toBe('swap');
  });

  it('is inert and unglyphed with a single option, and recovers from an unknown value', () => {
    const onChange = jest.fn();
    const { rerender } = render(<ToggleChip accessibilityLabel="Stats period" onChange={onChange}
      options={[{ value: 'this-week', label: 'This week' }]} testID="period" value="this-week" />);

    expect(screen.getByTestId('period')).toHaveProp('accessibilityState', { disabled: true });
    expect(screen.getByTestId('period').props.accessibilityLabel).toBe('Stats period: This week.');
    expect(within(screen.getByTestId('period')).UNSAFE_queryByType(Icon)).toBeNull();
    fireEvent.press(screen.getByTestId('period'));
    expect(onChange).not.toHaveBeenCalled();

    rerender(<ToggleChip accessibilityLabel="Progress metric" onChange={onChange}
      options={OPTIONS} testID="metric" value={'gone' as 'workingSetCount'} />);
    expect(screen.getByTestId('metric')).toHaveTextContent('Sets');
  });
});

describe('ChipGroup', () => {
  const OPTIONS = [
    { value: 'a', label: 'Alpha' },
    { value: 'b', label: 'Bravo', accessibilityLabel: 'Turn bravo on' },
  ] as const;

  it('wraps pills and selects exactly one in single mode', () => {
    const onChange = jest.fn();
    render(<ChipGroup mode="single" onChange={onChange} options={OPTIONS} testIDPrefix="filter" value="a" />);

    expect(flatStyle(screen.getByTestId('filter-row'))).toMatchObject({ flexWrap: 'wrap' });
    expect(screen.getByTestId('filter-a').props.accessibilityState).toEqual({ selected: true });
    expect(flatStyle(screen.getByTestId('filter-a'))).toMatchObject({
      backgroundColor: roles.ink,
      borderRadius: uiGeometry.radius.pill,
      boxShadow: LIFT,
    });
    // Every pill is a control inside the edge; the one on fills with `ink`.
    expectEdge(screen.getByTestId('filter-b'));
    expect(flatStyle(screen.getByTestId('filter-b')).backgroundColor).toBe(roles.surface);
    fireEvent.press(screen.getByTestId('filter-a'));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.press(screen.getByLabelText('Turn bravo on'));
    expect(onChange).toHaveBeenCalledWith('b');
  });

  it('toggles each chip on its own in multi mode, as checkboxes', () => {
    const onToggle = jest.fn();
    render(<ChipGroup mode="multi" onToggle={onToggle} options={OPTIONS} testIDPrefix="muscles" values={['b']} />);

    expect(screen.getByTestId('muscles-a').props.accessibilityState).toEqual({ checked: false });
    expect(screen.getByTestId('muscles-b').props.accessibilityState).toEqual({ checked: true });
    fireEvent.press(screen.getByTestId('muscles-b'));
    expect(onToggle).toHaveBeenCalledWith('b');
  });

  it('returns to the clear value when the selected chip is pressed again', () => {
    const onChange = jest.fn();
    const options = [{ value: 'all', label: 'All' }, ...OPTIONS];
    const { rerender } = render(
      <ChipGroup clearValue="all" mode="single" onChange={onChange} options={options} testIDPrefix="tags" value="b" />
    );

    fireEvent.press(screen.getByTestId('tags-b'));
    expect(onChange).toHaveBeenLastCalledWith('all');

    onChange.mockClear();
    rerender(<ChipGroup clearValue="all" mode="single" onChange={onChange} options={options} testIDPrefix="tags" value="all" />);
    fireEvent.press(screen.getByTestId('tags-all'));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('draws a faint option in ink-faint until it is on', () => {
    const options = [{ value: 'a', label: 'Alpha' }, { value: 'old', label: 'Old (deleted)', faint: true }];
    const { rerender } = render(<ChipGroup mode="single" onChange={jest.fn()} options={options} testIDPrefix="tags" value="a" />);
    expect(flatStyle(within(screen.getByTestId('tags-old')).getByText('Old (deleted)')).color).toBe(roles.inkFaint);

    rerender(<ChipGroup mode="single" onChange={jest.fn()} options={options} testIDPrefix="tags" value="old" />);
    expect(flatStyle(within(screen.getByTestId('tags-old')).getByText('Old (deleted)')).color).toBe(roles.onInk);
  });
});

describe('Tag', () => {
  it('names a state in a micro-label pill on the hairline alone, never lifted like a control', () => {
    render(<Tag label="Archived" testID="tag" />);
    expect(flatStyle(screen.getByTestId('tag'))).toMatchObject({ borderRadius: uiGeometry.radius.pill, borderWidth: 1, borderColor: roles.rule });
    expect(flatStyle(screen.getByTestId('tag')).boxShadow).toBeUndefined();
    expect(flatStyle(screen.getByText('Archived'))).toMatchObject({ textTransform: 'uppercase', color: roles.inkMuted });
  });
});

describe('SwitchRow', () => {
  it('is one accessible switch across the row: the row or the drawn switch turns it', () => {
    const onValueChange = jest.fn();
    const { rerender } = render(<SwitchRow label="Show deleted sessions" onValueChange={onValueChange} testID="row" value={false} />);
    const row = screen.getByTestId('row');
    expect(row).toHaveProp('accessibilityRole', 'switch');
    expect(row).toHaveProp('accessibilityState', { checked: false });
    expect(row).toHaveProp('accessibilityLabel', 'Show deleted sessions');

    fireEvent.press(row);
    expect(onValueChange).toHaveBeenLastCalledWith(true);

    rerender(<SwitchRow label="Show deleted sessions" onValueChange={onValueChange} testID="row" value />);
    expect(screen.getByTestId('row')).toHaveProp('accessibilityState', { checked: true });
    fireEvent(screen.getByTestId('row-switch', { includeHiddenElements: true }), 'valueChange', false);
    expect(onValueChange).toHaveBeenLastCalledWith(false);
  });
});

describe('Notice', () => {
  it('states information on the subtle ground with no success or warning hue', () => {
    render(<Notice icon="offline" live message="Offline · last updated 09:41" testID="notice" />);

    const band = screen.getByTestId('notice');
    expect(flatStyle(band)).toMatchObject({ backgroundColor: roles.paper, borderRadius: uiGeometry.radius.card });
    expectEdge(band);
    expect(band.props.accessibilityLiveRegion).toBe('polite');
    expect(band.props.accessibilityRole).toBeUndefined();
    expect(flatStyle(screen.getByText('Offline · last updated 09:41')).color).toBe(roles.ink);
  });

  it('names its message with an optional title, the glyph level with it', () => {
    render(<Notice icon="warning" message="Missing EXPO_PUBLIC_SUPABASE_URL." testID="notice" title="Sign-in unavailable" />);
    expect(flatStyle(screen.getByTestId('notice')).alignItems).toBe('flex-start');
    expect(flatStyle(screen.getByRole('header', { name: 'Sign-in unavailable' }))).toMatchObject({
      fontFamily: 'Archivo',
      fontWeight: '700',
      color: roles.ink,
    });
    expect(flatStyle(screen.getByText('Missing EXPO_PUBLIC_SUPABASE_URL.')).color).toBe(roles.ink);
  });

  it('announces a failure as an alert in danger', () => {
    render(<Notice message="Nothing was changed." testID="notice" tone="danger" />);
    expect(screen.getByTestId('notice').props.accessibilityRole).toBe('alert');
    expect(flatStyle(screen.getByText('Nothing was changed.')).color).toBe(roles.danger);
  });
});

describe('PageHeader / SectionHeader', () => {
  it('titles a tab screen in Archivo 800, alone', () => {
    render(<PageHeader title="Today" />);
    expect(flatStyle(screen.getByRole('header', { name: 'Today' }))).toMatchObject({
      fontFamily: 'Archivo',
      fontWeight: '800',
      fontSize: uiTypography.size.xxl,
    });
  });

  it('heads a section with an optional caps text action, never a primary', () => {
    const onPress = jest.fn();
    render(<SectionHeader action={{ label: 'View groups', onPress, testID: 'view' }} title="Group activity" />);
    expect(screen.getByRole('header', { name: 'Group activity' })).toBeTruthy();
    expect(flatStyle(screen.getByTestId('view')).backgroundColor).toBeUndefined();
    fireEvent.press(screen.getByTestId('view'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe('SliderRow', () => {
  it('draws its plain track as a sunken well, filled in ink', () => {
    render(<SliderRow format={String} label="Depth" max={300} onChange={jest.fn()} onChangeEnd={jest.fn()} testID="depth" value={100} />);
    const track = screen.getByTestId('depth-track').children[0] as never;
    expectWell(track);
  });
});

describe('the floating tab pill', () => {
  it('is a surface inside the edge at the card radius', () => {
    render(<MainTabs activeTab="today" onSelect={jest.fn()} />);
    const shell = screen.getByTestId('main-bottom-tabs');
    expect(flatStyle(shell)).toMatchObject({ backgroundColor: roles.surface, borderRadius: uiGeometry.radius.card });
    expectEdge(shell);
  });
});
