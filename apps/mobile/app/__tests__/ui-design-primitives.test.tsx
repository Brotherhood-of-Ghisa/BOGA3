import { fireEvent, render, screen, within } from '@testing-library/react-native';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  StyleSheet,
  Text,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from 'react-native';

import {
  ActionButton,
  Card,
  ChipGroup,
  FormField,
  IconButton,
  ListRow,
  Notice,
  PageHeader,
  ScreenScroll,
  SearchField,
  SectionHeader,
  SegmentedControl,
  Sheet,
  Stat,
  StatePanel,
  Tag,
  uiGeometry,
  uiRoles,
  uiSpace,
  uiTypography,
} from '@/components/ui';

// The design-language primitives (`docs/specs/ui/design-language.md` §4–§6),
// asserted on their own; the screens that adopt them have their own tests.

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

  it('sets a secondary stacked figure at the row size, lighter than a headline', () => {
    render(<Stat align="end" label="Sets" rank="secondary" value="10 (8)" />);

    expect(flatStyle(screen.getByText('10 (8)'))).toMatchObject({
      fontFamily: 'IBM Plex Mono',
      fontWeight: '600',
      fontSize: uiTypography.size.base,
      color: uiRoles.ink,
    });
  });

  it('turns the legend ink on a data-viz ground, where ink-faint is illegible', () => {
    render(<Stat ground="viz" label="Sets" rank="secondary" value="10 (8)" />);

    expect(flatStyle(screen.getByText('Sets')).color).toBe(uiRoles.ink);
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

  it('sets a description under the label in ink-muted body text', () => {
    render(<ListRow density="list" description="Search, create, edit." label="Exercise database" />);

    expect(flatStyle(screen.getByText('Search, create, edit.'))).toMatchObject({
      fontFamily: 'Source Sans 3',
      fontWeight: '400',
      color: uiRoles.inkMuted,
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
  it('draws the one primary on accent, at the control radius and tap-target height', () => {
    const onPress = jest.fn();
    render(<ActionButton label="Edit" onPress={onPress} testID="button" variant="primary" />);

    const button = screen.getByTestId('button');
    expect(flatStyle(button)).toMatchObject({
      backgroundColor: uiRoles.accent,
      borderRadius: uiGeometry.radius.control,
      minHeight: uiGeometry.tapTarget,
    });
    expect(button.props.accessibilityRole).toBe('button');
    expect(flatStyle(screen.getByText('Edit'))).toMatchObject({ color: uiRoles.surface, textTransform: 'uppercase' });
    fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('draws a secondary action as an ink outline, and a danger one in danger', () => {
    render(
      <>
        <ActionButton label="+ Add exercise" onPress={jest.fn()} testID="outline" variant="outline" />
        <ActionButton label="Archive" onPress={jest.fn()} testID="danger" tone="danger" variant="outline" />
      </>,
    );

    expect(flatStyle(screen.getByTestId('outline'))).toMatchObject({ borderColor: uiRoles.ink, borderWidth: 1 });
    expect(flatStyle(screen.getByTestId('danger')).borderColor).toBe(uiRoles.danger);
    expect(flatStyle(screen.getByText('Archive')).color).toBe(uiRoles.danger);
  });

  it('fades when disabled and ignores presses', () => {
    const onPress = jest.fn();
    render(<ActionButton disabled label="Done" onPress={onPress} testID="button" variant="primary" />);

    const button = screen.getByTestId('button');
    expect(flatStyle(button).backgroundColor).toBe(uiRoles.disabled);
    expect(button.props.accessibilityState).toMatchObject({ disabled: true });
    fireEvent.press(button);
    expect(onPress).not.toHaveBeenCalled();
  });
});

describe('IconButton', () => {
  it('is one labelled 44pt button whose glyph is decoration', () => {
    const onPress = jest.fn();
    render(<IconButton accessibilityLabel="Session options" name="more-vertical" onPress={onPress} testID="more" />);

    const button = screen.getByRole('button', { name: 'Session options' });
    expect(flatStyle(button)).toMatchObject({ width: uiGeometry.tapTarget, height: uiGeometry.tapTarget });
    expect(screen.queryByRole('image')).toBeNull();
    fireEvent.press(button);
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('draws the accent tone as the one primary, and ignores presses when disabled', () => {
    const onPress = jest.fn();
    const { rerender } = render(
      <IconButton accessibilityLabel="New exercise" name="plus" onPress={onPress} testID="add" tone="accent" />,
    );
    expect(flatStyle(screen.getByTestId('add')).backgroundColor).toBe(uiRoles.accent);

    rerender(<IconButton accessibilityLabel="New exercise" disabled name="plus" onPress={onPress} testID="add" tone="accent" />);
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
    expect(flatStyle(screen.getByText("Couldn't load this"))).toMatchObject({ fontFamily: 'Archivo', color: uiRoles.ink });
    expect(flatStyle(screen.getByText('Check your connection.')).color).toBe(uiRoles.inkMuted);
    // An outline, never the screen's primary.
    expect(flatStyle(screen.getByTestId('retry')).borderColor).toBe(uiRoles.ink);
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
    expect(flatStyle(scroll).backgroundColor).toBe(uiRoles.paper);
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
    expect(flatStyle(screen.getByText('Start'))).toMatchObject({ textTransform: 'uppercase', color: uiRoles.inkFaint });
    expect(screen.getByTestId('start').props.placeholderTextColor).toBe(uiRoles.disabled);
    expect(flatStyle(screen.getByTestId('start')).fontFamily).toBe('IBM Plex Mono');
    expect(screen.queryByTestId('start-error')).toBeNull();

    rerender(<FormField error="Use YYYY-MM-DD HH:mm" face="text" label="Start" onChangeText={jest.fn()} testID="start" value="x" />);
    expect(flatStyle(screen.getByTestId('start-error')).color).toBe(uiRoles.danger);
    expect(flatStyle(screen.getByTestId('start')).fontFamily).toBe('Source Sans 3');
    const field = screen.getByTestId('start').parent?.parent;
    expect(field && flatStyle(field)).toMatchObject({
      height: uiGeometry.fieldHeight,
      borderColor: uiRoles.danger,
      borderRadius: uiGeometry.radius.control,
    });
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
    expect(flatStyle(screen.getByTestId('view-records')).backgroundColor).toBe(uiRoles.ink);
    expect(flatStyle(screen.getByTestId('view-last')).backgroundColor).toBe(uiRoles.surface);

    fireEvent.press(screen.getByTestId('view-records'));
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.press(screen.getByTestId('view-last'));
    expect(onChange).toHaveBeenCalledWith('last');
  });

  it('fills the row with equal segments unless inline', () => {
    const { rerender } = render(<SegmentedControl onChange={jest.fn()} options={OPTIONS} testIDPrefix="view" value="last" />);
    expect(flatStyle(screen.getByTestId('view-last')).flex).toBe(1);

    rerender(<SegmentedControl layout="inline" onChange={jest.fn()} options={OPTIONS} testIDPrefix="view" value="last" />);
    expect(flatStyle(screen.getByTestId('view-last')).flex).toBeUndefined();
  });

  it('ignores presses and fades while disabled', () => {
    const onChange = jest.fn();
    render(<SegmentedControl disabled onChange={onChange} options={OPTIONS} testIDPrefix="view" value="records" />);

    expect(screen.getByTestId('view-records').props.accessibilityState).toEqual({ selected: true, disabled: true });
    expect(screen.getByTestId('view-last').props.accessibilityState).toEqual({ selected: false, disabled: true });
    expect(flatStyle(screen.getByTestId('view-records')).backgroundColor).toBe(uiRoles.disabled);
    fireEvent.press(screen.getByTestId('view-last'));
    expect(onChange).not.toHaveBeenCalled();
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
      backgroundColor: uiRoles.ink,
      borderRadius: uiGeometry.radius.pill,
    });
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
});

describe('Tag', () => {
  it('names a state in a micro-label pill', () => {
    render(<Tag label="Archived" testID="tag" />);
    expect(flatStyle(screen.getByTestId('tag'))).toMatchObject({ borderRadius: uiGeometry.radius.pill, borderColor: uiRoles.rule });
    expect(flatStyle(screen.getByText('Archived'))).toMatchObject({ textTransform: 'uppercase', color: uiRoles.inkMuted });
  });
});

describe('Notice', () => {
  it('states information on the subtle ground with no success or warning hue', () => {
    render(<Notice icon="offline" live message="Offline · last updated 09:41" testID="notice" />);

    const band = screen.getByTestId('notice');
    expect(flatStyle(band)).toMatchObject({ backgroundColor: uiRoles.surfaceSubtle, borderColor: uiRoles.rule });
    expect(band.props.accessibilityLiveRegion).toBe('polite');
    expect(band.props.accessibilityRole).toBeUndefined();
    expect(flatStyle(screen.getByText('Offline · last updated 09:41')).color).toBe(uiRoles.ink);
  });

  it('names its message with an optional title, the glyph level with it', () => {
    render(<Notice icon="warning" message="Missing EXPO_PUBLIC_SUPABASE_URL." testID="notice" title="Sign-in unavailable" />);
    expect(flatStyle(screen.getByTestId('notice')).alignItems).toBe('flex-start');
    expect(flatStyle(screen.getByRole('header', { name: 'Sign-in unavailable' }))).toMatchObject({
      fontFamily: 'Archivo',
      fontWeight: '700',
      color: uiRoles.ink,
    });
    expect(flatStyle(screen.getByText('Missing EXPO_PUBLIC_SUPABASE_URL.')).color).toBe(uiRoles.ink);
  });

  it('announces a failure as an alert in danger', () => {
    render(<Notice message="Nothing was changed." testID="notice" tone="danger" />);
    expect(screen.getByTestId('notice').props.accessibilityRole).toBe('alert');
    expect(flatStyle(screen.getByText('Nothing was changed.')).color).toBe(uiRoles.danger);
  });
});

describe('PageHeader / SectionHeader', () => {
  it('titles a tab screen in Archivo 800 with a muted intro', () => {
    render(<PageHeader intro="At a glance." title="Today" />);
    expect(flatStyle(screen.getByRole('header', { name: 'Today' }))).toMatchObject({
      fontFamily: 'Archivo',
      fontWeight: '800',
      fontSize: uiTypography.size.xxl,
    });
    expect(flatStyle(screen.getByText('At a glance.')).color).toBe(uiRoles.inkMuted);
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
