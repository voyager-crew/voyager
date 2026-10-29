import Foundation
import XCTest

@testable import VoyagerNativeCore

final class ICloudUploadTransactionsTests: XCTestCase {
  private let targetName = "gemini-voyager-prompts.json"

  func testStalePlanDoesNotOverwriteNewerDeviceOrArchiveStaleBytes() throws {
    let store = MemoryICloudStore()
    let original = store.put(targetName, "original")
    store.put(targetName, "other device")
    let result = write(store, json: "mine", expected: original.version)
    XCTAssertEqual((try failure(result) as? VoyagerICloudFailure)?.code, .conflict)
    XCTAssertEqual(store.files[targetName]?.json, "other device")
    XCTAssertTrue(store.archives.isEmpty)
  }

  func testArchiveKeepsExactOldBytesAndReceiptUsesOwnSaveWhenAnotherDeviceWritesImmediately() throws
  {
    let store = MemoryICloudStore()
    let raw = "\u{FEFF}  {future 🛟 format}\r\n"
    let original = store.put(targetName, raw)
    store.afterSave = { store.put(self.targetName, "other device after mine") }
    let receipt = try write(store, json: "abc", expected: original.version).get()
    guard case .history(let id) = receipt.replaced else { return XCTFail("missing before-image") }
    XCTAssertEqual(Data(try XCTUnwrap(store.archives[id]?.json).utf8), Data(raw.utf8))
    XCTAssertEqual(store.archives[id]?.fileName, targetName)
    XCTAssertEqual(receipt.md5Checksum, "900150983cd24fb0d6963f7d28e17f72")
    XCTAssertEqual(store.files[targetName]?.json, "other device after mine")
    XCTAssertEqual(store.fetchCount, 1)
  }

  func testCASRejectsAnotherDeviceBetweenFetchAndSaveAndKeepsArchive() throws {
    let store = MemoryICloudStore()
    let original = store.put(targetName, "original")
    store.beforeSave = { store.put(self.targetName, "concurrent") }
    let result = write(store, json: "mine", expected: original.version)
    XCTAssertEqual((try failure(result) as? VoyagerICloudFailure)?.code, .conflict)
    XCTAssertEqual(store.files[targetName]?.json, "concurrent")
    XCTAssertEqual(store.archives.values.map(\.json), ["original"])
  }

  func testFailedImmutableArchiveLeavesCurrentUntouched() throws {
    let store = MemoryICloudStore()
    let original = store.put(targetName, "original")
    store.failArchive = true
    _ = try failure(write(store, json: "mine", expected: original.version))
    XCTAssertEqual(store.files[targetName]?.json, "original")
    XCTAssertEqual(store.saveCount, 0)
  }

  func testFirstCreateHasAnAbsenceReceiptAndUndoRemovesOnlyThatUnchangedFile() throws {
    let store = MemoryICloudStore()
    let receipt = try write(store, json: "abc", expected: nil).get()
    XCTAssertEqual(receipt.replaced, .created)
    XCTAssertEqual(receipt.name, targetName)
    XCTAssertEqual(receipt.fileId, targetName)
    XCTAssertEqual(undo(store, receipt).outcome, .removed)
    XCTAssertNil(store.files[targetName])
    XCTAssertEqual(store.archives.values.map(\.json), ["abc"])
    XCTAssertEqual(store.archives.values.map(\.fileName), [targetName])
  }

  func testFirstCreateUndoKeepsTheFileIfArchivingFailsOrAnotherDeviceWritesDuringArchive() throws {
    for failsArchive in [true, false] {
      let store = MemoryICloudStore()
      let receipt = try write(store, json: "mine", expected: nil).get()
      store.failArchive = failsArchive
      if !failsArchive { store.afterArchive = { store.put(self.targetName, "later device") } }
      XCTAssertEqual(undo(store, receipt).outcome, failsArchive ? .writeFailed : .kept)
      XCTAssertEqual(store.files[targetName]?.json, failsArchive ? "mine" : "later device")
      XCTAssertEqual(store.removeCount, 0)
    }
  }

