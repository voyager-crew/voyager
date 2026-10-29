import CloudKit
import XCTest

@testable import VoyagerNativeCore

final class ICloudBackupDeletionTests: XCTestCase {
  func testLargeBackupDeletesAllRecordsWithoutExceedingCloudKitBatchSize() throws {
    let database = MemoryICloudRecordDatabase()
    for index in 0..<805 {
      let record = CKRecord(
        recordType: "VoyagerSyncFile", recordID: CKRecord.ID(recordName: "file-\(index)"))
      database.records[record.recordID] = record
    }
    var result: Result<VoyagerICloudDeleteResponse, Error>?
    ICloudBackupDeletion(database: database).deleteBackup { result = $0 }
    XCTAssertEqual(try XCTUnwrap(result).get().deleted, 805)
    XCTAssertTrue(try XCTUnwrap(result).get().errors.isEmpty)
    XCTAssertTrue(database.records.isEmpty)
    assertBoundedNonAtomicBatches(database, total: 805)
  }

  func testPartialFailuresKeepTheirErrorsAndSuccessfulCountWhileLaterBatchesContinue() throws {
    let database = MemoryICloudRecordDatabase()
    for index in 0..<805 {
      let record = CKRecord(
        recordType: "VoyagerSyncFile", recordID: CKRecord.ID(recordName: "record-\(index)"))
      database.records[record.recordID] = record
    }
    let failed = CKRecord.ID(recordName: "record-7")
    database.deleteErrors[failed] = MemoryICloudRecordDatabase.cloudError(.networkFailure)
    var result: Result<VoyagerICloudDeleteResponse, Error>?
    ICloudBackupDeletion(database: database).deleteBackup { result = $0 }
    let progress = try XCTUnwrap(result).get()
    XCTAssertEqual(progress.deleted, 804)
    XCTAssertEqual(progress.errors.map(\.recordName), ["record-7"])
    XCTAssertEqual(progress.errors.first?.code, "cloudkit_4")
    XCTAssertEqual(Set(database.records.keys), [failed])
    assertBoundedNonAtomicBatches(database, total: 805)
    let envelope = try VoyagerNativeMessageCodec.encodeResponse(
      VoyagerNativeResponse.success(progress))
    let data = try XCTUnwrap(envelope["data"] as? [String: Any])
    XCTAssertEqual(data["deleted"] as? Int, 804)
    XCTAssertEqual(
      (data["errors"] as? [[String: Any]])?.first?["recordName"] as? String, "record-7")
  }

  private func assertBoundedNonAtomicBatches(_ database: MemoryICloudRecordDatabase, total: Int) {
    XCTAssertFalse(database.deleteBatches.isEmpty)
    XCTAssertTrue(database.deleteBatches.allSatisfy { !$0.isEmpty && $0.count <= 400 })
    let ids = database.deleteBatches.flatMap { $0 }
    XCTAssertEqual(ids.count, total)
    XCTAssertEqual(Set(ids).count, total)
    XCTAssertTrue(database.atomicDeleteBatches.allSatisfy { !$0 })
  }
}
