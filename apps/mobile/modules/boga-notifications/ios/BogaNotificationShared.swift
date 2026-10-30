import CryptoKit
import Foundation
import Security

struct BogaNotificationBinding: Codable {
  let installationId: String
  let userId: String
  let bindingId: String
  let authSessionId: String
  let environment: String
  let encryptionKey: String
}

struct BogaNotificationProjection: Codable {
  struct Route: Codable {
    let groupId: String
    let memberId: String
    let sessionId: String
  }
  let v: Int
  let bindingId: String
  let recipientUserId: String
  let expiresAt: Double
  let notificationId: String
  let kind: String
  let identity: String
  let heading: String
  let bestCount: Int
  let rankCount: Int
  let route: Route

  var dictionary: [String: Any] {
    (try? JSONSerialization.jsonObject(with: JSONEncoder().encode(self))) as? [String: Any] ?? [:]
  }

  var summary: String {
    var rows = [String]()
    if bestCount > 0 { rows.append("\(bestCount) new group best\(bestCount == 1 ? "" : "s")") }
    if rankCount > 0 { rows.append("\(rankCount) leaderboard change\(rankCount == 1 ? "" : "s")") }
    return rows.joined(separator: " · ")
  }
}

enum BogaNotificationError: Error {
  case invalidData
  case keychain(OSStatus)
}

enum BogaNotificationCrypto {
  static let headings = ["Started a workout", "Finished a workout", "Workout achievements", "Group exercise bests", "Leaderboard changes"]

  static func validHeading(_ value: String) -> Bool {
    if headings.contains(value) { return true }
    guard let prefix = ["Started a workout at ", "Finished a workout at "].first(where: { value.hasPrefix($0) }) else { return false }
    let location = value.dropFirst(prefix.count)
    return !location.isEmpty && location.unicodeScalars.count <= 100 &&
      !location.unicodeScalars.contains(where: { $0.value < 32 || (127...159).contains($0.value) })
  }

  /// APNs payloads arrive as NSNumber, but the Expo JS bridge hands every JS
  /// number over as a Swift `Double`, which never casts to `Int`. Accept both.
  static func integer(_ value: Any?) -> Int? {
    if let value = value as? Int { return value }
    if let value = value as? Double { return Int(exactly: value) }
    return nil
  }

  static func decrypt(_ envelope: [String: Any], binding: BogaNotificationBinding,
                      environment: String, now: Double = Date().timeIntervalSince1970 * 1000) -> BogaNotificationProjection? {
    guard Set(envelope.keys) == Set(["v", "bindingId", "nonce", "ciphertext"]),
          integer(envelope["v"]) == 1,
          envelope["bindingId"] as? String == binding.bindingId,
          binding.environment == environment,
          let encodedNonce = envelope["nonce"] as? String,
          let encodedCipher = envelope["ciphertext"] as? String,
          let nonceData = Data(base64Encoded: encodedNonce), nonceData.count == 12,
          let ciphertext = Data(base64Encoded: encodedCipher), ciphertext.count >= 16, ciphertext.count <= 16384,
          let key = Data(base64Encoded: binding.encryptionKey), key.count == 32 else { return nil }
    do {
      let nonce = try AES.GCM.Nonce(data: nonceData)
      let box = try AES.GCM.SealedBox(nonce: nonce, ciphertext: ciphertext.dropLast(16), tag: ciphertext.suffix(16))
      let aad = Data("boga-notification-v1:\(binding.bindingId)".utf8)
      let clear = try AES.GCM.open(box, using: SymmetricKey(data: key), authenticating: aad)
      let allowed: Set<String> = ["v", "bindingId", "recipientUserId", "expiresAt", "notificationId", "kind", "identity", "heading", "bestCount", "rankCount", "route"]
      guard let object = try JSONSerialization.jsonObject(with: clear) as? [String: Any], Set(object.keys) == allowed,
            let route = object["route"] as? [String: Any], Set(route.keys) == Set(["groupId", "memberId", "sessionId"]) else { return nil }
      let result = try JSONDecoder().decode(BogaNotificationProjection.self, from: clear)
      guard result.v == 1, result.bindingId == binding.bindingId,
            result.recipientUserId == binding.userId, result.expiresAt.isFinite, result.expiresAt > now,
            ["start", "completion"].contains(result.kind), validHeading(result.heading),
            result.bestCount >= 0, result.bestCount <= Int32.max,
            result.rankCount >= 0, result.rankCount <= Int32.max,
            !result.identity.isEmpty, result.identity.utf8.count <= 1024,
            !result.notificationId.isEmpty, result.notificationId.count <= 24,
            result.notificationId.allSatisfy({ $0.isASCII && $0.isNumber }),
            UUID(uuidString: result.route.groupId) != nil, UUID(uuidString: result.route.memberId) != nil,
            !result.route.sessionId.isEmpty, result.route.sessionId.utf8.count <= 512,
            !result.route.sessionId.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) }),
            result.kind != "start" || (result.bestCount == 0 && result.rankCount == 0) else { return nil }
      return result
    } catch { return nil }
  }

  static func envelope(from userInfo: [AnyHashable: Any]) -> [String: Any]? {
    // Expo places remote message data under body; local fixtures use data directly.
    if let body = userInfo["body"] as? [String: Any] { return body }
    return userInfo as? [String: Any]
  }
}

