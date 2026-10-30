import Foundation
import Security

/// A string slot both Voyager processes can read and write.
protocol VoyagerSharedValueStore {
  func value(forKey key: String) -> String?
  /// Removes the slot when `value` is nil. Returns false when the store refused the write.
  @discardableResult
  func setValue(_ value: String?, forKey key: String) -> Bool
}

/// The containing app and the Safari extension already share one keychain access
/// group (the Google session crosses between them there), so a small generic
/// password in it reaches the other process without an app group entitlement.
struct VoyagerKeychainValueStore: VoyagerSharedValueStore {
  var service = "fun.nagi.voyager.shared"

  func value(forKey key: String) -> String? {
    var query = baseQuery(forKey: key)
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: AnyObject?
    guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
      let data = result as? Data
    else { return nil }
    return String(data: data, encoding: .utf8)
  }

  @discardableResult
  func setValue(_ value: String?, forKey key: String) -> Bool {
    let query = baseQuery(forKey: key)
    guard let value else {
      let status = SecItemDelete(query as CFDictionary)
      return status == errSecSuccess || status == errSecItemNotFound
    }
    let data = Data(value.utf8)
    let updated = SecItemUpdate(
      query as CFDictionary,
      [kSecValueData as String: data] as CFDictionary
    )
    guard updated == errSecItemNotFound else { return updated == errSecSuccess }
    var item = query
    item[kSecValueData as String] = data
    // Background handoff launches can run before the user unlocks anything else.
    item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
    return SecItemAdd(item as CFDictionary, nil) == errSecSuccess
  }

  private func baseQuery(forKey key: String) -> [String: Any] {
    [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: key,
      // The data-protection keychain honours the shared access group; the file
      // keychain would tie each item to the process that wrote it.
      kSecUseDataProtectionKeychain as String: true,
    ]
  }
}

/// What the containing app and the Safari extension tell each other between launches.
struct VoyagerSharedState {
  private enum Key {
    static let googleDriveSignedInAt = "googleDriveSignedInAt"
    static let appLanguage = "appLanguage"
  }

  static let keychain = VoyagerSharedState(store: VoyagerKeychainValueStore())

  let store: VoyagerSharedValueStore

  /// When the app last completed a Google Drive sign-in, in milliseconds since 1970.
  /// The extension compares it with when the popup started a connect.
  var googleDriveSignedInAt: Int64? {
    store.value(forKey: Key.googleDriveSignedInAt).flatMap { Int64($0) }
  }

  @discardableResult
  func recordGoogleDriveSignIn(at date: Date) -> Bool {
    let milliseconds = Int64((date.timeIntervalSince1970 * 1_000).rounded())
    return store.setValue(String(milliseconds), forKey: Key.googleDriveSignedInAt)
  }

  /// The language chosen in Voyager, which the extension hands over whenever it changes.
  var appLanguage: VoyagerAppLanguage? {
    store.value(forKey: Key.appLanguage).flatMap(VoyagerAppLanguage.init(rawValue:))
  }

  /// Writes only a change, since the extension repeats the language on every start.
  @discardableResult
  func setAppLanguage(_ language: VoyagerAppLanguage) -> Bool {
    appLanguage == language || store.setValue(language.rawValue, forKey: Key.appLanguage)
  }
}
