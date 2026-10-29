import Foundation

/** Sibling history files are created with their media before they enter retention. */
extension GoogleDriveService {
  private static let historySourceProperty = "voyagerHistorySource"

  func createFile(
    named fileName: String,
    appProperties: [String: String],
    json: String,
    completion: @escaping (Result<VoyagerGoogleDriveHistoryFile, Error>) -> Void
  ) {
    guard !fileName.isEmpty,
      !appProperties.isEmpty,
      appProperties.allSatisfy({ !$0.key.isEmpty && !$0.value.isEmpty })
    else {
      completion(.failure(GoogleDriveServiceError.invalidResponse))
      return
    }
    ensureBackupFolder { result in
      switch result {
      case .failure(let error):
        completion(.failure(error))
      case .success(let folderID):
        self.createHistoryItem(
          request: VoyagerGoogleDriveCreateRequest(
            fileName: fileName,
            appProperties: appProperties,
            json: json
          ),
          parentID: folderID,
          completion: completion
        )
      }
    }
  }

  private func createHistoryItem(
    request: VoyagerGoogleDriveCreateRequest,
    parentID: String,
    completion: @escaping (Result<VoyagerGoogleDriveHistoryFile, Error>) -> Void
  ) {
    let upload: (contentType: String, body: Data)
    do {
      upload = try request.multipartUpload(parentID: parentID)
    } catch {
      completion(.failure(error))
      return
    }

    // A listed history must already contain its media, even if the worker dies after this request.
    performRequest(
      method: "POST",
      path: "/upload/drive/v3/files",
      queryItems: [
        URLQueryItem(name: "uploadType", value: "multipart"),
        URLQueryItem(name: "fields", value: "id,name,createdTime"),
      ],
      contentType: upload.contentType,
      body: upload.body
    ) { result in
      completion(
        result.flatMap { response in
          guard response.isSuccessful else {
            return .failure(self.requestFailure(response))
          }
          return Result {
            let file = try JSONDecoder().decode(DriveHistoryItem.self, from: response.data)
            return VoyagerGoogleDriveHistoryFile(
              fileID: file.id,
              name: file.name,
              createdTime: file.createdTime
            )
          }
        }
      )
    }
  }

  func listHistory(
    sourceFileName: String,
    completion: @escaping (Result<[VoyagerGoogleDriveHistoryFile], Error>) -> Void
  ) {
    guard !sourceFileName.isEmpty else {
      completion(.failure(GoogleDriveServiceError.invalidResponse))
      return
    }
    resolveExistingBackupFolder { result in
      switch result {
      case .failure(let error):
        completion(.failure(error))
      case .success(nil):
        completion(.success([]))
      case .success(let folderID?):
        self.listHistoryPage(
          sourceFileName: sourceFileName,
          folderID: folderID,
          pageToken: nil,
          collected: [],
          visited: [],
          completion: completion
        )
      }
    }
  }

  private func listHistoryPage(
    sourceFileName: String,
    folderID: String,
    pageToken: String?,
    collected: [VoyagerGoogleDriveHistoryFile],
    visited: Set<String>,
    completion: @escaping (Result<[VoyagerGoogleDriveHistoryFile], Error>) -> Void
  ) {
    let clauses = [
      "appProperties has { key='\(Self.historySourceProperty)' and value='\(escapeQueryValue(sourceFileName))' }",
      "'\(escapeQueryValue(folderID))' in parents",
      "trashed=false",
    ]
    var queryItems = [
      URLQueryItem(name: "q", value: clauses.joined(separator: " and ")),
      URLQueryItem(name: "fields", value: "nextPageToken,files(id,name,createdTime)"),
      URLQueryItem(name: "pageSize", value: "1000"),
    ]
    if let pageToken { queryItems.append(URLQueryItem(name: "pageToken", value: pageToken)) }
    performRequest(method: "GET", path: "/drive/v3/files", queryItems: queryItems) { result in
      switch result {
      case .failure(let error):
        completion(.failure(error))
      case .success(let response):
        guard response.isSuccessful else {
          completion(.failure(self.requestFailure(response)))
          return
        }
        do {
          let page = try JSONDecoder().decode(DriveHistoryPage.self, from: response.data)
          let files = collected + page.files.map {
            VoyagerGoogleDriveHistoryFile(
              fileID: $0.id,
              name: $0.name,
              createdTime: $0.createdTime
            )
          }
          guard let nextPage = page.nextPageToken else {
            completion(.success(files))
            return
          }
          guard !visited.contains(nextPage) else {
            completion(.failure(GoogleDriveServiceError.invalidResponse))
            return
          }
          self.listHistoryPage(
            sourceFileName: sourceFileName,
            folderID: folderID,
            pageToken: nextPage,
            collected: files,
            visited: visited.union([nextPage]),
            completion: completion
          )
        } catch {
          completion(.failure(error))
        }
      }
    }
  }

  func trashFile(fileID: String, completion: @escaping (Result<Void, Error>) -> Void) {
    guard !fileID.isEmpty else {
      completion(.failure(GoogleDriveServiceError.invalidResponse))
      return
    }
    performRequest(
      method: "PATCH",
      path: "/drive/v3/files/\(fileID)",
      contentType: "application/json",
      body: Data("{\"trashed\":true}".utf8)
    ) { result in
      completion(result.flatMap { response in
        response.isSuccessful ? .success(()) : .failure(self.requestFailure(response))
      })
    }
  }
}

private struct DriveHistoryPage: Decodable {
  let files: [DriveHistoryItem]
  let nextPageToken: String?
}

private struct DriveHistoryItem: Decodable {
  let id: String
  let name: String
  let createdTime: String
}
