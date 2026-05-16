import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { UiButton, UiSurface, UiText, uiBorder, uiColors, uiRadius, uiSpace } from '@/components/ui';
import { resetLocalDataAndReseed } from '@/src/data';
import { isDevMode } from '@/src/utils/isDevMode';

export default function SettingsScreen() {
  const router = useRouter();

  const [isResetting, setIsResetting] = useState(false);
  const [resetFeedback, setResetFeedback] = useState<{ tone: 'success' | 'error'; message: string } | null>(
    null
  );

  const handleDevReset = async () => {
    setIsResetting(true);
    setResetFeedback(null);
    try {
      await resetLocalDataAndReseed();
      setResetFeedback({
        tone: 'success',
        message: 'Local data wiped and the exercise catalog re-seeded.',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error during dev reset.';
      setResetFeedback({ tone: 'error', message });
    } finally {
      setIsResetting(false);
    }
  };

  const confirmDevReset = () => {
    Alert.alert(
      'Reset local data?',
      'Wipes every local table and re-seeds the exercise catalog. Server data is untouched. Dev builds only.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: () => {
            void handleDevReset();
          },
        },
      ]
    );
  };

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      contentInsetAdjustmentBehavior="automatic"
      keyboardShouldPersistTaps="handled"
      style={styles.screen}
      testID="settings-screen">
      <Pressable
        accessibilityHint="Opens your profile account screen"
        accessibilityLabel="Open Account Profile"
        onPress={() => router.push('/profile')}
        style={({ pressed }) => [styles.cardPressable, pressed ? styles.cardPressed : null]}
        testID="settings-profile-row">
        <UiSurface style={styles.profileCard}>
          <View style={styles.profileRow}>
            <View style={styles.iconBadge}>
              <UiText selectable={false} style={styles.iconGlyph} variant="labelStrong">
                👤
              </UiText>
            </View>
            <View style={styles.profileCopy}>
              <UiText selectable variant="labelStrong">
                Profile
              </UiText>
              <UiText selectable variant="bodyMuted">
                Sign in, review your account email, and sign out.
              </UiText>
            </View>
          </View>
        </UiSurface>
      </Pressable>

      {isDevMode() ? (
        <UiSurface style={styles.devCard} testID="settings-dev-tools-card">
          <UiText selectable variant="labelStrong">
            Developer tools
          </UiText>
          <UiText selectable variant="bodyMuted">
            Wipe every local table and re-run the exercise catalog seeder. Available only in
            development builds — does nothing in release.
          </UiText>
          <UiButton
            accessibilityLabel="Reset local data and re-seed exercise catalog"
            disabled={isResetting}
            label={isResetting ? 'Resetting…' : 'Reset local data and re-seed'}
            onPress={confirmDevReset}
            testID="settings-dev-reset-button"
            variant="secondary"
          />
          {resetFeedback ? (
            <UiText
              selectable
              style={resetFeedback.tone === 'success' ? styles.devSuccessText : styles.devErrorText}
              testID="settings-dev-reset-feedback"
              variant="bodyMuted">
              {resetFeedback.message}
            </UiText>
          ) : null}
        </UiSurface>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: uiColors.surfacePage,
  },
  content: {
    padding: uiSpace.screen,
    gap: uiSpace.xxl,
  },
  cardPressable: {
    width: '100%',
  },
  cardPressed: {
    opacity: 0.94,
  },
  profileCard: {
    padding: uiSpace.xxl,
    gap: uiSpace.lg,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: uiSpace.lg,
  },
  iconBadge: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: uiBorder.width,
    borderColor: uiColors.actionPrimarySubtleBorder,
    borderRadius: uiRadius.full,
    backgroundColor: uiColors.surfaceInfo,
  },
  iconGlyph: {
    fontSize: 20,
    lineHeight: 20,
  },
  profileCopy: {
    flex: 1,
    gap: uiSpace.sm,
  },
  devCard: {
    padding: uiSpace.xxl,
    gap: uiSpace.md,
    borderColor: uiColors.borderWarning,
    backgroundColor: uiColors.surfaceWarning,
  },
  devSuccessText: {
    color: uiColors.textAccentMuted,
  },
  devErrorText: {
    color: uiColors.actionDangerText,
  },
});
