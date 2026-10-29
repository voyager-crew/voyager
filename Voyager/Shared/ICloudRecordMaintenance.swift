import CloudKit
import Foundation

/// Queries only existing fields; source identity filtering needs no new CloudKit index or schema.
struct ICloudRecordMaintenance {
  let database: VoyagerICloudRecordDatabase

  func collect(
    cursor: CKQueryOperation.Cursor? = nil, records: [CKRecord] = [],
    completion: @escaping (Result<[CKRecord], Error>) -> Void
  ) {
    let operation =
      cursor.map(CKQueryOperation.init(cursor:))
      ?? CKQueryOperation(
        query: CKQuery(recordType: "VoyagerSyncFile", predicate: NSPredicate(value: true)))
    operation.desiredKeys = ["name"]
    var collected = records
    var recordError: Error?
    if #available(macOS 12.0, *) {
      operation.recordMatchedBlock = { _, result in
        switch result {
        case .success(let record): collected.append(record)
        case .failure(let error): recordError = error
        }
      }
    } else {
      operation.recordFetchedBlock = { collected.append($0) }
    }
    operation.queryCompletionBlock = { cursor, error in
      if let error = error ?? recordError {
        completion(.failure(error))
      } else if let cursor {
        self.collect(cursor: cursor, records: collected, completion: completion)
      } else {
        completion(.success(collected))
      }
    }
    database.add(operation)
  }

  func histories(
    fileName: String, completion: @escaping (Result<[VoyagerICloudHistoryVersion], Error>) -> Void
  ) {
    collect { result in
      completion(
        result.map { records in
          records.compactMap { record in
            guard record["name"] as? String == fileName,
              VoyagerICloudHistoryIdentity.matches(record.recordID.recordName, fileName: fileName)
            else { return nil }
            return VoyagerICloudHistoryVersion(
              id: record.recordID.recordName, createdAt: record.creationDate)
          }
        })
    }
  }

}
