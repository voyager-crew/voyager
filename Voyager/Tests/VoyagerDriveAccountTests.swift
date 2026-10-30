import XCTest

@testable import VoyagerNativeCore

final class VoyagerDriveAccountTests: XCTestCase {
  func testAccountNameIsStableAndRevealsNoToken() {
    let name = VoyagerDriveAccount.name(forIdentity: "1//refresh-token-a")

    XCTAssertEqual(name, VoyagerDriveAccount.name(forIdentity: "1//refresh-token-a"))
    XCTAssertNotEqual(name, VoyagerDriveAccount.name(forIdentity: "1//refresh-token-b"))
    XCTAssertFalse(name.contains("refresh"))
    XCTAssertEqual(name.count, 32)
  }

  func testRequestsNameTheAccountTheirSessionExpects() throws {
    XCTAssertNil(try VoyagerDriveAccount.expected(in: ["action": "googleDriveFindFile"]))
    XCTAssertEqual(
      try VoyagerDriveAccount.expected(in: ["expectedDriveAccount": "account-a"]), "account-a")
    XCTAssertThrowsError(try VoyagerDriveAccount.expected(in: ["expectedDriveAccount": ""]))
    XCTAssertThrowsError(try VoyagerDriveAccount.expected(in: ["expectedDriveAccount": 7]))
  }

  func testTransferBoundToAnotherAccountIsRefusedBeforeItRuns() {
    XCTAssertNil(VoyagerDriveAccountCheck(expected: "account-a", current: "account-b"))

    let unbound = VoyagerDriveAccountCheck(expected: nil, current: "account-b")
    XCTAssertEqual(unbound?.account, "account-b")
    XCTAssertEqual(unbound?.writeAccount, "account-b")
    // Signed out: the action runs and fails with its own authorization error.
    let signedOut = VoyagerDriveAccountCheck(expected: "account-a", current: nil)
    XCTAssertEqual(signedOut?.writeAccount, "account-a")
  }

  func testAccountReplacedWhileTheActionRanFailsIt() throws {
    let check = try XCTUnwrap(VoyagerDriveAccountCheck(expected: "account-a", current: "account-a"))

    XCTAssertTrue(check.held(byCurrent: "account-a"))
    XCTAssertFalse(check.held(byCurrent: "account-b"))
    XCTAssertTrue(check.held(byCurrent: nil))
    XCTAssertFalse(
      try XCTUnwrap(VoyagerDriveAccountCheck(expected: nil, current: nil)).held(
        byCurrent: "account-b"))
  }
}
