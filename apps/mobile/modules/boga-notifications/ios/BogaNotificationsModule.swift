import ExpoModulesCore
import Foundation
import UserNotifications

public class BogaNotificationsModule: Module {
  public func definition() -> ModuleDefinition {
    Name("BogaNotifications")

    Function("getRegistrationMaterial") { (userId: String, environment: String) -> [String: String] in
      guard UUID(uuidString: userId) != nil, environment == BogaNotificationStore.environment,
            ["preview", "production"].contains(environment) else { throw BogaNotificationError.invalidData }
      var installation: [String: String]
      if let stored = try BogaNotificationStore.read("installation"),
         let decoded = try JSONSerialization.jsonObject(with: stored) as? [String: String] {
        installation = decoded
      } else {
        installation = ["installationId": UUID().uuidString.lowercased(), "capability": try BogaNotificationStore.randomKey()]
        try BogaNotificationStore.write("installation", JSONSerialization.data(withJSONObject: installation))
      }
      let binding = try BogaNotificationStore.binding()
      installation["encryptionKey"] = binding?.userId == userId && binding?.environment == environment
        ? binding?.encryptionKey : try BogaNotificationStore.randomKey()
      return installation
    }

    Function("readBinding") { () -> [String: String]? in
      guard BogaNotificationStore.environment != "unsupported" else { return nil }
      guard let binding = try BogaNotificationStore.binding() else { return nil }
      return ["installationId": binding.installationId, "userId": binding.userId,
              "bindingId": binding.bindingId, "authSessionId": binding.authSessionId, "environment": binding.environment]
    }

    Function("activateBinding") { (value: [String: String]) in
      guard let installationId = value["installationId"], UUID(uuidString: installationId) != nil,
            let userId = value["userId"], UUID(uuidString: userId) != nil,
            let bindingId = value["bindingId"], UUID(uuidString: bindingId) != nil,
            let sessionId = value["authSessionId"], UUID(uuidString: sessionId) != nil,
            let environment = value["environment"], environment == BogaNotificationStore.environment,
            let encryptionKey = value["encryptionKey"], Data(base64Encoded: encryptionKey)?.count == 32 else {
        throw BogaNotificationError.invalidData
      }
      let binding = BogaNotificationBinding(installationId: installationId, userId: userId, bindingId: bindingId,
        authSessionId: sessionId, environment: environment, encryptionKey: encryptionKey)
      try BogaNotificationStore.write("binding", JSONEncoder().encode(binding))
    }

    Function("invalidateBinding") {
      if BogaNotificationStore.environment != "unsupported" { try BogaNotificationStore.clearBinding() }
      // OS alert recall is asynchronous; the key is already invalid before auth changes.
      UNUserNotificationCenter.current().removeAllDeliveredNotifications()
      UNUserNotificationCenter.current().removeAllPendingNotificationRequests()
    }

    Function("decrypt") { (envelope: [String: Any]) -> [String: Any]? in
      BogaNotificationStore.decrypt(envelope)?.dictionary
    }

    Function("setAppliedTheme") { (theme: [String: String]) in
      try BogaNotificationStore.writeTheme(theme)
    }
  }
}
