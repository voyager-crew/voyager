import CloudKit
import Foundation

final class ICloudSyncService {
  static let shared = ICloudSyncService()

  private static let temporaryFilePrefix = "voyager-icloud-"
  private let container = CKContainer(identifier: "iCloud.com.yourCompany.Gemini-Voyager")

  private init() {
    removeOrphanedTemporaryFiles()
  }

  private var database: CKDatabase {
    container.privateCloudDatabase
  }

  func readUploadVersion(
    fileName: String,
    completion: @escaping (Result<VoyagerICloudUploadVersionResponse, Error>) -> Void
  ) {
    ICloudUploadStore(database: database).fetch(fileName: fileName) { result in
      completion(
        result.map { current in
          VoyagerICloudUploadVersionResponse(
            json: current?.json, version: current?.version, found: current != nil
          )
        })
    }
  }

  func writeUpload(
    request: VoyagerICloudUploadRequest,
    completion: @escaping (Result<VoyagerICloudUploadReceipt, Error>) -> Void
  ) {
    VoyagerICloudUploadTransactions(store: ICloudUploadStore(database: database)).write(
      fileName: request.fileName, json: request.json, expectedVersion: request.expectedVersion,
      completion: completion
    )
  }

  func undoUpload(
    receipt: VoyagerICloudUploadReceipt,
    completion: @escaping (VoyagerICloudUndoResponse) -> Void
  ) {
    VoyagerICloudUploadTransactions(store: ICloudUploadStore(database: database)).undo(
      receipt, completion: completion
    )
  }

  func accountStatus(completion: @escaping (Result<Void, Error>) -> Void) {
    container.accountStatus { status, error in
      if let error {
        completion(.failure(VoyagerICloudFailureMapper.map(error: error)))
      } else if status == .available {
        completion(.success(()))
      } else {
        completion(.failure(VoyagerICloudFailure.accountUnavailable))
      }
    }
  }

  func readHistory(
    fileName: String, includingHistoryId: String?,
    completion: @escaping (Result<VoyagerICloudHistoryResponse, Error>) -> Void
  ) {
    ICloudHistoryOperations(database: database).read(
      fileName: fileName, includingHistoryId: includingHistoryId, completion: completion)
  }

  func restoreHistory(
    _ request: VoyagerICloudRestoreHistoryRequest,
    completion: @escaping (VoyagerICloudUndoResponse) -> Void
  ) {
    ICloudHistoryOperations(database: database).restore(request, completion: completion)
  }

  func pruneHistory(
    _ request: VoyagerICloudPruneHistoryRequest,
    completion: @escaping (Result<VoyagerICloudDeleteResponse, Error>) -> Void
  ) {
    ICloudHistoryOperations(database: database).prune(request, completion: completion)
  }

  func read(fileName: String, completion: @escaping (Result<String?, Error>) -> Void) {
    database.fetch(withRecordID: recordID(for: fileName)) { record, error in
      if let cloudError = error as? CKError, cloudError.code == .unknownItem {
        completion(.success(nil))
        return
      }
      if let error {
        completion(.failure(VoyagerICloudFailureMapper.map(error: error, fileName: fileName)))
        return
      }
      guard let asset = record?["payload"] as? CKAsset,
        let fileURL = asset.fileURL
      else {
        completion(.failure(VoyagerICloudFailure.invalidPayload))
        return
      }

      do {
        let data = try Data(contentsOf: fileURL)
        guard let json = String(data: data, encoding: .utf8) else {
          throw VoyagerICloudFailure.invalidPayload
        }
        completion(.success(json))
      } catch {
        completion(.failure(error))
      }
    }
  }

  func deleteBackup(completion: @escaping (Result<VoyagerICloudDeleteResponse, Error>) -> Void) {
    ICloudBackupDeletion(database: database).deleteBackup(completion: completion)
  }

  private func recordID(for fileName: String) -> CKRecord.ID {
    CKRecord.ID(recordName: VoyagerICloudRecordIdentity.recordName(for: fileName))
  }

  private func removeOrphanedTemporaryFiles() {
    let fileManager = FileManager.default
    let directory = fileManager.temporaryDirectory
    guard
      let files = try? fileManager.contentsOfDirectory(
        at: directory,
        includingPropertiesForKeys: nil
      )
    else { return }

    for file in files where file.lastPathComponent.hasPrefix(Self.temporaryFilePrefix) {
      try? fileManager.removeItem(at: file)
    }
  }
}
