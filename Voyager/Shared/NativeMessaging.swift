import Foundation

enum VoyagerNativeRequest: Codable, Equatable {
  case ping
  case deliverNotification(VoyagerNotificationRequest)
  case requestNotificationPermission
  case googleDriveGetSession(interactive: Bool)
  case googleDriveSignOut
  case googleDriveFindFile(fileName: String)
  case googleDriveEnsureFile(VoyagerGoogleDriveEnsureRequest)
  case googleDriveUploadFile(VoyagerGoogleDriveFileRequest)
  case googleDriveDownloadFile(fileID: String)
  case googleDriveGetFileMetadata(fileID: String)
  case googleDriveCreateFile(VoyagerGoogleDriveCreateRequest)
  case googleDriveListHistory(sourceFileName: String)
  case googleDriveTrashFile(fileID: String)
  case iCloudAccountStatus
  case iCloudReadFile(fileName: String)
  case iCloudDeleteBackup
  case iCloudReadUploadVersion(fileName: String)
  case iCloudWriteUpload(VoyagerICloudUploadRequest)
  case iCloudUndoUpload(VoyagerICloudUploadReceipt)
  case iCloudReadHistory(fileName: String, includingHistoryId: String?)
  case iCloudRestoreHistory(VoyagerICloudRestoreHistoryRequest)
  case iCloudPruneHistory(VoyagerICloudPruneHistoryRequest)
  case copyImageToPasteboard(VoyagerClipboardImageRequest)

  var actionName: String {
    switch self {
    case .ping: return Action.ping.rawValue
    case .deliverNotification: return Action.deliverNotification.rawValue
    case .requestNotificationPermission: return Action.requestNotificationPermission.rawValue
    case .googleDriveGetSession: return Action.googleDriveGetSession.rawValue
    case .googleDriveSignOut: return Action.googleDriveSignOut.rawValue
    case .googleDriveFindFile: return Action.googleDriveFindFile.rawValue
    case .googleDriveEnsureFile: return Action.googleDriveEnsureFile.rawValue
    case .googleDriveUploadFile: return Action.googleDriveUploadFile.rawValue
    case .googleDriveDownloadFile: return Action.googleDriveDownloadFile.rawValue
    case .googleDriveGetFileMetadata: return Action.googleDriveGetFileMetadata.rawValue
    case .googleDriveCreateFile: return Action.googleDriveCreateFile.rawValue
    case .googleDriveListHistory: return Action.googleDriveListHistory.rawValue
    case .googleDriveTrashFile: return Action.googleDriveTrashFile.rawValue
    case .iCloudAccountStatus: return Action.iCloudAccountStatus.rawValue
    case .iCloudReadFile: return Action.iCloudReadFile.rawValue
    case .iCloudDeleteBackup: return Action.iCloudDeleteBackup.rawValue
    case .iCloudReadUploadVersion: return Action.iCloudReadUploadVersion.rawValue
    case .iCloudWriteUpload: return Action.iCloudWriteUpload.rawValue
    case .iCloudUndoUpload: return Action.iCloudUndoUpload.rawValue
    case .iCloudReadHistory: return Action.iCloudReadHistory.rawValue
    case .iCloudRestoreHistory: return Action.iCloudRestoreHistory.rawValue
    case .iCloudPruneHistory: return Action.iCloudPruneHistory.rawValue
    case .copyImageToPasteboard: return Action.copyImageToPasteboard.rawValue
    }
  }

  private enum Action: String, Codable {
    case ping
    case deliverNotification
    case requestNotificationPermission
    case googleDriveGetSession
    case googleDriveSignOut
    case googleDriveFindFile
    case googleDriveEnsureFile
    case googleDriveUploadFile
    case googleDriveDownloadFile
    case googleDriveGetFileMetadata
    case googleDriveCreateFile
    case googleDriveListHistory
    case googleDriveTrashFile
    case iCloudAccountStatus
    case iCloudReadFile
    case iCloudDeleteBackup
    case iCloudReadUploadVersion
    case iCloudWriteUpload
    case iCloudUndoUpload
    case iCloudReadHistory
    case iCloudRestoreHistory
    case iCloudPruneHistory
    case copyImageToPasteboard
  }

