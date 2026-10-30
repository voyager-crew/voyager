import Foundation
import GoogleSignIn
import os.log

final class GoogleDriveService {
  static let shared = GoogleDriveService()

  private let scope = "https://www.googleapis.com/auth/drive.file"
  private let apiHost = "www.googleapis.com"
  var backupFolderID: String?
  let backupFolderResolutionLock = NSLock()
  var backupFolderResolutionInFlight = false
  var backupFolderResolutionWaiters: [
    (Result<String, Error>) -> Void
  ] = []
  private let restoredSignInLock = NSLock()
  /// The app sign-in the restored Google user came from; see `withAccessToken`.
  private var restoredSignInAt: Int64?

  enum AuthorizationState {
    case signedIn
    case signedOut
    case requiresAppLaunch
  }

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
    guard GIDSignIn.sharedInstance.hasPreviousSignIn() else {
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

  func findFile(
    named fileName: String,
    completion: @escaping (Result<String?, Error>) -> Void
  ) {
    migrateBackupFolderIfPresent {
      self.findFileInResolvedFolder(named: fileName, completion: completion)
    }
  }

  private func findFileInResolvedFolder(
    named fileName: String,
    completion: @escaping (Result<String?, Error>) -> Void
  ) {
    guard let backupFolderID else {
      findItem(
        named: fileName,
        mimeType: nil,
        fields: "files(id,name)",
        completion: completion
      )
      return
    }

    findItem(
      clauses: [
        "name='\(escapeQueryValue(fileName))'",
        "'\(escapeQueryValue(backupFolderID))' in parents",
        "trashed=false",
      ],
      fields: "files(id,name)"
    ) { scopedResult in
      switch scopedResult {
      case .failure(let error):
        completion(.failure(error))
      case .success(let fileID?):
        completion(.success(fileID))
      case .success(nil):
        // Older versions searched globally and may have left a sync file in a
        // previous folder. Keep one global fallback so it can be recovered and
        // moved into the resolved folder by ensureFile.
        self.findItem(
          named: fileName,
          mimeType: nil,
          fields: "files(id,name)",
          completion: completion
        )
      }
    }
  }

  func ensureFile(
    named fileName: String,
    cachedFileID: String?,
    completion: @escaping (Result<String, Error>) -> Void
  ) {
    ensureBackupFolder { folderResult in
      switch folderResult {
      case .failure(let error):
        completion(.failure(error))
      case .success(let folderID):
        self.resolveFile(
          named: fileName,
          cachedFileID: cachedFileID,
          folderID: folderID,
          completion: completion
        )
      }
    }
  }

  func upload(
    fileID: String,
    json: String,
    completion: @escaping (Result<VoyagerGoogleDriveMetadataResponse, Error>) -> Void
  ) {
    performRequest(
      method: "PATCH",
      path: "/upload/drive/v3/files/\(fileID)",
      queryItems: [
        URLQueryItem(name: "uploadType", value: "media"),
        URLQueryItem(name: "fields", value: "id,md5Checksum,modifiedTime"),
      ],
      contentType: "application/json",
      body: Data(json.utf8)
    ) { result in
      switch result {
      case .failure(let error):
        completion(.failure(error))
      case .success(let response):
        guard response.isSuccessful else {
          completion(.failure(self.requestFailure(response)))
          return
        }
        do {
          let metadata = try JSONDecoder().decode(DriveUploadMetadata.self, from: response.data)
          completion(.success(VoyagerGoogleDriveMetadataResponse(
            found: true, id: metadata.id, md5Checksum: metadata.md5Checksum,
            modifiedTime: metadata.modifiedTime
          )))
        } catch {
          // The media write succeeded. Missing receipt fields must never retry that write.
          completion(.success(VoyagerGoogleDriveMetadataResponse(
            found: true, id: nil, md5Checksum: nil, modifiedTime: nil
          )))
        }
      }
    }
  }

  func download(
    fileID: String,
    completion: @escaping (Result<String?, Error>) -> Void
  ) {
    performRequest(
      method: "GET",
      path: "/drive/v3/files/\(fileID)",
      queryItems: [URLQueryItem(name: "alt", value: "media")]
    ) { result in
      switch result {
      case .failure(let error):
        completion(.failure(error))
      case .success(let response) where response.statusCode == 404:
        completion(.success(nil))
      case .success(let response):
        guard response.isSuccessful,
          let json = VoyagerGoogleDriveMedia.decode(response.data)
        else {
          completion(.failure(self.requestFailure(response)))
          return
        }
        completion(.success(json))
      }
    }
  }

  private func resolveFile(
    named fileName: String,
    cachedFileID: String?,
    folderID: String,
    completion: @escaping (Result<String, Error>) -> Void
  ) {
    guard let cachedFileID else {
      findOrCreateFile(named: fileName, folderID: folderID, completion: completion)
      return
    }

    getFileParents(fileID: cachedFileID) { result in
      switch result {
      case .failure(let error):
        completion(.failure(error))
      case .success(nil):
        self.findOrCreateFile(named: fileName, folderID: folderID, completion: completion)
      case .success(let parents?):
        self.moveIfNeeded(fileID: cachedFileID, parents: parents, folderID: folderID) { moveResult in
          switch moveResult {
          case .failure(let error):
            completion(.failure(error))
          case .success:
            completion(.success(cachedFileID))
          }
        }
      }
    }
  }

  private func findOrCreateFile(
    named fileName: String,
    folderID: String,
    completion: @escaping (Result<String, Error>) -> Void
  ) {
    findFile(named: fileName) { result in
      switch result {
      case .failure(let error):
        completion(.failure(error))
      case .success(nil):
        self.createItem(
          name: fileName,
          mimeType: "application/json",
          parentID: folderID,
          completion: completion
        )
      case .success(let fileID?):
        self.getFileParents(fileID: fileID) { parentsResult in
          switch parentsResult {
          case .failure(let error):
            completion(.failure(error))
          case .success(nil):
            self.createItem(
              name: fileName,
              mimeType: "application/json",
              parentID: folderID,
              completion: completion
            )
          case .success(let parents?):
            self.moveIfNeeded(fileID: fileID, parents: parents, folderID: folderID) { moveResult in
              switch moveResult {
              case .failure(let error):
                completion(.failure(error))
              case .success:
                completion(.success(fileID))
              }
            }
          }
        }
      }
    }
  }

  func findItem(
    named name: String,
    mimeType: String?,
    fields: String,
    completion: @escaping (Result<String?, Error>) -> Void
  ) {
    var clauses = ["name='\(escapeQueryValue(name))'", "trashed=false"]
    if let mimeType {
      clauses.insert("mimeType='\(escapeQueryValue(mimeType))'", at: 1)
    }

    findItem(clauses: clauses, fields: fields, completion: completion)
  }

  func findItem(
    clauses: [String],
    fields: String,
    completion: @escaping (Result<String?, Error>) -> Void
  ) {

    performRequest(
      method: "GET",
      path: "/drive/v3/files",
      queryItems: [
        URLQueryItem(name: "q", value: clauses.joined(separator: " and ")),
        URLQueryItem(name: "fields", value: fields),
        URLQueryItem(name: "pageSize", value: "1"),
      ]
    ) { result in
      completion(
        result.flatMap { response in
          guard response.isSuccessful else {
            return .failure(self.requestFailure(response))
          }
          return Result {
            try JSONDecoder().decode(DriveFileList.self, from: response.data).files.first?.id
          }
        }
      )
    }
  }

  func createItem(
    name: String,
    mimeType: String,
    parentID: String?,
    appProperties: [String: String]? = nil,
    completion: @escaping (Result<String, Error>) -> Void
  ) {
    let metadata = DriveCreateMetadata(
      name: name,
      mimeType: mimeType,
      parents: parentID.map { [$0] },
      appProperties: appProperties
    )

    let body: Data
    do {
      body = try JSONEncoder().encode(metadata)
    } catch {
      completion(.failure(error))
      return
    }

    performRequest(
      method: "POST",
      path: "/drive/v3/files",
      contentType: "application/json",
      body: body
    ) { result in
      completion(
        result.flatMap { response in
          guard response.isSuccessful else {
            return .failure(self.requestFailure(response))
          }
          return Result { try JSONDecoder().decode(DriveFile.self, from: response.data).id }
        }
      )
    }
  }

  func getFileParents(
    fileID: String,
    completion: @escaping (Result<[String]?, Error>) -> Void
  ) {
    performRequest(
      method: "GET",
      path: "/drive/v3/files/\(fileID)",
      queryItems: [URLQueryItem(name: "fields", value: "parents,trashed")]
    ) { result in
      switch result {
      case .failure(let error):
        completion(.failure(error))
      case .success(let response) where response.statusCode == 404:
        completion(.success(nil))
      case .success(let response):
        guard response.isSuccessful else {
          completion(.failure(self.requestFailure(response)))
          return
        }
        do {
          let metadata = try JSONDecoder().decode(DriveParentMetadata.self, from: response.data)
          completion(.success(metadata.trashed == true ? nil : metadata.parents ?? []))
        } catch {
          completion(.failure(error))
        }
      }
    }
  }

  private func moveIfNeeded(
    fileID: String,
    parents: [String],
    folderID: String,
    completion: @escaping (Result<Void, Error>) -> Void
  ) {
    guard !parents.contains(folderID) else {
      completion(.success(()))
      return
    }

    performRequest(
      method: "PATCH",
      path: "/drive/v3/files/\(fileID)",
      queryItems: [
        URLQueryItem(name: "addParents", value: folderID),
        URLQueryItem(name: "removeParents", value: parents.joined(separator: ",")),
        URLQueryItem(name: "fields", value: "id,parents"),
      ]
    ) { result in
      switch result {
      case .failure(let error):
        os_log(
          .error,
          "Google Drive file move request failed: %{public}@",
          error.localizedDescription
        )
        if VoyagerGoogleDriveHTTPFailureMapper.isAuthorizationFailure(error) {
          completion(.failure(error))
        } else {
          completion(.success(()))
        }
      case .success(let response):
        guard !response.isSuccessful else {
          completion(.success(()))
          return
        }
        let error = self.requestFailure(response)
        os_log(
          .error,
          "Google Drive file move returned HTTP %{public}d: %{public}@",
          response.statusCode,
          error.localizedDescription
        )
        if VoyagerGoogleDriveHTTPFailureMapper.isAuthorizationFailure(error) {
          completion(.failure(error))
        } else {
          completion(.success(()))
        }
      }
    }
  }

  func itemExists(
    fileID: String,
    completion: @escaping (Result<Bool, Error>) -> Void
  ) {
    performRequest(
      method: "GET",
      path: "/drive/v3/files/\(fileID)",
      queryItems: [URLQueryItem(name: "fields", value: "id")]
    ) { result in
      switch result {
      case .failure(let error):
        completion(.failure(error))
      case .success(let response) where response.statusCode == 404:
        completion(.success(false))
      case .success(let response) where response.isSuccessful:
        completion(.success(true))
      case .success(let response):
        completion(.failure(self.requestFailure(response)))
      }
    }
  }

  func requestFailure(_ response: DriveHTTPResponse) -> Error {
    VoyagerGoogleDriveHTTPFailureMapper.map(
      statusCode: response.statusCode,
      retryAfterSeconds: response.retryAfterSeconds,
      bodyHint: String(data: response.data, encoding: .utf8)
    ) ?? GoogleDriveServiceError.httpStatus(response.statusCode)
  }

  func performRequest(
    method: String,
    path: String,
    queryItems: [URLQueryItem] = [],
    contentType: String? = nil,
    body: Data? = nil,
    completion: @escaping (Result<DriveHTTPResponse, Error>) -> Void
  ) {
    withAccessToken { tokenResult in
      switch tokenResult {
      case .failure(let error):
        completion(.failure(error))
      case .success(let token):
        var components = URLComponents()
        components.scheme = "https"
        components.host = self.apiHost
        components.path = path
        components.queryItems = queryItems.isEmpty ? nil : queryItems
        guard let url = components.url else {
          completion(.failure(GoogleDriveServiceError.invalidResponse))
          return
        }

        var request = URLRequest(url: url)
        request.httpMethod = method
        request.httpBody = body
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        if let contentType {
          request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        }

        URLSession.shared.dataTask(with: request) { data, response, error in
          if let error {
            completion(.failure(error))
            return
          }
          guard let response = response as? HTTPURLResponse else {
            completion(.failure(GoogleDriveServiceError.invalidResponse))
            return
          }
          let retryAfterSeconds = response.allHeaderFields
            .first { ($0.key as? String)?.caseInsensitiveCompare("Retry-After") == .orderedSame }
            .flatMap { $0.value as? String }
            .flatMap(TimeInterval.init)
          completion(
            .success(
              DriveHTTPResponse(
                data: data ?? Data(),
                statusCode: response.statusCode,
                retryAfterSeconds: retryAfterSeconds
              )
            )
          )
        }.resume()
      }
    }
  }

  private func withAccessToken(
    completion: @escaping (Result<String, Error>) -> Void
  ) {
    guard configureGoogleSignIn() else {
      completion(.failure(GoogleDriveServiceError.notConfigured))
      return
    }

    // This process can outlive a sign-in the app completes later, such as a
    // changed account. A newer sign-in reloads the user from the keychain, so
    // Drive requests never keep going to the account the person left.
    let signedInAt = VoyagerSharedState.keychain.googleDriveSignedInAt
    if let currentUser = GIDSignIn.sharedInstance.currentUser,
      !needsRestore(forSignInAt: signedInAt)
    {
      refresh(user: currentUser, completion: completion)
      return
    }

    GIDSignIn.sharedInstance.restorePreviousSignIn { user, _ in
      guard let user else {
        completion(.failure(VoyagerGoogleDriveFailure.authRequired))
        return
      }
      self.markRestored(forSignInAt: signedInAt)
      self.refresh(user: user, completion: completion)
    }
  }

  private func needsRestore(forSignInAt signedInAt: Int64?) -> Bool {
    restoredSignInLock.lock()
    defer { restoredSignInLock.unlock() }
    return restoredSignInAt != signedInAt
  }

  private func markRestored(forSignInAt signedInAt: Int64?) {
    restoredSignInLock.lock()
    let accountMayHaveChanged = restoredSignInAt != signedInAt
    restoredSignInAt = signedInAt
    restoredSignInLock.unlock()
    // The previous account's folder is invisible to a new one; resolve it again.
    if accountMayHaveChanged { backupFolderID = nil }
  }

  private func refresh(
    user: GIDGoogleUser,
    completion: @escaping (Result<String, Error>) -> Void
  ) {
    user.refreshTokensIfNeeded { refreshedUser, error in
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
      guard let refreshedUser else {
        completion(.failure(VoyagerGoogleDriveFailure.authRequired))
        return
      }
      guard refreshedUser.grantedScopes?.contains(self.scope) == true else {
        completion(.failure(VoyagerGoogleDriveFailure.authRequired))
        return
      }
      completion(.success(refreshedUser.accessToken.tokenString))
    }
  }

  private func configureGoogleSignIn() -> Bool {
    guard let clientID = Bundle.main.object(forInfoDictionaryKey: "GIDClientID") as? String,
      !clientID.isEmpty
    else { return false }
    GIDSignIn.sharedInstance.configuration = GIDConfiguration(clientID: clientID)
    return true
  }

  func escapeQueryValue(_ value: String) -> String {
    value
      .replacingOccurrences(of: "\\", with: "\\\\")
      .replacingOccurrences(of: "'", with: "\\'")
  }
}

struct DriveHTTPResponse {
  let data: Data
  let statusCode: Int
  let retryAfterSeconds: TimeInterval?

  var isSuccessful: Bool {
    (200..<300).contains(statusCode)
  }
}

private struct DriveFileList: Decodable {
  let files: [DriveFile]
}

private struct DriveFile: Decodable {
  let id: String
}

private struct DriveCreateMetadata: Encodable {
  let name: String
  let mimeType: String
  let parents: [String]?
  let appProperties: [String: String]?
}

struct DriveUpdateMetadata: Encodable {
  let name: String?
  let appProperties: [String: String]
}

private struct DriveParentMetadata: Decodable {
  let parents: [String]?
  let trashed: Bool?
}

private struct DriveUploadMetadata: Decodable {
  let id: String
  let md5Checksum: String
  let modifiedTime: String
}

enum GoogleDriveServiceError: LocalizedError, Equatable {
  case httpStatus(Int)
  case invalidResponse
  case notConfigured

  var errorDescription: String? {
    switch self {
    case .httpStatus(let statusCode):
      return "Google Drive request failed (\(statusCode))"
    case .invalidResponse:
      return "Google Drive returned an invalid response"
    case .notConfigured:
      return "Google Sign-In is not configured"
    }
  }
}
