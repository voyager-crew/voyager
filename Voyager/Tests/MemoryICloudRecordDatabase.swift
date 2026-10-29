import CloudKit
import Foundation
import XCTest

@testable import VoyagerNativeCore

/// Exercises production CloudKit operations without reaching a real account or database.
final class MemoryICloudRecordDatabase: VoyagerICloudRecordDatabase {
  var records: [CKRecord.ID: CKRecord] = [:]
  var failMainSave = false
  var failHistorySave = false
  var hiddenFromQuery: Set<CKRecord.ID> = []
  var hideNewHistoryFromQuery = false
  var deleteBatches: [[CKRecord.ID]] = []
  var atomicDeleteBatches: [Bool] = []
  var deleteErrors: [CKRecord.ID: Error] = [:]
  var queryError: Error?
  var beforeMainSave: (() -> Void)?
  var afterHistorySave: (() -> Void)?
  private var sequence = 0
  private let directory = FileManager.default.temporaryDirectory
    .appendingPathComponent("voyager-fake-icloud-\(UUID().uuidString)")

  init() {
    try! FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
  }
  deinit { try? FileManager.default.removeItem(at: directory) }

  @discardableResult func put(_ fileName: String, _ json: String, history: Bool = false) -> CKRecord
  {
    let id = CKRecord.ID(
      recordName: history
        ? VoyagerICloudHistoryIdentity.make(fileName: fileName)
        : VoyagerICloudRecordIdentity.recordName(for: fileName))
    let record = CKRecord(recordType: "VoyagerSyncFile", recordID: id)
    record["name"] = fileName as CKRecordValue
    let url = directory.appendingPathComponent(UUID().uuidString)
    try! Data(json.utf8).write(to: url)
    record["payload"] = CKAsset(fileURL: url)
    return persist(record)
  }

  func text(_ record: CKRecord?) throws -> String {
    let url = try XCTUnwrap((record?["payload"] as? CKAsset)?.fileURL)
    return try VoyagerICloudRawPayload.decode(Data(contentsOf: url))
  }

  func histories(_ name: String) -> [CKRecord] {
    records.values.filter {
      $0["name"] as? String == name
        && VoyagerICloudHistoryIdentity.matches($0.recordID.recordName, fileName: name)
    }.sorted { ($0.creationDate ?? .distantPast) > ($1.creationDate ?? .distantPast) }
  }

  func fetch(
    withRecordID id: CKRecord.ID, completionHandler: @escaping @Sendable (CKRecord?, Error?) -> Void
  ) {
    completionHandler(records[id], records[id] == nil ? Self.cloudError(.unknownItem) : nil)
  }

  func delete(
    withRecordID id: CKRecord.ID,
    completionHandler: @escaping @Sendable (CKRecord.ID?, Error?) -> Void
  ) {
    if let error = deleteErrors[id] {
      completionHandler(nil, error)
      return
    }
    records.removeValue(forKey: id)
    completionHandler(id, nil)
  }

  func add(_ operation: CKDatabaseOperation) {
    if let query = operation as? CKQueryOperation {
      for record in records.values where !hiddenFromQuery.contains(record.recordID) {
        if #available(macOS 12.0, *), let match = query.recordMatchedBlock {
          match(record.recordID, .success(record))
        } else {
          query.recordFetchedBlock?(record)
        }
      }
      query.queryCompletionBlock?(nil, queryError)
      return
    }
    guard let modify = operation as? CKModifyRecordsOperation else {
      XCTFail("unknown operation")
      return
    }
    if let ids = modify.recordIDsToDelete {
      deleteBatches.append(ids)
      atomicDeleteBatches.append(modify.isAtomic)
      let errors = deleteErrors.filter { ids.contains($0.key) }
      let deleted = ids.filter { errors[$0] == nil }
      deleted.forEach { records.removeValue(forKey: $0) }
      let error =
        errors.isEmpty
        ? nil
        : CKError(
          _nsError: NSError(
            domain: CKErrorDomain, code: CKError.Code.partialFailure.rawValue,
            userInfo: [CKPartialErrorsByItemIDKey: errors]))
      modify.modifyRecordsCompletionBlock?(nil, deleted, error)
      return
    }
    guard let record = modify.recordsToSave?.first else {
      XCTFail("missing save record")
      return
    }
    let isHistory = record.recordID.recordName.hasPrefix("history-")
    if !isHistory {
      let hook = beforeMainSave
      beforeMainSave = nil
      hook?()
    }
    if (isHistory && failHistorySave) || (!isHistory && failMainSave) {
      modify.modifyRecordsCompletionBlock?(nil, nil, Self.cloudError(.networkFailure))
      return
    }
    if modify.savePolicy == .ifServerRecordUnchanged
      && records[record.recordID]?.recordChangeTag != record.recordChangeTag
    {
      modify.modifyRecordsCompletionBlock?(nil, nil, Self.cloudError(.serverRecordChanged))
      return
    }
    let saved = persist(record)
    if isHistory {
      if hideNewHistoryFromQuery { hiddenFromQuery.insert(saved.recordID) }
      afterHistorySave?()
    }
    modify.modifyRecordsCompletionBlock?([saved], nil, nil)
  }

  private func persist(_ record: CKRecord) -> CKRecord {
    sequence += 1
    let saved = MemoryICloudRecord(recordType: record.recordType, recordID: record.recordID)
    saved.tag = "tag-\(sequence)"
    saved.created = record.creationDate ?? Date(timeIntervalSince1970: Double(sequence))
    for key in record.allKeys() { saved[key] = record[key] }
    saved["updatedAt"] = Date(timeIntervalSince1970: Double(sequence)) as CKRecordValue
    if let url = (record["payload"] as? CKAsset)?.fileURL {
      let copy = directory.appendingPathComponent(UUID().uuidString)
      try! Data(contentsOf: url).write(to: copy)
      saved["payload"] = CKAsset(fileURL: copy)
    }
    records[saved.recordID] = saved
    return saved
  }

  static func cloudError(_ code: CKError.Code) -> CKError {
    CKError(_nsError: NSError(domain: CKErrorDomain, code: code.rawValue))
  }
}

private final class MemoryICloudRecord: CKRecord, @unchecked Sendable {
  var tag: String?
  var created: Date?
  override var recordChangeTag: String? { tag }
  override var creationDate: Date? { created }
}
