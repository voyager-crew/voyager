import Foundation
import os.log

/// Owns backup-folder discovery, recovery and the existing metadata migration. Each account has
/// its own folder: every lookup runs in the scope of the action that asked, and its answer is
/// cached for that scope's account only (`VoyagerDriveFolderCache`).
extension GoogleDriveService {
  func ensureBackupFolder(
    in scope: VoyagerDriveAccountScope,
    completion: @escaping (Result<String, Error>) -> Void
  ) {
    folderCache.resolve(for: scope.account, completion: completion) { answer in
      self.resolveBackupFolder(in: scope, completion: answer)
    }
  }

  private func resolveBackupFolder(
    in scope: VoyagerDriveAccountScope,
    completion: @escaping (Result<String, Error>) -> Void
  ) {
    if let backupFolderID = folderCache.folder(for: scope.account) {
      itemExists(fileID: backupFolderID, in: scope) { result in
        switch result {
        case .success(true):
          completion(.success(backupFolderID))
        case .success(false):
          self.folderCache.forget(backupFolderID, for: scope.account)
          self.findOrCreateBackupFolder(in: scope, completion: completion)
        case .failure(let error):
          completion(.failure(error))
        }
      }
      return
    }

    findOrCreateBackupFolder(in: scope, completion: completion)
  }

  private func findOrCreateBackupFolder(
    in scope: VoyagerDriveAccountScope,
    completion: @escaping (Result<String, Error>) -> Void
  ) {
    findExistingBackupFolder(in: scope) { result in
      switch result {
      case .failure(let error):
        completion(.failure(error))
      case .success(let folderID?):
        self.folderCache.remember(folderID, for: scope.account)
        completion(.success(folderID))
      case .success(nil):
        self.createItem(
          name: VoyagerGoogleDriveFolderIdentity.currentName,
          mimeType: "application/vnd.google-apps.folder",
          parentID: nil,
          appProperties: [
            VoyagerGoogleDriveFolderIdentity.markerKey:
              VoyagerGoogleDriveFolderIdentity.markerValue
          ],
          in: scope
        ) { createResult in
          if case .success(let folderID) = createResult {
            self.folderCache.remember(folderID, for: scope.account)
          }
          completion(createResult)
        }
      }
    }
  }

  func migrateBackupFolderIfPresent(
    in scope: VoyagerDriveAccountScope,
    completion: @escaping () -> Void
  ) {
    resolveExistingBackupFolder(in: scope) { result in
      if case .failure(let error) = result {
        os_log(
          .error,
          "Google Drive folder migration deferred: %{public}@",
          error.localizedDescription
        )
      }
      completion()
    }
  }

  func resolveExistingBackupFolder(
    in scope: VoyagerDriveAccountScope,
    completion: @escaping (Result<String?, Error>) -> Void
  ) {
    if let backupFolderID = folderCache.folder(for: scope.account) {
      completion(.success(backupFolderID))
      return
    }

    findExistingBackupFolder(in: scope) { result in
      switch result {
      case .success(let folderID?):
        self.folderCache.remember(folderID, for: scope.account)
      case .failure, .success(nil):
        break
      }
      // History cannot report "none" when folder discovery was unreadable or unauthorized.
      completion(result)
    }
  }

  private func findExistingBackupFolder(
    in scope: VoyagerDriveAccountScope,
    completion: @escaping (Result<String?, Error>) -> Void
  ) {
    findMarkedBackupFolder(in: scope) { markedResult in
      switch markedResult {
      case .failure(let error):
        completion(.failure(error))
      case .success(let folderID?):
        completion(.success(folderID))
      case .success(nil):
        self.findNamedBackupFolders(in: scope, completion: completion)
      }
    }
  }

  private func findMarkedBackupFolder(
    in scope: VoyagerDriveAccountScope,
    completion: @escaping (Result<String?, Error>) -> Void
  ) {
    let identity = VoyagerGoogleDriveFolderIdentity.self
    findItem(
      clauses: [
        "appProperties has { key='\(escapeQueryValue(identity.markerKey))' and value='\(escapeQueryValue(identity.markerValue))' }",
        "mimeType='application/vnd.google-apps.folder'",
        "trashed=false",
      ],
      fields: "files(id)",
      in: scope
    ) { result in
      completion(result)
    }
  }

