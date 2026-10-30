//
//  ViewController.swift
//  Voyager
//
//  Created by Jesse Zhang on 15/05/2026.
//

import Cocoa
import SafariServices
import os.log

let extensionBundleIdentifier = "com.yourCompany.Gemini-Voyager.Extension"

class ViewController: NSViewController {

  private enum Metrics {
    static let windowPadding: CGFloat = 20
    static let rowInset: CGFloat = 14
    static let rowSpacing: CGFloat = 11
    static let sectionSpacing: CGFloat = 22
  }

  private let diagnosticsService = NativeDiagnosticsService()
  private var updaterAvailabilityObservation: NSKeyValueObservation?
  private var hasLoadedInitialState = false

  private let stateLabel = ViewController.makeLabel(
    font: .systemFont(ofSize: 13),
    color: .secondaryLabelColor
  )
  private let openPreferencesButton = NSButton()
  // The step after enabling: Voyager lives inside the chat page, so hand the
  // user to Gemini in Safari where the in-page tour takes over.
  private let openGeminiButton = NSButton()
  private let nextStepLabel = ViewController.makeLabel(
    font: .systemFont(ofSize: 12),
    color: .secondaryLabelColor
  )
  private var activationObserver: NSObjectProtocol?
  private let automaticUpdatesSwitch = NSSwitch()
  private let checkForUpdatesButton = NSButton()
  private let diagnosticsCard = CardView()

  // MARK: - Lifecycle

  override func viewDidLoad() {
    super.viewDidLoad()
    buildInterface()
    showDiagnosticsPlaceholder()
  }

  override func viewWillAppear() {
    super.viewWillAppear()
    guard !hasLoadedInitialState, let appDelegate = NSApp.delegate as? AppDelegate else { return }
    hasLoadedInitialState = true
    observeUpdaterAvailability(appDelegate)
    updateUpdaterControls(appDelegate)
    updateExtensionState()
    updateDiagnostics(appDelegate)

    // The user enables the extension in Safari's settings and comes back here;
    // re-read the state so the window moves on to the next step by itself.
    activationObserver = NotificationCenter.default.addObserver(
      forName: NSApplication.didBecomeActiveNotification,
      object: nil,
      queue: .main
    ) { [weak self] _ in
      self?.updateExtensionState()
    }
  }

  deinit {
    if let activationObserver {
      NotificationCenter.default.removeObserver(activationObserver)
    }
  }

  // MARK: - Interface

  private func buildInterface() {
    let sections = [makeHeroSection(), makeUpdatesSection(), makeDiagnosticsSection()]
    let content = NSStackView(views: sections)
    content.orientation = .vertical
    content.alignment = .leading
    content.spacing = Metrics.sectionSpacing
    content.edgeInsets = NSEdgeInsets(
      top: Metrics.windowPadding,
      left: Metrics.windowPadding,
      bottom: Metrics.windowPadding,
      right: Metrics.windowPadding
    )
    content.translatesAutoresizingMaskIntoConstraints = false

    // Flipped so the stack lays out from the top edge down, the way a scrolled
    // settings pane should; an unflipped document view would pin it to the bottom.
    let documentView = FlippedView()
    documentView.translatesAutoresizingMaskIntoConstraints = false
    documentView.addSubview(content)

    let scrollView = NSScrollView()
    scrollView.hasVerticalScroller = true
    scrollView.drawsBackground = false
    scrollView.autohidesScrollers = true
    scrollView.documentView = documentView
    scrollView.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(scrollView)

    NSLayoutConstraint.activate([
      scrollView.topAnchor.constraint(equalTo: view.topAnchor),
      scrollView.bottomAnchor.constraint(equalTo: view.bottomAnchor),
      scrollView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      scrollView.trailingAnchor.constraint(equalTo: view.trailingAnchor),

      documentView.widthAnchor.constraint(equalTo: scrollView.contentView.widthAnchor),
      content.topAnchor.constraint(equalTo: documentView.topAnchor),
      content.bottomAnchor.constraint(equalTo: documentView.bottomAnchor),
      content.leadingAnchor.constraint(equalTo: documentView.leadingAnchor),
      content.trailingAnchor.constraint(equalTo: documentView.trailingAnchor),
    ])

    // `.width` alignment would only make the sections equal to each other, so pin
    // each one to the stack's content width explicitly.
    for section in sections {
      section.widthAnchor.constraint(
        equalTo: content.widthAnchor,
        constant: -2 * Metrics.windowPadding
      ).isActive = true
    }
  }