  private enum CodingKeys: String, CodingKey {
    case action
    case appProperties
    case body
    case cachedFileID
    case fileID
    case fileName
    case id
    case interactive
    case json
    case expectedVersion
    case receipt
    case includingHistoryId
    case historyId
    case historyIds
    case protectedHistoryId
    case pngBase64
    case sourceFileName
    case title
    case url
  }

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    let action = try container.decode(Action.self, forKey: .action)

    switch action {
    case .ping:
      self = .ping
    case .deliverNotification:
      self = .deliverNotification(
        VoyagerNotificationRequest(
          id: try container.decodeIfPresent(String.self, forKey: .id),
          title: try container.decode(String.self, forKey: .title),
          body: try container.decode(String.self, forKey: .body),
          url: try container.decodeIfPresent(String.self, forKey: .url)
        )
      )
    case .requestNotificationPermission:
      self = .requestNotificationPermission
    case .googleDriveGetSession:
      self = .googleDriveGetSession(
        interactive: try container.decodeIfPresent(Bool.self, forKey: .interactive) ?? false
      )
    case .googleDriveSignOut:
      self = .googleDriveSignOut
    case .googleDriveFindFile:
      self = .googleDriveFindFile(
        fileName: try container.decode(String.self, forKey: .fileName)
      )
    case .googleDriveEnsureFile:
      self = .googleDriveEnsureFile(
        VoyagerGoogleDriveEnsureRequest(
          fileName: try container.decode(String.self, forKey: .fileName),
          cachedFileID: try container.decodeIfPresent(String.self, forKey: .cachedFileID)
        )
      )
    case .googleDriveUploadFile:
      self = .googleDriveUploadFile(
        VoyagerGoogleDriveFileRequest(
          fileID: try container.decode(String.self, forKey: .fileID),
          json: try container.decode(String.self, forKey: .json)
        )
      )
    case .googleDriveDownloadFile:
      self = .googleDriveDownloadFile(
        fileID: try container.decode(String.self, forKey: .fileID)
      )
    case .googleDriveGetFileMetadata:
      self = .googleDriveGetFileMetadata(fileID: try container.decode(String.self, forKey: .fileID))
    case .googleDriveCreateFile:
      self = .googleDriveCreateFile(
        VoyagerGoogleDriveCreateRequest(
          fileName: try container.decode(String.self, forKey: .fileName),
          appProperties: try container.decode([String: String].self, forKey: .appProperties),
          json: try container.decode(String.self, forKey: .json)
        )
      )
    case .googleDriveListHistory:
      self = .googleDriveListHistory(
        sourceFileName: try container.decode(String.self, forKey: .sourceFileName)
      )
    case .googleDriveTrashFile:
      self = .googleDriveTrashFile(fileID: try container.decode(String.self, forKey: .fileID))
    case .iCloudAccountStatus:
      self = .iCloudAccountStatus
    case .iCloudReadFile:
      self = .iCloudReadFile(
        fileName: try container.decode(String.self, forKey: .fileName)
      )
    case .iCloudDeleteBackup:
      self = .iCloudDeleteBackup
    case .iCloudReadUploadVersion:
      self = .iCloudReadUploadVersion(
        fileName: try container.decode(String.self, forKey: .fileName))
    case .iCloudWriteUpload:
      self = .iCloudWriteUpload(
        VoyagerICloudUploadRequest(
          fileName: try container.decode(String.self, forKey: .fileName),
          json: try container.decode(String.self, forKey: .json),
          expectedVersion: try container.decode(String?.self, forKey: .expectedVersion)
        )
      )
    case .iCloudUndoUpload:
      self = .iCloudUndoUpload(
        try container.decode(VoyagerICloudUploadReceipt.self, forKey: .receipt).validated()
      )
    case .iCloudReadHistory:
      self = .iCloudReadHistory(
        fileName: try container.decode(String.self, forKey: .fileName),
        includingHistoryId: try container.decodeIfPresent(String.self, forKey: .includingHistoryId))
    case .iCloudRestoreHistory:
      self = .iCloudRestoreHistory(
        VoyagerICloudRestoreHistoryRequest(
          fileName: try container.decode(String.self, forKey: .fileName),
          historyId: try container.decode(String.self, forKey: .historyId),
          expectedVersion: try container.decode(String?.self, forKey: .expectedVersion)))
    case .iCloudPruneHistory:
      self = .iCloudPruneHistory(
        VoyagerICloudPruneHistoryRequest(
          fileName: try container.decode(String.self, forKey: .fileName),
          historyIds: try container.decode([String].self, forKey: .historyIds),
          protectedHistoryId: try container.decodeIfPresent(
            String.self, forKey: .protectedHistoryId)))
    case .copyImageToPasteboard:
      self = .copyImageToPasteboard(
        VoyagerClipboardImageRequest(
          pngBase64: try container.decode(String.self, forKey: .pngBase64)
        )
      )
    }
  }

  func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)

    switch self {
    case .ping:
      try container.encode(Action.ping, forKey: .action)
    case .deliverNotification(let request):
      try container.encode(Action.deliverNotification, forKey: .action)
      try container.encodeIfPresent(request.id, forKey: .id)
      try container.encode(request.title, forKey: .title)
      try container.encode(request.body, forKey: .body)
      try container.encodeIfPresent(request.url, forKey: .url)
    case .requestNotificationPermission:
      try container.encode(Action.requestNotificationPermission, forKey: .action)
    case .googleDriveGetSession(let interactive):
      try container.encode(Action.googleDriveGetSession, forKey: .action)
      try container.encode(interactive, forKey: .interactive)
    case .googleDriveSignOut:
      try container.encode(Action.googleDriveSignOut, forKey: .action)
    case .googleDriveFindFile(let fileName):
      try container.encode(Action.googleDriveFindFile, forKey: .action)
      try container.encode(fileName, forKey: .fileName)
    case .googleDriveEnsureFile(let request):
      try container.encode(Action.googleDriveEnsureFile, forKey: .action)
      try container.encode(request.fileName, forKey: .fileName)
      try container.encodeIfPresent(request.cachedFileID, forKey: .cachedFileID)
    case .googleDriveUploadFile(let request):
      try container.encode(Action.googleDriveUploadFile, forKey: .action)
      try container.encode(request.fileID, forKey: .fileID)
      try container.encode(request.json, forKey: .json)
    case .googleDriveDownloadFile(let fileID):
      try container.encode(Action.googleDriveDownloadFile, forKey: .action)
      try container.encode(fileID, forKey: .fileID)
    case .googleDriveGetFileMetadata(let fileID):
      try container.encode(Action.googleDriveGetFileMetadata, forKey: .action)
      try container.encode(fileID, forKey: .fileID)
    case .googleDriveCreateFile(let request):
      try container.encode(Action.googleDriveCreateFile, forKey: .action)
      try container.encode(request.fileName, forKey: .fileName)
      try container.encode(request.appProperties, forKey: .appProperties)
      try container.encode(request.json, forKey: .json)
    case .googleDriveListHistory(let sourceFileName):
      try container.encode(Action.googleDriveListHistory, forKey: .action)
      try container.encode(sourceFileName, forKey: .sourceFileName)
    case .googleDriveTrashFile(let fileID):
      try container.encode(Action.googleDriveTrashFile, forKey: .action)
      try container.encode(fileID, forKey: .fileID)
    case .iCloudAccountStatus:
      try container.encode(Action.iCloudAccountStatus, forKey: .action)
    case .iCloudReadFile(let fileName):
      try container.encode(Action.iCloudReadFile, forKey: .action)
      try container.encode(fileName, forKey: .fileName)
    case .iCloudDeleteBackup:
      try container.encode(Action.iCloudDeleteBackup, forKey: .action)
    case .iCloudReadUploadVersion(let fileName):
      try container.encode(Action.iCloudReadUploadVersion, forKey: .action)
      try container.encode(fileName, forKey: .fileName)
    case .iCloudWriteUpload(let request):
      try container.encode(Action.iCloudWriteUpload, forKey: .action)
      try container.encode(request.fileName, forKey: .fileName)
      try container.encode(request.json, forKey: .json)
      try container.encode(request.expectedVersion, forKey: .expectedVersion)
    case .iCloudUndoUpload(let receipt):
      try container.encode(Action.iCloudUndoUpload, forKey: .action)
      try container.encode(receipt, forKey: .receipt)
    case .iCloudReadHistory(let fileName, let includingHistoryId):
      try container.encode(Action.iCloudReadHistory, forKey: .action)
      try container.encode(fileName, forKey: .fileName)
      try container.encodeIfPresent(includingHistoryId, forKey: .includingHistoryId)
    case .iCloudRestoreHistory(let request):
      try container.encode(Action.iCloudRestoreHistory, forKey: .action)
      try container.encode(request.fileName, forKey: .fileName)
      try container.encode(request.historyId, forKey: .historyId)
      try container.encode(request.expectedVersion, forKey: .expectedVersion)
    case .iCloudPruneHistory(let request):
      try container.encode(Action.iCloudPruneHistory, forKey: .action)
      try container.encode(request.fileName, forKey: .fileName)
      try container.encode(request.historyIds, forKey: .historyIds)
      try container.encodeIfPresent(request.protectedHistoryId, forKey: .protectedHistoryId)
    case .copyImageToPasteboard(let request):
      try container.encode(Action.copyImageToPasteboard, forKey: .action)
      try container.encode(request.pngBase64, forKey: .pngBase64)
    }
  }
}

