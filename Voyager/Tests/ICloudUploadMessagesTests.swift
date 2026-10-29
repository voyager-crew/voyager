import Foundation
import XCTest

@testable import VoyagerNativeCore

final class ICloudUploadMessagesTests: XCTestCase {
  private let targetName = "gemini-voyager-prompts.json"

  func testUploadActionsRoundTripExplicitAbsenceAndExactReceipt() throws {
    let receipt = VoyagerICloudUploadReceipt(
      name: targetName, fileId: targetName, md5Checksum: "900150983cd24fb0d6963f7d28e17f72",
      replaced: .history(VoyagerICloudHistoryIdentity.make(fileName: targetName))
    )
    let actions: [VoyagerNativeRequest] = [
      .iCloudReadUploadVersion(fileName: targetName),
      .iCloudWriteUpload(
        VoyagerICloudUploadRequest(fileName: targetName, json: "abc", expectedVersion: nil)),
      .iCloudWriteUpload(
        VoyagerICloudUploadRequest(fileName: targetName, json: "abc", expectedVersion: "tag-7")),
      .iCloudUndoUpload(receipt),
      .iCloudReadHistory(fileName: targetName, includingHistoryId: nil),
      .iCloudReadHistory(
        fileName: targetName,
        includingHistoryId: VoyagerICloudHistoryIdentity.make(fileName: targetName)),
      .iCloudRestoreHistory(
        VoyagerICloudRestoreHistoryRequest(
          fileName: targetName, historyId: VoyagerICloudHistoryIdentity.make(fileName: targetName),
          expectedVersion: nil)),
      .iCloudPruneHistory(
        VoyagerICloudPruneHistoryRequest(
          fileName: targetName, historyIds: [], protectedHistoryId: nil)),
    ]
    for action in actions {
      let bytes = try JSONEncoder().encode(action)
      XCTAssertEqual(try JSONDecoder().decode(VoyagerNativeRequest.self, from: bytes), action)
    }
    let absent = try JSONEncoder().encode(actions[1])
    let object = try XCTUnwrap(JSONSerialization.jsonObject(with: absent) as? [String: Any])
    XCTAssertTrue(object["expectedVersion"] is NSNull)
  }

  func testNativeUploadRequiresAnExplicitPrereadVersionEvenWhenAbsent() {
    XCTAssertThrowsError(
      try VoyagerNativeMessageCodec.decodeRequest(from: [
        "action": "iCloudWriteUpload", "fileName": targetName, "json": "{}",
      ]))
  }

  func testUnversionedICloudWriteCannotBypassTheUploadTransaction() {
    XCTAssertThrowsError(
      try VoyagerNativeMessageCodec.decodeRequest(from: [
        "action": "iCloudWriteFile", "fileName": targetName, "json": "{}",
      ]))
  }

  func testNativeUndoRejectsReceiptForAnotherAccountHistoryOrFileID() throws {
    let historyID = VoyagerICloudHistoryIdentity.make(fileName: "another-account.json")
    let base: [String: Any] = [
      "name": targetName, "fileId": targetName, "md5Checksum": String(repeating: "a", count: 32),
      "replaced": ["kind": "history", "historyId": historyID],
    ]
    XCTAssertThrowsError(
      try VoyagerNativeMessageCodec.decodeRequest(from: [
        "action": "iCloudUndoUpload", "receipt": base,
      ]))
    var differentFile = base
    differentFile["fileId"] = "another-account.json"
    differentFile["replaced"] = ["kind": "created"]
    XCTAssertThrowsError(
      try VoyagerNativeMessageCodec.decodeRequest(from: [
        "action": "iCloudUndoUpload", "receipt": differentFile,
      ]))
  }

  func testRawPayloadPreservesBOMWhitespaceAndUnknownFormats() throws {
    let bytes = Data("\u{FEFF}  {future 🛟 format}\r\n".utf8)
    XCTAssertEqual(Data(try VoyagerICloudRawPayload.decode(bytes).utf8), bytes)
    XCTAssertThrowsError(try VoyagerICloudRawPayload.decode(Data([0xFF])))
    XCTAssertEqual(VoyagerICloudRawPayload.checksum("abc"), "900150983cd24fb0d6963f7d28e17f72")
  }

  func testUndoResponseKeepsExistingPerFileStatusShape() throws {
    let response = VoyagerNativeResponse.success(
      VoyagerICloudUndoResponse(name: targetName, outcome: .restored("exact-before-image"))
    )
    let message = try VoyagerNativeMessageCodec.encodeResponse(response)
    let data = try XCTUnwrap(message["data"] as? [String: Any])
    XCTAssertEqual(data["name"] as? String, targetName)
    XCTAssertEqual(data["status"] as? String, "restored")
    XCTAssertEqual(data["historyId"] as? String, "exact-before-image")
  }
}