  private func makeHeroSection() -> NSView {
    let iconView = NSImageView()
    iconView.image = NSApp.applicationIconImage
    iconView.imageScaling = .scaleProportionallyUpOrDown
    iconView.translatesAutoresizingMaskIntoConstraints = false
    NSLayoutConstraint.activate([
      iconView.widthAnchor.constraint(equalToConstant: 64),
      iconView.heightAnchor.constraint(equalToConstant: 64),
    ])

    let titleLabel = Self.makeLabel(font: .systemFont(ofSize: 20, weight: .semibold))
    titleLabel.stringValue = "Voyager"

    stateLabel.stringValue = Self.stateCopy(for: nil)
    stateLabel.alignment = .center
    stateLabel.maximumNumberOfLines = 3
    stateLabel.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)

    openPreferencesButton.title = Self.openPreferencesTitle
    openPreferencesButton.bezelStyle = .rounded
    openPreferencesButton.controlSize = .large
    openPreferencesButton.keyEquivalent = "\r"
    openPreferencesButton.target = self
    openPreferencesButton.action = #selector(openPreferences)

    openGeminiButton.title = voyagerLocalized("hero.openGemini", "Open Gemini in Safari")
    openGeminiButton.bezelStyle = .rounded
    openGeminiButton.controlSize = .large
    openGeminiButton.target = self
    openGeminiButton.action = #selector(openGemini)
    openGeminiButton.isHidden = true

    nextStepLabel.stringValue = Self.nextStepCopy
    nextStepLabel.alignment = .center
    nextStepLabel.maximumNumberOfLines = 3
    nextStepLabel.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
    nextStepLabel.isHidden = true

