import CloudKit
import Foundation
import UserNotifications

enum VoyagerICloudFailureCode: String, Codable {
  case accountUnavailable = "icloud_account_unavailable"
  case conflict = "icloud_conflict"
  case invalidPayload = "icloud_invalid_payload"
  case temporarilyUnavailable = "icloud_temporarily_unavailable"
}

struct VoyagerICloudFailure: LocalizedError, Equatable {
  let code: VoyagerICloudFailureCode
  let message: String
  let retryAfterMilliseconds: Int?

  var errorDescription: String? { message }

  static let accountUnavailable = VoyagerICloudFailure(
    code: .accountUnavailable,
    message: "iCloud is unavailable. Sign in to iCloud in System Settings.",
    retryAfterMilliseconds: nil
  )

  static let invalidPayload = VoyagerICloudFailure(
    code: .invalidPayload,
    message: "The iCloud sync file is invalid.",
    retryAfterMilliseconds: nil
  )

  static func conflict(fileName: String) -> VoyagerICloudFailure {
    VoyagerICloudFailure(
      code: .conflict,
      message:
        "\(fileName) changed on another device. Download and merge before uploading again.",
      retryAfterMilliseconds: nil
    )
  }

  static func temporarilyUnavailable(retryAfter seconds: TimeInterval?)
    -> VoyagerICloudFailure
  {
    VoyagerICloudFailure(
      code: .temporarilyUnavailable,
      message: "iCloud is temporarily unavailable. Try again shortly.",
      retryAfterMilliseconds: seconds.map { max(0, Int(($0 * 1_000).rounded())) }
    )
  }
}

enum VoyagerICloudFailureMapper {
  static func map(error: Error, fileName: String? = nil) -> Error {
    guard let cloudError = primaryCloudKitError(from: error) else { return error }

    switch cloudError.code {
    case .serverRecordChanged:
      return VoyagerICloudFailure.conflict(fileName: fileName ?? "The iCloud sync file")
    case .notAuthenticated:
      return VoyagerICloudFailure.accountUnavailable
    case .requestRateLimited, .serviceUnavailable, .zoneBusy:
      let retryAfter = (cloudError.userInfo[CKErrorRetryAfterKey] as? NSNumber)?.doubleValue
      return VoyagerICloudFailure.temporarilyUnavailable(retryAfter: retryAfter)
    default:
      return error
    }
  }

  static func primaryCloudKitError(from error: Error?) -> CKError? {
    guard let cloudError = error as? CKError else { return nil }
    guard cloudError.code == .partialFailure,
      let nestedError = cloudError.partialErrorsByItemID?.values.first
    else { return cloudError }

    return primaryCloudKitError(from: nestedError) ?? cloudError
  }
}

enum VoyagerGoogleDriveFailureCode: String, Codable {
  case authRequired = "drive_auth_required"
  case notFound = "drive_not_found"
  case rateLimited = "drive_rate_limited"
  case temporarilyUnavailable = "drive_temporarily_unavailable"
  case accountChanged = "drive_account_changed"
}

enum VoyagerGoogleDriveFolderIdentity {
  static let currentName = "Voyager Data"
  static let legacyName = "Gemini Voyager Data"
  static let markerKey = "voyagerDataFolder"
  static let markerValue = "1"

  static func shouldRenameLegacyFolder(
    named name: String,
    canonicalNameAlreadyExists: Bool
  ) -> Bool {
    name == legacyName && !canonicalNameAlreadyExists
  }
}

struct VoyagerGoogleDriveFailure: LocalizedError, Equatable {
  let code: VoyagerGoogleDriveFailureCode
  let message: String
  let retryAfterMilliseconds: Int?

  var errorDescription: String? { message }

  static let authRequired = VoyagerGoogleDriveFailure(
    code: .authRequired,
    message: "Google Drive access must be authorized again. Open Voyager to reconnect.",
    retryAfterMilliseconds: nil
  )

  static let notFound = VoyagerGoogleDriveFailure(
    code: .notFound,
    message: "The Google Drive file no longer exists.",
    retryAfterMilliseconds: nil
  )

