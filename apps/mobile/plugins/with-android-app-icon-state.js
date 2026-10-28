const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { withDangerousMod } = require('expo/config-plugins');

// Pinned upstream fix: a running Activity retains its old launcher alias after DONT_KILL_APP.
const ORIGINAL_SHA256 = '34feed5f2c21c3e28de69886014153aaf8843efd0310e554d4392208ffeb3a90';
const PATCHED_SHA256 = 'df63ed53dad58ce0e5f8f0ddf3c31fad8fd52251c7a78c6d19374a46f2c18e6c';
const ORIGINAL_BOUNDARY = `  private fun getAppIconName(): String? {
    val currentActivityComponent = appContext.activityProvider?.currentActivity?.componentName ?: return null

    return try {
      retrieveIconNameFromComponent(currentActivityComponent)
    } catch (error: PackageManager.NameNotFoundException) {
      null
    }
  }

  private suspend fun setAlternateAppIcon(icon: String?): String? = withContext(Dispatchers.Main) {
    val currentActivityComponent = appContext.activityProvider!!.currentActivity!!.componentName

    val currentIconName = retrieveIconNameFromComponent(currentActivityComponent)

    if (currentIconName == icon) return@withContext icon

    val newActivityComponent = replaceMainActivitySimpleName(currentActivityComponent, icon)

    appContext.reactContext?.packageManager?.run {
      setComponentEnabledSetting(newActivityComponent, PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP)
      setComponentEnabledSetting(currentActivityComponent, PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP)
    }

    return@withContext icon
  }

`;
const PATCHED_BOUNDARY = `  private fun enabledLauncherComponents(component: ComponentName, manager: PackageManager): List<ComponentName> {
    val mainActivity = replaceMainActivitySimpleName(component, null).className
    val activities = manager.getPackageInfo(component.packageName,
      PackageManager.GET_ACTIVITIES or PackageManager.MATCH_DISABLED_COMPONENTS).activities.orEmpty()
    return activities.mapNotNull { activity ->
      val candidate = ComponentName(component.packageName, activity.name)
      if ((activity.name != mainActivity && activity.targetActivity != mainActivity) ||
        !getSimpleName(candidate).startsWith(MAIN_ACTIVITY_NAME)) return@mapNotNull null
      val enabled = when (manager.getComponentEnabledSetting(candidate)) {
        PackageManager.COMPONENT_ENABLED_STATE_DEFAULT -> activity.enabled
        PackageManager.COMPONENT_ENABLED_STATE_ENABLED -> true
        else -> false
      }
      if (enabled) candidate else null
    }
  }

  private fun getAppIconName(): String? {
    val component = appContext.activityProvider?.currentActivity?.componentName ?: return null
    val manager = appContext.reactContext?.packageManager ?: return null
    return try {
      enabledLauncherComponents(component, manager).firstOrNull()?.let(::retrieveIconNameFromComponent)
    } catch (error: PackageManager.NameNotFoundException) {
      null
    }
  }

  private suspend fun setAlternateAppIcon(icon: String?): String? = withContext(Dispatchers.Main) {
    // DONT_KILL_APP leaves currentActivity.componentName pointing at the launch-time alias.
    val component = appContext.activityProvider!!.currentActivity!!.componentName
    val target = replaceMainActivitySimpleName(component, icon)
    appContext.reactContext?.packageManager?.run {
      val enabled = enabledLauncherComponents(component, this)
      if (enabled.size == 1 && enabled[0] == target) return@withContext icon
      setComponentEnabledSetting(target, PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP)
      for (previous in enabled) {
        if (previous != target) {
          setComponentEnabledSetting(previous, PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP)
        }
      }
    }
    return@withContext icon
  }

`;
const hash = source => createHash('sha256').update(source).digest('hex');

function patchAndroidIconSource(source) {
  const digest = hash(source);
  if (digest === PATCHED_SHA256) return source;
  if (digest !== ORIGINAL_SHA256 || !source.includes(ORIGINAL_BOUNDARY)) {
    throw new Error('Unsupported expo-alternate-app-icons Android source; review the pinned 8.0.0 launcher-alias patch.');
  }
  const patched = source.replace(ORIGINAL_BOUNDARY, PATCHED_BOUNDARY);
  if (hash(patched) !== PATCHED_SHA256) throw new Error('Could not apply the Android launcher-alias patch.');
  return patched;
}

module.exports = function withAndroidAppIconState(config) {
  return withDangerousMod(config, ['android', config => {
    const manifest = require.resolve('expo-alternate-app-icons/package.json', { paths: [config.modRequest.projectRoot] });
    if (JSON.parse(fs.readFileSync(manifest, 'utf8')).version !== '8.0.0') {
      throw new Error('Review the Android launcher-alias patch before upgrading expo-alternate-app-icons from 8.0.0.');
    }
    const file = path.join(path.dirname(manifest), 'android/src/main/java/expo/modules/alternateappicons/ExpoAlternateAppIconsModule.kt');
    const source = fs.readFileSync(file, 'utf8');
    const patched = patchAndroidIconSource(source);
    if (patched !== source) fs.writeFileSync(file, patched);
    return config;
  }]);
};
module.exports.patchAndroidIconSource = patchAndroidIconSource;
