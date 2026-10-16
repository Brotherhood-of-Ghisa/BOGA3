const fs = require('node:fs');
const path = require('node:path');
const { IOSConfig, withDangerousMod, withEntitlementsPlist, withInfoPlist, withXcodeProject } = require('expo/config-plugins');
const { build: buildPlist } = require('@expo/plist').default;

const TARGETS = [
  { name: 'BogaNotificationService', suffix: 'notification-service', point: 'com.apple.usernotifications.service' },
  { name: 'BogaNotificationContent', suffix: 'notification-content', point: 'com.apple.usernotifications.content-extension' },
];

function notificationConfig(bundleId) {
  const environment = bundleId === 'com.phano.boga3' ? 'production'
    : bundleId === 'com.phano.boga3.dev' ? 'preview' : 'unsupported';
  return { environment, appGroup: `group.${bundleId}.notifications`, keychainGroup: `$(AppIdentifierPrefix)${bundleId}.notifications` };
}

function sharedInfo(configuration) {
  return { BogaNotificationEnvironment: configuration.environment,
    BogaNotificationAppGroup: configuration.appGroup, BogaNotificationKeychainGroup: configuration.keychainGroup };
}

function extensionEntitlements(configuration) {
  return { 'com.apple.security.application-groups': [configuration.appGroup],
    'keychain-access-groups': [configuration.keychainGroup] };
}

function extensionInfo(target, configuration, config, fonts) {
  const extension = { NSExtensionPointIdentifier: target.point,
    NSExtensionPrincipalClass: `$(PRODUCT_MODULE_NAME).${target.name}` };
  if (target.name === 'BogaNotificationContent') {
    extension.NSExtensionAttributes = { UNNotificationExtensionCategory: 'boga-workout',
      UNNotificationExtensionInitialContentSizeRatio: 0.5, UNNotificationExtensionDefaultContentHidden: true };
  }
  return { CFBundleDevelopmentRegion: 'en', CFBundleDisplayName: 'BoGa', CFBundleExecutable: '$(EXECUTABLE_NAME)',
    CFBundleIdentifier: '$(PRODUCT_BUNDLE_IDENTIFIER)', CFBundleInfoDictionaryVersion: '6.0',
    CFBundleName: '$(PRODUCT_NAME)', CFBundlePackageType: 'XPC!', CFBundleShortVersionString: config.version ?? '1.0',
    CFBundleVersion: config.ios?.buildNumber ?? '1', NSExtension: extension, ...sharedInfo(configuration),
    ...(target.name === 'BogaNotificationContent' ? { UIAppFonts: fonts.map(file => path.basename(file)), UIUserInterfaceStyle: 'Light' } : {}) };
}

function configureTargets(project, config, fonts) {
  for (const target of TARGETS) {
    const existing = Object.entries(project.pbxNativeTargetSection()).find(([key, value]) =>
      !key.endsWith('_comment') && String(value.name).replaceAll('"', '') === target.name);
    const added = existing ? { uuid: existing[0], pbxNativeTarget: existing[1] } : project.addTarget(target.name, 'app_extension', target.name, `${config.ios.bundleIdentifier}.${target.suffix}`);
    if (!existing) {
      IOSConfig.XcodeUtils.ensureGroupRecursively(project, target.name);
      project.addBuildPhase([], 'PBXSourcesBuildPhase', 'Sources', added.uuid);
      project.addBuildPhase([], 'PBXResourcesBuildPhase', 'Resources', added.uuid);
      for (const source of ['BogaNotificationShared.swift', `${target.name}.swift`]) {
        IOSConfig.XcodeUtils.addBuildSourceFileToGroup({ project, groupName: target.name,
          filepath: `${target.name}/${source}`, targetUuid: added.uuid });
      }
      if (target.name === 'BogaNotificationContent') {
        for (const font of fonts) {
          IOSConfig.XcodeUtils.addResourceFileToGroup({ project, groupName: target.name,
            filepath: `${target.name}/${path.basename(font)}`, targetUuid: added.uuid, isBuildFile: true });
        }
      }
    }
    const configurations = IOSConfig.XcodeUtils.getBuildConfigurationsForListId(project, added.pbxNativeTarget.buildConfigurationList);
    for (const [, configuration] of configurations) {
      Object.assign(configuration.buildSettings, { CODE_SIGN_ENTITLEMENTS: `"${target.name}/${target.name}.entitlements"`,
        INFOPLIST_FILE: `"${target.name}/${target.name}-Info.plist"`, SWIFT_VERSION: '5.9',
        IPHONEOS_DEPLOYMENT_TARGET: '16.0', TARGETED_DEVICE_FAMILY: '"1,2"',
        APPLICATION_EXTENSION_API_ONLY: 'YES', CODE_SIGN_STYLE: 'Automatic',
        PRODUCT_BUNDLE_IDENTIFIER: `"${config.ios.bundleIdentifier}.${target.suffix}"`,
        CURRENT_PROJECT_VERSION: config.ios.buildNumber ?? '1', MARKETING_VERSION: config.version ?? '1.0',
        GENERATE_INFOPLIST_FILE: 'NO' });
    }
  }
  return project;
}

