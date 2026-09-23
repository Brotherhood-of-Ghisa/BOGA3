import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ExercisePageScreen } from '@/components/exercise-page/exercise-page-screen';
import { ExerciseTopBar } from '@/components/exercise-page/exercise-top-bar';
import { pageText } from '@/components/exercise-page/text-styles';
import { uiGeometry, uiRoles, uiSpace } from '@/components/ui/tokens';
import { useNewScreensEnabled } from '@/src/session-recorder/new-screens-preference';

const firstParam = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? '';

/**
 * The exercise page, behind the `New exercise & session screens` setting while
 * it is built beside the recorder (docs/plans/exercise-session-redesign.md).
 */
export default function ExercisePageRoute() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    sessionId?: string | string[];
    sessionExerciseId?: string | string[];
  }>();
  const [enabled] = useNewScreensEnabled();
  const sessionId = firstParam(params.sessionId);
  const sessionExerciseId = firstParam(params.sessionExerciseId);

  if (enabled) {
    return (
      <ExercisePageScreen
        key={`${sessionId}:${sessionExerciseId}`}
        sessionExerciseId={sessionExerciseId}
        sessionId={sessionId}
      />
    );
  }

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/train' as Href));

  return (
    <SafeAreaView edges={['top']} style={styles.screen} testID="exercise-page-disabled">
      <ExerciseTopBar onBack={goBack} title="" />
      <View style={styles.body}>
        <Text style={pageText.body}>
          The new exercise page is off. Turn on New exercise & session screens in Settings to use it.
        </Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push('/settings' as Href)}
          style={styles.link}
          testID="exercise-page-open-settings">
          <Text style={[pageText.controlLabel, styles.linkLabel]}>Open Settings</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: uiRoles.paper,
  },
  body: {
    gap: uiSpace.md,
    padding: uiSpace.lg,
  },
  link: {
    minHeight: uiGeometry.tapTarget,
    justifyContent: 'center',
  },
  linkLabel: {
    color: uiRoles.accent,
  },
});
