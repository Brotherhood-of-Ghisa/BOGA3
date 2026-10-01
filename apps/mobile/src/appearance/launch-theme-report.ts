import type { ThemeLaunchProblem } from '@/components/ui/theme-presets';
import { logEvent } from '@/src/logging';

// Logs why this launch is drawn in the default theme rather than the stored
// choice (`components/ui/theme-launch.ts`). The app still opens; the log is how
// a fallback stays visible instead of silent. Warn and error both reach
// `app_logs` once signed in.
export function reportLaunchThemeProblem(problem: ThemeLaunchProblem | null): void {
  if (!problem) return;
  if (problem.kind === 'unknown-preset') {
    void logEvent({
      level: 'warn',
      event: 'theme.unknown_preset',
      message: 'The stored theme preset is not one this build ships; using the default.',
      context: { storedId: problem.storedId },
    });
    return;
  }
  void logEvent({
    level: 'error',
    event: 'theme.read_failed',
    message: 'Could not read the stored theme preset; using the default.',
    context: { error: problem.message },
  });
}
