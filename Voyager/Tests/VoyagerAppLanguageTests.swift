import XCTest

@testable import VoyagerNativeCore

final class VoyagerAppLanguageTests: XCTestCase {
  func testEveryVoyagerLanguageHasAnAppTranslation() {
    let appDirectory = URL(fileURLWithPath: #filePath)
      .deletingLastPathComponent()
      .deletingLastPathComponent()
      .appendingPathComponent("App")

    for language in VoyagerAppLanguage.allCases {
      let table = appDirectory.appendingPathComponent(
        "\(language.appleLocalization).lproj/Localizable.strings")
      XCTAssertTrue(
        FileManager.default.fileExists(atPath: table.path),
        "\(language.rawValue) launches into a language the app has no strings for"
      )
    }
  }

  func testAppFollowsVoyagerLanguageOverTheSystemOne() {
    XCTAssertEqual(
      VoyagerAppLanguageLaunch.languages(for: .zh, launchArguments: [:]),
      ["zh-Hans"]
    )
    // Nothing handed over yet: the system language decides.
    XCTAssertNil(VoyagerAppLanguageLaunch.languages(for: nil, launchArguments: [:]))
  }

  func testLaunchArgumentsStillChooseTheLanguage() {
    XCTAssertNil(
      VoyagerAppLanguageLaunch.languages(
        for: .zh, launchArguments: ["AppleLanguages": ["ar"]]
      )
    )
  }

  func testLaunchLanguageIsAppliedWithoutLosingOtherArguments() throws {
    let suite = "VoyagerAppLanguageTests.\(UUID().uuidString)"
    let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
    defer { defaults.removePersistentDomain(forName: suite) }
    defaults.setVolatileDomain(["NSQuitAlwaysKeepsWindows": false], forName: UserDefaults.argumentDomain)

    VoyagerAppLanguageLaunch.apply(.zhTW, to: defaults)

    let arguments = defaults.volatileDomain(forName: UserDefaults.argumentDomain)
    XCTAssertEqual(arguments["AppleLanguages"] as? [String], ["zh-Hant"])
    XCTAssertEqual(arguments["AppleTextDirection"] as? Bool, false)
    XCTAssertEqual(arguments["NSQuitAlwaysKeepsWindows"] as? Bool, false)
    // Never written to the app's saved preferences.
    XCTAssertNil(defaults.persistentDomain(forName: suite)?["AppleLanguages"])
  }

  func testArabicMirrorsTheWindowWhateverTheSystemLanguage() throws {
    let suite = "VoyagerAppLanguageTests.\(UUID().uuidString)"
    let defaults = try XCTUnwrap(UserDefaults(suiteName: suite))
    defer { defaults.removePersistentDomain(forName: suite) }
    defaults.setVolatileDomain([:], forName: UserDefaults.argumentDomain)

    VoyagerAppLanguageLaunch.apply(.ar, to: defaults)

    let arguments = defaults.volatileDomain(forName: UserDefaults.argumentDomain)
    XCTAssertEqual(arguments["AppleLanguages"] as? [String], ["ar"])
    XCTAssertEqual(arguments["AppleTextDirection"] as? Bool, true)
    XCTAssertEqual(
      VoyagerAppLanguage.allCases.filter(\.isRightToLeft), [.ar])
  }

  func testSharedStateKeepsOnlyLanguagesVoyagerOffers() {
    let store = MemoryValueStore()
    let state = VoyagerSharedState(store: store)

    XCTAssertTrue(state.setAppLanguage(.ar))
    XCTAssertEqual(state.appLanguage, .ar)

    store.values["appLanguage"] = "de"
    XCTAssertNil(state.appLanguage)
  }

  func testNativeMessageCarriesOnlySupportedLanguages() throws {
    XCTAssertEqual(
      try VoyagerNativeMessageCodec.decodeRequest(from: [
        "action": "setAppLanguage", "language": "zh_TW",
      ]),
      .setAppLanguage(.zhTW)
    )
    XCTAssertThrowsError(
      try VoyagerNativeMessageCodec.decodeRequest(from: [
        "action": "setAppLanguage", "language": "de",
      ])
    )
  }
}
