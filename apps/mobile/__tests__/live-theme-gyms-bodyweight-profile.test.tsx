/* eslint-disable import/first */
/**
 * A saved theme repaints the gym, body weight, profile and notification pieces
 * that draw colour (`components/ui/theme-context.tsx`): text roles, tones and
 * `makeStyles` sheets alike, without a remount.
 */
jest.mock('expo-router', () => ({
  useFocusEffect: jest.fn(),
  useRouter: () => ({ push: jest.fn() }),
}));
jest.mock('@/src/notifications', () => ({
  NotificationApiError: class extends Error {},
  getGroupNotificationPreferences: jest.fn(),
  setGroupNotificationMuted: jest.fn(),
}));

import { screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { WeightEntrySheet } from '@/components/bodyweight/weight-entry-sheet';
import { GymEditor } from '@/components/gyms/gym-editor';
import { GymScopeChoices } from '@/components/gyms/gym-picker';
import { GroupNotificationMuteRow } from '@/components/notifications/group-mute-row';
import { ProfileSummary, SignedOutCard } from '@/components/profile/profile-cards';
import { DEFAULT_APPEARANCE, type AppearanceChoice } from '@/components/ui/theme-presets';

import { renderWithTheme, rolesFor, switchTheme } from './helpers/theme';

const SLATE_DARK: AppearanceChoice = { theme: 'slate', mode: 'dark', custom: null };
const before = rolesFor(DEFAULT_APPEARANCE);
const after = rolesFor(SLATE_DARK);

afterEach(async () => {
  await switchTheme(DEFAULT_APPEARANCE);
});

describe('live theme: gyms, body weight, profile and notifications', () => {
  it('repaints the body weight entry explanation (muted text tone)', async () => {
    renderWithTheme(
      <WeightEntrySheet autoFocus={false} explanation="Used from this session on." initial={{ weightValue: '' }}
        measuredAt={new Date()} onDismiss={jest.fn()} onSave={jest.fn()} title="Add reading" />,
    );
    expect(screen.getByText('Used from this session on.')).toHaveStyle({ color: before.inkMuted });
    await switchTheme(SLATE_DARK);
    expect(after.inkMuted).not.toBe(before.inkMuted);
    expect(screen.getByText('Used from this session on.')).toHaveStyle({ color: after.inkMuted });
  });

  it('repaints the gym editor row (a sheet) and its text', async () => {
    renderWithTheme(<GymEditor gym={null} onCancel={jest.fn()} onDone={jest.fn()} onLocationChanged={jest.fn()} />);
    expect(screen.getByTestId('gym-editor')).toHaveStyle({ backgroundColor: before.accentWash, borderLeftColor: before.accent });
    expect(screen.getByTestId('gym-editor-location-status')).toHaveStyle({ color: before.ink });

    await switchTheme(SLATE_DARK);

    expect(after.accentWash).not.toBe(before.accentWash);
    expect(after.ink).not.toBe(before.ink);
    expect(screen.getByTestId('gym-editor')).toHaveStyle({ backgroundColor: after.accentWash, borderLeftColor: after.accent });
    expect(screen.getByTestId('gym-editor-location-status')).toHaveStyle({ color: after.ink });
  });

  it('repaints the gym choices', async () => {
    renderWithTheme(
      <GymScopeChoices allSessionCount={3} onChoose={jest.fn()} options={[]} testID="gym" value={undefined} />,
    );
    expect(screen.getByText('All gyms')).toHaveStyle({ color: before.ink });
    await switchTheme(SLATE_DARK);
    expect(screen.getByText('All gyms')).toHaveStyle({ color: after.ink });
  });

  it('repaints the profile cards', async () => {
    renderWithTheme(
      <SignedOutCard disabled={false} email="" inlineError={null} isSubmitting={false} onChangeEmail={jest.fn()}
        onChangePassword={jest.fn()} onSignIn={jest.fn()} password="" />,
    );
    const title = screen.getByRole('header');
    expect(title).toHaveStyle({ color: before.ink });
    await switchTheme(SLATE_DARK);
    expect(screen.getByRole('header')).toHaveStyle({ color: after.ink });
  });

  it('repaints the signed-in profile dividers', async () => {
    renderWithTheme(
      <ProfileSummary editDisabled={false} email="a@b.co" isSigningOut={false} onEdit={jest.fn()} onSignOut={jest.fn()}
        pendingEmail={null} signOutDisabled={false} username="Ada" />,
    );
    // The email row sits under the username row's divider.
    const divided = () => {
      let node = screen.getByText('a@b.co').parent;
      while (node && !StyleSheet.flatten(node.props.style)?.borderTopColor) node = node.parent;
      return node;
    };
    expect(divided()).toHaveStyle({ borderTopColor: before.ruleSoft });
    await switchTheme(SLATE_DARK);
    expect(after.ruleSoft).not.toBe(before.ruleSoft);
    expect(divided()).toHaveStyle({ borderTopColor: after.ruleSoft });
  });

  it('repaints the group mute row', async () => {
    renderWithTheme(<GroupNotificationMuteRow groupId="g" offline />);
    expect(screen.getByTestId('group-notifications')).toHaveStyle({ borderTopColor: before.ruleSoft });
    await switchTheme(SLATE_DARK);
    expect(screen.getByTestId('group-notifications')).toHaveStyle({ borderTopColor: after.ruleSoft });
  });
});
