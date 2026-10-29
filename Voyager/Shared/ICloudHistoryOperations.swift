import CloudKit
import Foundation

struct VoyagerICloudHistoryFile: Codable {
  let id: String
  let json: String
  let createdTime: Double?
}

struct VoyagerICloudHistoryResponse: Codable {
  let files: [VoyagerICloudHistoryFile]
}

struct VoyagerICloudRestoreHistoryRequest: Codable, Equatable {
  let fileName: String
  let historyId: String
  let expectedVersion: String?
}

struct VoyagerICloudPruneHistoryRequest: Codable, Equatable {
  let fileName: String
  let historyIds: [String]
  let protectedHistoryId: String?
}

/// Native history authority and CAS writes; shared TypeScript payload readers choose retention/restore.
struct ICloudHistoryOperations {
  let database: VoyagerICloudRecordDatabase
  private var store: ICloudUploadStore { ICloudUploadStore(database: database) }

  func read(
    fileName: String, includingHistoryId: String?,
    completion: @escaping (Result<VoyagerICloudHistoryResponse, Error>) -> Void
  ) {
    if let includingHistoryId,
      !VoyagerICloudHistoryIdentity.matches(includingHistoryId, fileName: fileName)
    {
      completion(.failure(VoyagerICloudFailure.invalidPayload))
      return
    }
    store.histories(fileName: fileName) { result in
      switch result {
      case .failure(let error): completion(.failure(error))
      case .success(let entries):
        var ids = entries.map(\.id)
        // Query indexing can lag a save. Fetch this known source-bound ID directly as well.
        if let includingHistoryId, !ids.contains(includingHistoryId) {
          ids.append(includingHistoryId)
        }
        self.readFiles(fileName: fileName, ids: ids) { files in
          completion(
            files.flatMap { files in
              if let includingHistoryId, !files.contains(where: { $0.id == includingHistoryId }) {
                return .failure(VoyagerICloudFailure.invalidPayload)
              }
              return .success(
                VoyagerICloudHistoryResponse(
                  files: files.sorted {
                    ($0.createdTime ?? -Double.greatestFiniteMagnitude)
                      == ($1.createdTime ?? -Double.greatestFiniteMagnitude)
                      ? $0.id > $1.id
                      : ($0.createdTime ?? -Double.greatestFiniteMagnitude)
                        > ($1.createdTime ?? -Double.greatestFiniteMagnitude)
                  }))
            })
        }
      }
    }
  }

  func prune(
    _ request: VoyagerICloudPruneHistoryRequest,
    completion: @escaping (Result<VoyagerICloudDeleteResponse, Error>) -> Void
  ) {
    let ids = Array(Set(request.historyIds))
    guard ids.allSatisfy({ VoyagerICloudHistoryIdentity.matches($0, fileName: request.fileName) }),
      request.protectedHistoryId.map({
        VoyagerICloudHistoryIdentity.matches($0, fileName: request.fileName)
      }) ?? true,
      !ids.contains(where: { $0 == request.protectedHistoryId })
    else {
      completion(.failure(VoyagerICloudFailure.invalidPayload))
      return
    }
    // Confirm stored source fields too. A malformed or unreadable candidate cannot be deleted.
    readFiles(fileName: request.fileName, ids: ids) { result in
      switch result {
      case .failure(let error): completion(.failure(error))
      case .success(let files):
        guard files.allSatisfy({ $0.createdTime != nil }) else {
          completion(.failure(VoyagerICloudFailure.invalidPayload))
          return
        }
        ICloudBackupDeletion(database: self.database).remove(
          files.map { CKRecord.ID(recordName: $0.id) }
        ) {
          completion(.success($0))
        }
      }
    }
  }

  func restore(
    _ request: VoyagerICloudRestoreHistoryRequest,
    completion: @escaping (VoyagerICloudUndoResponse) -> Void
  ) {
    let finish: (VoyagerICloudUndoResponse.Outcome) -> Void = {
      completion(VoyagerICloudUndoResponse(name: request.fileName, outcome: $0))
    }
    guard VoyagerICloudHistoryIdentity.matches(request.historyId, fileName: request.fileName) else {
      finish(.noHistory)
      return
    }
    store.fetch(fileName: request.fileName) { current in
      guard case .success(let current) = current else {
        finish(.readFailed)
        return
      }
      guard current?.version == request.expectedVersion else {
        finish(.kept)
        return
      }
      self.store.history(id: request.historyId, fileName: request.fileName) { history in
        switch history {
        case .failure: finish(.readFailed)
        case .success(nil): finish(.noHistory)
        case .success(let json?):
          let commit: (String?) -> Void = { archiveId in
            self.store.fetch(fileName: request.fileName) { latest in
              guard case .success(let latest) = latest else {
                finish(.readFailed)
                return
              }
              guard latest?.version == request.expectedVersion else {
                finish(.kept)
                return
              }
              self.store.save(fileName: request.fileName, json: json, previous: latest?.handle) {
                saved in
                switch saved {
                case .success:
                  completion(
                    VoyagerICloudUndoResponse(
                      name: request.fileName, outcome: .restored(request.historyId),
                      retentionHistoryId: archiveId))
                case .failure(let error):
                  finish((error as? VoyagerICloudFailure)?.code == .conflict ? .kept : .writeFailed)
                }
              }
            }
          }
          if let current {
            self.store.archive(fileName: request.fileName, json: current.json) { archived in
              switch archived {
              case .success(let archive): commit(archive.id)
              case .failure: finish(.writeFailed)
              }
            }
          } else {
            commit(nil)
          }
        }
      }
    }
  }

  private func readFiles(
    fileName: String, ids: [String], files: [VoyagerICloudHistoryFile] = [],
    completion: @escaping (Result<[VoyagerICloudHistoryFile], Error>) -> Void
  ) {
    guard let id = ids.first else {
      completion(.success(files))
      return
    }
    store.historyFile(id: id, fileName: fileName) { result in
      switch result {
      case .failure(let error): completion(.failure(error))
      case .success(let file):
        self.readFiles(
          fileName: fileName, ids: Array(ids.dropFirst()), files: files + (file.map { [$0] } ?? []),
          completion: completion)
      }
    }
  }
}
