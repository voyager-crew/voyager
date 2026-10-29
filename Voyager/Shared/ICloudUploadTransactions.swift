import Foundation

/// The fetched handle carries the provider's CAS identity; bytes and version come from that same read.
struct VoyagerICloudStoredVersion<Handle> {
  let json: String
  let version: String
  let handle: Handle
}

struct VoyagerICloudHistoryVersion {
  let id: String
  let createdAt: Date?
}

protocol VoyagerICloudUploadStore {
  associatedtype Handle
  func fetch(
    fileName: String,
    completion: @escaping (Result<VoyagerICloudStoredVersion<Handle>?, Error>) -> Void
  )
  func history(
    id: String, fileName: String, completion: @escaping (Result<String?, Error>) -> Void
  )
  func archive(
    fileName: String, json: String,
    completion: @escaping (Result<VoyagerICloudHistoryVersion, Error>) -> Void
  )
  func histories(
    fileName: String, completion: @escaping (Result<[VoyagerICloudHistoryVersion], Error>) -> Void
  )
  func save(
    fileName: String, json: String, previous: Handle?,
    completion: @escaping (Result<VoyagerICloudStoredVersion<Handle>, Error>) -> Void
  )
  func remove(fileName: String, completion: @escaping (Result<Void, Error>) -> Void)
}

/// Owns immutable before-images, version-bound writes and exact per-upload Undo for both native entrypoints.
final class VoyagerICloudUploadTransactions<Store: VoyagerICloudUploadStore> {
  private let store: Store

  init(store: Store) { self.store = store }

  func write(
    fileName: String, json: String, expectedVersion: String?,
    completion: @escaping (Result<VoyagerICloudUploadReceipt, Error>) -> Void
  ) {
    store.fetch(fileName: fileName) { result in
      switch result {
      case .failure(let error): completion(.failure(error))
      case .success(let previous):
        // The plan was built from this version; a newer fetch is not permission to overwrite it.
        guard previous?.version == expectedVersion else {
          completion(.failure(VoyagerICloudFailure.conflict(fileName: fileName)))
          return
        }
        let commit: (VoyagerICloudHistoryVersion?) -> Void = { archive in
          self.store.save(fileName: fileName, json: json, previous: previous?.handle) { saved in
            switch saved {
            case .failure(let error): completion(.failure(error))
            case .success(let written):
              let receipt = VoyagerICloudUploadReceipt(
                name: fileName, fileId: fileName,
                md5Checksum: VoyagerICloudRawPayload.checksum(written.json),
                replaced: archive.map { .history($0.id) } ?? .created
              )
              completion(.success(receipt))
            }
          }
        }
        if let previous {
          self.store.archive(fileName: fileName, json: previous.json) { archived in
            switch archived {
            case .success(let entry): commit(entry)
            case .failure(let error): completion(.failure(error))
            }
          }
        } else {
          commit(nil)
        }
      }
    }
  }

  func undo(
    _ receipt: VoyagerICloudUploadReceipt,
    completion: @escaping (VoyagerICloudUndoResponse) -> Void
  ) {
    let finish: (VoyagerICloudUndoResponse.Outcome) -> Void = {
      completion(VoyagerICloudUndoResponse(name: receipt.name, outcome: $0))
    }
    store.fetch(fileName: receipt.name) { result in
      switch result {
      case .failure: finish(.readFailed)
      case .success(let current):
        guard let current else {
          finish(receipt.replaced == .created ? .removed : .kept)
          return
        }
        guard self.matches(current, receipt) else {
          finish(.kept)
          return
        }
        switch receipt.replaced {
        case .created:
          self.removeCreated(receipt, current: current, finish: finish)
        case .history(let id):
          self.restore(receipt, current: current, historyId: id) { outcome, historyId in
            completion(
              VoyagerICloudUndoResponse(
                name: receipt.name, outcome: outcome, retentionHistoryId: historyId))
          }
        }
      }
    }
  }

  private func matches(
    _ current: VoyagerICloudStoredVersion<Store.Handle>, _ receipt: VoyagerICloudUploadReceipt
  ) -> Bool {
    VoyagerICloudRawPayload.checksum(current.json) == receipt.md5Checksum
  }

  private func removeCreated(
    _ receipt: VoyagerICloudUploadReceipt,
    current: VoyagerICloudStoredVersion<Store.Handle>,
    finish: @escaping (VoyagerICloudUndoResponse.Outcome) -> Void
  ) {
    // Keep the exact deleted bytes recoverable by ordinary restore-previous-version.
    store.archive(fileName: receipt.name, json: current.json) { archived in
      guard case .success = archived else {
        finish(.writeFailed)
        return
      }
      self.store.fetch(fileName: receipt.name) { latest in
        switch latest {
        case .failure: finish(.readFailed)
        case .success(let current):
          guard let current, self.matches(current, receipt) else {
            finish(.kept)
            return
          }
          // CloudKit has no delete CAS. The accepted final-check→delete race starts here.
          self.store.remove(fileName: receipt.name) { removed in
            switch removed {
            case .success: finish(.removed)
            case .failure: finish(.writeFailed)
            }
          }
        }
      }
    }
  }

  private func restore(
    _ receipt: VoyagerICloudUploadReceipt,
    current: VoyagerICloudStoredVersion<Store.Handle>, historyId: String,
    completion: @escaping (VoyagerICloudUndoResponse.Outcome, String?) -> Void
  ) {
    let finish: (VoyagerICloudUndoResponse.Outcome) -> Void = { completion($0, nil) }
    guard VoyagerICloudHistoryIdentity.matches(historyId, fileName: receipt.name) else {
      finish(.noHistory)
      return
    }
    store.history(id: historyId, fileName: receipt.name) { history in
      switch history {
      case .failure: finish(.readFailed)
      case .success(nil): finish(.noHistory)
      case .success(let json?):
        // A failed final CAS can leave an extra immutable archive; never retire recovery data first.
        self.store.archive(fileName: receipt.name, json: current.json) { archived in
          switch archived {
          case .failure: finish(.writeFailed)
          case .success(let archive):
            self.store.fetch(fileName: receipt.name) { latest in
              switch latest {
              case .failure: finish(.readFailed)
              case .success(let current):
                guard let current, self.matches(current, receipt) else {
                  finish(.kept)
                  return
                }
                self.store.save(fileName: receipt.name, json: json, previous: current.handle) {
                  saved in
                  switch saved {
                  case .success:
                    completion(.restored(historyId), archive.id)
                  case .failure(let error):
                    finish(
                      (error as? VoyagerICloudFailure)?.code == .conflict ? .kept : .writeFailed)
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
