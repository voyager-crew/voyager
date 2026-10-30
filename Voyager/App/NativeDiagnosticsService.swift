import Foundation
import GoogleSignIn
import SafariServices

final class NativeDiagnosticsService {
  private let googleDriveScope = "https://www.googleapis.com/auth/drive.file"

  func collect(
    appDelegate: AppDelegate,
    completion: @escaping (VoyagerDiagnosticsSnapshot) -> Void
  ) {
    let automaticUpdatesEnabled = appDelegate.automaticUpdatesEnabled
    let canCheckForUpdates = appDelegate.canCheckForUpdates
    let lastUpdateCheckDate = appDelegate.lastUpdateCheckDate

    SFSafariExtensionManager.getStateOfSafariExtension(
      withIdentifier: extensionBundleIdentifier
    ) { state, error in
      let extensionEnabled = error == nil ? state?.isEnabled : nil
      let extensionReady = extensionEnabled == true

      let unavailable = voyagerLocalized("diag.value.unavailable", "Unavailable")
      self.googleDriveDiagnostic { googleDriveItem in
        let items = [
          VoyagerDiagnosticItem(
            id: "extension",
            label: voyagerLocalized("diag.extension.label", "Safari extension"),
            value: extensionEnabled.map {
              $0
                ? voyagerLocalized("diag.value.enabled", "Enabled")
                : voyagerLocalized("diag.value.disabled", "Disabled")
            } ?? unavailable,
            detail: extensionReady
              ? voyagerLocalized("diag.extension.ready", "Voyager is available in Safari.")
              : voyagerLocalized(
                "diag.extension.attention", "Open Safari Extensions and enable Voyager."),
            level: extensionReady ? .ready : .attention
          ),
          VoyagerDiagnosticItem(
            id: "notifications",
            label: voyagerLocalized("diag.notifications.label", "Native notifications"),
            value: extensionReady
              ? voyagerLocalized("diag.notifications.value.ready", "Safari managed")
              : unavailable,
            detail: extensionReady
              ? voyagerLocalized(
                "diag.notifications.ready",
                "Safari checks notification authorization before delivery.")
              : voyagerLocalized(
                "diag.notifications.attention",
                "Enable the Safari extension before requesting notification access."),
            level: extensionReady ? .neutral : .attention
          ),
          VoyagerDiagnosticItem(
            id: "icloud",
            label: voyagerLocalized("diag.icloud.label", "iCloud bridge"),
            value: extensionReady
              ? voyagerLocalized("diag.icloud.value.ready", "Checked on use")
              : unavailable,
            detail: extensionReady
              ? voyagerLocalized(
                "diag.icloud.ready",
                "The Safari extension verifies CloudKit account status before every sync.")
              : voyagerLocalized(
                "diag.icloud.attention", "Enable the Safari extension before using iCloud sync."),
            level: extensionReady ? .neutral : .attention
          ),
          googleDriveItem,
          VoyagerDiagnosticItem(
            id: "updates",
            label: voyagerLocalized("updates.title", "Updates"),
            value: automaticUpdatesEnabled
              ? voyagerLocalized("diag.updates.value.automatic", "Automatic")
              : voyagerLocalized("diag.updates.value.manual", "Manual"),
            detail: canCheckForUpdates
              ? Self.updatesReadyDetail(lastCheck: lastUpdateCheckDate)
              : voyagerLocalized(
                "diag.updates.starting", "Sparkle is still starting or unavailable."),
            level: canCheckForUpdates ? .ready : .attention
          ),
        ]

        completion(VoyagerDiagnosticsSnapshot(items: items))
      }
    }
  }

  private func googleDriveDiagnostic(
    completion: @escaping (VoyagerDiagnosticItem) -> Void
  ) {
    guard let clientID = Bundle.main.object(forInfoDictionaryKey: "GIDClientID") as? String,
      !clientID.isEmpty
    else {
      completion(
        googleDriveItem(
          value: voyagerLocalized("diag.drive.value.notConfigured", "Not configured"),
          detail: voyagerLocalized(
            "diag.drive.notConfigured", "Google Sign-In is missing its client configuration."),
          level: .attention
        )
      )
      return
    }

    guard GIDSignIn.sharedInstance.hasPreviousSignIn() else {
      completion(
        googleDriveItem(
          value: voyagerLocalized("diag.drive.value.notConnected", "Not connected"),
          detail: voyagerLocalized(
            "diag.drive.notConnected", "Connect Google Drive from the Voyager popup when needed."),
          level: .neutral
        )
      )
      return
    }

    GIDSignIn.sharedInstance.configuration = GIDConfiguration(clientID: clientID)
    GIDSignIn.sharedInstance.restorePreviousSignIn { user, _ in
      guard let user else {
        completion(
          self.googleDriveItem(
            value: voyagerLocalized("diag.drive.value.needsSignIn", "Needs sign-in"),
            detail: voyagerLocalized(
              "diag.drive.restoreFailed", "The saved Google session could not be restored."),
            level: .attention
          )
        )
        return
      }

      user.refreshTokensIfNeeded { refreshedUser, _ in
        guard let refreshedUser else {
          completion(
            self.googleDriveItem(
              value: voyagerLocalized("diag.drive.value.needsSignIn", "Needs sign-in"),
              detail: voyagerLocalized(
                "diag.drive.refreshFailed", "The Google session could not be refreshed."),
              level: .attention
            )
          )
          return
        }

        guard refreshedUser.grantedScopes?.contains(self.googleDriveScope) == true else {
          completion(
            self.googleDriveItem(
              value: voyagerLocalized("diag.drive.value.reconnect", "Reconnect"),
              detail: voyagerLocalized(
                "diag.drive.missingScope",
                "The saved Google session does not include Drive access."),
              level: .attention
            )
          )
          return
        }

        completion(
          self.googleDriveItem(
            value: voyagerLocalized("diag.drive.value.connected", "Connected"),
            detail: voyagerLocalized(
              "diag.drive.connected",
              "The native Google session is valid and includes Drive access."),
            level: .ready
          )
        )
      }
    }
  }

  private static func updatesReadyDetail(lastCheck: Date?) -> String {
    guard let lastCheck else {
      return voyagerLocalized(
        "diag.updates.neverChecked",
        "Sparkle is ready to check for updates. No check has completed yet.")
    }
    let formatter = DateFormatter()
    // Dates read in the window's language, not only the system's.
    formatter.locale = Locale(identifier: Bundle.main.preferredLocalizations.first ?? "en")
    formatter.dateStyle = .medium
    formatter.timeStyle = .short
    return String(
      format: voyagerLocalized(
        "diag.updates.lastChecked", "Sparkle is ready to check for updates. Last checked %@."),
      formatter.string(from: lastCheck))
  }

  private func googleDriveItem(
    value: String,
    detail: String,
    level: VoyagerDiagnosticLevel
  ) -> VoyagerDiagnosticItem {
    VoyagerDiagnosticItem(
      id: "google-drive",
      label: voyagerLocalized("diag.drive.label", "Google Drive"),
      value: value,
      detail: detail,
      level: level
    )
  }
}