  func testCreateDoesNotClaimAbsenceIfAnotherDeviceCreatedTheFile() throws {
    let store = MemoryICloudStore()
    store.put(targetName, "other device")
    XCTAssertEqual(
      (try failure(write(store, json: "mine", expected: nil)) as? VoyagerICloudFailure)?.code,
      .conflict)
    XCTAssertEqual(store.files[targetName]?.json, "other device")
    XCTAssertEqual(store.saveCount, 0)
  }

  func testUndoKeepsALaterDeviceVersionForReplacementAndFirstCreate() throws {
    for existing in [false, true] {
      let store = MemoryICloudStore()
      let prior = existing ? store.put(targetName, "original").version : nil
      let receipt = try write(store, json: "mine", expected: prior).get()
      store.put(targetName, "later device")
      XCTAssertEqual(undo(store, receipt).outcome, .kept)
      XCTAssertEqual(store.files[targetName]?.json, "later device")
      XCTAssertEqual(store.removeCount, 0)
    }
  }

  func testUndoRestoresExactReceiptHistoryRatherThanNewestHistory() throws {
    let store = MemoryICloudStore()
    let raw = "\u{FEFF}  {future 🛟 format}\r\n"
    let original = store.put(targetName, raw)
    let receipt = try write(store, json: "mine", expected: original.version).get()
    let unrelated = VoyagerICloudHistoryIdentity.make(fileName: targetName)
    store.archives[unrelated] = (targetName, "newest unrelated history")
    guard case .history(let id) = receipt.replaced else { return XCTFail("missing before-image") }
    XCTAssertEqual(undo(store, receipt).outcome, .restored(id))
    XCTAssertEqual(Data(try XCTUnwrap(store.files[targetName]?.json).utf8), Data(raw.utf8))
    XCTAssertTrue(store.archives.values.contains { $0.json == "mine" })
  }

  func testUndoRechecksAfterHistoryReadAndUsesCASAtTheFinalWrite() throws {
    for afterHistory in [false, true] {
      let store = MemoryICloudStore()
      let original = store.put(targetName, "original")
      let receipt = try write(store, json: "mine", expected: original.version).get()
      if afterHistory {
        store.afterHistory = { store.put(self.targetName, "later device") }
      } else {
        store.beforeSave = { store.put(self.targetName, "later device") }
      }
      XCTAssertEqual(undo(store, receipt).outcome, .kept)
      XCTAssertEqual(store.files[targetName]?.json, "later device")
    }
  }

  func testForeignAccountHistoryCannotBeRestoredWithAForgedReceipt() {
    let store = MemoryICloudStore()
    let current = store.put(targetName, "mine")
    let other = "gemini-voyager-folders_other_account.json"
    let foreign = VoyagerICloudHistoryIdentity.make(fileName: other)
    store.archives[foreign] = (other, "private other account")
    let receipt = VoyagerICloudUploadReceipt(
      name: targetName, fileId: targetName,
      md5Checksum: VoyagerICloudRawPayload.checksum(current.json),
      replaced: .history(foreign)
    )
    XCTAssertEqual(undo(store, receipt).outcome, .noHistory)
    XCTAssertEqual(store.files[targetName]?.json, "mine")
    XCTAssertEqual(store.historyReads, 0)
    XCTAssertThrowsError(try receipt.validated())
  }

  func testMissingHistoryAndArchiveFailureDoNotMutateCurrentDuringUndo() throws {
    let store = MemoryICloudStore()
    let original = store.put(targetName, "original")
    let receipt = try write(store, json: "mine", expected: original.version).get()
    guard case .history(let id) = receipt.replaced else { return XCTFail("missing before-image") }
    let archive = store.archives.removeValue(forKey: id)
    XCTAssertEqual(undo(store, receipt).outcome, .noHistory)
    store.archives[id] = archive
    store.failArchive = true
    XCTAssertEqual(undo(store, receipt).outcome, .writeFailed)
    XCTAssertEqual(store.files[targetName]?.json, "mine")
  }