struct VoyagerNotificationRequest: Codable, Equatable {
  let id: String?
  let title: String
  let body: String
  let url: String?
}

struct VoyagerClipboardImageRequest: Codable, Equatable {
  let pngBase64: String
}

struct VoyagerGoogleDriveEnsureRequest: Codable, Equatable {
  let fileName: String
  let cachedFileID: String?
}

struct VoyagerGoogleDriveCreateRequest: Codable, Equatable {
  let fileName: String
  let appProperties: [String: String]
  let json: String

  func multipartUpload(parentID: String) throws -> (contentType: String, body: Data) {
    struct Metadata: Encodable {
      let name: String
      let mimeType = "application/json"
      let parents: [String]
      let appProperties: [String: String]
    }
    let boundary = "voyager-history-\(UUID().uuidString)"
    let metadata = try JSONEncoder().encode(
      Metadata(name: fileName, parents: [parentID], appProperties: appProperties)
    )
    var body = Data("--\(boundary)\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n".utf8)
    body.append(metadata)
    body.append(Data("\r\n--\(boundary)\r\nContent-Type: application/json\r\n\r\n".utf8))
    // Keep unknown formats and a UTF-8 BOM byte-for-byte; history is not a parsed backup.
    body.append(Data(json.utf8))
    body.append(Data("\r\n--\(boundary)--\r\n".utf8))
    return ("multipart/related; boundary=\(boundary)", body)
  }
}

