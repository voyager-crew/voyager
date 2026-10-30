import AppAuthCore
import Foundation
import GTMAppAuth
import GoogleSignIn
import os.log

/// Owns the Google authorization behind every Drive request and sign-out.
extension GoogleDriveService {
  /// Where GoogleSignIn keeps its authorization. The app writes it when someone signs in; the
  /// extension reads it through the keychain access group they share.
  private static let sharedAuthorizationItemName = "auth"

  func authorizationState(
    interactive: Bool,
    completion: @escaping (Result<AuthorizationState, Error>) -> Void
  ) {
    withAccessToken { result in
      switch result {
      case .success:
        completion(.success(.signedIn))
      case .failure(let error as VoyagerGoogleDriveFailure) where error.code == .authRequired:
        completion(.success(interactive ? .requiresAppLaunch : .signedOut))
      case .failure(let error):
        completion(.failure(error))
      }
    }
  }

  func signOut(completion: @escaping (Result<Void, Error>) -> Void) {
    backupFolderID = nil
    authorizations.forget()
    _ = configureGoogleSignIn()
    // Only sign-out restores a GoogleSignIn user in this process, and it always ends cleared, so
    // the restore reads what the app stored last and the revocation reaches that account.
    GIDSignIn.sharedInstance.restorePreviousSignIn { user, _ in
      guard user != nil else {
        GIDSignIn.sharedInstance.signOut()
        completion(.success(()))
        return
      }
      GIDSignIn.sharedInstance.disconnect { error in
        if let error {
          os_log(
            .error,
            "Google Drive revocation failed; completing local sign-out: %{public}@",
            error.localizedDescription
          )
          GIDSignIn.sharedInstance.signOut()
        }
        completion(.success(()))
      }
    }
  }

  /// The account the app stores now, as the web extension names it; nil while signed out.
  func currentDriveAccount() -> String? {
    Self.storedAuthorization().map { VoyagerDriveAccount.name(forIdentity: $0.identity) }
  }

  /// This process can outlive a sign-in the app completes later, such as a changed account, and
  /// GoogleSignIn would keep answering with the user it restored first. Each request therefore
  /// starts from the authorization the app stored, so Drive never keeps the account left behind.
  /// With `expectedAccount`, a token of any other account is refused instead of used.
  func withAccessToken(
    expectedAccount: String? = nil,
    completion: @escaping (Result<String, Error>) -> Void
  ) {
    guard configureGoogleSignIn() else {
      completion(.failure(GoogleDriveServiceError.notConfigured))
      return
    }

    let stored = Self.storedAuthorization()
    if let expectedAccount, let stored,
      VoyagerDriveAccount.name(forIdentity: stored.identity) != expectedAccount
    {
      completion(.failure(VoyagerGoogleDriveFailure.accountChanged))
      return
    }
    switch authorizations.lookup(stored) {
    case .signedOut:
      completion(.failure(VoyagerGoogleDriveFailure.authRequired))
    case .replaced(let authState):
      // The previous account's folder is invisible to a new one; resolve it again.
      backupFolderID = nil
      freshAccessToken(from: authState, completion: completion)
    case .unchanged(let authState):
      freshAccessToken(from: authState, completion: completion)
    }
  }

  private static func storedAuthorization() -> VoyagerStoredAuthorization<OIDAuthState>? {
    let store = KeychainStore(itemName: sharedAuthorizationItemName)
    guard let authState = try? store.retrieveAuthSession().authState,
      let refreshToken = authState.refreshToken
    else { return nil }
    return VoyagerStoredAuthorization(identity: refreshToken, authorization: authState)
  }

  private func freshAccessToken(
    from authState: OIDAuthState,
    completion: @escaping (Result<String, Error>) -> Void
  ) {
    authState.performAction { accessToken, _, error in
      if let error {
        completion(
          .failure(
            VoyagerGoogleDriveAuthErrorClassifier.isPermanentAuthFailure(error)
              ? VoyagerGoogleDriveFailure.authRequired
              : error
          )
        )
        return
      }
      // Read the way GIDGoogleUser.grantedScopes does: the token response's scope is authoritative.
      let grantedScopes = authState.lastTokenResponse?.scope?.split(separator: " ") ?? []
      guard let accessToken, grantedScopes.contains(Substring(self.scope)) else {
        completion(.failure(VoyagerGoogleDriveFailure.authRequired))
        return
      }
      completion(.success(accessToken))
    }
  }

  func configureGoogleSignIn() -> Bool {
    guard let clientID = Bundle.main.object(forInfoDictionaryKey: "GIDClientID") as? String,
      !clientID.isEmpty
    else { return false }
    GIDSignIn.sharedInstance.configuration = GIDConfiguration(clientID: clientID)
    return true
  }
}