  /// The transfer began under another Google account than the one the app stores now.
  static let accountChanged = VoyagerGoogleDriveFailure(
    code: .accountChanged,
    message: "The Google account changed during this sync.",
    retryAfterMilliseconds: nil
  )

  static func rateLimited(retryAfter seconds: TimeInterval?) -> VoyagerGoogleDriveFailure {
    VoyagerGoogleDriveFailure(
      code: .rateLimited,
      message: "Google Drive is rate limiting requests. Try again shortly.",
      retryAfterMilliseconds: seconds.map { max(0, Int(($0 * 1_000).rounded())) }
    )
  }

  static func temporarilyUnavailable(
    statusCode: Int,
    retryAfter seconds: TimeInterval? = nil
  ) -> VoyagerGoogleDriveFailure {
    VoyagerGoogleDriveFailure(
      code: .temporarilyUnavailable,
      message: "Google Drive is temporarily unavailable (\(statusCode)). Try again shortly.",
      retryAfterMilliseconds: seconds.map { max(0, Int(($0 * 1_000).rounded())) }
    )
  }
}

enum VoyagerGoogleDriveAuthErrorClassifier {
  /// AppAuth surfaces a revoked or expired grant as OIDOAuthTokenErrorDomain
  /// ("org.openid.appauth.oauth_token") or an OAuth invalid_grant response in
  /// the underlying-error chain. Network failures (NSURLErrorDomain) must stay
  /// retryable, so only those definitive markers count as permanent.
  static func isPermanentAuthFailure(_ error: Error) -> Bool {
    var current: NSError? = error as NSError
    var depth = 0
    while let nsError = current, depth < 8 {
      if nsError.domain == "org.openid.appauth.oauth_token" { return true }
      if nsError.localizedDescription.lowercased().contains("invalid_grant") { return true }
      current = nsError.userInfo[NSUnderlyingErrorKey] as? NSError
      depth += 1
    }
    return false
  }
}

enum VoyagerGoogleDriveHTTPFailureMapper {
  static func isAuthorizationFailure(_ error: Error) -> Bool {
    (error as? VoyagerGoogleDriveFailure)?.code == .authRequired
  }

  /// Maps a Drive REST status to a structured failure, or nil when the status
  /// carries no reliable semantics (callers keep their generic error).
  /// 403 is ambiguous (revoked permission vs. rate limit vs. storage quota),
  /// so it is only mapped when the response body confirms rate limiting.
  static func map(
    statusCode: Int,
    retryAfterSeconds: TimeInterval? = nil,
    bodyHint: String? = nil
  ) -> VoyagerGoogleDriveFailure? {
    switch statusCode {
    case 200..<300:
      return nil
    case 401:
      return .authRequired
    case 403:
      let hint = bodyHint?.lowercased() ?? ""
      if hint.contains("ratelimit") || hint.contains("dailylimitexceeded") {
        return .rateLimited(retryAfter: retryAfterSeconds)
      }
      return nil
    case 404:
      return .notFound
    case 429:
      return .rateLimited(retryAfter: retryAfterSeconds)
    case 500..<600:
      return .temporarilyUnavailable(statusCode: statusCode, retryAfter: retryAfterSeconds)
    default:
      return nil
    }
  }
}

enum VoyagerICloudRecordIdentity {
  static func recordName(for fileName: String) -> String {
    let encoded = Data(fileName.utf8).base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
    return "file-\(encoded)"
  }
}

struct VoyagerNotificationDestination: Equatable {
  static let userInfoKey = "voyagerConversationURL"
  static let categoryIdentifier = "voyager.response-complete"
  static let openActionIdentifier = "voyager.open-conversation"

  private static let allowedHosts = [
    "gemini.google.com",
    "aistudio.google.com",
    "chatgpt.com",
    "claude.ai",
  ]

  let url: URL

  init?(rawValue: String) {
    guard let url = URL(string: rawValue),
      url.scheme == "https",
      let host = url.host?.lowercased(),
      Self.allowedHosts.contains(where: { host == $0 || host.hasSuffix(".\($0)") })
    else { return nil }

    self.url = url
  }

  init?(userInfo: [AnyHashable: Any]) {
    guard let rawValue = userInfo[Self.userInfoKey] as? String else { return nil }
    self.init(rawValue: rawValue)
  }