    // Once enabled, "Open Gemini" leads and the settings button drops beneath it.
    let stack = NSStackView(views: [
      iconView, titleLabel, stateLabel, openGeminiButton, openPreferencesButton, nextStepLabel,
    ])
    stack.orientation = .vertical
    stack.alignment = .centerX
    stack.spacing = 8
    stack.setCustomSpacing(4, after: titleLabel)
    stack.setCustomSpacing(14, after: stateLabel)
    stack.setCustomSpacing(10, after: openPreferencesButton)
    return stack
  }

  private func makeUpdatesSection() -> NSView {
    automaticUpdatesSwitch.target = self
    automaticUpdatesSwitch.action = #selector(toggleAutomaticUpdates)

    let updatesRow = SettingRow(
      title: voyagerLocalized("updates.automatic.title", "Automatic updates"),
      detail: voyagerLocalized(
        "updates.automatic.detail", "Keep Voyager up to date in the background."),
      accessory: automaticUpdatesSwitch
    )

    checkForUpdatesButton.title = voyagerLocalized("updates.check", "Check for updates")
    checkForUpdatesButton.bezelStyle = .rounded
    checkForUpdatesButton.target = self
    checkForUpdatesButton.action = #selector(checkForUpdates)

    let buttonRow = Self.makeButtonRow(checkForUpdatesButton)
    let card = CardView()
    card.setRows([updatesRow, buttonRow])
    return Self.makeSection(
      title: voyagerLocalized("updates.title", "Updates"), subtitle: nil, accessory: nil,
      body: card)
  }

  private func makeDiagnosticsSection() -> NSView {
    let refreshButton = NSButton()
    refreshButton.title = voyagerLocalized("status.refresh", "Refresh")
    refreshButton.bezelStyle = .rounded
    refreshButton.controlSize = .small
    refreshButton.target = self
    refreshButton.action = #selector(refreshDiagnostics)
    refreshButton.setAccessibilityLabel(
      voyagerLocalized("status.refresh.accessibility", "Refresh system status"))

    return Self.makeSection(
      title: voyagerLocalized("status.title", "System status"),
      subtitle: voyagerLocalized("status.subtitle", "Safari and native integrations"),
      accessory: refreshButton,
      body: diagnosticsCard
    )
  }

  // MARK: - Actions

  @objc private func openPreferences() {
    // Stay running: when the user returns after enabling the extension, the
    // window refreshes and offers the next step instead of having vanished.
    SFSafariApplication.showPreferencesForExtension(withIdentifier: extensionBundleIdentifier) {
      _ in
    }
  }

  @objc private func openGemini() {
    guard let url = URL(string: Self.geminiURL) else { return }
    if let safariURL = NSWorkspace.shared.urlForApplication(
      withBundleIdentifier: "com.apple.Safari")
    {
      NSWorkspace.shared.open(
        [url], withApplicationAt: safariURL, configuration: NSWorkspace.OpenConfiguration())
    } else {
      NSWorkspace.shared.open(url)
    }
  }

  @objc private func toggleAutomaticUpdates() {
    guard let appDelegate = NSApp.delegate as? AppDelegate else { return }
    appDelegate.setAutomaticUpdatesEnabled(automaticUpdatesSwitch.state == .on)
    updateUpdaterControls(appDelegate)
  }

  @objc private func checkForUpdates() {
    guard let appDelegate = NSApp.delegate as? AppDelegate else { return }
    appDelegate.checkForUpdates(nil)
    updateUpdaterControls(appDelegate)
  }

  @objc private func refreshDiagnostics() {
    guard let appDelegate = NSApp.delegate as? AppDelegate else { return }
    showDiagnosticsPlaceholder()
    updateExtensionState()
    updateDiagnostics(appDelegate)
  }

  // MARK: - State

  private func updateExtensionState() {
    SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: extensionBundleIdentifier) {
      (state, error) in
      let isEnabled = error == nil ? state?.isEnabled : nil

      DispatchQueue.main.async {
        self.stateLabel.stringValue = Self.stateCopy(for: isEnabled)
        self.showNextStep(isEnabled == true)
      }
    }
  }

  /// Once the extension is on, "Open Gemini" becomes the default action and
  /// the settings button steps back.
  private func showNextStep(_ enabled: Bool) {
    openGeminiButton.isHidden = !enabled
    nextStepLabel.isHidden = !enabled
    openGeminiButton.keyEquivalent = enabled ? "\r" : ""
    openPreferencesButton.keyEquivalent = enabled ? "" : "\r"
  }

  private func updateUpdaterControls(_ appDelegate: AppDelegate) {
    automaticUpdatesSwitch.state = appDelegate.automaticUpdatesEnabled ? .on : .off
    checkForUpdatesButton.isEnabled = appDelegate.canCheckForUpdates
  }

  private func observeUpdaterAvailability(_ appDelegate: AppDelegate) {
    guard updaterAvailabilityObservation == nil else { return }
    updaterAvailabilityObservation = appDelegate.observeCanCheckForUpdates {
      [weak self, weak appDelegate] in
      guard let self, let appDelegate else { return }
      self.updateUpdaterControls(appDelegate)
    }
  }

  private func updateDiagnostics(_ appDelegate: AppDelegate) {
    diagnosticsService.collect(appDelegate: appDelegate) { [weak self] snapshot in
      DispatchQueue.main.async {
        self?.showDiagnostics(snapshot)
      }
    }
  }

  private func showDiagnosticsPlaceholder() {
    let label = Self.makeLabel(font: .systemFont(ofSize: 12), color: .secondaryLabelColor)
    label.stringValue = voyagerLocalized("status.checking", "Checking…")
    diagnosticsCard.setRows([Self.makePlaceholderRow(label)])
  }

  private func showDiagnostics(_ snapshot: VoyagerDiagnosticsSnapshot) {
    diagnosticsCard.setRows(
      snapshot.items.map {
        SettingRow(title: $0.label, detail: $0.detail, accessory: StatusView($0))
      }
    )
  }

  // MARK: - Copy

  private static var usesSettingsWording: Bool {
    if #available(macOS 13, *) { return true }
    return false
  }

  private static let geminiURL = "https://gemini.google.com/app"

  private static var nextStepCopy: String {
    voyagerLocalized(
      "hero.nextStep",
      "Voyager works inside the chat page. On your first visit, click Voyager in Safari's address bar and choose “Always Allow on This Website”."
    )
  }

  private static var openPreferencesTitle: String {
    usesSettingsWording
      ? voyagerLocalized("hero.openExtensions.settings", "Open Safari Extensions…")
      : voyagerLocalized(
        "hero.openExtensions.preferences", "Open Safari Extensions Preferences…")
  }

  // Whole sentences per wording: the place name cannot be spliced into every language.
  private static func stateCopy(for isEnabled: Bool?) -> String {
    switch (isEnabled, usesSettingsWording) {
    case (.some(true), _):
      return voyagerLocalized("hero.state.ready", "The Safari extension is on and ready.")
    case (.some(false), true):
      return voyagerLocalized(
        "hero.state.off.settings",
        "The Safari extension is off. Turn it on in Safari Extensions.")
    case (.some(false), false):
      return voyagerLocalized(
        "hero.state.off.preferences",
        "The Safari extension is off. Turn it on in Safari Extensions preferences.")
    case (.none, true):
      return voyagerLocalized(
        "hero.state.unknown.settings", "Turn on Voyager in Safari Extensions to get started.")
    case (.none, false):
      return voyagerLocalized(
        "hero.state.unknown.preferences",
        "Turn on Voyager in Safari Extensions preferences to get started.")
    }
  }

  // MARK: - View factories

  static func makeLabel(font: NSFont, color: NSColor = .labelColor) -> NSTextField {
    let label = NSTextField(labelWithString: "")
    label.font = font
    label.textColor = color
    label.lineBreakMode = .byWordWrapping
    return label
  }

  private static func makeSection(
    title: String,
    subtitle: String?,
    accessory: NSView?,
    body: NSView
  ) -> NSView {
    let titleLabel = makeLabel(font: .systemFont(ofSize: 13, weight: .semibold))
    titleLabel.stringValue = title

    let headingCopy = NSStackView(views: [titleLabel])
    headingCopy.orientation = .vertical
    headingCopy.alignment = .leading
    headingCopy.spacing = 1

    if let subtitle {
      let subtitleLabel = makeLabel(font: .systemFont(ofSize: 11), color: .secondaryLabelColor)
      subtitleLabel.stringValue = subtitle
      headingCopy.addArrangedSubview(subtitleLabel)
    }

    let heading = NSStackView(views: [headingCopy])
    heading.orientation = .horizontal
    heading.alignment = .centerY
    heading.edgeInsets = NSEdgeInsets(top: 0, left: 2, bottom: 0, right: 0)

    if let accessory {
      let spacer = NSView()
      spacer.setContentHuggingPriority(.defaultLow, for: .horizontal)
      heading.addArrangedSubview(spacer)
      accessory.setContentHuggingPriority(.required, for: .horizontal)
      heading.addArrangedSubview(accessory)
    }

    let section = NSStackView(views: [heading, body])
    section.orientation = .vertical
    section.alignment = .leading
    section.spacing = 7
    NSLayoutConstraint.activate([
      heading.widthAnchor.constraint(equalTo: section.widthAnchor),
      body.widthAnchor.constraint(equalTo: section.widthAnchor),
    ])
    return section
  }

  /// Wraps a bare control in a row so it picks up the card's standard insets.
  private static func makeButtonRow(_ button: NSButton) -> NSView {
    let container = NSView()
    button.translatesAutoresizingMaskIntoConstraints = false
    container.addSubview(button)
    NSLayoutConstraint.activate([
      button.topAnchor.constraint(equalTo: container.topAnchor, constant: Metrics.rowSpacing),
      button.bottomAnchor.constraint(
        equalTo: container.bottomAnchor, constant: -Metrics.rowSpacing),
      button.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: Metrics.rowInset),
      button.trailingAnchor.constraint(
        lessThanOrEqualTo: container.trailingAnchor, constant: -Metrics.rowInset),
    ])
    return container
  }

  private static func makePlaceholderRow(_ label: NSTextField) -> NSView {
    let container = NSView()
    label.translatesAutoresizingMaskIntoConstraints = false
    container.addSubview(label)
    NSLayoutConstraint.activate([
      label.topAnchor.constraint(equalTo: container.topAnchor, constant: Metrics.rowSpacing),
      label.bottomAnchor.constraint(equalTo: container.bottomAnchor, constant: -Metrics.rowSpacing),
      label.leadingAnchor.constraint(equalTo: container.leadingAnchor, constant: Metrics.rowInset),
      label.trailingAnchor.constraint(
        lessThanOrEqualTo: container.trailingAnchor, constant: -Metrics.rowInset),
    ])
    return container
  }
}
