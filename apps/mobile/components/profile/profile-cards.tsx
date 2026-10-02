import { StyleSheet, Text, View } from 'react-native';

import {
  ActionButton,
  Card,
  FormField,
  Notice,
  Stat,
  uiBorder,
  uiFonts,
  uiRoles,
  uiSpace,
  uiTypography,
} from '@/components/ui';

import type { InlineFeedback } from './use-profile-panel';

export function InlineError({ message }: { message: string | null }) {
  return message ? <Notice live message={message} testID="profile-inline-error" tone="danger" /> : null;
}

// A success is the `success` glyph and the words on the neutral band (G3); a
// failure is the `danger` notice.
export function ProfileFeedback({ feedback }: { feedback: InlineFeedback | null }) {
  if (!feedback) return null;
  return feedback.tone === 'error'
    ? <Notice live message={feedback.message} testID="profile-update-feedback" tone="danger" />
    : <Notice icon="success" live message={feedback.message} testID="profile-update-feedback" />;
}

export function SignedOutCard({ email, password, onChangeEmail, onChangePassword, inlineError, disabled, isSubmitting, onSignIn }: {
  email: string;
  password: string;
  onChangeEmail: (value: string) => void;
  onChangePassword: (value: string) => void;
  inlineError: string | null;
  disabled: boolean;
  isSubmitting: boolean;
  onSignIn: () => void;
}) {
  return (
    <Card style={styles.formCard} testID="profile-signed-out-card">
      <Text allowFontScaling={false} accessibilityRole="header" style={styles.cardTitle}>
        Sign in
      </Text>

      <FormField
        accessibilityLabel="Email"
        autoCapitalize="none"
        autoCorrect={false}
        face="text"
        keyboardType="email-address"
        label="Email"
        onChangeText={onChangeEmail}
        placeholder="you@example.com"
        testID="profile-email-input"
        textContentType="emailAddress"
        value={email}
      />

      <FormField
        accessibilityLabel="Password"
        autoCapitalize="none"
        autoCorrect={false}
        face="text"
        label="Password"
        onChangeText={onChangePassword}
        placeholder="Enter password"
        secureTextEntry
        testID="profile-password-input"
        textContentType="password"
        value={password}
      />

      <InlineError message={inlineError} />

      <ActionButton
        accessibilityLabel="Sign in to profile"
        disabled={disabled}
        label={isSubmitting ? 'Signing in…' : 'Sign in'}
        onPress={onSignIn}
        testID="profile-sign-in-button"
        variant="primary"
      />
    </Card>
  );
}

export function ProfileEditForm({ username, newEmail, newPassword, onChangeUsername, onChangeNewEmail, onChangeNewPassword,
  onCancel, onUpdate, isUpdating, updateDisabled }: {
  username: string;
  newEmail: string;
  newPassword: string;
  onChangeUsername: (value: string) => void;
  onChangeNewEmail: (value: string) => void;
  onChangeNewPassword: (value: string) => void;
  onCancel: () => void;
  onUpdate: () => void;
  isUpdating: boolean;
  updateDisabled: boolean;
}) {
  return (
    <Card style={styles.formCard}>
      <FormField
        accessibilityLabel="Username"
        autoCapitalize="none"
        autoCorrect={false}
        face="text"
        label="Username"
        onChangeText={onChangeUsername}
        placeholder="Add a username"
        testID="profile-username-input"
        value={username}
      />
      <FormField
        accessibilityLabel="New email"
        autoCapitalize="none"
        autoCorrect={false}
        face="text"
        keyboardType="email-address"
        label="New email"
        onChangeText={onChangeNewEmail}
        placeholder="you@example.com"
        testID="profile-email-update-input"
        textContentType="emailAddress"
        value={newEmail}
      />
      <FormField
        accessibilityLabel="New password"
        autoCapitalize="none"
        autoCorrect={false}
        face="text"
        label="New password"
        onChangeText={onChangeNewPassword}
        placeholder="Enter a new password"
        secureTextEntry
        testID="profile-password-update-input"
        textContentType="newPassword"
        value={newPassword}
      />

      {/* Inline edit stays in place (T05-D2): Cancel steps back, Update
          is the screen's one primary. */}
      <View style={styles.actionRow}>
        <ActionButton
          accessibilityLabel="Cancel profile editing"
          disabled={isUpdating}
          label="Cancel"
          onPress={onCancel}
          testID="profile-cancel-edit-button"
          variant="text"
        />
        <View style={styles.actionFill}>
          <ActionButton
            accessibilityLabel="Update profile"
            disabled={updateDisabled}
            label={isUpdating ? 'Updating…' : 'Update'}
            onPress={onUpdate}
            testID="profile-update-button"
            variant="primary"
          />
        </View>
      </View>
    </Card>
  );
}

export function ProfileSummary({ username, email, pendingEmail, editDisabled, signOutDisabled, isSigningOut, onEdit, onSignOut }: {
  username: string;
  email: string;
  pendingEmail: string | null;
  editDisabled: boolean;
  signOutDisabled: boolean;
  isSigningOut: boolean;
  onEdit: () => void;
  onSignOut: () => void;
}) {
  return (
    <>
      <Card>
        <View style={styles.valueRow}>
          <Stat kind="text" label="Username" value={username} />
        </View>
        <View style={[styles.valueRow, styles.valueRowDivider]}>
          <Stat kind="text" label="Email" value={email} />
        </View>
        {pendingEmail ? (
          <View style={[styles.valueRow, styles.valueRowDivider]}>
            <Stat kind="text" label="Pending email" value={pendingEmail} />
          </View>
        ) : null}
      </Card>

      {/* Neither is the primary: Edit opens the form, and Sign out is an
          outline in `danger` with no confirmation (T05-D4). */}
      <View style={styles.actionRow}>
        <View style={styles.actionFill}>
          <ActionButton
            accessibilityLabel="Edit profile"
            disabled={editDisabled}
            label="Edit"
            onPress={onEdit}
            testID="profile-edit-button"
            variant="outline"
          />
        </View>
        <View style={styles.actionFill}>
          <ActionButton
            accessibilityLabel="Sign out of profile"
            disabled={signOutDisabled}
            label={isSigningOut ? 'Signing out…' : 'Sign out'}
            onPress={onSignOut}
            testID="profile-sign-out-button"
            tone="danger"
            variant="outline"
          />
        </View>
      </View>
    </>
  );
}

export const profileStyles = StyleSheet.create({
  profilePanel: {
    gap: uiSpace.md,
  },
});

const styles = StyleSheet.create({
  formCard: {
    padding: uiSpace.lg,
    gap: uiSpace.md,
  },
  cardTitle: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.lg,
    lineHeight: uiTypography.lineHeight.lg,
    color: uiRoles.ink,
  },
  valueRow: {
    paddingHorizontal: uiSpace.lg,
    paddingVertical: uiSpace.md,
  },
  valueRowDivider: {
    borderTopWidth: uiBorder.width,
    borderTopColor: uiRoles.ruleSoft,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
  },
  actionFill: {
    flex: 1,
  },
});
