import CloudKit
import Foundation

/// The native delete-backup boundary, kept separate so provider operations run against a fake DB.
struct ICloudBackupDeletion {
  let database: VoyagerICloudRecordDatabase

  func deleteBackup(completion: @escaping (Result<VoyagerICloudDeleteResponse, Error>) -> Void) {
    ICloudRecordMaintenance(database: database).collect { result in
      switch result {
      case .failure(let error): completion(.failure(error))
      case .success(let records): self.remove(records.map(\.recordID)) { completion(.success($0)) }
      }
    }
  }

  func remove(
    _ ids: [CKRecord.ID], deleted: Int = 0, errors: [VoyagerICloudDeleteIssue] = [],
    completion: @escaping (VoyagerICloudDeleteResponse) -> Void
  ) {
    guard !ids.isEmpty else {
      completion(VoyagerICloudDeleteResponse(deleted: deleted, errors: errors))
      return
    }
    // CloudKit rejects oversized operations; one item's failure must not roll back its siblings.
    let batch = Array(ids.prefix(400))
    let operation = CKModifyRecordsOperation(recordIDsToDelete: batch)
    operation.isAtomic = false
    operation.modifyRecordsCompletionBlock = { _, deletedIDs, error in
      let confirmed = Set(deletedIDs ?? []).intersection(batch)
      var failures = errors
      if let error {
        let partial = (error as? CKError)?.partialErrorsByItemID
        if let partial, !partial.isEmpty {
          failures += partial.map { id, failure in
            VoyagerICloudDeleteIssue(error: failure, recordName: (id as? CKRecord.ID)?.recordName)
          }.sorted { ($0.recordName ?? "") < ($1.recordName ?? "") }
        } else {
          failures.append(VoyagerICloudDeleteIssue(error: error))
        }
      } else if confirmed.count != batch.count {
        failures.append(VoyagerICloudDeleteIssue(error: VoyagerICloudFailure.invalidPayload))
      }
      self.remove(
        Array(ids.dropFirst(batch.count)), deleted: deleted + confirmed.count, errors: failures,
        completion: completion)
    }
    database.add(operation)
  }
}

struct VoyagerICloudDeleteIssue: Codable, Equatable {
  let recordName: String?
  let error: String
  let code: String?
  let retryAfterMs: Int?

  init(error original: Error, recordName: String? = nil) {
    let mapped = VoyagerICloudFailureMapper.map(error: original)
    let failure = mapped as? VoyagerICloudFailure
    self.recordName = recordName
    self.error = mapped.localizedDescription
    self.code =
      failure?.code.rawValue ?? (original as? CKError).map { "cloudkit_\($0.code.rawValue)" }
    self.retryAfterMs = failure?.retryAfterMilliseconds
  }
}