struct VoyagerGoogleDriveHistoryFile: Codable, Equatable {
  let fileID: String
  let name: String
  let createdTime: String
}

struct VoyagerGoogleDriveHistoryResponse: Codable {
  let files: [VoyagerGoogleDriveHistoryFile]
}

struct VoyagerGoogleDriveTrashResponse: Codable {
  let trashed: Bool
}

struct VoyagerGoogleDriveFileRequest: Codable, Equatable {
  let fileID: String
  let json: String
}

enum VoyagerGoogleDriveMedia {
  static func decode(_ data: Data) -> String? {
    guard String(data: data, encoding: .utf8) != nil else { return nil }
    // Foundation validates UTF-8 but strips a BOM; Swift decoding preserves the validated bytes.
    return String(decoding: data, as: UTF8.self)
  }
}

struct VoyagerNativeFailure: Codable, Equatable {
  let error: String
  let code: String?
  let retryAfterMs: Int?

  init(error: String, code: String? = nil, retryAfterMs: Int? = nil) {
    self.error = error
    self.code = code
    self.retryAfterMs = retryAfterMs
  }
}

enum VoyagerNativeResponse<Payload: Codable>: Codable {
  case success(Payload)
  case failure(VoyagerNativeFailure)

  private enum CodingKeys: String, CodingKey {
    case success
    case data
    case error
    case code
    case retryAfterMs
  }

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    if try container.decode(Bool.self, forKey: .success) {
      self = .success(try container.decode(Payload.self, forKey: .data))
    } else {
      self = .failure(
        VoyagerNativeFailure(
          error: try container.decode(String.self, forKey: .error),
          code: try container.decodeIfPresent(String.self, forKey: .code),
          retryAfterMs: try container.decodeIfPresent(Int.self, forKey: .retryAfterMs)
        )
      )
    }
  }

  func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)

    switch self {
    case .success(let payload):
      try container.encode(true, forKey: .success)
      try container.encode(payload, forKey: .data)
    case .failure(let failure):
      try container.encode(false, forKey: .success)
      try container.encode(failure.error, forKey: .error)
      try container.encodeIfPresent(failure.code, forKey: .code)
      try container.encodeIfPresent(failure.retryAfterMs, forKey: .retryAfterMs)
    }
  }
}

