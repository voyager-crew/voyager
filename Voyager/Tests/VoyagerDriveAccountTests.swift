import XCTest

@testable import VoyagerNativeCore

final class VoyagerDriveAccountTests: XCTestCase {
  func testAccountNameFollowsTheGoogleAccountAndRevealsNoToken() {
    let name = VoyagerDriveAccount.name(userID: "1001", authorization: "1//refresh-token-a")

    // Signing the same account in again keeps its name; another account gets another.
    XCTAssertEqual(name, VoyagerDriveAccount.name(userID: "1001", authorization: "1//refresh-b"))
    XCTAssertNotEqual(name, VoyagerDriveAccount.name(userID: "2002", authorization: "1//refresh-a"))
    XCTAssertFalse(name.contains("1001"))
    XCTAssertEqual(name.count, 32)
    // Without a user ID the authorization names the account, never colliding with a user ID.
    XCTAssertNotEqual(
      VoyagerDriveAccount.name(userID: nil, authorization: "x"),
      VoyagerDriveAccount.name(userID: nil, authorization: "y"))
    XCTAssertNotEqual(
      VoyagerDriveAccount.name(userID: nil, authorization: "x"),
      VoyagerDriveAccount.name(userID: "x", authorization: "x"))
  }

  func testRequestsNameTheAccountTheirSessionExpects() throws {
    XCTAssertNil(try VoyagerDriveAccount.expected(in: ["action": "googleDriveFindFile"]))
    XCTAssertEqual(
      try VoyagerDriveAccount.expected(in: ["expectedDriveAccount": "account-a"]), "account-a")
    XCTAssertThrowsError(try VoyagerDriveAccount.expected(in: ["expectedDriveAccount": ""]))
    XCTAssertThrowsError(try VoyagerDriveAccount.expected(in: ["expectedDriveAccount": 7]))
  }

  func testActionBoundToAnotherAccountIsRefusedBeforeItStarts() throws {
    XCTAssertThrowsError(
      try VoyagerDriveAccountScope.forAction(expected: "account-a", current: "account-b")
    ) { error in
      XCTAssertEqual(error as? VoyagerGoogleDriveFailure, .accountChanged)
    }
    XCTAssertEqual(
      try VoyagerDriveAccountScope.forAction(expected: nil, current: "account-b")?.account,
      "account-b")
    XCTAssertEqual(
      try VoyagerDriveAccountScope.forAction(expected: "account-a", current: "account-a")?.account,
      "account-a")
    // Signed out: no scope, so the action answers as signed out.
    XCTAssertNil(try VoyagerDriveAccountScope.forAction(expected: "account-a", current: nil))
  }

  func testScopedWriteIsRefusedOnceTheAppStoresAnotherAccount() {
    // ensureFile for A: its folder query finds nothing, then the app signs in B before the folder
    // and the sync file are created.
    let drive = ScopedDrive(stored: "account-a")
    let scope = VoyagerDriveAccountScope(account: "account-a")

    XCTAssertNil(drive.send("GET", in: scope))
    drive.stored = "account-b"
    XCTAssertEqual(drive.send("POST", in: scope), .accountChanged)
    XCTAssertEqual(drive.send("POST", in: scope), .accountChanged)

    XCTAssertEqual(drive.sent["account-b"], nil, "nothing reaches the new account's Drive")
    XCTAssertEqual(drive.sent["account-a"], ["GET"])
  }

  func testRefusalSaysWhetherTheActionHadWrittenToThePreviousAccount() {
    // A legacy folder is marked for A, then B is stored before the sync file is created.
    let drive = ScopedDrive(stored: "account-a")
    let scope = VoyagerDriveAccountScope(account: "account-a")

    XCTAssertNil(drive.send("PATCH", in: scope))
    drive.stored = "account-b"

    XCTAssertEqual(drive.send("POST", in: scope), .accountChangedAfterWrite)
    XCTAssertEqual(drive.sent["account-a"], ["PATCH"])
    XCTAssertNil(drive.sent["account-b"])
    // Signed out mid-action: the request is left to fail as signed out.
    XCTAssertTrue(scope.admits(storedAccount: nil))
  }
}

/// Sends requests the way `GoogleDriveService.performRequest` does: only with a token of the
/// scope's account, recording a write just before it leaves.
private final class ScopedDrive {
  var stored: String
  private(set) var sent: [String: [String]] = [:]

  init(stored: String) {
    self.stored = stored
  }

  func send(_ method: String, in scope: VoyagerDriveAccountScope) -> VoyagerGoogleDriveFailure? {
    guard scope.admits(storedAccount: stored) else { return scope.refusal }
    if method != "GET" { scope.recordWrite() }
    sent[stored, default: []].append(method)
    return nil
  }
}
