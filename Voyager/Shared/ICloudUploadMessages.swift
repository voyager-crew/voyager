import CryptoKit
import Foundation

struct VoyagerICloudUploadRequest: Codable, Equatable {
  let fileName: String
  let json: String
  let expectedVersion: String?
}

struct VoyagerICloudUploadVersionResponse: Codable {
  let json: String?
  let version: String?
  let found: Bool
}

enum VoyagerICloudUploadPrevious: Codable, Equatable {
  case created
  case history(String)

  private enum CodingKeys: String, CodingKey { case kind, historyId }
  private enum Kind: String, Codable { case created, history }

  init(from decoder: Decoder) throws {
    let values = try decoder.container(keyedBy: CodingKeys.self)
    switch try values.decode(Kind.self, forKey: .kind) {
    case .created: self = .created
    case .history: self = .history(try values.decode(String.self, forKey: .historyId))
    }
  }

  func encode(to encoder: Encoder) throws {
    var values = encoder.container(keyedBy: CodingKeys.self)
    switch self {
    case .created:
      try values.encode(Kind.created, forKey: .kind)
    case .history(let id):
      try values.encode(Kind.history, forKey: .kind)
      try values.encode(id, forKey: .historyId)
    }
  }
}

struct VoyagerICloudUploadReceipt: Codable, Equatable {
  let name: String
  let fileId: String
  let md5Checksum: String
  let replaced: VoyagerICloudUploadPrevious

  func validated() throws -> Self {
    guard !name.isEmpty, fileId == name, md5Checksum.count == 32,
      md5Checksum.allSatisfy({ "0123456789abcdef".contains($0) })
    else { throw VoyagerICloudFailure.invalidPayload }
    if case .history(let id) = replaced,
      !VoyagerICloudHistoryIdentity.matches(id, fileName: name)
    {
      throw VoyagerICloudFailure.invalidPayload
    }
    return self
  }
}

struct VoyagerICloudUndoResponse: Codable, Equatable {
  enum Outcome: Equatable {
    case restored(String)
    case removed
    case kept
    case noHistory
    case readFailed
    case writeFailed
  }

  let name: String
  let outcome: Outcome
  let retentionHistoryId: String?

  private enum CodingKeys: String, CodingKey { case name, status, historyId, retentionHistoryId }
  private enum Status: String, Codable {
    case restored, removed, kept
    case noHistory = "no_history"
    case readFailed = "read_failed"
    case writeFailed = "write_failed"
  }

  init(name: String, outcome: Outcome, retentionHistoryId: String? = nil) {
    self.name = name
    self.outcome = outcome
    self.retentionHistoryId = retentionHistoryId
  }

  init(from decoder: Decoder) throws {
    let values = try decoder.container(keyedBy: CodingKeys.self)
    name = try values.decode(String.self, forKey: .name)
    retentionHistoryId = try values.decodeIfPresent(String.self, forKey: .retentionHistoryId)
    switch try values.decode(Status.self, forKey: .status) {
    case .restored: outcome = .restored(try values.decode(String.self, forKey: .historyId))
    case .removed: outcome = .removed
    case .kept: outcome = .kept
    case .noHistory: outcome = .noHistory
    case .readFailed: outcome = .readFailed
    case .writeFailed: outcome = .writeFailed
    }
  }

  func encode(to encoder: Encoder) throws {
    var values = encoder.container(keyedBy: CodingKeys.self)
    try values.encode(name, forKey: .name)
    try values.encodeIfPresent(retentionHistoryId, forKey: .retentionHistoryId)
    let status: Status
    switch outcome {
    case .restored(let id):
      status = .restored
      try values.encode(id, forKey: .historyId)
    case .removed: status = .removed
    case .kept: status = .kept
    case .noHistory: status = .noHistory
    case .readFailed: status = .readFailed
    case .writeFailed: status = .writeFailed
    }
    try values.encode(status, forKey: .status)
  }
}

enum VoyagerICloudRawPayload {
  static func decode(_ bytes: Data) throws -> String {
    guard String(data: bytes, encoding: .utf8) != nil else {
      throw VoyagerICloudFailure.invalidPayload
    }
    // Foundation's validating initializer strips BOM; decoding the validated bytes preserves it.
    return String(decoding: bytes, as: UTF8.self)
  }

  static func checksum(_ json: String) -> String {
    Insecure.MD5.hash(data: Data(json.utf8)).map { String(format: "%02x", $0) }.joined()
  }
}

enum VoyagerICloudHistoryIdentity {
  private static func prefix(_ fileName: String) -> String {
    "history-\(VoyagerICloudRecordIdentity.recordName(for: fileName))-"
  }

  static func make(fileName: String) -> String {
    "\(prefix(fileName))\(UUID().uuidString)"
  }

  static func matches(_ id: String, fileName: String) -> Bool {
    let prefix = prefix(fileName)
    return id.hasPrefix(prefix) && UUID(uuidString: String(id.dropFirst(prefix.count))) != nil
  }
}