enum VoyagerNativeMessageCodec {
  static func decodeRequest(from message: [String: Any]) throws -> VoyagerNativeRequest {
    let data = try JSONSerialization.data(withJSONObject: message)
    return try JSONDecoder().decode(VoyagerNativeRequest.self, from: data)
  }

  static func encodeResponse<Payload: Codable>(
    _ response: VoyagerNativeResponse<Payload>
  ) throws -> [String: Any] {
    let data = try JSONEncoder().encode(response)
    guard let message = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
      throw VoyagerNativeMessageCodecError.invalidResponse
    }
    return message
  }
}

private enum VoyagerNativeMessageCodecError: Error {
  case invalidResponse
}

struct VoyagerPingResponse: Codable {
  let status: String
}

struct VoyagerNotificationDeliveryResponse: Codable {
  let delivered: Bool
}

struct VoyagerNotificationPermissionResponse: Codable {
  let granted: Bool
}

struct VoyagerGoogleDriveSessionResponse: Codable {
  let signedIn: Bool
  let requiresAppLaunch: Bool?

  init(
    signedIn: Bool,
    requiresAppLaunch: Bool? = nil
  ) {
    self.signedIn = signedIn
    self.requiresAppLaunch = requiresAppLaunch
  }
}

struct VoyagerGoogleDriveSignOutResponse: Codable {
  let signedOut: Bool
}

struct VoyagerGoogleDriveFileResponse: Codable {
  let fileID: String?
}

struct VoyagerGoogleDriveUploadResponse: Codable {
  let saved: Bool
}

struct VoyagerGoogleDriveDownloadResponse: Codable {
  let json: String?
  let found: Bool
}

struct VoyagerICloudAccountResponse: Codable {
  let available: Bool
}

struct VoyagerClipboardWriteResponse: Codable {
  let copied: Bool
}

struct VoyagerICloudReadResponse: Codable {
  let json: String?
  let found: Bool
}

struct VoyagerICloudDeleteResponse: Codable {
  let deleted: Int
  let errors: [VoyagerICloudDeleteIssue]
}

struct VoyagerEmptyResponse: Codable {}
