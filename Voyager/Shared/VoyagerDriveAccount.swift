import CryptoKit
import Foundation

/// Which Google account the Safari extension's Drive requests run under, as the web extension
/// sees it. A sync session binds its transfers to the account its first answer named, so an
/// account changed in the app during a transfer cannot mix two Drives in one sync.
enum VoyagerDriveAccount {
  /// Request key: the account the request's sync session is bound to.
  static let expectedKey = "expectedDriveAccount"
  /// Response key: the account that served the request.
  static let responseKey = "driveAccount"

  /// Names a Google account without revealing it. The same account has the same name in every
  /// process and after it signs in again, so an upload's Undo can still find it; another account
  /// has another name. Without a user ID, which GoogleSignIn stores with each sign-in, the
  /// authorization itself stands in for the account.
  static func name(userID: String?, authorization: String) -> String {
    let identity = userID.map { "user:\($0)" } ?? "authorization:\(authorization)"
    return SHA256.hash(data: Data(identity.utf8)).prefix(16)
      .map { String(format: "%02x", $0) }.joined()
  }

  struct InvalidExpectation: Error {}

  /// The account a request expects, or nil before its session has bound one.
  static func expected(in message: [String: Any]) throws -> String? {
    switch message[expectedKey] {
    case nil: return nil
    case let name as String where !name.isEmpty: return name
    default: throw InvalidExpectation()
    }
  }
}

/// The Google account every Drive request of one action runs under.
///
/// An action starts in the account its sync session expects, which must still be the one the app
/// stores. Every request the action makes, reads and writes alike, takes this scope and is sent
/// only with a token of that account, so an account the app stores later is refused instead of
/// used. The scope also records whether the action has sent a write, so a refusal can tell the web
/// extension whether anything may have reached Drive.
final class VoyagerDriveAccountScope {
  let account: String
  private let lock = NSLock()
  private var sentWrite = false

  init(account: String) {
    self.account = account
  }

  /// The scope of an action whose session expects `expected` while the app stores `current`. Nil
  /// while nobody is signed in, so the action fails as signed out; throws when the session expects
  /// another account than the stored one, before the action sends anything.
  static func forAction(expected: String?, current: String?) throws -> VoyagerDriveAccountScope? {
    guard let current else { return nil }
    if let expected, expected != current { throw VoyagerGoogleDriveFailure.accountChanged }
    return VoyagerDriveAccountScope(account: current)
  }

  /// Whether a request may use the authorization stored now, which belongs to `storedAccount`.
  /// No stored authorization passes, so the request fails as signed out.
  func admits(storedAccount: String?) -> Bool {
    storedAccount == nil || storedAccount == account
  }

  /// Records a request that can change Drive, just before it leaves.
  func recordWrite() {
    lock.lock()
    sentWrite = true
    lock.unlock()
  }

  /// What a request this scope does not admit answers.
  var refusal: VoyagerGoogleDriveFailure {
    lock.lock()
    defer { lock.unlock() }
    return sentWrite ? .accountChangedAfterWrite : .accountChanged
  }
}
