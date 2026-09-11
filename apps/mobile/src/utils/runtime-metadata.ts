import * as Application from 'expo-application';
import Constants from 'expo-constants';

import { getAppFlavor, type AppFlavor } from '@/src/utils/app-flavor';

type ExpoConfigMetadata = {
  extra?: Record<string, unknown>;
  version?: string | null;
} | null | undefined;

export type AppRuntimeMetadata = {
  buildNumber: string | null;
  displayFlavor: Exclude<AppFlavor, 'production'> | null;
  releaseCodename: string | null;
  version: string | null;
};

type RuntimeMetadataInput = {
  appFlavor: AppFlavor;
  expoConfig: ExpoConfigMetadata;
  nativeApplicationVersion: unknown;
  nativeBuildVersion: unknown;
};

const trimmedOptionalString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
};

// Logging historically preserved surrounding whitespace in nonblank native /
// Expo strings. Keep that exact behavior even though the user-facing About
// metadata below is deliberately trimmed.
const loggingOptionalString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value : null;

export const resolveAppRuntimeMetadata = ({
  appFlavor,
  expoConfig,
  nativeApplicationVersion,
  nativeBuildVersion,
}: RuntimeMetadataInput): AppRuntimeMetadata => ({
  version:
    trimmedOptionalString(nativeApplicationVersion) ??
    (appFlavor === 'production' ? null : trimmedOptionalString(expoConfig?.version)),
  buildNumber: trimmedOptionalString(nativeBuildVersion),
  releaseCodename: trimmedOptionalString(expoConfig?.extra?.releaseCodename),
  displayFlavor: appFlavor === 'production' ? null : appFlavor,
});

export const readAppRuntimeMetadata = (): AppRuntimeMetadata =>
  resolveAppRuntimeMetadata({
    appFlavor: getAppFlavor(),
    expoConfig: Constants.expoConfig as ExpoConfigMetadata,
    nativeApplicationVersion: Application.nativeApplicationVersion,
    nativeBuildVersion: Application.nativeBuildVersion,
  });

export const formatVersionBuild = ({
  buildNumber,
  version,
}: Pick<AppRuntimeMetadata, 'buildNumber' | 'version'>): string | null => {
  if (version && buildNumber) return `Version ${version} (build ${buildNumber})`;
  if (version) return `Version ${version}`;
  if (buildNumber) return `Build ${buildNumber}`;
  return null;
};

/** Runtime values consumed by logging, preserving the pre-extraction payload. */
export const readLoggingRuntimeMetadata = () => {
  const expoConfig = Constants.expoConfig as ExpoConfigMetadata;
  return {
    clientAppVersion:
      loggingOptionalString(Application.nativeApplicationVersion) ??
      loggingOptionalString(expoConfig?.version),
    clientBuildNumber: loggingOptionalString(Application.nativeBuildVersion),
    clientVariant: loggingOptionalString(expoConfig?.extra?.env),
  };
};
