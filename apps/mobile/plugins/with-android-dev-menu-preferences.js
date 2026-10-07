const { withAndroidManifest } = require('expo/config-plugins');

// Keeps expo-dev-menu's launch UI off the RN root on Android. Without these
// manifest defaults, expo-dev-menu opens its bottom sheet at launch
// (`EXDevMenuShowsAtLaunch` defaults true on Android, unlike iOS) and replaces
// the accessibility tree, so a Maestro flow's first assertion sees no app views.
// iOS seeds the same preferences at runtime (maestro_seed_dev_menu_preferences);
// Android has no equivalent runtime hook, so they are baked into the manifest.
//
// Android-only: this never touches the iOS project, so it does not invalidate
// the shared iOS .app cache. Contract:
// docs/specs/11-maestro-runtime-and-testing-conventions.md.
const DEV_MENU_META_DATA = {
  EXDevMenuShowsAtLaunch: 'false',
  EXDevMenuIsOnboardingFinished: 'true',
  EXDevMenuShowFloatingActionButton: 'false',
};

module.exports = function withAndroidDevMenuPreferences(config) {
  return withAndroidManifest(config, (config) => {
    const application = config.modResults.manifest.application?.[0];
    if (!application) {
      return config;
    }

    if (!Array.isArray(application['meta-data'])) {
      application['meta-data'] = [];
    }

    for (const [name, value] of Object.entries(DEV_MENU_META_DATA)) {
      const existing = application['meta-data'].find(
        (entry) => entry.$ && entry.$['android:name'] === name
      );
      if (existing) {
        existing.$['android:value'] = value;
      } else {
        application['meta-data'].push({ $: { 'android:name': name, 'android:value': value } });
      }
    }

    return config;
  });
};
