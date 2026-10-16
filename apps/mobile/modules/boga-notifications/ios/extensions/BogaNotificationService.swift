import UserNotifications

final class BogaNotificationService: UNNotificationServiceExtension {
  private var handler: ((UNNotificationContent) -> Void)?
  private var fallback: UNMutableNotificationContent?

  override func didReceive(_ request: UNNotificationRequest, withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void) {
    handler = contentHandler
    guard let content = request.content.mutableCopy() as? UNMutableNotificationContent else {
      finish(request.content)
      return
    }
    content.title = "BoGa"
    content.subtitle = ""
    content.body = "Open the app to view your notification"
    fallback = content
    guard let envelope = BogaNotificationCrypto.envelope(from: request.content.userInfo),
          let projection = BogaNotificationStore.decrypt(envelope) else { finish(content); return }
    guard let expanded = content.mutableCopy() as? UNMutableNotificationContent else { finish(content); return }
    expanded.title = projection.identity
    expanded.subtitle = projection.heading
    expanded.body = projection.summary
    // Retain the encrypted envelope. App taps and expanded content decrypt it again.
    finish(expanded)
  }

  override func serviceExtensionTimeWillExpire() {
    if let fallback { finish(fallback) }
  }

  private func finish(_ content: UNNotificationContent) {
    let completion = handler
    handler = nil
    completion?(content)
  }
}
