import {
  buildThemeShadePalette,
  projectMuscleBody as projectBody,
  type ProjectMuscleBodyOptions,
  type ThemeShadePalette,
} from '@/components/stats/muscle-body-projection';
import { launchTheme } from '@/components/ui/theme-launch';
import { readPhoneScheme } from '@/components/ui/theme-native';
import { appearanceMode, appearanceRoles } from '@/components/ui/theme-presets';

/** The mode and roles a test launch draws in: what a screen outside a saved choice reads. */
export const testMode = appearanceMode(launchTheme.appearance, readPhoneScheme());
export const testRoles = appearanceRoles(launchTheme.appearance, testMode);

/** The body's shades in the test launch's theme. */
export const testPalette: ThemeShadePalette = buildThemeShadePalette(testRoles, testMode);

/** `projectMuscleBody` drawn in the test launch's palette unless a test names its own. */
export const projectMuscleBody = (options: Omit<ProjectMuscleBodyOptions, 'palette'> & { palette?: ThemeShadePalette }) =>
  projectBody({ palette: testPalette, ...options });
