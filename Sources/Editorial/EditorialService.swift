import Foundation

protocol EditorialServicing: Sendable {
    func improve(text: String, preferences: EditorialPreferences) async throws -> EditorialResult
}

struct EditorialResult: Equatable {
    let improvedText: String
    let notes: [String]
}

enum EditorialServiceError: LocalizedError {
    case missingAPIKey
    case invalidResponse
    case timedOut
    case apiError(String)

    var errorDescription: String? {
        switch self {
        case .missingAPIKey:
            "Set OPENAI_API_KEY in the launch environment to use AI editing."
        case .invalidResponse:
            "The editing service returned an unreadable response."
        case .timedOut:
            "The editing request timed out. Check your network connection and try again."
        case .apiError(let message):
            message
        }
    }
}

struct EditorialServiceFailure: LocalizedError {
    let message: String
    let statusCode: Int?
    let rawBody: String?
    let underlyingDescription: String?

    var errorDescription: String? {
        message
    }

    var fullDescription: String {
        var parts: [String] = []
        if let statusCode {
            parts.append("HTTP \(statusCode)")
        }
        parts.append(message)
        if let underlyingDescription, !underlyingDescription.isEmpty {
            parts.append(underlyingDescription)
        }
        if let rawBody, !rawBody.isEmpty {
            parts.append(rawBody)
        }
        return parts.joined(separator: "\n\n")
    }
}

struct OpenAIEditorialService: EditorialServicing {
    private let apiKey: String?
    private let session: URLSession

    init(apiKey: String? = ProcessInfo.processInfo.environment["OPENAI_API_KEY"], session: URLSession = .shared) {
        self.apiKey = apiKey
        self.session = session
    }

    func improve(text: String, preferences: EditorialPreferences) async throws -> EditorialResult {
        try await withTimeout(seconds: 45) {
            try await requestImprovement(text: text, preferences: preferences)
        }
    }

    private func requestImprovement(text: String, preferences: EditorialPreferences) async throws -> EditorialResult {
        guard let apiKey, !apiKey.isEmpty else {
            throw EditorialServiceError.missingAPIKey
        }

        var request = URLRequest(url: URL(string: "https://api.openai.com/v1/responses")!)
        request.httpMethod = "POST"
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(OpenAIResponsesRequest(
            model: ProcessInfo.processInfo.environment["EDITORIAL_MODEL"] ?? "gpt-5.4-mini",
            input: [
                .init(role: "system", content: [
                    .init(type: "input_text", text: """
                    You are Editorial, a precise virtual line editor and copy editor.
                    Improve grammar, rhythm, clarity, word choice, and sentence flow.
                    Preserve the author's meaning, voice, formatting, markdown, and paragraph structure.
                    Return strict JSON with keys improved_text and notes. Notes should be brief and practical.

                    User preferences:
                    \(preferences.promptInstructions)
                    """)
                ]),
                .init(role: "user", content: [
                    .init(type: "input_text", text: text)
                ])
            ],
            text: .init(format: .editorialSchema)
        ))

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw EditorialServiceFailure(
                message: error.localizedDescription,
                statusCode: nil,
                rawBody: nil,
                underlyingDescription: String(reflecting: error)
            )
        }

        guard let httpResponse = response as? HTTPURLResponse else {
            throw EditorialServiceError.invalidResponse
        }

        guard (200..<300).contains(httpResponse.statusCode) else {
            let apiError = try? JSONDecoder().decode(OpenAIErrorResponse.self, from: data).error
            let rawBody = String(data: data, encoding: .utf8)
            let message = apiError?.message
                ?? HTTPURLResponse.localizedString(forStatusCode: httpResponse.statusCode)
            throw EditorialServiceFailure(
                message: message,
                statusCode: httpResponse.statusCode,
                rawBody: rawBody,
                underlyingDescription: apiError?.diagnosticDescription
            )
        }

