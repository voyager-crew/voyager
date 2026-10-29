//
//  SafariWebExtensionHandler.swift
//  Voyager Extension
//

import AppKit
import SafariServices
import os.log

final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
  func beginRequest(with context: NSExtensionContext) {
    guard let request = context.inputItems.first as? NSExtensionItem,
      let message = extensionMessage(from: request)
    else {
      respondWithError(context: context, message: "Invalid message")
      return
    }

    let nativeRequest: VoyagerNativeRequest
    do {
      nativeRequest = try VoyagerNativeMessageCodec.decodeRequest(from: message)
    } catch {
      respondWithError(context: context, message: "Invalid native message")
      return
    }

    os_log(.info, "Safari native action: %{public}@", nativeRequest.actionName)

    switch nativeRequest {
    case .ping:
      respondWithSuccess(context: context, data: VoyagerPingResponse(status: "ok"))
    case .deliverNotification(let request):
      deliverNotification(request: request, context: context)
    case .requestNotificationPermission:
      requestNotificationPermission(context: context)
    case .googleDriveGetSession(let interactive):
      getGoogleDriveSession(interactive: interactive, context: context)
    case .googleDriveSignOut:
      signOutGoogleDrive(context: context)
    case .googleDriveFindFile(let fileName):
      findGoogleDriveFile(fileName: fileName, context: context)
    case .googleDriveEnsureFile(let request):
      ensureGoogleDriveFile(request: request, context: context)
    case .googleDriveUploadFile(let request):
      uploadGoogleDriveFile(request: request, context: context)
    case .googleDriveDownloadFile(let fileID):
      downloadGoogleDriveFile(fileID: fileID, context: context)
    case .googleDriveCreateFile(let request):
      createGoogleDriveFile(request: request, context: context)
    case .googleDriveListHistory(let sourceFileName):
      listGoogleDriveHistory(sourceFileName: sourceFileName, context: context)
    case .googleDriveTrashFile(let fileID):
      trashGoogleDriveFile(fileID: fileID, context: context)
    case .iCloudAccountStatus:
      handleICloudAccountStatus(context: context)
    case .iCloudWriteFile(let request):
      writeICloudFile(request: request, context: context)
    case .iCloudReadFile(let fileName):
      readICloudFile(fileName: fileName, context: context)
    case .iCloudDeleteBackup:
      deleteICloudBackup(context: context)
    case .copyImageToPasteboard(let request):
      copyImageToPasteboard(request: request, context: context)
    }
  }

  private func copyImageToPasteboard(
    request: VoyagerClipboardImageRequest,
    context: NSExtensionContext
  ) {
    guard let imageData = Data(base64Encoded: request.pngBase64), !imageData.isEmpty else {
      respondWithError(context: context, message: "Invalid image data")
      return
    }

    DispatchQueue.main.async {
      let pasteboard = NSPasteboard.general
      pasteboard.clearContents()
      let copied = pasteboard.setData(imageData, forType: .png)
      self.respondWithSuccess(
        context: context,
        data: VoyagerClipboardWriteResponse(copied: copied)
      )
    }
  }

  private func handleICloudAccountStatus(context: NSExtensionContext) {
    ICloudSyncService.shared.accountStatus { result in
      switch result {
      case .success:
        self.respondWithSuccess(
          context: context,
          data: VoyagerICloudAccountResponse(available: true)
        )
      case .failure(let error):
        self.respondWithICloudError(context: context, error: error)
      }
    }
  }

  private func writeICloudFile(
    request: VoyagerICloudWriteRequest,
    context: NSExtensionContext
  ) {
    ICloudSyncService.shared.write(fileName: request.fileName, json: request.json) { result in
      switch result {
      case .success:
        self.respondWithSuccess(
          context: context,
          data: VoyagerICloudWriteResponse(saved: true)
        )
      case .failure(let error):
        self.respondWithICloudError(context: context, error: error)
      }
    }
  }

  private func readICloudFile(fileName: String, context: NSExtensionContext) {
    ICloudSyncService.shared.read(fileName: fileName) { result in
      switch result {
      case .success(let json):
        self.respondWithSuccess(
          context: context,
          data: VoyagerICloudReadResponse(json: json, found: json != nil)
        )
      case .failure(let error):
        self.respondWithICloudError(context: context, error: error)
      }
    }
  }

  private func deleteICloudBackup(context: NSExtensionContext) {
    ICloudSyncService.shared.deleteBackup { result in
      switch result {
      case .success(let deleted):
        self.respondWithSuccess(
          context: context,
          data: VoyagerICloudDeleteResponse(deleted: deleted)
        )
      case .failure(let error):
        self.respondWithICloudError(context: context, error: error)
      }
    }
  }

  private func respondWithICloudError(context: NSExtensionContext, error: Error) {
    guard let failure = error as? VoyagerICloudFailure else {
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

  private func respondWithGoogleDriveError(context: NSExtensionContext, error: Error) {
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
        self.respondWithSuccess(
          context: context,
          data: VoyagerGoogleDriveSessionResponse(signedIn: true)
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

  private func findGoogleDriveFile(fileName: String, context: NSExtensionContext) {
    GoogleDriveService.shared.findFile(named: fileName) { result in
      switch result {
      case .success(let fileID):
        self.respondWithSuccess(
          context: context,
          data: VoyagerGoogleDriveFileResponse(fileID: fileID)
        )
      case .failure(let error):
        self.respondWithGoogleDriveError(context: context, error: error)
      }
    }
  }

  private func ensureGoogleDriveFile(
    request: VoyagerGoogleDriveEnsureRequest,
    context: NSExtensionContext
  ) {
    GoogleDriveService.shared.ensureFile(
      named: request.fileName,
      cachedFileID: request.cachedFileID
    ) { result in
      switch result {
      case .success(let fileID):
        self.respondWithSuccess(
          context: context,
          data: VoyagerGoogleDriveFileResponse(fileID: fileID)
        )
      case .failure(let error):
        self.respondWithGoogleDriveError(context: context, error: error)
      }
    }
  }

  private func uploadGoogleDriveFile(
    request: VoyagerGoogleDriveFileRequest,
    context: NSExtensionContext
  ) {
    GoogleDriveService.shared.upload(fileID: request.fileID, json: request.json) { result in
      switch result {
      case .success:
        self.respondWithSuccess(
          context: context,
          data: VoyagerGoogleDriveUploadResponse(saved: true)
        )
      case .failure(let error):
        self.respondWithGoogleDriveError(context: context, error: error)
      }
    }
  }

  private func downloadGoogleDriveFile(fileID: String, context: NSExtensionContext) {
    GoogleDriveService.shared.download(fileID: fileID) { result in
      switch result {
      case .success(let json):
        self.respondWithSuccess(
          context: context,
          data: VoyagerGoogleDriveDownloadResponse(json: json, found: json != nil)
        )
      case .failure(let error):
        self.respondWithGoogleDriveError(context: context, error: error)
      }
    }
  }

  private func createGoogleDriveFile(
    request: VoyagerGoogleDriveCreateRequest,
    context: NSExtensionContext
  ) {
    GoogleDriveService.shared.createFile(
      named: request.fileName,
      appProperties: request.appProperties,
      json: request.json
    ) { result in
      switch result {
      case .success(let file):
        self.respondWithSuccess(context: context, data: file)
      case .failure(let error):
        self.respondWithGoogleDriveError(context: context, error: error)
      }
    }
  }

  private func listGoogleDriveHistory(sourceFileName: String, context: NSExtensionContext) {
    GoogleDriveService.shared.listHistory(sourceFileName: sourceFileName) { result in
      switch result {
      case .success(let files):
        self.respondWithSuccess(
          context: context,
          data: VoyagerGoogleDriveHistoryResponse(files: files)
        )
      case .failure(let error):
        self.respondWithGoogleDriveError(context: context, error: error)
      }
    }
  }

  private func trashGoogleDriveFile(fileID: String, context: NSExtensionContext) {
    GoogleDriveService.shared.trashFile(fileID: fileID) { result in
      switch result {
      case .success:
        self.respondWithSuccess(
          context: context,
          data: VoyagerGoogleDriveTrashResponse(trashed: true)
        )
      case .failure(let error):
        self.respondWithGoogleDriveError(context: context, error: error)
      }
    }
  }

  private func deliverNotification(
    request: VoyagerNotificationRequest,
    context: NSExtensionContext
  ) {
    NativeNotificationService.shared.deliver(
      id: request.id ?? UUID().uuidString,
      title: request.title,
      body: request.body,
      destination: request.url.flatMap {
        VoyagerNotificationDestination(rawValue: $0)
      }
    ) { result in
      switch result {
      case .success:
        self.respondWithSuccess(
          context: context,
          data: VoyagerNotificationDeliveryResponse(delivered: true)
        )
      case .failure(let error):
        self.respondWithError(context: context, message: error.localizedDescription)
      }
    }
  }

  private func requestNotificationPermission(context: NSExtensionContext) {
    NativeNotificationService.shared.requestAuthorization { result in
      switch result {
      case .success(let granted):
        self.respondWithSuccess(
          context: context,
          data: VoyagerNotificationPermissionResponse(granted: granted)
        )
      case .failure(let error):
        self.respondWithError(context: context, message: error.localizedDescription)
      }
    }
  }

  private func extensionMessage(from request: NSExtensionItem) -> [String: Any]? {
    if #available(macOS 11.0, *) {
      return request.userInfo?[SFExtensionMessageKey] as? [String: Any]
    }
    return request.userInfo?["message"] as? [String: Any]
  }

  private func respondWithSuccess<Payload: Codable>(
    context: NSExtensionContext,
    data: Payload
  ) {
    respond(context: context, response: VoyagerNativeResponse.success(data))
  }

  private func respondWithError(context: NSExtensionContext, message: String) {
    respondWithError(context: context, failure: VoyagerNativeFailure(error: message))
  }

  private func respondWithError(context: NSExtensionContext, failure: VoyagerNativeFailure) {
    respond(
      context: context,
      response: VoyagerNativeResponse<VoyagerEmptyResponse>.failure(failure)
    )
  }

  private func respond<Payload: Codable>(
    context: NSExtensionContext,
    response nativeResponse: VoyagerNativeResponse<Payload>
  ) {
    guard let message = try? VoyagerNativeMessageCodec.encodeResponse(nativeResponse) else {
      context.cancelRequest(withError: VoyagerNativeHandlerError.responseEncodingFailed)
      return
    }

    let response = NSExtensionItem()
    if #available(macOS 11.0, *) {
      response.userInfo = [SFExtensionMessageKey: message]
    } else {
      response.userInfo = ["message": message]
    }
    context.completeRequest(returningItems: [response])
  }
}

private enum VoyagerNativeHandlerError: LocalizedError {
  case responseEncodingFailed

  var errorDescription: String? {
    "Could not encode the native response"
  }
}
