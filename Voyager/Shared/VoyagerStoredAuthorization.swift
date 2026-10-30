import Foundation

/// The Google Drive authorization the app stored when someone signed in, as the Safari extension
/// reads it back from the keychain they share.
struct VoyagerStoredAuthorization<Authorization> {
  /// Changes whenever the stored authorization does: another account, or a new sign-in.
  let identity: String
  let authorization: Authorization
}

/// Keeps the Safari extension on the authorization the app stored last.
///
/// GoogleSignIn keeps the first user it restores for the life of the process and returns it again
/// even after the app has stored another account, so the extension reads the stored authorization
/// itself before every request. It keeps its own copy, whose tokens it refreshes in memory, only
/// while the stored one is unchanged, and never writes the shared authorization back.
final class VoyagerStoredAuthorizationTracker<Authorization> {
  enum Lookup {
    /// The copy in use, with the tokens it has refreshed since.
    case unchanged(Authorization)
    /// The app stored a different authorization; anything tied to the previous one is stale.
    case replaced(Authorization)
    case signedOut
  }

  private let lock = NSLock()
  private var current: VoyagerStoredAuthorization<Authorization>?

  /// `stored` is what the keychain holds now, nil when nobody is signed in.
  func lookup(_ stored: VoyagerStoredAuthorization<Authorization>?) -> Lookup {
    lock.lock()
    defer { lock.unlock() }
    guard let stored else {
      current = nil
      return .signedOut
    }
    if let current, current.identity == stored.identity {
      return .unchanged(current.authorization)
    }
    current = stored
    return .replaced(stored.authorization)
  }

  func forget() {
    lock.lock()
    current = nil
    lock.unlock()
  }
}
