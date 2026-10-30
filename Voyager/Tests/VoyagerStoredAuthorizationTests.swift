import XCTest

@testable import VoyagerNativeCore

/// Stands in for GoogleSignIn's stored authorization: one account and its current access token.
private final class FakeAuthorization {
  let account: String
  var accessToken: String

  init(account: String, accessToken: String) {
    self.account = account
    self.accessToken = accessToken
  }
}

private func stored(_ account: String, refreshToken: String)
  -> VoyagerStoredAuthorization<FakeAuthorization>
{
  // Every read decodes a new copy, carrying the access token saved at sign-in.
  VoyagerStoredAuthorization(
    identity: refreshToken,
    authorization: FakeAuthorization(account: account, accessToken: "\(account)-at-sign-in")
  )
}

final class VoyagerStoredAuthorizationTests: XCTestCase {
  func testRequestAfterTheAppSignsInAnotherAccountUsesThatAccount() throws {
    let tracker = VoyagerStoredAuthorizationTracker<FakeAuthorization>()

    // Account A is in use and its access token has been refreshed in memory.
    let accountA = try XCTUnwrap(replaced(tracker.lookup(stored("a", refreshToken: "refresh-a"))))
    accountA.accessToken = "a-refreshed"
    let stillA = try XCTUnwrap(unchanged(tracker.lookup(stored("a", refreshToken: "refresh-a"))))
    XCTAssertTrue(stillA === accountA, "an unchanged keychain keeps the refreshed copy")

    // Change account: the app stores B. The very next request must use B.
    let accountB = try XCTUnwrap(replaced(tracker.lookup(stored("b", refreshToken: "refresh-b"))))
    XCTAssertEqual(accountB.account, "b")
    let afterwards = try XCTUnwrap(unchanged(tracker.lookup(stored("b", refreshToken: "refresh-b"))))
    XCTAssertTrue(afterwards === accountB)
  }

  func testSigningOutDropsTheCopyEvenWhenTheSameAccountReturns() throws {
    let tracker = VoyagerStoredAuthorizationTracker<FakeAuthorization>()
    let first = try XCTUnwrap(replaced(tracker.lookup(stored("a", refreshToken: "refresh-a"))))

    guard case .signedOut = tracker.lookup(nil) else {
      return XCTFail("an empty keychain means signed out")
    }
    // Signed in again later, with the same refresh token a copy was made from.
    let again = try XCTUnwrap(replaced(tracker.lookup(stored("a", refreshToken: "refresh-a"))))
    XCTAssertFalse(again === first)

    tracker.forget()
    XCTAssertNotNil(replaced(tracker.lookup(stored("a", refreshToken: "refresh-a"))))
  }

  private func replaced(_ lookup: VoyagerStoredAuthorizationTracker<FakeAuthorization>.Lookup)
    -> FakeAuthorization?
  {
    if case .replaced(let authorization) = lookup { return authorization }
    return nil
  }

  private func unchanged(_ lookup: VoyagerStoredAuthorizationTracker<FakeAuthorization>.Lookup)
    -> FakeAuthorization?
  {
    if case .unchanged(let authorization) = lookup { return authorization }
    return nil
  }
}
