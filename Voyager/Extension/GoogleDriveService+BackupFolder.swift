import Foundation
import os.log

/** Owns backup-folder discovery, recovery and the existing metadata migration. */
extension GoogleDriveService {
  func ensureBackupFolder(
    completion: @escaping (Result<String, Error>) -> Void
  ) {
    backupFolderResolutionLock.lock()
    backupFolderResolutionWaiters.append(completion)
    guard !backupFolderResolutionInFlight else {
      backupFolderResolutionLock.unlock()
      return
    }
    backupFolderResolutionInFlight = true
    backupFolderResolutionLock.unlock()

    resolveBackupFolder { result in
      self.backupFolderResolutionLock.lock()
      let waiters = self.backupFolderResolutionWaiters
      self.backupFolderResolutionWaiters.removeAll()
      self.backupFolderResolutionInFlight = false
      self.backupFolderResolutionLock.unlock()
      waiters.forEach { $0(result) }
    }
  }

  private func resolveBackupFolder(
    completion: @escaping (Result<String, Error>) -> Void
  ) {
    if let backupFolderID {
      itemExists(fileID: backupFolderID) { result in
        switch result {
        case .success(true):
          completion(.success(backupFolderID))
        case .success(false):
          self.backupFolderID = nil
          self.findOrCreateBackupFolder(completion: completion)
        case .failure(let error):
          completion(.failure(error))
        }
      }
      return
    }

    findOrCreateBackupFolder(completion: completion)
  }

  private func findOrCreateBackupFolder(
    completion: @escaping (Result<String, Error>) -> Void
  ) {
    findExistingBackupFolder { result in
      switch result {
      case .failure(let error):
        completion(.failure(error))
      case .success(let folderID?):
        self.backupFolderID = folderID
        completion(.success(folderID))
      case .success(nil):
        self.createItem(
          name: VoyagerGoogleDriveFolderIdentity.currentName,
          mimeType: "application/vnd.google-apps.folder",
          parentID: nil,
          appProperties: [
            VoyagerGoogleDriveFolderIdentity.markerKey:
              VoyagerGoogleDriveFolderIdentity.markerValue
          ]
        ) { createResult in
          if case .success(let folderID) = createResult {
            self.backupFolderID = folderID
          }
          completion(createResult)
        }
      }
    }
  }

  func migrateBackupFolderIfPresent(completion: @escaping () -> Void) {
    resolveExistingBackupFolder { result in
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
    completion: @escaping (Result<String?, Error>) -> Void
  ) {
    if let backupFolderID {
      completion(.success(backupFolderID))
      return
    }

    findExistingBackupFolder { result in
      switch result {
      case .success(let folderID?):
        self.backupFolderID = folderID
      case .failure, .success(nil):
        break
      }
      // History cannot report "none" when folder discovery was unreadable or unauthorized.
      completion(result)
    }
  }

  private func findExistingBackupFolder(
    completion: @escaping (Result<String?, Error>) -> Void
  ) {
    findMarkedBackupFolder { markedResult in
      switch markedResult {
      case .failure(let error):
        completion(.failure(error))
      case .success(let folderID?):
        completion(.success(folderID))
      case .success(nil):
        self.findNamedBackupFolders(completion: completion)
      }
    }
  }

  private func findMarkedBackupFolder(
    completion: @escaping (Result<String?, Error>) -> Void
  ) {
    let identity = VoyagerGoogleDriveFolderIdentity.self
    findItem(
      clauses: [
        "appProperties has { key='\(escapeQueryValue(identity.markerKey))' and value='\(escapeQueryValue(identity.markerValue))' }",
        "mimeType='application/vnd.google-apps.folder'",
        "trashed=false",
      ],
      fields: "files(id)"
    ) { result in
      completion(result)
    }
  }

  private func findNamedBackupFolders(
    completion: @escaping (Result<String?, Error>) -> Void
  ) {
    findItem(
      named: VoyagerGoogleDriveFolderIdentity.currentName,
      mimeType: "application/vnd.google-apps.folder",
      fields: "files(id)"
    ) { canonicalResult in
      switch canonicalResult {
      case .failure(let error):
        completion(.failure(error))
      case .success(let folderID?):
        self.markBackupFolder(folderID: folderID, renameLegacyFolder: false) {
          completion(.success(folderID))
        }
      case .success(nil):
        self.findLegacyOrRecoveredBackupFolder(completion: completion)
      }
    }
  }

  private func findLegacyOrRecoveredBackupFolder(
    completion: @escaping (Result<String?, Error>) -> Void
  ) {
    findItem(
      named: VoyagerGoogleDriveFolderIdentity.legacyName,
      mimeType: "application/vnd.google-apps.folder",
      fields: "files(id)"
    ) { legacyResult in
      switch legacyResult {
      case .failure(let error):
        completion(.failure(error))
      case .success(let folderID?):
        self.markBackupFolder(folderID: folderID, renameLegacyFolder: true) {
          completion(.success(folderID))
        }
      case .success(nil):
        self.recoverBackupFolderFromSyncFile(completion: completion)
      }
    }
  }

  private func recoverBackupFolderFromSyncFile(
    completion: @escaping (Result<String?, Error>) -> Void
  ) {
    findItem(
      named: "gemini-voyager-folders.json",
      mimeType: nil,
      fields: "files(id)"
    ) { fileResult in
      switch fileResult {
      case .failure(let error):
        completion(.failure(error))
      case .success(nil):
        completion(.success(nil))
      case .success(let fileID?):
        self.getFileParents(fileID: fileID) { parentsResult in
          switch parentsResult {
          case .failure(let error):
            completion(.failure(error))
          case .success(let parents?):
            guard let folderID = parents.first else {
              completion(.success(nil))
              return
            }
            self.markBackupFolder(folderID: folderID, renameLegacyFolder: false) {
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
      body: body
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
