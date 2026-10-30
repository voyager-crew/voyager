import Foundation

/// Drive actions. A sync session binds its transfers to one Google account (`VoyagerDriveAccount`):
/// each transfer action runs in a `VoyagerDriveAccountScope` of that account, so every request it
/// makes is refused once the app stores another account, and its answer names the account.
extension SafariWebExtensionHandler {
  func handleGoogleDrive(
    _ request: VoyagerNativeRequest,
    message: [String: Any],
    context: NSExtensionContext
  ) {
    switch request {
    case .googleDriveGetSession(let interactive):
      getGoogleDriveSession(interactive: interactive, context: context)
      return
    case .googleDriveSignOut:
      signOutGoogleDrive(context: context)
      return
    default:
      break
    }

    let service = GoogleDriveService.shared
    let scope: VoyagerDriveAccountScope
    do {
      guard
        let started = try VoyagerDriveAccountScope.forAction(
          expected: VoyagerDriveAccount.expected(in: message),
          current: service.currentDriveAccount())
      else {
        respondWithGoogleDriveError(context: context, error: service.signedOutFailure())
        return
      }
      scope = started
    } catch let failure as VoyagerGoogleDriveFailure {
      respondWithGoogleDriveError(context: context, error: failure)
      return
    } catch {
      respondWithError(context: context, message: "Invalid native message")
      return
    }
    let reply = GoogleDriveTransferReply(handler: self, context: context, account: scope.account)

    switch request {
    case .googleDriveFindFile(let fileName):
      service.findFile(named: fileName, in: scope) {
        reply.finish($0.map { VoyagerGoogleDriveFileResponse(fileID: $0) })
      }
    case .googleDriveEnsureFile(let ensure):
      service.ensureFile(named: ensure.fileName, cachedFileID: ensure.cachedFileID, in: scope) {
        reply.finish($0.map { VoyagerGoogleDriveFileResponse(fileID: $0) })
      }
    case .googleDriveUploadFile(let upload):
      service.upload(fileID: upload.fileID, json: upload.json, in: scope) {
        reply.finish($0.map { VoyagerGoogleDriveUploadMetadataResponse($0) })
      }
    case .googleDriveDownloadFile(let fileID):
      service.download(fileID: fileID, in: scope) {
        reply.finish($0.map { VoyagerGoogleDriveDownloadResponse(json: $0, found: $0 != nil) })
      }
    case .googleDriveGetFileMetadata(let fileID):
      service.fileMetadata(fileID: fileID, in: scope) { reply.finish($0) }
    case .googleDriveCreateFile(let create):
      service.createFile(
        named: create.fileName,
        appProperties: create.appProperties,
        json: create.json,
        in: scope
      ) { reply.finish($0) }
    case .googleDriveListHistory(let sourceFileName):
      service.listHistory(sourceFileName: sourceFileName, in: scope) {
        reply.finish($0.map { VoyagerGoogleDriveHistoryResponse(files: $0) })
      }
    case .googleDriveTrashFile(let fileID):
      service.trashFile(fileID: fileID, in: scope) {
        reply.finish($0.map { VoyagerGoogleDriveTrashResponse(trashed: true) })
      }
    default:
      respondWithError(context: context, message: "Invalid native message")
    }
  }

  func respondWithGoogleDriveError(context: NSExtensionContext, error: Error) {
    guard let failure = error as? VoyagerGoogleDriveFailure else {
      respondWithError(context: context, message: error.localizedDescription)
      return
    }

    respondWithError(
      context: context,
      failure: VoyagerNativeFailure(
        error: failure.localizedDescription,
        code: failure.code.rawValue,
        retryAfterMs: failure.retryAfterMilliseconds
      )
    )
  }

  private func getGoogleDriveSession(
    interactive: Bool,
    context: NSExtensionContext
  ) {
    GoogleDriveService.shared.authorizationState(interactive: interactive) { result in
      switch result {
      case .failure(let error):
        self.respondWithGoogleDriveError(context: context, error: error)
      case .success(.signedIn):
        // Naming the account lets a popup that returns after a change of account end the sync
        // session bound to the previous one.
        self.respondWithSuccess(
          context: context,
          data: VoyagerGoogleDriveSessionResponse(
            signedIn: true,
            signedInAt: VoyagerSharedState.keychain.googleDriveSignedInAt
          ),
          driveAccount: GoogleDriveService.shared.currentDriveAccount()
        )
      case .success(.signedOut):
        self.respondWithSuccess(
          context: context,
          data: VoyagerGoogleDriveSessionResponse(signedIn: false)
        )
      case .success(.requiresAppLaunch):
        self.respondWithSuccess(
          context: context,
          data: VoyagerGoogleDriveSessionResponse(
            signedIn: false,
            requiresAppLaunch: true
          )
        )
      }
    }
  }

  private func signOutGoogleDrive(context: NSExtensionContext) {
    GoogleDriveService.shared.signOut { result in
      switch result {
      case .success:
        self.respondWithSuccess(
          context: context,
          data: VoyagerGoogleDriveSignOutResponse(signedOut: true)
        )
      case .failure(let error):
        self.respondWithGoogleDriveError(context: context, error: error)
      }
    }
  }
}

/// Answers one Drive transfer action. Every request it made ran in its scope, so a success is
/// that account's alone, even when the app stored another account just after the last request.
private struct GoogleDriveTransferReply {
  let handler: SafariWebExtensionHandler
  let context: NSExtensionContext
  let account: String

  func finish<Payload: Codable>(_ result: Result<Payload, Error>) {
    switch result {
    case .success(let data):
      handler.respondWithSuccess(context: context, data: data, driveAccount: account)
    case .failure(let error):
      handler.respondWithGoogleDriveError(context: context, error: error)
    }
  }
}
