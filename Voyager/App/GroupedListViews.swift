//
//  GroupedListViews.swift
//  Voyager
//
//  The views the containing app's window is built from, in the grouped-list style of
//  macOS settings.
//

import Cocoa

/// Top-down coordinate space, required for content inside an `NSScrollView`.
final class FlippedView: NSView {
  override var isFlipped: Bool { true }
}

/// Multi-line label that reports the right height for whatever width it is given.
final class WrappingLabel: NSTextField {
  override func layout() {
    if abs(preferredMaxLayoutWidth - bounds.width) > 0.5 {
      preferredMaxLayoutWidth = bounds.width
      invalidateIntrinsicContentSize()
    }
    super.layout()
  }
}

/// Grouped-list container: rounded background plus hairlines inset to the text column.
final class CardView: NSView {
  private var rowViews: [NSView] = []

  override init(frame frameRect: NSRect) {
    super.init(frame: frameRect)
    wantsLayer = true
    layer?.cornerRadius = 8
    layer?.borderWidth = 1
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  override var isFlipped: Bool { true }
  override var wantsUpdateLayer: Bool { true }

  override func updateLayer() {
    layer?.backgroundColor = NSColor.controlBackgroundColor.cgColor
    layer?.borderColor = NSColor.separatorColor.cgColor
  }

  func setRows(_ rows: [NSView]) {
    for view in rowViews { view.removeFromSuperview() }
    rowViews = rows

    var previous: NSView?
    for row in rows {
      row.translatesAutoresizingMaskIntoConstraints = false
      addSubview(row)

      if let previous {
        let separator = NSBox()
        separator.boxType = .separator
        separator.translatesAutoresizingMaskIntoConstraints = false
        addSubview(separator)
        NSLayoutConstraint.activate([
          separator.topAnchor.constraint(equalTo: previous.bottomAnchor),
          separator.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 14),
          separator.trailingAnchor.constraint(equalTo: trailingAnchor),
          row.topAnchor.constraint(equalTo: separator.bottomAnchor),
        ])
      } else {
        row.topAnchor.constraint(equalTo: topAnchor).isActive = true
      }

      NSLayoutConstraint.activate([
        row.leadingAnchor.constraint(equalTo: leadingAnchor),
        row.trailingAnchor.constraint(equalTo: trailingAnchor),
      ])
      previous = row
    }

    previous?.bottomAnchor.constraint(equalTo: bottomAnchor).isActive = true
  }
}

/// One line of a grouped list: title over an optional detail, control pinned right.
final class SettingRow: NSView {
  init(title: String, detail: String, accessory: NSView) {
    super.init(frame: .zero)

    let titleLabel = ViewController.makeLabel(font: .systemFont(ofSize: 13, weight: .medium))
    titleLabel.stringValue = title
    titleLabel.translatesAutoresizingMaskIntoConstraints = false

    let detailLabel = WrappingLabel(labelWithString: detail)
    detailLabel.font = .systemFont(ofSize: 11)
    detailLabel.textColor = .secondaryLabelColor
    detailLabel.lineBreakMode = .byWordWrapping
    detailLabel.maximumNumberOfLines = 0
    detailLabel.translatesAutoresizingMaskIntoConstraints = false

    // Let the copy wrap instead of forcing the card wider than the window.
    for label in [titleLabel, detailLabel] {
      label.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
      label.setContentHuggingPriority(.defaultLow, for: .horizontal)
    }

    accessory.translatesAutoresizingMaskIntoConstraints = false
    accessory.setContentHuggingPriority(.required, for: .horizontal)
    accessory.setContentCompressionResistancePriority(.required, for: .horizontal)

    addSubview(titleLabel)
    addSubview(detailLabel)
    addSubview(accessory)

    let inset: CGFloat = 14
    let vertical: CGFloat = 11

    NSLayoutConstraint.activate([
      titleLabel.topAnchor.constraint(equalTo: topAnchor, constant: vertical),
      titleLabel.leadingAnchor.constraint(equalTo: leadingAnchor, constant: inset),
      titleLabel.trailingAnchor.constraint(lessThanOrEqualTo: accessory.leadingAnchor, constant: -12),

      detailLabel.topAnchor.constraint(equalTo: titleLabel.bottomAnchor, constant: 1),
      detailLabel.leadingAnchor.constraint(equalTo: leadingAnchor, constant: inset),
      detailLabel.trailingAnchor.constraint(equalTo: accessory.leadingAnchor, constant: -12),
      detailLabel.bottomAnchor.constraint(equalTo: bottomAnchor, constant: -vertical),

      accessory.trailingAnchor.constraint(equalTo: trailingAnchor, constant: -inset),
      accessory.centerYAnchor.constraint(equalTo: centerYAnchor),
      accessory.topAnchor.constraint(greaterThanOrEqualTo: topAnchor, constant: vertical),
    ])
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  override var isFlipped: Bool { true }
}

/// Diagnostic value shown the way macOS does it: a tinted dot next to plain text.
final class StatusView: NSView {
  private let level: VoyagerDiagnosticLevel
  private let dot = NSView()

  init(_ item: VoyagerDiagnosticItem) {
    self.level = item.level
    super.init(frame: .zero)

    dot.wantsLayer = true
    dot.layer?.cornerRadius = 3
    dot.translatesAutoresizingMaskIntoConstraints = false
    addSubview(dot)

    let label = ViewController.makeLabel(font: .systemFont(ofSize: 12), color: .secondaryLabelColor)
    label.stringValue = item.value
    label.translatesAutoresizingMaskIntoConstraints = false
    addSubview(label)

    NSLayoutConstraint.activate([
      dot.widthAnchor.constraint(equalToConstant: 6),
      dot.heightAnchor.constraint(equalToConstant: 6),
      dot.leadingAnchor.constraint(equalTo: leadingAnchor),
      dot.centerYAnchor.constraint(equalTo: centerYAnchor),

      label.leadingAnchor.constraint(equalTo: dot.trailingAnchor, constant: 6),
      label.trailingAnchor.constraint(equalTo: trailingAnchor),
      label.topAnchor.constraint(equalTo: topAnchor),
      label.bottomAnchor.constraint(equalTo: bottomAnchor),
    ])
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  override var wantsUpdateLayer: Bool { true }

  override func updateLayer() {
    dot.layer?.backgroundColor = level.dotColor.cgColor
  }
}

extension VoyagerDiagnosticLevel {
  fileprivate var dotColor: NSColor {
    switch self {
    case .ready: return .systemGreen
    case .attention: return .systemOrange
    case .neutral: return .tertiaryLabelColor
    }
  }
}
