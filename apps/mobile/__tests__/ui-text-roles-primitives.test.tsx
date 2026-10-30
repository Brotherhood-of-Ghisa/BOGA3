/**
 * The shared primitives draw every text from the text roles
 * (`design-language.md` §3, "Text roles"): a title, an option row, a button, a
 * field, a legend each take one role, so a screen built from them inherits the
 * vocabulary instead of re-assembling face, weight and size.
 */
import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, Text, type TextStyle } from 'react-native';

import { ActionButton, ChipGroup, FormField, ListRow, Notice, PageHeader, SearchField, SectionHeader, SegmentedControl, Sheet, Stat, StatePanel, SwitchRow, Tag, ToggleChip } from '@/components/ui';
import { ActionRow, InputRow } from '@/components/ui/form-section';
import { Information } from '@/components/ui/information';
import { PageSheetHeader } from '@/components/ui/page-sheet';
import { uiText, uiTextTone } from '@/components/ui/text-roles';
import { uiRoles } from '@/components/ui/tokens';

const style = (node: { props: { style?: unknown } }): TextStyle => StyleSheet.flatten(node.props.style as never) as TextStyle;
const OPTIONS = [{ value: 'a', label: 'Alpha' }, { value: 'b', label: 'Beta' }] as const;

describe('titles', () => {
  it('heads a page in pageTitle and a section in title', () => {
    render(<><PageHeader title="Settings" /><SectionHeader title="Units" /></>);
    expect(style(screen.getByText('Settings'))).toMatchObject(uiText.pageTitle);
    expect(style(screen.getByText('Units'))).toMatchObject(uiText.title);
  });

  it('heads a sheet and a page sheet in sheetTitle, a page sheet eyebrow in label', () => {
    render(<>
      <Sheet dismissLabel="Dismiss" onDismiss={jest.fn()} title="Bench Press" visible><Text>Body</Text></Sheet>
      <PageSheetHeader closeLabel="Close" eyebrow="Exercise" onClose={jest.fn()} title="Squat" />
    </>);
    expect(style(screen.getByText('Bench Press'))).toMatchObject(uiText.sheetTitle);
    expect(style(screen.getByText('Squat'))).toMatchObject(uiText.sheetTitle);
    expect(style(screen.getByText('Exercise'))).toMatchObject(uiText.label);
  });

  it('titles a state panel, a notice and an information heading in title over body', () => {
    render(<>
      <StatePanel body="Try again." fill={false} title="Nothing here" />
      <Notice message="Retry later." title="Offline" />
      <Information body="About." label="RM curve" title="About the RM curve" />
    </>);
    expect(style(screen.getByText('Nothing here'))).toMatchObject(uiText.title);
    expect(style(screen.getByText('Try again.'))).toMatchObject({ ...uiText.body, color: uiRoles.inkMuted });
    expect(style(screen.getByText('Offline'))).toMatchObject(uiText.title);
    expect(style(screen.getByText('Retry later.'))).toMatchObject(uiText.body);
    expect(style(screen.getByText('RM curve'))).toMatchObject(uiText.title);
  });

  it('heads an information sheet\'s sections in bodyStrong over muted body', () => {
    render(<Information body="About." label="RM curve" sections={[['Regimes', 'Two fits.']]} testIDPrefix="rm" title="About the RM curve" />);
    fireEvent.press(screen.getByTestId('rm-info'));
    expect(style(screen.getByText('Regimes'))).toMatchObject(uiText.bodyStrong);
    expect(style(screen.getByText('Two fits.'))).toMatchObject({ ...uiText.body, color: uiRoles.inkMuted });
  });
});

