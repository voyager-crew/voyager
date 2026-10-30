import XCTest

@testable import VoyagerNativeCore

final class VoyagerDriveFolderCacheTests: XCTestCase {
  func testLateAnswerForThePreviousAccountNeverServesTheNextOne() {
    let cache = VoyagerDriveFolderCache()
    var answerA: VoyagerDriveFolderCache.Completion?
    var resultA: Result<String, Error>?
    var resultB: Result<String, Error>?

    // A's folder lookup is out when the app signs in B.
    cache.resolve(for: "account-a", completion: { resultA = $0 }) { answerA = $0 }
    // B's history asks for its folder before A's lookup answers: it finds none cached.
    XCTAssertNil(cache.folder(for: "account-b"))

    // A's lookup answers late and records A's folder, as the service's callbacks do.
    cache.remember("folder-a", for: "account-a")
    answerA?(.success("folder-a"))
    XCTAssertNil(cache.folder(for: "account-b"), "B's next lookup must not use A's folder")

    // B resolves on its own instead of waiting on A's lookup.
    var startedB = false
    cache.resolve(for: "account-b", completion: { resultB = $0 }) { answer in
      startedB = true
      cache.remember("folder-b", for: "account-b")
      answer(.success("folder-b"))
    }
    XCTAssertTrue(startedB)
    XCTAssertEqual(try resultA?.get(), "folder-a")
    XCTAssertEqual(try resultB?.get(), "folder-b")
    XCTAssertEqual(cache.folder(for: "account-a"), "folder-a")
    XCTAssertEqual(cache.folder(for: "account-b"), "folder-b")
  }

  func testAnAccountsCallersShareOneResolutionAndNoOtherAccountJoinsIt() {
    let cache = VoyagerDriveFolderCache()
    var startsA = 0
    var answerA: VoyagerDriveFolderCache.Completion?
    var answers: [String] = []

    cache.resolve(for: "account-a", completion: { answers.append("a1:\(try! $0.get())") }) {
      startsA += 1
      answerA = $0
    }
    cache.resolve(for: "account-a", completion: { answers.append("a2:\(try! $0.get())") }) { _ in
      startsA += 1
    }
    cache.resolve(for: "account-b", completion: { answers.append("b:\(try! $0.get())") }) {
      $0(.success("folder-b"))
    }
    XCTAssertEqual(startsA, 1)
    XCTAssertEqual(answers, ["b:folder-b"])

    answerA?(.success("folder-a"))
    XCTAssertEqual(answers, ["b:folder-b", "a1:folder-a", "a2:folder-a"])
  }

  func testAMissingFolderIsForgottenOnlyUntilTheAccountResolvesAnother() {
    let cache = VoyagerDriveFolderCache()
    cache.remember("folder-old", for: "account-a")
    cache.remember("folder-new", for: "account-a")

    cache.forget("folder-old", for: "account-a")
    XCTAssertEqual(cache.folder(for: "account-a"), "folder-new")
    cache.forget("folder-new", for: "account-a")
    XCTAssertNil(cache.folder(for: "account-a"))
  }

  func testSignOutClearsFoldersAndStillAnswersALookupInFlight() {
    let cache = VoyagerDriveFolderCache()
    var answer: VoyagerDriveFolderCache.Completion?
    var result: Result<String, Error>?
    cache.remember("folder-a", for: "account-a")
    cache.resolve(for: "account-b", completion: { result = $0 }) { answer = $0 }

    cache.removeAll()
    XCTAssertNil(cache.folder(for: "account-a"))
    answer?(.success("folder-b"))
    XCTAssertEqual(try result?.get(), "folder-b")
  }
}
