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
    // The one token request outside an action's scope: it asks whether any account is signed in,
    // reads nothing from Drive and writes nothing to it.
    accessToken(admitting: nil) { result in
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
    folderCache.removeAll()
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
    Self.storedAuthorization()?.account
  }

  /// What a Drive action answers when nobody was signed in as it started.
  func signedOutFailure() -> Error {
    configureGoogleSignIn()
      ? VoyagerGoogleDriveFailure.authRequired : GoogleDriveServiceError.notConfigured
  }

  /// This process can outlive a sign-in the app completes later, such as a changed account, and
  /// GoogleSignIn would keep answering with the user it restored first. Each request therefore
  /// starts from the authorization the app stored, and a token of any other account than the
  /// scope's is refused instead of used.
  func withAccessToken(
    in scope: VoyagerDriveAccountScope,
    completion: @escaping (Result<String, Error>) -> Void
  ) {
    accessToken(admitting: scope, completion: completion)
  }

  private func accessToken(
    admitting scope: VoyagerDriveAccountScope?,
    completion: @escaping (Result<String, Error>) -> Void
  ) {
    guard configureGoogleSignIn() else {
      completion(.failure(GoogleDriveServiceError.notConfigured))
      return
    }

    let stored = Self.storedAuthorization()
    if let scope, !scope.admits(storedAccount: stored?.account) {
      completion(.failure(scope.refusal))
      return
    }
    // Each account keeps its own backup folder, so a replaced authorization needs no cleanup here.
    switch authorizations.lookup(stored) {
    case .signedOut:
      completion(.failure(VoyagerGoogleDriveFailure.authRequired))
    case .replaced(let authState), .unchanged(let authState):
      freshAccessToken(from: authState, completion: completion)
    }
  }

  private static func storedAuthorization() -> VoyagerStoredAuthorization<OIDAuthState>? {
    let store = KeychainStore(itemName: sharedAuthorizationItemName)
    guard let session = try? store.retrieveAuthSession(),
      let refreshToken = session.authState.refreshToken
    else { return nil }
    return VoyagerStoredAuthorization(
      identity: refreshToken,
      account: VoyagerDriveAccount.name(userID: session.userID, authorization: refreshToken),
      authorization: session.authState
    )
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
