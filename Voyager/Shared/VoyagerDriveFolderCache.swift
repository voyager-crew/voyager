import Foundation

/// The backup folder each Google account's Drive resolved, and the resolution in flight for each.
///
/// Folder lookups take network round trips, and the app can store another account while one is
/// out. Every entry, every waiter and every late answer is keyed by the account that asked, so an
/// answer that arrives after a change of account only ever serves the account it came from.
final class VoyagerDriveFolderCache {
  typealias Completion = (Result<String, Error>) -> Void

  private let lock = NSLock()
  private var folders: [String: String] = [:]
  private var waiters: [String: [Completion]] = [:]

  func folder(for account: String) -> String? {
    lock.lock()
    defer { lock.unlock() }
    return folders[account]
  }

  func remember(_ folderID: String, for account: String) {
    lock.lock()
    folders[account] = folderID
    lock.unlock()
  }

  /// Drops a folder found missing, unless the account has resolved another one since.
  func forget(_ folderID: String, for account: String) {
    lock.lock()
    if folders[account] == folderID { folders[account] = nil }
    lock.unlock()
  }

  /// Sign-out. Resolutions in flight still answer the callers that wait on them.
  func removeAll() {
    lock.lock()
    folders.removeAll()
    lock.unlock()
  }

  /// Runs `start` once per account at a time: a caller that arrives while the same account's
  /// resolution is out shares its answer, and never waits on another account's.
  func resolve(
    for account: String,
    completion: @escaping Completion,
    start: (@escaping Completion) -> Void
  ) {
    lock.lock()
    let inFlight = waiters[account] != nil
    waiters[account, default: []].append(completion)
    lock.unlock()
    guard !inFlight else { return }

    start { result in
      self.lock.lock()
      let answered = self.waiters.removeValue(forKey: account) ?? []
      self.lock.unlock()
      answered.forEach { $0(result) }
    }
  }
}
