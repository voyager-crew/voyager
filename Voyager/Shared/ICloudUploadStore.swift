import CloudKit
import Foundation

protocol VoyagerICloudRecordDatabase {
  func fetch(
    withRecordID: CKRecord.ID, completionHandler: @escaping @Sendable (CKRecord?, Error?) -> Void)
  func delete(
    withRecordID: CKRecord.ID, completionHandler: @escaping @Sendable (CKRecord.ID?, Error?) -> Void
  )
  func add(_ operation: CKDatabaseOperation)
}

extension CKDatabase: VoyagerICloudRecordDatabase {}

/// CloudKit boundary for versioned upload transactions. Existing record type/fields remain unchanged.
struct ICloudUploadStore: VoyagerICloudUploadStore {
  typealias Handle = CKRecord
  let database: VoyagerICloudRecordDatabase

  func fetch(
    fileName: String,
    completion: @escaping (Result<VoyagerICloudStoredVersion<CKRecord>?, Error>) -> Void
  ) {
    fetchRecord(id: mainID(fileName), fileName: fileName) { result in
      completion(
        result.flatMap { record in
          guard let record else { return .success(nil) }
          return Result { try snapshot(record, fileName: fileName) }
        })
    }
  }

  func history(
    id: String, fileName: String, completion: @escaping (Result<String?, Error>) -> Void
  ) {
    guard VoyagerICloudHistoryIdentity.matches(id, fileName: fileName) else {
      completion(.failure(VoyagerICloudFailure.invalidPayload))
      return
    }
    fetchRecord(id: CKRecord.ID(recordName: id), fileName: fileName) { result in
      completion(
        result.flatMap { record in
          guard let record else { return .success(nil) }
          return Result { try snapshot(record, fileName: fileName).json }
        })
    }
  }

  func historyFile(
    id: String, fileName: String,
    completion: @escaping (Result<VoyagerICloudHistoryFile?, Error>) -> Void
  ) {
    guard VoyagerICloudHistoryIdentity.matches(id, fileName: fileName) else {
      completion(.failure(VoyagerICloudFailure.invalidPayload))
      return
    }
    fetchRecord(id: CKRecord.ID(recordName: id), fileName: fileName) { result in
      completion(
        result.flatMap { record in
          guard let record else { return .success(nil) }
          return Result {
            return VoyagerICloudHistoryFile(
              id: id, json: try snapshot(record, fileName: fileName).json,
              createdTime: record.creationDate.flatMap {
                $0.timeIntervalSince1970.isFinite ? $0.timeIntervalSince1970 * 1000 : nil
              })
          }
        })
    }
  }

  func archive(
    fileName: String, json: String,
    completion: @escaping (Result<VoyagerICloudHistoryVersion, Error>) -> Void
  ) {
    let id = CKRecord.ID(recordName: VoyagerICloudHistoryIdentity.make(fileName: fileName))
    let record = CKRecord(recordType: "VoyagerSyncFile", recordID: id)
    // Each before-image gets a unique ID. No update path can address it as a main file.
    saveRecord(record, fileName: fileName, json: json) { result in
      completion(
        result.map { saved in
          VoyagerICloudHistoryVersion(
            id: saved.handle.recordID.recordName, createdAt: saved.handle.creationDate)
        })
    }
  }

  func histories(
    fileName: String, completion: @escaping (Result<[VoyagerICloudHistoryVersion], Error>) -> Void
  ) {
    ICloudRecordMaintenance(database: database).histories(
      fileName: fileName, completion: completion)
  }

  func save(
    fileName: String, json: String, previous: CKRecord?,
    completion: @escaping (Result<VoyagerICloudStoredVersion<CKRecord>, Error>) -> Void
  ) {
    let id = mainID(fileName)
    if let previous, previous.recordID != id {
      completion(.failure(VoyagerICloudFailure.invalidPayload))
      return
    }
    saveRecord(
      previous ?? CKRecord(recordType: "VoyagerSyncFile", recordID: id),
      fileName: fileName, json: json, completion: completion
    )
  }

  func remove(fileName: String, completion: @escaping (Result<Void, Error>) -> Void) {
    // CloudKit deletes take record IDs, not change tags. The transaction makes its final
    // checksum read immediately before this call; this provider has no delete CAS.
    database.delete(withRecordID: mainID(fileName)) { _, error in
      if let error,
        VoyagerICloudFailureMapper.primaryCloudKitError(from: error)?.code != .unknownItem
      {
        completion(.failure(VoyagerICloudFailureMapper.map(error: error, fileName: fileName)))
      } else {
        completion(.success(()))
      }
    }
  }

  private func fetchRecord(
    id: CKRecord.ID, fileName: String,
    completion: @escaping (Result<CKRecord?, Error>) -> Void
  ) {
    database.fetch(withRecordID: id) { record, error in
      if VoyagerICloudFailureMapper.primaryCloudKitError(from: error)?.code == .unknownItem {
        completion(.success(nil))
      } else if let error {
        completion(.failure(VoyagerICloudFailureMapper.map(error: error, fileName: fileName)))
      } else if let record {
        completion(.success(record))
      } else {
        completion(.failure(VoyagerICloudFailure.invalidPayload))
      }
    }
  }

  private func snapshot(
    _ record: CKRecord, fileName: String
  ) throws -> VoyagerICloudStoredVersion<CKRecord> {
    guard record["name"] as? String == fileName,
      let version = record.recordChangeTag, !version.isEmpty,
      let asset = record["payload"] as? CKAsset, let fileURL = asset.fileURL
    else { throw VoyagerICloudFailure.invalidPayload }
    let bytes = try Data(contentsOf: fileURL)
    let json = try VoyagerICloudRawPayload.decode(bytes)
    return VoyagerICloudStoredVersion(json: json, version: version, handle: record)
  }

  private func saveRecord(
    _ record: CKRecord, fileName: String, json: String,
    completion: @escaping (Result<VoyagerICloudStoredVersion<CKRecord>, Error>) -> Void
  ) {
    let temporary = FileManager.default.temporaryDirectory
      .appendingPathComponent("voyager-icloud-\(UUID().uuidString).json")
    do {
      try Data(json.utf8).write(to: temporary, options: .atomic)
    } catch {
      completion(.failure(error))
      return
    }
    record["name"] = fileName as CKRecordValue
    record["payload"] = CKAsset(fileURL: temporary)
    record["updatedAt"] = Date() as CKRecordValue
    let operation = CKModifyRecordsOperation(recordsToSave: [record])
    operation.isAtomic = true
    // Both main writes and archive creates fail on a change after their fetch/create boundary.
    operation.savePolicy = .ifServerRecordUnchanged
    operation.modifyRecordsCompletionBlock = { saved, _, error in
      defer { try? FileManager.default.removeItem(at: temporary) }
      if let error {
        completion(.failure(VoyagerICloudFailureMapper.map(error: error, fileName: fileName)))
      } else if let written = saved?.first(where: { $0.recordID == record.recordID }) {
        // Receipt bytes are from this save response; never GET the current record after saving.
        completion(Result { try snapshot(written, fileName: fileName) })
      } else {
        completion(.failure(VoyagerICloudFailure.invalidPayload))
      }
    }
    database.add(operation)
  }

  private func mainID(_ fileName: String) -> CKRecord.ID {
    CKRecord.ID(recordName: VoyagerICloudRecordIdentity.recordName(for: fileName))
  }
}