  private func findNamedBackupFolders(
    in scope: VoyagerDriveAccountScope,
    completion: @escaping (Result<String?, Error>) -> Void
  ) {
    findItem(
      named: VoyagerGoogleDriveFolderIdentity.currentName,
      mimeType: "application/vnd.google-apps.folder",
      fields: "files(id)",
      in: scope
    ) { canonicalResult in
      switch canonicalResult {
      case .failure(let error):
        completion(.failure(error))
      case .success(let folderID?):
        self.markBackupFolder(folderID: folderID, renameLegacyFolder: false, in: scope) {
          completion(.success(folderID))
        }
      case .success(nil):
        self.findLegacyOrRecoveredBackupFolder(in: scope, completion: completion)
      }
    }
  }

  private func findLegacyOrRecoveredBackupFolder(
    in scope: VoyagerDriveAccountScope,
    completion: @escaping (Result<String?, Error>) -> Void
  ) {
    findItem(
      named: VoyagerGoogleDriveFolderIdentity.legacyName,
      mimeType: "application/vnd.google-apps.folder",
      fields: "files(id)",
      in: scope
    ) { legacyResult in
      switch legacyResult {
      case .failure(let error):
        completion(.failure(error))
      case .success(let folderID?):
        self.markBackupFolder(folderID: folderID, renameLegacyFolder: true, in: scope) {
          completion(.success(folderID))
        }
      case .success(nil):
        self.recoverBackupFolderFromSyncFile(in: scope, completion: completion)
      }
    }
  }

  private func recoverBackupFolderFromSyncFile(
    in scope: VoyagerDriveAccountScope,
    completion: @escaping (Result<String?, Error>) -> Void
  ) {
    findItem(
      named: "gemini-voyager-folders.json",
      mimeType: nil,
      fields: "files(id)",
      in: scope
    ) { fileResult in
      switch fileResult {
      case .failure(let error):
        completion(.failure(error))
      case .success(nil):
        completion(.success(nil))
      case .success(let fileID?):
        self.getFileParents(fileID: fileID, in: scope) { parentsResult in
          switch parentsResult {
          case .failure(let error):
            completion(.failure(error))
          case .success(let parents?):
            guard let folderID = parents.first else {
              completion(.success(nil))
              return
            }
            self.markBackupFolder(folderID: folderID, renameLegacyFolder: false, in: scope) {
              completion(.success(folderID))
            }
          case .success(nil):
            completion(.success(nil))
          }
        }
      }
    }
  }

  private func markBackupFolder(
    folderID: String,
    renameLegacyFolder: Bool,
    in scope: VoyagerDriveAccountScope,
    completion: @escaping () -> Void
  ) {
    let metadata = DriveUpdateMetadata(
      name: renameLegacyFolder ? VoyagerGoogleDriveFolderIdentity.currentName : nil,
      appProperties: [
        VoyagerGoogleDriveFolderIdentity.markerKey:
          VoyagerGoogleDriveFolderIdentity.markerValue
      ]
    )

    let body: Data
    do {
      body = try JSONEncoder().encode(metadata)
    } catch {
      os_log(.error, "Google Drive folder metadata encoding failed: %{public}@", error.localizedDescription)
      completion()
      return
    }

    performRequest(
      method: "PATCH",
      path: "/drive/v3/files/\(folderID)",
      queryItems: [URLQueryItem(name: "fields", value: "id,name,appProperties")],
      contentType: "application/json",
      body: body,
      in: scope
    ) { result in
      if case .failure(let error) = result {
        os_log(.error, "Google Drive folder migration failed: %{public}@", error.localizedDescription)
      } else if case .success(let response) = result, !response.isSuccessful {
        os_log(.error, "Google Drive folder migration returned HTTP %{public}d", response.statusCode)
      }
      completion()
    }
  }

}
