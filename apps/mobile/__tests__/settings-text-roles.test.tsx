/**
 * Settings' own pieces on the shared text roles (`design-language.md` §3,
 * "Text roles"): titles `title`, micro-labels `label`, figures in Plex Mono and
 * words never. The theme preview keeps the colours of the theme it previews.
 */
import { configure, screen, within } from '@testing-library/react-native';

import { PartSpotlight, ThemePreview } from '@/components/appearance/theme-preview';
import { HeaderTitleMenu } from '@/components/ui';
import { SignedOutCard } from '@/components/profile/profile-cards';
import { generateRoles } from '@/components/ui/theme';
import { seedsFromHue } from '@/components/ui/theme-hue';
import { uiFonts, uiTypography } from '@/components/ui/tokens';

import { DEFAULT_APPEARANCE } from '@/components/ui/theme-presets';
import { renderWithTheme, rolesFor } from './helpers/theme';

const defaultRoles = rolesFor(DEFAULT_APPEARANCE);

const TITLE = { fontFamily: uiFonts.display.family, fontWeight: '700', fontSize: uiTypography.size.lg, lineHeight: uiTypography.lineHeight.lg } as const;
const FIGURE = { fontFamily: uiFonts.figure.family, fontWeight: '500', fontSize: uiTypography.size.base } as const;
const META = { fontFamily: uiFonts.body.family, fontWeight: '400', fontSize: uiTypography.size.sm } as const;
const BODY = { fontFamily: uiFonts.body.family, fontWeight: '400', fontSize: uiTypography.size.base } as const;

describe('ThemePreview', () => {
  // The preview is decoration, hidden from accessibility (`no-hide-descendants`).
  beforeAll(() => configure({ defaultIncludeHiddenElements: true }));
  afterAll(() => configure({ defaultIncludeHiddenElements: false }));
  const roles = generateRoles(seedsFromHue(200));
  const renderPreview = () => {
    renderWithTheme(<ThemePreview roles={roles} testID="preview" />);
    return within(screen.getByTestId('preview'));
  };

  it('titles the mock card and keeps the previewed theme’s colours', () => {
    const preview = renderPreview();
    expect(preview.getByText('Bench Press')).toHaveStyle({ ...TITLE, color: roles.ink });
  });

  it('draws the set lines as figures, set numbers at the figure weight', () => {
    const preview = renderPreview();
    expect(preview.getByText('80 × 8')).toHaveStyle(FIGURE);
    // The first `1` is the header's set count; the second, the set's number.
    expect(preview.getAllByText('1')[1]).toHaveStyle({ ...FIGURE, color: roles.inkMuted });
    expect(preview.getByText('2')).toHaveStyle({ ...FIGURE, color: roles.accent });
  });

  it('shows the secondary text, the muted text and the direction at a size that reads', () => {
    const preview = renderPreview();
    // The secondary text: the header's line, and each done set's 1RM beside it.
    expect(preview.getByText(/^1 set · 1RM/)).toHaveStyle({ ...BODY, color: roles.inkMuted });
    // The muted text: a planned set, every figure faded ([[set.row-figures]]).
    const planned = within(screen.getByTestId('preview-planned'));
    expect(planned.getByText('3')).toHaveStyle({ ...FIGURE, color: roles.inkFaint });
    expect(planned.getByText('85 × 8')).toHaveStyle({ ...FIGURE, color: roles.inkFaint });
    // The direction: a change up and one down.
    const changes = within(screen.getByTestId('preview-changes'));
    expect(changes.getByText('+2.5')).toHaveStyle({ fontFamily: uiFonts.figure.family, color: roles.gain });
    expect(changes.getByText('−1')).toHaveStyle({ fontFamily: uiFonts.figure.family, color: roles.loss });
  });

  it('keeps words out of Plex Mono on the body lines, only their figures in it', () => {
    const preview = renderPreview();
    const header = preview.getByText(/^1 set · 1RM/);
    expect(header).toHaveStyle({ ...BODY, color: roles.inkMuted });
    expect(preview.getByText('Since last week')).toHaveStyle({ ...BODY, color: roles.pageInkMuted });
    expect(within(header).getAllByText(/^\d/).length).toBeGreaterThan(0);
    within(header).getAllByText(/^\d/).forEach((figure) => expect(figure).toHaveStyle({ fontFamily: uiFonts.figure.family }));
  });

  it('draws the record as a micro-label and a heavy figure in the record colour', () => {
    const preview = renderPreview();
    expect(preview.getByText('BEST EVER')).toHaveStyle({ fontFamily: uiFonts.display.family, fontSize: uiTypography.size.xxs, color: roles.record });
    expect(preview.getByText('105.0')).toHaveStyle({ fontFamily: uiFonts.figure.family, fontWeight: '700', color: roles.record });
  });
});

describe('PartSpotlight', () => {
  beforeAll(() => configure({ defaultIncludeHiddenElements: true }));
  afterAll(() => configure({ defaultIncludeHiddenElements: false }));
  const roles = generateRoles(seedsFromHue(200));

  it('names each sample in meta words, in the previewed theme’s muted ink', () => {
    renderWithTheme(<PartSpotlight part="muted" roles={roles} testID="spotlight" />);
    expect(screen.getByText('Field')).toHaveStyle({ ...META, color: roles.inkMuted });
  });
});

describe('HeaderTitleMenu', () => {
  it('draws the current option in the sheet-title role', () => {
    renderWithTheme(
      <HeaderTitleMenu currentId="b" onChoose={jest.fn()} options={[{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }]}
        sheetTitle="Letter" testID="title" />,
    );
    expect(screen.getByText('Beta')).toHaveStyle({ fontFamily: uiFonts.display.family, color: defaultRoles.ink });
  });
});

describe('SignedOutCard', () => {
  it('titles the card', () => {
    renderWithTheme(
      <SignedOutCard disabled={false} email="" inlineError={null} isSubmitting={false} onChangeEmail={jest.fn()}
        onChangePassword={jest.fn()} onSignIn={jest.fn()} password="" />,
    );
    expect(screen.getByRole('header', { name: 'Sign in' })).toHaveStyle(TITLE);
  });
});
