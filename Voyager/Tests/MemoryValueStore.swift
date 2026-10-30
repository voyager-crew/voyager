@testable import VoyagerNativeCore

/// The keychain slot both Voyager processes share, kept in memory.
final class MemoryValueStore: VoyagerSharedValueStore {
  var values: [String: String] = [:]

  func value(forKey key: String) -> String? { values[key] }

  func setValue(_ value: String?, forKey key: String) -> Bool {
    values[key] = value
    return true
  }
}
