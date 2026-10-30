import CryptoKit
import Foundation

let user = "11111111-1111-4111-8111-111111111111"
let bindingID = "22222222-2222-4222-8222-222222222222"
let key = Data(repeating: 55, count: 32)
let binding = BogaNotificationBinding(installationId: "33333333-3333-4333-8333-333333333333", userId: user,
  bindingId: bindingID, authSessionId: "44444444-4444-4444-8444-444444444444", environment: "preview", encryptionKey: key.base64EncodedString())
var checked = 0
func verify(_ condition: Bool, _ message: String) {
  checked += 1
  guard condition else { fatalError(message) }
}
let fixtureData = try Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
let fixture = try JSONSerialization.jsonObject(with: fixtureData) as! [String: Any]
let envelope = fixture["envelope"] as! [String: Any]
let clear = fixture["projection"] as! [String: Any]
func decrypt(_ value: [String: Any], current: BogaNotificationBinding = binding, environment: String = "preview", now: Double = 1000) -> BogaNotificationProjection? {
  BogaNotificationCrypto.decrypt(value, binding: current, environment: environment, now: now)
}
func encrypt(_ value: [String: Any]) throws -> [String: Any] {
  let nonce = try AES.GCM.Nonce(data: Data(repeating: 18, count: 12))
  let sealed = try AES.GCM.seal(JSONSerialization.data(withJSONObject: value), using: SymmetricKey(data: key), nonce: nonce,
    authenticating: Data("boga-notification-v1:\(bindingID)".utf8))
  return ["v": 1, "bindingId": bindingID, "nonce": Data(repeating: 18, count: 12).base64EncodedString(),
    "ciphertext": (sealed.ciphertext + sealed.tag).base64EncodedString()]
}
verify(decrypt(envelope)?.identity == clear["identity"] as? String, "WebCrypto envelope must decrypt")
verify(decrypt(envelope)?.summary == "2 new group bests · 3 leaderboard changes", "Count preview")
verify(decrypt(envelope, environment: "production") == nil, "Wrong environment")
verify(decrypt(envelope, now: 2000) == nil, "Original expiration")
// A tap's envelope reaches decrypt through the Expo JS bridge, which turns every JS number into a Swift Double.
var bridged = envelope
bridged["v"] = Double(1) as Any
verify(decrypt(bridged)?.identity == clear["identity"] as? String, "JS-bridged envelope version must decrypt")
bridged["v"] = Double(1.5) as Any
verify(decrypt(bridged) == nil, "Fractional envelope version")
let other = BogaNotificationBinding(installationId: binding.installationId, userId: "55555555-5555-4555-8555-555555555555",
  bindingId: bindingID, authSessionId: binding.authSessionId, environment: "preview", encryptionKey: binding.encryptionKey)
verify(decrypt(envelope, current: other) == nil, "Wrong account")
for (name, value) in [("v", 2 as Any), ("bindingId", other.userId as Any), ("nonce", "bad" as Any), ("ciphertext", Data(repeating: 0, count: 32).base64EncodedString() as Any), ("url", "https://example.invalid" as Any)] {
  var changed = envelope
  changed[name] = value
  verify(decrypt(changed) == nil, "Invalid encrypted envelope field \(name)")
}
for (name, value) in [("v", 2 as Any), ("recipientUserId", other.userId as Any), ("expiresAt", 999 as Any), ("bestCount", -1 as Any), ("rankCount", -1 as Any), ("kind", "other" as Any), ("heading", "Other" as Any), ("notificationId", "https://example.invalid" as Any), ("url", "https://example.invalid" as Any)] {
  var changed = clear
  changed[name] = value
  verify(decrypt(try encrypt(changed)) == nil, "Invalid projection field \(name)")
}
var invalidRoute = clear
invalidRoute["route"] = ["groupId": "invalid", "memberId": user, "sessionId": "session"]
verify(decrypt(try encrypt(invalidRoute)) == nil, "Malformed route")
var singular = clear
singular["bestCount"] = 1
singular["rankCount"] = 1
verify(decrypt(try encrypt(singular))?.summary == "1 new group best · 1 leaderboard change", "Singular counts")
var start = clear
start["kind"] = "start"
start["heading"] = "Started a workout"
verify(decrypt(try encrypt(start)) == nil, "Start cannot expose achievement counts")
start["bestCount"] = 0
start["rankCount"] = 0
verify(decrypt(try encrypt(start))?.summary == "", "Plain activity has no count rows")
var located = clear
located["heading"] = "Finished a workout at Main Gym"
verify(decrypt(try encrypt(located))?.heading == "Finished a workout at Main Gym", "Mapped completion gym")
located["heading"] = "Finished a workout at a secret location"
verify(decrypt(try encrypt(located))?.heading == "Finished a workout at a secret location", "Unmapped completion location")
located["heading"] = "Finished a workout at " + String(repeating: "💪", count: 100)
verify(decrypt(try encrypt(located)) != nil, "Gym limit counts Unicode code points")
located["heading"] = "Finished a workout"
verify(decrypt(try encrypt(located)) != nil, "Legacy completion heading")
start["heading"] = "Started a workout at Main Gym"
verify(decrypt(try encrypt(start))?.heading == "Started a workout at Main Gym", "Mapped start gym")
start["heading"] = "Started a workout at a secret location"
verify(decrypt(try encrypt(start))?.heading == "Started a workout at a secret location", "Unmapped start location")
for heading in ["Started a workout at ", "Finished a workout at " + String(repeating: "a", count: 101), "Finished a workout at Main\nGym"] {
  located["heading"] = heading
  verify(decrypt(try encrypt(located)) == nil, "Malformed location heading")
}
print("Native authenticated notification checks passed: \(checked)")
