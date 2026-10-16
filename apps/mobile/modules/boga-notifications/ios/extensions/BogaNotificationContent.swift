import UIKit
import UserNotifications
import UserNotificationsUI

final class BogaNotificationContent: UIViewController, UNNotificationContentExtension {
  private var card: UIStackView?

  func didReceive(_ notification: UNNotification) {
    card?.removeFromSuperview()
    guard let envelope = BogaNotificationCrypto.envelope(from: notification.request.content.userInfo),
          let projection = BogaNotificationStore.decrypt(envelope),
          let theme = BogaNotificationStore.readTheme() else {
      showFallback()
      return
    }
    let stack = UIStackView()
    stack.axis = .vertical
    stack.backgroundColor = colour(theme, "surface")
    stack.layer.cornerRadius = 6
    stack.layer.borderWidth = 1
    stack.layer.borderColor = colour(theme, "rule").cgColor
    stack.clipsToBounds = true
    let header = UIStackView(arrangedSubviews: [
      label(projection.identity, family: "Archivo", weight: .semibold, size: 14, colour: colour(theme, "ink")),
      label(projection.heading, family: "Archivo", weight: .bold, size: 24, colour: colour(theme, "ink"))
    ])
    header.axis = .vertical
    header.spacing = 8
    header.isLayoutMarginsRelativeArrangement = true
    header.layoutMargins = UIEdgeInsets(top: 16, left: 16, bottom: 16, right: 16)
    stack.addArrangedSubview(header)
    if projection.bestCount > 0 {
      addRow(stack, count: projection.bestCount, text: "new group best\(projection.bestCount == 1 ? "" : "s")", theme: theme, record: true)
    }
    if projection.rankCount > 0 {
      addRow(stack, count: projection.rankCount, text: "leaderboard change\(projection.rankCount == 1 ? "" : "s")", theme: theme, record: false)
    }
    view.backgroundColor = colour(theme, "paper")
    attach(stack)
  }

  private func addRow(_ stack: UIStackView, count: Int, text: String, theme: [String: String], record: Bool) {
    let rule = UIView()
    rule.backgroundColor = colour(theme, "rule")
    rule.heightAnchor.constraint(equalToConstant: 1).isActive = true
    stack.addArrangedSubview(rule)
    let ink = colour(theme, record ? "record" : "ink")
    let number = label(String(count), family: "IBM Plex Mono", weight: .bold, size: 24, colour: ink)
    number.setContentCompressionResistancePriority(.required, for: .horizontal)
    let row = UIStackView(arrangedSubviews: [number, label(text, family: "Source Sans 3", weight: .semibold, size: 18, colour: ink)])
    row.axis = .horizontal
    row.alignment = .center
    row.spacing = 12
    row.backgroundColor = colour(theme, record ? "recordWash" : "surface")
    row.isLayoutMarginsRelativeArrangement = true
    row.layoutMargins = UIEdgeInsets(top: 12, left: 16, bottom: 12, right: 16)
    row.isAccessibilityElement = true
    row.accessibilityLabel = "\(count) \(text)"
    stack.addArrangedSubview(row)
  }

  private func label(_ text: String, family: String, weight: UIFont.Weight, size: CGFloat, colour: UIColor) -> UILabel {
    let label = UILabel()
    label.text = text
    label.numberOfLines = 0
    label.textColor = colour
    let descriptor = UIFontDescriptor(fontAttributes: [.family: family, .traits: [UIFontDescriptor.TraitKey.weight: weight]])
    label.font = UIFontMetrics(forTextStyle: .body).scaledFont(for: UIFont(descriptor: descriptor, size: size))
    label.adjustsFontForContentSizeCategory = true
    return label
  }

  private func colour(_ theme: [String: String], _ key: String) -> UIColor {
    let hex = String((theme[key] ?? "#000000").dropFirst())
    let value = UInt32(hex, radix: 16) ?? 0
    return UIColor(red: CGFloat((value >> 16) & 255) / 255, green: CGFloat((value >> 8) & 255) / 255,
                   blue: CGFloat(value & 255) / 255, alpha: 1)
  }

  private func showFallback() {
    let stack = UIStackView(arrangedSubviews: [label("Open the app to view your notification", family: "Source Sans 3", weight: .regular, size: 14, colour: .label)])
    stack.isLayoutMarginsRelativeArrangement = true
    stack.layoutMargins = UIEdgeInsets(top: 16, left: 16, bottom: 16, right: 16)
    view.backgroundColor = .systemBackground
    attach(stack)
  }

  private func attach(_ stack: UIStackView) {
    card = stack
    stack.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(stack)
    NSLayoutConstraint.activate([stack.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      stack.trailingAnchor.constraint(equalTo: view.trailingAnchor), stack.topAnchor.constraint(equalTo: view.topAnchor)])
    view.layoutIfNeeded()
    let width = view.bounds.width > 0 ? view.bounds.width : 320
    preferredContentSize = CGSize(width: width, height: stack.systemLayoutSizeFitting(
      CGSize(width: width, height: UIView.layoutFittingCompressedSize.height),
      withHorizontalFittingPriority: .required, verticalFittingPriority: .fittingSizeLevel).height)
  }
}
