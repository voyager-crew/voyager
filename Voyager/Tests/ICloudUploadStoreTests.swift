import CloudKit
import Foundation
import XCTest

@testable import VoyagerNativeCore

final class ICloudUploadStoreTests: XCTestCase {
  private let targetName = "gemini-voyager-prompts.json"

  func testRealCloudKitWriteUsesCASMapsConflictAndCleansItsExactPayloadFile() throws {
    let database = FakeICloudRecordDatabase()
    let raw = "\u{FEFF}  {future 🛟 format}\r\n"
    var assetURL: URL?
    database.modify = { operation in
      XCTAssertEqual(operation.savePolicy, .ifServerRecordUnchanged)
      let record = try XCTUnwrap(operation.recordsToSave?.first)
      XCTAssertEqual(
        record.recordID.recordName, VoyagerICloudRecordIdentity.recordName(for: self.targetName))
      XCTAssertEqual(record["name"] as? String, self.targetName)
      assetURL = (record["payload"] as? CKAsset)?.fileURL
      XCTAssertEqual(try Data(contentsOf: XCTUnwrap(assetURL)), Data(raw.utf8))
      operation.modifyRecordsCompletionBlock?(nil, nil, self.conflict())
    }
    var result: Result<VoyagerICloudStoredVersion<CKRecord>, Error>?
    ICloudUploadStore(database: database).save(fileName: targetName, json: raw, previous: nil) {
      result = $0
    }
    guard case .failure(let error) = try XCTUnwrap(result) else {
      return XCTFail("conflict not surfaced")
    }
    XCTAssertEqual((error as? VoyagerICloudFailure)?.code, .conflict)
    XCTAssertFalse(FileManager.default.fileExists(atPath: try XCTUnwrap(assetURL).path))
  }

  func testArchiveUsesImmutableSourceBoundIdentityWithoutChangingRecordSchema() throws {
    let database = FakeICloudRecordDatabase()
    database.modify = { operation in
      XCTAssertEqual(operation.savePolicy, .ifServerRecordUnchanged)
      let record = try XCTUnwrap(operation.recordsToSave?.first)
      XCTAssertEqual(record.recordType, "VoyagerSyncFile")
      XCTAssertEqual(record["name"] as? String, self.targetName)
      XCTAssertTrue(
        VoyagerICloudHistoryIdentity.matches(record.recordID.recordName, fileName: self.targetName))
      XCTAssertFalse(
        VoyagerICloudHistoryIdentity.matches(
          record.recordID.recordName, fileName: "other-account.json"))
      operation.modifyRecordsCompletionBlock?(nil, nil, self.conflict())
    }
    var completed = false
    ICloudUploadStore(database: database).archive(fileName: targetName, json: "original") { _ in
      completed = true
    }
    XCTAssertTrue(completed)
  }

  func testReceiptComesFromTheExactCloudKitSaveResponseWithoutAPostWriteRead() throws {
    let database = FakeICloudRecordDatabase()
    database.modify = { operation in
      let submitted = try XCTUnwrap(operation.recordsToSave?.first)
      let saved = SavedICloudRecord(recordType: submitted.recordType, recordID: submitted.recordID)
      for key in submitted.allKeys() { saved[key] = submitted[key] }
      operation.modifyRecordsCompletionBlock?([saved], nil, nil)
    }
    var result: Result<VoyagerICloudUploadReceipt, Error>?
    let transaction = VoyagerICloudUploadTransactions(store: ICloudUploadStore(database: database))
    transaction.write(fileName: targetName, json: "abc", expectedVersion: nil) { result = $0 }
    let receipt = try XCTUnwrap(result).get()
    XCTAssertEqual(receipt.md5Checksum, "900150983cd24fb0d6963f7d28e17f72")
    XCTAssertEqual(receipt.replaced, .created)
    XCTAssertEqual(database.reads, 1)
  }

  func testForeignHistoryIsRejectedBeforeCloudKitReadsAnotherAccountRecord() {
    let database = FakeICloudRecordDatabase()
    let foreign = VoyagerICloudHistoryIdentity.make(fileName: "other-account.json")
    var failed = false
    ICloudUploadStore(database: database).history(id: foreign, fileName: targetName) { result in
      if case .failure = result { failed = true }
    }
    XCTAssertTrue(failed)
    XCTAssertEqual(database.reads, 0)
  }

  func testUnknownCloudKitRecordIsReturnedAsExplicitAbsence() throws {
    let database = FakeICloudRecordDatabase()
    var result: Result<VoyagerICloudStoredVersion<CKRecord>?, Error>?
    ICloudUploadStore(database: database).fetch(fileName: targetName) { result = $0 }
    XCTAssertNil(try XCTUnwrap(result).get())
  }

  private func conflict() -> CKError {
    CKError(
      _nsError: NSError(domain: CKErrorDomain, code: CKError.Code.serverRecordChanged.rawValue))
  }
}

private final class SavedICloudRecord: CKRecord {
  override var recordChangeTag: String? { "saved-record-tag" }
}

private final class FakeICloudRecordDatabase: VoyagerICloudRecordDatabase {
  var reads = 0
  var modify: ((CKModifyRecordsOperation) throws -> Void)?

  func fetch(
    withRecordID: CKRecord.ID, completionHandler: @escaping @Sendable (CKRecord?, Error?) -> Void
  ) {
    reads += 1
    completionHandler(
      nil,
      CKError(_nsError: NSError(domain: CKErrorDomain, code: CKError.Code.unknownItem.rawValue)))
  }

  func delete(
    withRecordID: CKRecord.ID, completionHandler: @escaping @Sendable (CKRecord.ID?, Error?) -> Void
  ) {
    completionHandler(withRecordID, nil)
  }

  func add(_ operation: CKDatabaseOperation) {
    if let query = operation as? CKQueryOperation {
      query.queryCompletionBlock?(nil, nil)
      return
    }
    guard let operation = operation as? CKModifyRecordsOperation else {
      XCTFail("unexpected CloudKit operation")
      return
    }
    do {
      try modify?(operation)
    } catch {
      XCTFail("CloudKit seam failed: \(error)")
      operation.modifyRecordsCompletionBlock?(nil, nil, error)
    }
  }
}