function withBogaNotifications(config, { fonts = [] } = {}) {
  const bundleId = config.ios?.bundleIdentifier;
  if (!bundleId) throw new Error('BOGA notifications require an explicit iOS bundle identifier.');
  const configuration = notificationConfig(bundleId);
  config.extra = { ...config.extra, notificationEnvironment: configuration.environment };
  const eas = config.extra.eas ?? {};
  const build = eas.build ?? {};
  const experimental = build.experimental ?? {};
  const ios = experimental.ios ?? {};
  const ours = new Set(TARGETS.map(target => target.name));
  config.extra.eas = { ...eas, build: { ...build, experimental: { ...experimental, ios: { ...ios,
    appExtensions: [...(ios.appExtensions ?? []).filter(target => !ours.has(target.targetName)), ...TARGETS.map(target => ({
      targetName: target.name, bundleIdentifier: `${bundleId}.${target.suffix}`, entitlements: extensionEntitlements(configuration),
    }))],
  } } } };
  config = withInfoPlist(config, mod => {
    Object.assign(mod.modResults, sharedInfo(configuration));
    return mod;
  });
  config = withEntitlementsPlist(config, mod => {
    const entitlements = mod.modResults;
    entitlements['com.apple.security.application-groups'] = [...new Set([...(entitlements['com.apple.security.application-groups'] ?? []), configuration.appGroup])];
    // Keep the existing app's default group first so adding push never moves Auth's SecureStore entries.
    entitlements['keychain-access-groups'] = [...new Set([`$(AppIdentifierPrefix)${bundleId}`,
      ...(entitlements['keychain-access-groups'] ?? []), configuration.keychainGroup])];
    return mod;
  });
  config = withDangerousMod(config, ['ios', mod => {
    const sources = path.join(mod.modRequest.projectRoot, 'modules/boga-notifications/ios');
    for (const target of TARGETS) {
      const output = path.join(mod.modRequest.platformProjectRoot, target.name);
      fs.mkdirSync(output, { recursive: true });
      fs.copyFileSync(path.join(sources, 'BogaNotificationShared.swift'), path.join(output, 'BogaNotificationShared.swift'));
      fs.copyFileSync(path.join(sources, 'extensions', `${target.name}.swift`), path.join(output, `${target.name}.swift`));
      fs.writeFileSync(path.join(output, `${target.name}-Info.plist`), buildPlist(extensionInfo(target, configuration, config, fonts)));
      fs.writeFileSync(path.join(output, `${target.name}.entitlements`), buildPlist(extensionEntitlements(configuration)));
      if (target.name === 'BogaNotificationContent') {
        for (const font of fonts) fs.copyFileSync(path.resolve(mod.modRequest.projectRoot, font), path.join(output, path.basename(font)));
      }
    }
    return mod;
  }]);
  return withXcodeProject(config, mod => { configureTargets(mod.modResults, config, fonts); return mod; });
}

module.exports = withBogaNotifications;
module.exports.notificationConfig = notificationConfig;
module.exports.extensionInfo = extensionInfo;
module.exports.configureTargets = configureTargets;
