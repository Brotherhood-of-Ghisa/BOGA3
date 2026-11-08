import { screen } from '@testing-library/react-native';
import { StyleSheet, type TextStyle, type ViewStyle } from 'react-native';

import { RestTimerBar } from '@/components/session-recorder/rest-timer-bar';
import { TitleBarTimer } from '@/components/session-recorder/title-bar-timer';
import { SessionTopBar } from '@/components/session-view/session-top-bar';
import { ViewSessionTopBar } from '@/components/view-session/view-session-top-bar';
import { DEFAULT_APPEARANCE, type AppearanceChoice } from '@/components/ui/theme-presets';
import type { RestTimerView } from '@/src/session-recorder/rest-timer';

import { renderWithTheme, rolesFor, switchTheme } from './helpers/theme';

// The session recorder, the session view and the completed-session view repaint
// when a theme is saved: the roles they draw come from the provider, so a saved
// choice changes their colours without a remount.

const SLATE_DARK: AppearanceChoice = { theme: 'slate', mode: 'dark', custom: null };

const flat = (node: { props: { style?: unknown } }) => StyleSheet.flatten(node.props.style as never) as TextStyle & ViewStyle;

const REST_DONE: RestTimerView = {
  mode: 'rest', status: 'completed', sessionId: 's', remainingSec: 0, formatted: '0:00', durationSec: 90,
};

describe('session recorder, session view and completed-session view: live theme', () => {
  afterEach(async () => {
    await switchTheme(DEFAULT_APPEARANCE);
  });

  it('repaints the title-bar timer pill and the rest timer bar when the theme is saved', async () => {
    const before = rolesFor(DEFAULT_APPEARANCE);
    const after = rolesFor(SLATE_DARK);
    expect(after.ink).not.toBe(before.ink);
    expect(after.surface).not.toBe(before.surface);

    renderWithTheme(
      <>
        <TitleBarTimer onLongPress={jest.fn()} onPress={jest.fn()} testID="timer" view={REST_DONE} />
        <RestTimerBar onAdjust={jest.fn()} onDismiss={jest.fn()} onRestart={jest.fn()} view={REST_DONE} />
      </>,
    );
    expect(flat(screen.getByTestId('timer-pill'))).toMatchObject({ backgroundColor: before.ink, borderColor: before.ink });
    expect(flat(screen.getByTestId('timer-countdown')).color).toBe(before.onInk);
    expect(flat(screen.getByTestId('rest-timer-bar')).backgroundColor).toBe(before.surface);

    await switchTheme(SLATE_DARK);

    expect(flat(screen.getByTestId('timer-pill'))).toMatchObject({ backgroundColor: after.ink, borderColor: after.ink });
    expect(flat(screen.getByTestId('timer-countdown')).color).toBe(after.onInk);
    expect(flat(screen.getByTestId('rest-timer-bar')).backgroundColor).toBe(after.surface);
  });

  it('repaints the session view and completed-session title bars when the theme is saved', async () => {
    const before = rolesFor(DEFAULT_APPEARANCE);
    const after = rolesFor(SLATE_DARK);

    renderWithTheme(
      <>
        <SessionTopBar mode="completed" onDone={jest.fn()} />
        <ViewSessionTopBar onBack={jest.fn()} title="Morning training" />
      </>,
    );
    expect(flat(screen.getByTestId('session-view-top-bar')).backgroundColor).toBe(before.surface);
    expect(flat(screen.getByText('Edit session')).color).toBe(before.ink);
    expect(flat(screen.getByTestId('completed-session-detail-top-bar')).backgroundColor).toBe(before.surface);
    expect(flat(screen.getByText('Morning training')).color).toBe(before.ink);

    await switchTheme(SLATE_DARK);

    expect(flat(screen.getByTestId('session-view-top-bar')).backgroundColor).toBe(after.surface);
    expect(flat(screen.getByText('Edit session')).color).toBe(after.ink);
    expect(flat(screen.getByTestId('completed-session-detail-top-bar')).backgroundColor).toBe(after.surface);
    expect(flat(screen.getByText('Morning training')).color).toBe(after.ink);
  });
});