  private func write(
    _ store: MemoryICloudStore, json: String, expected: String?
  ) -> Result<VoyagerICloudUploadReceipt, Error> {
    var result: Result<VoyagerICloudUploadReceipt, Error> = .failure(
      MemoryICloudStore.Failure.testNotCompleted)
    VoyagerICloudUploadTransactions(store: store).write(
      fileName: targetName, json: json, expectedVersion: expected
    ) { result = $0 }
    return result
  }

  private func undo(
    _ store: MemoryICloudStore, _ receipt: VoyagerICloudUploadReceipt
  ) -> VoyagerICloudUndoResponse {
    var result = VoyagerICloudUndoResponse(name: targetName, outcome: .readFailed)
    VoyagerICloudUploadTransactions(store: store).undo(receipt) { result = $0 }
    return result
  }

  private func failure<T>(_ result: Result<T, Error>) throws -> Error {
    switch result {
    case .failure(let error): return error
    case .success: throw MemoryICloudStore.Failure.expectedFailure
    }
  }
}

private final class MemoryICloudStore: VoyagerICloudUploadStore {
  typealias Handle = Int
  enum Failure: Error { case archive, expectedFailure, testNotCompleted }
  var files: [String: VoyagerICloudStoredVersion<Int>] = [:]
  var archives: [String: (fileName: String, json: String)] = [:]
  var beforeSave: (() -> Void)?
  var afterSave: (() -> Void)?
  var afterHistory: (() -> Void)?
  var afterArchive: (() -> Void)?
  var failArchive = false
  var fetchCount = 0
  var saveCount = 0
  var removeCount = 0
  var historyReads = 0
  private var nextVersion = 0
  private var archiveOrder: [String: Date] = [:]

  @discardableResult func put(_ name: String, _ json: String) -> VoyagerICloudStoredVersion<Int> {
    nextVersion += 1
    let record = VoyagerICloudStoredVersion(
      json: json, version: String(nextVersion), handle: nextVersion)
    files[name] = record
    return record
  }

  func fetch(
    fileName: String,
    completion: @escaping (Result<VoyagerICloudStoredVersion<Int>?, Error>) -> Void
  ) {
    fetchCount += 1
    completion(.success(files[fileName]))
  }

  func history(id: String, fileName: String, completion: @escaping (Result<String?, Error>) -> Void)
  {
    historyReads += 1
    let entry = archives[id]
    let json = entry?.fileName == fileName ? entry?.json : nil
    let hook = afterHistory
    afterHistory = nil
    hook?()
    completion(.success(json))
  }

  func archive(
    fileName: String, json: String,
    completion: @escaping (Result<VoyagerICloudHistoryVersion, Error>) -> Void
  ) {
    if failArchive {
      completion(.failure(Failure.archive))
      return
    }
    let id = VoyagerICloudHistoryIdentity.make(fileName: fileName)
    archives[id] = (fileName, json)
    let date = Date()
    archiveOrder[id] = date
    let hook = afterArchive
    afterArchive = nil
    hook?()
    completion(.success(VoyagerICloudHistoryVersion(id: id, createdAt: date)))
  }

  func histories(
    fileName: String, completion: @escaping (Result<[VoyagerICloudHistoryVersion], Error>) -> Void
  ) {
    completion(
      .success(
        archives.compactMap { id, entry in
          entry.fileName == fileName
            ? VoyagerICloudHistoryVersion(id: id, createdAt: archiveOrder[id] ?? .distantPast) : nil
        }.sorted { ($0.createdAt ?? .distantPast) > ($1.createdAt ?? .distantPast) }))
  }

  func save(
    fileName: String, json: String, previous: Int?,
    completion: @escaping (Result<VoyagerICloudStoredVersion<Int>, Error>) -> Void
  ) {
    saveCount += 1
    let hook = beforeSave
    beforeSave = nil
    hook?()
    guard files[fileName]?.handle == previous else {
      completion(.failure(VoyagerICloudFailure.conflict(fileName: fileName)))
      return
    }
    let saved = put(fileName, json)
    let after = afterSave
    afterSave = nil
    after?()
    completion(.success(saved))
  }

  func remove(fileName: String, completion: @escaping (Result<Void, Error>) -> Void) {
    removeCount += 1
    files.removeValue(forKey: fileName)
    completion(.success(()))
  }
}