describe('option rows', () => {
  it('names a sheet row in optionLarge and a card row in option', () => {
    render(<>
      <ListRow label="Sheet row" />
      <ListRow density="list" description="Search, create, edit." label="List row" />
      <SwitchRow label="Sheet switch" onValueChange={jest.fn()} value />
      <SwitchRow density="list" label="List switch" onValueChange={jest.fn()} value />
      <ActionRow icon="link" label="Link exercise" onPress={jest.fn()} />
    </>);
    expect(style(screen.getByText('Sheet row'))).toMatchObject(uiText.optionLarge);
    expect(style(screen.getByText('Sheet switch'))).toMatchObject(uiText.optionLarge);
    expect(style(screen.getByText('List row'))).toMatchObject(uiText.option);
    expect(style(screen.getByText('List switch'))).toMatchObject(uiText.option);
    expect(style(screen.getByText('Link exercise'))).toMatchObject({ ...uiText.option, color: uiRoles.accent });
    expect(style(screen.getByText('Search, create, edit.'))).toMatchObject({ ...uiText.body, color: uiRoles.inkMuted });
  });
});

describe('controls', () => {
  it('labels a button in button, a compact one in the ink micro-label', () => {
    render(<>
      <ActionButton label="Save" onPress={jest.fn()} variant="outline" />
      <ActionButton label="Certify" onPress={jest.fn()} size="compact" variant="outline" />
    </>);
    expect(style(screen.getByText('Save'))).toMatchObject(uiText.button);
    expect(style(screen.getByText('Certify'))).toMatchObject({ ...uiText.label, ...uiTextTone.ink });
  });

  it('labels chips, toggle chips, segments and tags with the micro-label', () => {
    render(<>
      <ChipGroup mode="single" onChange={jest.fn()} options={[{ value: 'c', label: 'Chest' }]} testIDPrefix="chip" value="c" />
      <ToggleChip accessibilityLabel="Metric" onChange={jest.fn()} options={[{ value: 's', label: 'Sets' }]} testID="toggle" value="s" />
      <SegmentedControl onChange={jest.fn()} options={OPTIONS} testIDPrefix="seg" value="a" />
      <Tag label="Draft" />
    </>);
    for (const text of ['Chest', 'Sets', 'Alpha', 'Draft']) {
      const { color: _colour, ...face } = uiText.label;
      expect(style(screen.getByText(text))).toMatchObject(face);
    }
  });
});

describe('fields', () => {
  it('types words in input, a search query in inputLarge and numbers in input with the figure face', () => {
    render(<>
      <FormField face="text" hint="Shown to your group." label="Name" onChangeText={jest.fn()} testID="name" value="Ann" />
      <FormField error="Enter a weight" label="Weight" onChangeText={jest.fn()} testID="weight" value="100" />
      <InputRow label="Rest" onChangeText={jest.fn()} testID="rest" value="90" />
      <SearchField accessibilityLabel="Search" onChangeText={jest.fn()} testID="search" value="bench" />
    </>);
    expect(style(screen.getByTestId('name'))).toMatchObject(uiText.input);
    expect(style(screen.getByTestId('search'))).toMatchObject(uiText.inputLarge);
    expect(style(screen.getByTestId('weight'))).toMatchObject({ ...uiText.input, ...uiText.inlineFigure });
    expect(style(screen.getByTestId('rest'))).toMatchObject({ ...uiText.input, ...uiText.inlineFigure });
    expect(style(screen.getByText('Name'))).toMatchObject({ ...uiText.label, color: uiRoles.inkFaint });
    expect(style(screen.getByText('Shown to your group.'))).toMatchObject(uiText.meta);
    expect(style(screen.getByText('Enter a weight'))).toMatchObject({ ...uiText.meta, color: uiRoles.danger });
  });
});

describe('Stat', () => {
  it('draws its legend in label, a headline in figureStat, a row figure in figure', () => {
    render(<>
      <Stat label="Volume" value="8420" />
      <Stat label="Sets" rank="secondary" value="12" />
      <Stat label="1RM" layout="inline" value="102.1" />
    </>);
    expect(style(screen.getByText('Volume'))).toMatchObject({ ...uiText.label, color: uiRoles.inkFaint });
    expect(style(screen.getByText('8420'))).toMatchObject(uiText.figureStat);
    expect(style(screen.getByText('12'))).toMatchObject(uiText.figure);
    expect(style(screen.getByText('102.1'))).toMatchObject({ ...uiText.figureSmall, color: uiRoles.ink });
  });
});
