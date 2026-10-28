/**
 * Settings' own pieces on the shared text roles (`design-language.md` §3,
 * "Text roles"): titles `title`, micro-labels `label`, figures in Plex Mono and
 * words never. The theme preview keeps the colours of the theme it previews.
 */
import { configure, render, screen, within } from '@testing-library/react-native';

import { HueRing } from '@/components/appearance/hue-ring';
import { ThemePreview } from '@/components/appearance/theme-preview';
import { SignedOutCard } from '@/components/profile/profile-cards';
import { generateRoles } from '@/components/ui/theme';
import { seedsFromHue } from '@/components/ui/theme-hue';
import { uiFonts, uiRoles, uiTypography } from '@/components/ui/tokens';

const TITLE = { fontFamily: uiFonts.display.family, fontWeight: '700', fontSize: uiTypography.size.lg, lineHeight: uiTypography.lineHeight.lg } as const;
const FIGURE = { fontFamily: uiFonts.figure.family, fontWeight: '500', fontSize: uiTypography.size.base } as const;
const META = { fontFamily: uiFonts.body.family, fontWeight: '400', fontSize: uiTypography.size.sm } as const;

describe('ThemePreview', () => {
  // The preview is decoration, hidden from accessibility (`no-hide-descendants`).
  beforeAll(() => configure({ defaultIncludeHiddenElements: true }));
  afterAll(() => configure({ defaultIncludeHiddenElements: false }));
  const roles = generateRoles(seedsFromHue(200));
  const renderPreview = () => {
    render(<ThemePreview roles={roles} testID="preview" />);
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
    expect(preview.getAllByText('1')[1]).toHaveStyle({ ...FIGURE, color: roles.inkFaint });
    expect(preview.getByText('2')).toHaveStyle({ ...FIGURE, color: roles.accent });
  });

  it('keeps words out of Plex Mono on the meta lines, only their figures in it', () => {
    const preview = renderPreview();
    const header = preview.getByText(/^1 set · 1RM/);
    expect(header).toHaveStyle({ ...META, color: roles.inkMuted });
    expect(within(header).getAllByText(/^\d/).length).toBeGreaterThan(0);
    within(header).getAllByText(/^\d/).forEach((figure) => expect(figure).toHaveStyle({ fontFamily: uiFonts.figure.family }));
  });

  it('draws the record as a micro-label and a heavy figure in the record colour', () => {
    const preview = renderPreview();
    expect(preview.getByText('BEST EVER')).toHaveStyle({ fontFamily: uiFonts.display.family, fontSize: uiTypography.size.xxs, color: roles.record });
    expect(preview.getByText('105.0')).toHaveStyle({ fontFamily: uiFonts.figure.family, fontWeight: '700', color: roles.record });
  });
});

describe('HueRing', () => {
  it('names the hue as a title and its degrees as a muted figure', () => {
    render(<HueRing hue={47} onChange={jest.fn()} testID="ring" />);
    expect(screen.getByTestId('ring-name')).toHaveStyle(TITLE);
    expect(screen.getByText('47°')).toHaveStyle({ ...FIGURE, color: uiRoles.inkMuted });
  });
});

describe('SignedOutCard', () => {
  it('titles the card', () => {
    render(
      <SignedOutCard disabled={false} email="" inlineError={null} isSubmitting={false} onChangeEmail={jest.fn()}
        onChangePassword={jest.fn()} onSignIn={jest.fn()} password="" />,
    );
    expect(screen.getByRole('header', { name: 'Sign in' })).toHaveStyle(TITLE);
  });
});
