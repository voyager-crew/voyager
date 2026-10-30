import XCTest

@testable import VoyagerNativeCore

final class VoyagerSharedStateTests: XCTestCase {
  func testDriveSignInTimeUsesTheExtensionsMilliseconds() {
    let state = VoyagerSharedState(store: MemoryValueStore())

    XCTAssertNil(state.googleDriveSignedInAt)
    // The extension compares this with Date.now() taken when the popup started the connect.
    state.recordGoogleDriveSignIn(at: Date(timeIntervalSince1970: 1_761_700_000.25))
    XCTAssertEqual(state.googleDriveSignedInAt, 1_761_700_000_250)
  }
}