enum BogaNotificationStore {
  static var environment: String { Bundle.main.object(forInfoDictionaryKey: "BogaNotificationEnvironment") as? String ?? "unsupported" }
  private static var group: String? { Bundle.main.object(forInfoDictionaryKey: "BogaNotificationKeychainGroup") as? String }
  private static var themeURL: URL? {
    guard let group = Bundle.main.object(forInfoDictionaryKey: "BogaNotificationAppGroup") as? String else { return nil }
    return FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)?.appendingPathComponent("applied-theme.json")
  }

  static func writeTheme(_ theme: [String: String]) throws {
    let keys: Set<String> = ["paper", "surface", "rule", "ink", "inkMuted", "record", "recordWash"]
    guard Set(theme.keys) == keys, theme.values.allSatisfy({ $0.range(of: "^#[0-9a-fA-F]{6}$", options: .regularExpression) != nil }),
          let url = themeURL else { throw BogaNotificationError.invalidData }
    // An atomic file makes the applied palette immediately coherent across app/extension processes.
    try JSONEncoder().encode(theme).write(to: url, options: .atomic)
  }

  static func readTheme() -> [String: String]? {
    guard let url = themeURL, let data = try? Data(contentsOf: url),
          let theme = try? JSONDecoder().decode([String: String].self, from: data) else { return nil }
    let keys: Set<String> = ["paper", "surface", "rule", "ink", "inkMuted", "record", "recordWash"]
    guard Set(theme.keys) == keys, theme.values.allSatisfy({ $0.range(of: "^#[0-9a-fA-F]{6}$", options: .regularExpression) != nil }) else { return nil }
    return theme
  }

  private static func query(_ account: String) throws -> [String: Any] {
    guard let group, !group.contains("$(") else { throw BogaNotificationError.invalidData }
    return [kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: "boga.notifications.v1",
            kSecAttrAccount as String: account, kSecAttrAccessGroup as String: group]
  }

  static func read(_ account: String) throws -> Data? {
    var attributes = try query(account)
    attributes[kSecReturnData as String] = true
    attributes[kSecMatchLimit as String] = kSecMatchLimitOne
    var value: CFTypeRef?
    let status = SecItemCopyMatching(attributes as CFDictionary, &value)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess else { throw BogaNotificationError.keychain(status) }
    return value as? Data
  }

  static func write(_ account: String, _ data: Data) throws {
    let attributes = try query(account)
    let status = SecItemUpdate(attributes as CFDictionary, [kSecValueData as String: data] as CFDictionary)
    if status == errSecItemNotFound {
      var added = attributes
      added[kSecValueData as String] = data
      added[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
      let created = SecItemAdd(added as CFDictionary, nil)
      guard created == errSecSuccess else { throw BogaNotificationError.keychain(created) }
    } else if status != errSecSuccess { throw BogaNotificationError.keychain(status) }
  }

  static func clearBinding() throws {
    let status = SecItemDelete(try query("binding") as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else { throw BogaNotificationError.keychain(status) }
  }

  static func binding() throws -> BogaNotificationBinding? {
    guard let data = try read("binding") else { return nil }
    return try JSONDecoder().decode(BogaNotificationBinding.self, from: data)
  }

  static func decrypt(_ envelope: [String: Any]) -> BogaNotificationProjection? {
    guard let current = try? binding() else { return nil }
    guard let projection = BogaNotificationCrypto.decrypt(envelope, binding: current, environment: environment),
          let latest = try? binding(), latest.bindingId == current.bindingId, latest.userId == current.userId,
          latest.authSessionId == current.authSessionId else { return nil }
    return projection
  }

  static func randomKey() throws -> String {
    var bytes = [UInt8](repeating: 0, count: 32)
    guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else { throw BogaNotificationError.invalidData }
    return Data(bytes).base64EncodedString()
  }
}
