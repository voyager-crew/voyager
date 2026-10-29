import CloudKit
import Foundation
import XCTest

@testable import VoyagerNativeCore

final class ICloudHistoryRecoveryTests: XCTestCase {
  private let targetName = "gemini-voyager-prompts.json"

  func testHistoryChronologyUsesServerCreationRatherThanDeviceClock() throws {
    let database = MemoryICloudRecordDatabase()
    let older = database.put(targetName, "older", history: true)
    let newer = database.put(targetName, "newer", history: true)
    older["updatedAt"] = Date(timeIntervalSince1970: 9_999_999) as CKRecordValue
    newer["updatedAt"] = Date(timeIntervalSince1970: 1) as CKRecordValue
    var result: Result<VoyagerICloudHistoryResponse, Error>?
    ICloudHistoryOperations(database: database).read(fileName: targetName, includingHistoryId: nil)
    { result = $0 }
    XCTAssertEqual(try XCTUnwrap(result).get().files.map(\.json), ["newer", "older"])
  }

  func testHistoryReadIncludesTheKnownSavedArchiveEvenWhileItsQueryIndexLags() throws {
    let database = MemoryICloudRecordDatabase()
    database.put(targetName, "initial")
    database.hideNewHistoryFromQuery = true
    let receipt = try write(database, "mine").get()
    guard case .history(let id) = receipt.replaced else { return XCTFail("missing history") }
    var result: Result<VoyagerICloudHistoryResponse, Error>?
    ICloudHistoryOperations(database: database).read(fileName: targetName, includingHistoryId: id) {
      result = $0
    }
    let files = try XCTUnwrap(result).get().files
    XCTAssertEqual(files.map(\.id), [id])
    XCTAssertEqual(files.map(\.json), ["initial"])
    XCTAssertEqual(
      files.first?.createdTime,
      database.histories(targetName).first?.creationDate.map { $0.timeIntervalSince1970 * 1000 })
  }

  func testNativeHistoryPruningRejectsMainForeignAndProtectedRecordsBeforeDeletion() throws {
    let database = MemoryICloudRecordDatabase()
    let history = database.put(targetName, "ours", history: true)
    let foreign = database.put("other-account.json", "private", history: true)
    database.put(targetName, "current")
    for forbidden in [mainID.recordName, foreign.recordID.recordName, history.recordID.recordName] {
      var result: Result<VoyagerICloudDeleteResponse, Error>?
      ICloudHistoryOperations(database: database).prune(
        VoyagerICloudPruneHistoryRequest(
          fileName: targetName, historyIds: [forbidden],
          protectedHistoryId: history.recordID.recordName
        )
      ) { result = $0 }
      XCTAssertThrowsError(try XCTUnwrap(result).get())
    }
    XCTAssertTrue(database.deleteBatches.isEmpty)
    XCTAssertEqual(database.records.count, 3)
    var removed: Result<VoyagerICloudDeleteResponse, Error>?
    ICloudHistoryOperations(database: database).prune(
      VoyagerICloudPruneHistoryRequest(
        fileName: targetName, historyIds: [history.recordID.recordName], protectedHistoryId: nil)
    ) { removed = $0 }
    XCTAssertEqual(try XCTUnwrap(removed).get().deleted, 1)
    XCTAssertEqual(database.atomicDeleteBatches, [false])
    XCTAssertNotNil(database.records[foreign.recordID])
    XCTAssertNotNil(database.records[mainID])
  }

  func testCreatedUndoHistoryCanRestoreTheExactRemovedPayloadThroughNativeHistoryOperations() throws
  {
    let database = MemoryICloudRecordDatabase()
    let raw = "\u{FEFF}  {\"format\":\"gemini-voyager.prompts.v1\",\"items\":[]}\r\n"
    let receipt = try write(database, raw).get()
    var undo: VoyagerICloudUndoResponse?
    VoyagerICloudUploadTransactions(store: ICloudUploadStore(database: database)).undo(receipt) {
      undo = $0
    }
    XCTAssertEqual(undo?.outcome, .removed)
    XCTAssertNil(database.records[mainID])
    let history = try XCTUnwrap(database.histories(targetName).first)
    var restored: VoyagerICloudUndoResponse?
    ICloudHistoryOperations(database: database).restore(
      VoyagerICloudRestoreHistoryRequest(
        fileName: targetName, historyId: history.recordID.recordName, expectedVersion: nil)
    ) { restored = $0 }
    XCTAssertEqual(restored?.outcome, .restored(history.recordID.recordName))
    XCTAssertEqual(Data(try database.text(database.records[mainID]).utf8), Data(raw.utf8))
    XCTAssertNotNil(database.records[history.recordID])
  }

  func testOrdinaryRestoreKeepsLaterDeviceDataAfterArchivingAndAtTheFinalCAS() throws {
    for duringArchive in [false, true] {
      let database = MemoryICloudRecordDatabase()
      let history = database.put(targetName, "older", history: true)
      let current = database.put(targetName, "current")
      let later = { database.put(self.targetName, "later device") }
      if duringArchive {
        database.afterHistorySave = { _ = later() }
      } else {
        database.beforeMainSave = { _ = later() }
      }
      var result: VoyagerICloudUndoResponse?
      ICloudHistoryOperations(database: database).restore(
        VoyagerICloudRestoreHistoryRequest(
          fileName: targetName, historyId: history.recordID.recordName,
          expectedVersion: current.recordChangeTag)
      ) { result = $0 }
      XCTAssertEqual(result?.outcome, .kept)
      XCTAssertEqual(try database.text(database.records[mainID]), "later device")
      XCTAssertTrue(try database.histories(targetName).map(database.text).contains("current"))
    }
  }

  func testFailedCreatedUndoDeleteKeepsBothCurrentAndItsRecoveryArchive() throws {
    let database = MemoryICloudRecordDatabase()
    let receipt = try write(database, "mine").get()
    database.deleteErrors[mainID] = MemoryICloudRecordDatabase.cloudError(.networkFailure)
    var result: VoyagerICloudUndoResponse?
    VoyagerICloudUploadTransactions(store: ICloudUploadStore(database: database)).undo(receipt) {
      result = $0
    }
    XCTAssertEqual(result?.outcome, .writeFailed)
    XCTAssertEqual(try database.text(database.records[mainID]), "mine")
    XCTAssertEqual(try database.histories(targetName).map(database.text), ["mine"])
  }

  private var mainID: CKRecord.ID {
    CKRecord.ID(recordName: VoyagerICloudRecordIdentity.recordName(for: targetName))
  }

  private func write(_ database: MemoryICloudRecordDatabase, _ json: String)
    -> Result<VoyagerICloudUploadReceipt, Error>
  {
    var result: Result<VoyagerICloudUploadReceipt, Error> = .failure(
      VoyagerICloudFailure.invalidPayload)
    VoyagerICloudUploadTransactions(store: ICloudUploadStore(database: database)).write(
      fileName: targetName, json: json, expectedVersion: database.records[mainID]?.recordChangeTag
    ) { result = $0 }
    return result
  }
}
