import Foundation

/// A language Voyager offers, under the code the web extension stores.
enum VoyagerAppLanguage: String, CaseIterable, Codable {
  case en
  case ar
  case es
  case fr
  case ja
  case ko
  case pt
  case ru
  case zh
  case zhTW = "zh_TW"

  /// The containing app's `.lproj` for this language. Script codes match any region
  /// of the same script, and plain `pt` matches both Brazil and Portugal.
  var appleLocalization: String {
    switch self {
    case .zh: return "zh-Hans"
    case .zhTW: return "zh-Hant"
    default: return rawValue
    }
  }

  var isRightToLeft: Bool {
    Locale.characterDirection(forLanguage: appleLocalization) == .rightToLeft
  }
}

/// The containing app follows the language chosen in Voyager rather than the system's,
/// so a person with an English Mac and a Chinese Voyager sees one language throughout.
enum VoyagerAppLanguageLaunch {
  static let preferenceKey = "AppleLanguages"
  /// AppKit mirrors the layout from this, which otherwise follows the system language:
  /// Arabic text would sit in a left-to-right window on an English Mac.
  static let textDirectionKey = "AppleTextDirection"

  /// Languages to launch with, or nil to keep the system's choice: when Voyager has not
  /// told the app a language yet, or when launch arguments already chose one.
  static func languages(
    for language: VoyagerAppLanguage?,
    launchArguments: [String: Any]
  ) -> [String]? {
    guard launchArguments[preferenceKey] == nil, let language else { return nil }
    return [language.appleLocalization]
  }

  /// Must run before AppKit loads any localized resource. The argument domain is never
  /// saved, so the app's own preferences file keeps whatever the person set there.
  static func apply(_ language: VoyagerAppLanguage?, to defaults: UserDefaults) {
    var arguments = defaults.volatileDomain(forName: UserDefaults.argumentDomain)
    guard let language, let languages = languages(for: language, launchArguments: arguments)
    else { return }
    arguments[preferenceKey] = languages
    if arguments[textDirectionKey] == nil {
      arguments[textDirectionKey] = language.isRightToLeft
    }
    defaults.setVolatileDomain(arguments, forName: UserDefaults.argumentDomain)
  }
}

/// The app's text for `key` in its launch language, or `english` when no table has it.
func voyagerLocalized(_ key: String, _ english: String) -> String {
  Bundle.main.localizedString(forKey: key, value: english, table: nil)
}
