Pod::Spec.new do |s|
  s.name = 'BogaNotifications'
  s.version = '1.0.0'
  s.summary = 'BOGA notification binding and authenticated decryption'
  s.description = s.summary
  s.license = { :type => 'MIT' }
  s.author = 'Brotherhood of Ghisa'
  s.homepage = 'https://github.com/Brotherhood-of-Ghisa/BOGA3'
  s.platforms = { :ios => '16.0' }
  s.source = { :git => '' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.swift_version = '5.9'
  s.source_files = 'BogaNotificationsModule.swift', 'BogaNotificationShared.swift'
end