        let apiResponse: OpenAIResponsesResponse
        do {
            apiResponse = try JSONDecoder().decode(OpenAIResponsesResponse.self, from: data)
        } catch {
            throw EditorialServiceFailure(
                message: "The editing service returned an unreadable response.",
                statusCode: httpResponse.statusCode,
                rawBody: String(data: data, encoding: .utf8),
                underlyingDescription: String(reflecting: error)
            )
        }
        guard let outputText = apiResponse.outputText else {
            throw EditorialServiceFailure(
                message: "The editing service response did not include output_text.",
                statusCode: httpResponse.statusCode,
                rawBody: String(data: data, encoding: .utf8),
                underlyingDescription: nil
            )
        }

        let payloadData = Data(outputText.utf8)
        let payload: EditPayload
        do {
            payload = try JSONDecoder().decode(EditPayload.self, from: payloadData)
        } catch {
            throw EditorialServiceFailure(
                message: "The editing service returned JSON Editorial could not read.",
                statusCode: httpResponse.statusCode,
                rawBody: outputText,
                underlyingDescription: String(reflecting: error)
            )
        }
        return EditorialResult(improvedText: payload.improvedText, notes: payload.notes)
    }

    private func withTimeout<T: Sendable>(
        seconds: UInt64,
        operation: @Sendable @escaping () async throws -> T
    ) async throws -> T {
        try await withThrowingTaskGroup(of: T.self) { group in
            group.addTask {
                try await operation()
            }
            group.addTask {
                try await Task.sleep(for: .seconds(seconds))
                throw EditorialServiceError.timedOut
            }

            let value = try await group.next()!
            group.cancelAll()
            return value
        }
    }
}

private struct EditPayload: Decodable {
    let improvedText: String
    let notes: [String]

    enum CodingKeys: String, CodingKey {
        case improvedText = "improved_text"
        case notes
    }
}

private struct OpenAIResponsesRequest: Encodable {
    let model: String
    let input: [Message]
    let text: TextOptions

    struct Message: Encodable {
        let role: String
        let content: [Content]
    }

    struct Content: Encodable {
        let type: String
        let text: String
    }

    struct TextOptions: Encodable {
        let format: Format
    }

    struct Format: Encodable {
        let type: String
        let name: String?
        let strict: Bool?
        let schema: JSONValue?

        static let editorialSchema = Format(
            type: "json_schema",
            name: "editorial_edit",
            strict: true,
            schema: .object([
                "type": .string("object"),
                "additionalProperties": .bool(false),
                "required": .array([.string("improved_text"), .string("notes")]),
                "properties": .object([
                    "improved_text": .object([
                        "type": .string("string"),
                        "description": .string("The fully edited text, preserving author meaning, voice, and structure.")
                    ]),
                    "notes": .object([
                        "type": .string("array"),
                        "items": .object([
                            "type": .string("string")
                        ]),
                        "description": .string("Brief practical notes about the most important edits.")
                    ])
                ])
            ])
        )
    }
}

private enum JSONValue: Encodable {
    case string(String)
    case bool(Bool)
    case array([JSONValue])
    case object([String: JSONValue])

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let value):
            try container.encode(value)
        case .bool(let value):
            try container.encode(value)
        case .array(let values):
            try container.encode(values)
        case .object(let values):
            try container.encode(values)
        }
    }
}

private struct OpenAIResponsesResponse: Decodable {
    let output: [Output]

    var outputText: String? {
        output
            .flatMap(\.content)
            .first { $0.type == "output_text" }?
            .text
    }

    struct Output: Decodable {
        let content: [Content]
    }

    struct Content: Decodable {
        let type: String
        let text: String?
    }
}

private struct OpenAIErrorResponse: Decodable {
    let error: APIError

    struct APIError: Decodable {
        let message: String
        let type: String?
        let param: String?
        let code: String?

        var diagnosticDescription: String {
            [
                type.map { "type: \($0)" },
                param.map { "param: \($0)" },
                code.map { "code: \($0)" }
            ]
            .compactMap { $0 }
            .joined(separator: "\n")
        }
    }
}
