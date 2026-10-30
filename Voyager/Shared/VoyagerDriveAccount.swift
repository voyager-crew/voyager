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

  /// Names a stored authorization without revealing its token: one authorization gives the same
  /// name in every process, another authorization a different name.
  static func name(forIdentity identity: String) -> String {
    SHA256.hash(data: Data(identity.utf8)).prefix(16).map { String(format: "%02x", $0) }.joined()
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

/// One Drive transfer action, held to the account it starts under.
struct VoyagerDriveAccountCheck {
  let expected: String?
  /// The stored account when the action starts; nil while nobody is signed in.
  let account: String?

  /// Nil when the session expects another account than the one stored now. A missing stored
  /// account passes, so the action fails as signed out instead.
  init?(expected: String?, current: String?) {
    if let expected, let current, expected != current { return nil }
    self.expected = expected
    self.account = current
  }

  /// What a write's access token must belong to; checked as the token is chosen, so nothing is
  /// written to an account that replaced this one after the action started.
  var writeAccount: String? { expected ?? account }

  /// False when another account was stored while the action ran, so its requests may have
  /// reached two Drives. Signing out is left to the action's own authorization failure.
  func held(byCurrent current: String?) -> Bool {
    current == nil || current == account
  }
}