  var userInfo: [AnyHashable: Any] {
    [Self.userInfoKey: url.absoluteString]
  }

  static let openConversationMessageName = "gvOpenConversation"

  var dispatchUserInfo: [String: Any] {
    [
      "type": Self.openConversationMessageName,
      "url": url.absoluteString,
    ]
  }

  /// The containing app passes `openActionTitle` in its window's language.
  static func notificationCategory(
    openActionTitle: String = "Open Conversation"
  ) -> UNNotificationCategory {
    let openAction = UNNotificationAction(
      identifier: openActionIdentifier,
      title: openActionTitle,
      // The containing app owns Safari notifications so macOS can relaunch it
      // for the response. The handler immediately focuses Safari and hides the
      // app again after this foreground action.
      options: [.foreground]
    )
    return UNNotificationCategory(
      identifier: categoryIdentifier,
      actions: [openAction],
      intentIdentifiers: [],
      options: []
    )
  }
}

/// Shared os_log subsystem for notification click routing. Follow along with:
/// log stream --level debug --predicate 'subsystem == "fun.nagi.voyager.notif"'
enum VoyagerNotifLog {
  static let subsystem = "fun.nagi.voyager.notif"
}

struct VoyagerAppNotification: Equatable {
  let id: String
  let title: String
  let body: String
  let destination: VoyagerNotificationDestination?

  init?(
    id: String,
    title: String,
    body: String,
    destinationURL: String?
  ) {
    guard !id.isEmpty, id.count <= 256,
      !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
      title.count <= 200,
      body.count <= 2_000
    else { return nil }

    let destination: VoyagerNotificationDestination?
    if let destinationURL {
      guard let parsed = VoyagerNotificationDestination(rawValue: destinationURL) else {
        return nil
      }
      destination = parsed
    } else {
      destination = nil
    }

    self.id = id
    self.title = title
    self.body = body
    self.destination = destination
  }
}

/// Typed `gemini-voyager://` handoff used to make the launchable containing
/// app own notifications. Safari's native extension can display a notification
/// but macOS doesn't grant it an execution window for the response callback.
enum VoyagerAppLink {
  static let scheme = "gemini-voyager"
  static let deliverNotificationHost = "deliver-notification"
  private static let payloadQueryItemName = "payload"

  private struct NotificationPayload: Codable {
    let id: String
    let title: String
    let body: String
    let url: String?
  }

  static func deliverNotificationURL(for notification: VoyagerAppNotification) -> URL? {
    let payload = NotificationPayload(
      id: notification.id,
      title: notification.title,
      body: notification.body,
      url: notification.destination?.url.absoluteString
    )
    guard let data = try? JSONEncoder().encode(payload) else { return nil }
    let encoded = data.base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
    return URL(
      string: "\(scheme)://\(deliverNotificationHost)?\(payloadQueryItemName)=\(encoded)"
    )
  }

  static func notificationDelivery(from url: URL) -> VoyagerAppNotification? {
    guard url.scheme?.lowercased() == scheme,
      url.host?.lowercased() == deliverNotificationHost,
      let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
      var encoded = components.queryItems?
        .first(where: { $0.name == payloadQueryItemName })?
        .value
    else { return nil }

    encoded = encoded.replacingOccurrences(of: "-", with: "+")
      .replacingOccurrences(of: "_", with: "/")
    encoded += String(repeating: "=", count: (4 - encoded.count % 4) % 4)
    guard let data = Data(base64Encoded: encoded),
      let payload = try? JSONDecoder().decode(NotificationPayload.self, from: data)
    else { return nil }

    return VoyagerAppNotification(
      id: payload.id,
      title: payload.title,
      body: payload.body,
      destinationURL: payload.url
    )
  }
}

enum VoyagerDiagnosticLevel: String, Codable {
  case ready
  case attention
  case neutral
}

struct VoyagerDiagnosticItem: Codable, Equatable {
  let id: String
  let label: String
  let value: String
  let detail: String
  let level: VoyagerDiagnosticLevel
}

struct VoyagerDiagnosticsSnapshot: Codable, Equatable {
  let items: [VoyagerDiagnosticItem]
}
