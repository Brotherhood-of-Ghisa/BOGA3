import {
  formatVersionBuild,
  resolveAppRuntimeMetadata,
} from '@/src/utils/runtime-metadata';

describe('app runtime metadata', () => {
  it('prefers installed native version and build metadata', () => {
    const metadata = resolveAppRuntimeMetadata({
      appFlavor: 'production',
      expoConfig: {
        extra: { releaseCodename: ' Jemiliano ' },
        version: '1.0.0-config',
      },
      nativeApplicationVersion: ' 1.2.3 ',
      nativeBuildVersion: ' 45 ',
    });

    expect(metadata).toEqual({
      buildNumber: '45',
      displayFlavor: null,
      releaseCodename: 'Jemiliano',
      version: '1.2.3',
    });
    expect(formatVersionBuild(metadata)).toBe('Version 1.2.3 (build 45)');
  });

  it('falls back to Expo config when the native version is unavailable', () => {
    const metadata = resolveAppRuntimeMetadata({
      appFlavor: 'local',
      expoConfig: { version: '1.1.0' },
      nativeApplicationVersion: null,
      nativeBuildVersion: null,
    });

    expect(metadata.version).toBe('1.1.0');
    expect(metadata.displayFlavor).toBe('local');
    expect(formatVersionBuild(metadata)).toBe('Version 1.1.0');
  });

  it('omits blank build numbers and release codenames cleanly', () => {
    const metadata = resolveAppRuntimeMetadata({
      appFlavor: 'preview',
      expoConfig: { extra: { releaseCodename: '   ' }, version: '1.1.0' },
      nativeApplicationVersion: undefined,
      nativeBuildVersion: ' ',
    });

    expect(metadata.buildNumber).toBeNull();
    expect(metadata.releaseCodename).toBeNull();
    expect(formatVersionBuild(metadata)).toBe('Version 1.1.0');
  });

  it('shows preview flavor but suppresses production flavor', () => {
    const base = {
      expoConfig: null,
      nativeApplicationVersion: null,
      nativeBuildVersion: null,
    };

    expect(resolveAppRuntimeMetadata({ ...base, appFlavor: 'preview' }).displayFlavor).toBe(
      'preview',
    );
    expect(resolveAppRuntimeMetadata({ ...base, appFlavor: 'production' }).displayFlavor).toBeNull();
  });

  it('does not present Expo config as the installed version in production', () => {
    const metadata = resolveAppRuntimeMetadata({
      appFlavor: 'production',
      expoConfig: { version: '1.1.0-config' },
      nativeApplicationVersion: null,
      nativeBuildVersion: null,
    });

    expect(metadata.version).toBeNull();
    expect(formatVersionBuild(metadata)).toBeNull();
  });

  it('can identify a build when only the native build number is available', () => {
    const metadata = resolveAppRuntimeMetadata({
      appFlavor: 'local',
      expoConfig: null,
      nativeApplicationVersion: null,
      nativeBuildVersion: '99',
    });

    expect(formatVersionBuild(metadata)).toBe('Build 99');
  });
});
