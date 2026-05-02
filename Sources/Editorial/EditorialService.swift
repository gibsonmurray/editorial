import Foundation

protocol EditorialServicing: Sendable {
    func improve(text: String, preferences: EditorialPreferences) async throws -> EditorialResult
}

struct EditorialResult: Equatable {
    let improvedText: String
    let notes: [String]
}

enum EditorialServiceError: LocalizedError {
    case missingAPIKey(String)
    case invalidResponse
    case timedOut
    case apiError(String)

    var errorDescription: String? {
        switch self {
        case .missingAPIKey(let envVar):
            "Set \(envVar) in Preferences or your environment to use this model."
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

    var errorDescription: String? { message }

    var fullDescription: String {
        var parts: [String] = []
        if let statusCode { parts.append("HTTP \(statusCode)") }
        parts.append(message)
        if let underlyingDescription, !underlyingDescription.isEmpty { parts.append(underlyingDescription) }
        if let rawBody, !rawBody.isEmpty { parts.append(rawBody) }
        return parts.joined(separator: "\n\n")
    }
}

// MARK: - Routing service

struct ProviderRoutingService: EditorialServicing {
    func improve(text: String, preferences: EditorialPreferences) async throws -> EditorialResult {
        try await makeService(for: preferences).improve(text: text, preferences: preferences)
    }

    private func makeService(for preferences: EditorialPreferences) -> EditorialServicing {
        let model = preferences.selectedModel
        switch model.provider {
        case .openai:
            let key = preferences.openaiAPIKey.isEmpty
                ? ProcessInfo.processInfo.environment["OPENAI_API_KEY"]
                : preferences.openaiAPIKey
            return OpenAIEditorialService(apiKey: key, modelId: model.modelId)
        case .anthropic:
            let key = preferences.anthropicAPIKey.isEmpty
                ? ProcessInfo.processInfo.environment["ANTHROPIC_API_KEY"]
                : preferences.anthropicAPIKey
            return AnthropicEditorialService(apiKey: key, modelId: model.modelId)
        case .ollama:
            return OllamaEditorialService(modelId: model.modelId)
        }
    }
}

// MARK: - OpenAI

struct OpenAIEditorialService: EditorialServicing {
    private let apiKey: String?
    private let modelId: String
    private let session: URLSession

    init(
        apiKey: String? = ProcessInfo.processInfo.environment["OPENAI_API_KEY"],
        modelId: String = ProcessInfo.processInfo.environment["EDITORIAL_MODEL"] ?? "gpt-4o-mini",
        session: URLSession = .shared
    ) {
        self.apiKey = apiKey
        self.modelId = modelId
        self.session = session
    }

    func improve(text: String, preferences: EditorialPreferences) async throws -> EditorialResult {
        try await editorialTimeout(seconds: 45) {
            try await requestImprovement(text: text, preferences: preferences)
        }
    }

    private func requestImprovement(text: String, preferences: EditorialPreferences) async throws -> EditorialResult {
        guard let apiKey, !apiKey.isEmpty else {
            throw EditorialServiceError.missingAPIKey("OPENAI_API_KEY")
        }

        var request = URLRequest(url: URL(string: "https://api.openai.com/v1/responses")!)
        request.httpMethod = "POST"
        request.setValue("Bearer \(apiKey)", forHTTPHeaderField: "Authorization")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONEncoder().encode(OpenAIResponsesRequest(
            model: modelId,
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

        guard let http = response as? HTTPURLResponse else {
            throw EditorialServiceError.invalidResponse
        }

        guard (200..<300).contains(http.statusCode) else {
            let apiError = try? JSONDecoder().decode(OpenAIErrorResponse.self, from: data).error
            let rawBody = String(data: data, encoding: .utf8)
            let message = apiError?.message ?? HTTPURLResponse.localizedString(forStatusCode: http.statusCode)
            throw EditorialServiceFailure(
                message: message,
                statusCode: http.statusCode,
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
                statusCode: http.statusCode,
                rawBody: String(data: data, encoding: .utf8),
                underlyingDescription: String(reflecting: error)
            )
        }

        guard let outputText = apiResponse.outputText else {
            throw EditorialServiceFailure(
                message: "The editing service response did not include output_text.",
                statusCode: http.statusCode,
                rawBody: String(data: data, encoding: .utf8),
                underlyingDescription: nil
            )
        }

        return try parseEditorialResponse(outputText, statusCode: http.statusCode, rawBody: outputText)
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
                        "items": .object(["type": .string("string")]),
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
        var c = encoder.singleValueContainer()
        switch self {
        case .string(let v): try c.encode(v)
        case .bool(let v):   try c.encode(v)
        case .array(let v):  try c.encode(v)
        case .object(let v): try c.encode(v)
        }
    }
}

private struct OpenAIResponsesResponse: Decodable {
    let output: [Output]
    var outputText: String? {
        output.flatMap(\.content).first { $0.type == "output_text" }?.text
    }
    struct Output: Decodable { let content: [Content] }
    struct Content: Decodable { let type: String; let text: String? }
}

private struct OpenAIErrorResponse: Decodable {
    let error: APIError
    struct APIError: Decodable {
        let message: String
        let type: String?
        let param: String?
        let code: String?
        var diagnosticDescription: String {
            [type.map { "type: \($0)" }, param.map { "param: \($0)" }, code.map { "code: \($0)" }]
                .compactMap { $0 }.joined(separator: "\n")
        }
    }
}

// MARK: - Anthropic

struct AnthropicEditorialService: EditorialServicing {
    private let apiKey: String?
    private let modelId: String
    private let session: URLSession

    init(apiKey: String?, modelId: String, session: URLSession = .shared) {
        self.apiKey = apiKey
        self.modelId = modelId
        self.session = session
    }

    func improve(text: String, preferences: EditorialPreferences) async throws -> EditorialResult {
        try await editorialTimeout(seconds: 60) {
            try await requestImprovement(text: text, preferences: preferences)
        }
    }

    private func requestImprovement(text: String, preferences: EditorialPreferences) async throws -> EditorialResult {
        guard let apiKey, !apiKey.isEmpty else {
            throw EditorialServiceError.missingAPIKey("ANTHROPIC_API_KEY")
        }

        struct AnthropicRequest: Encodable {
            let model: String
            let max_tokens: Int
            let system: String
            let messages: [Msg]
            struct Msg: Encodable { let role: String; let content: String }
        }

        let system = """
        You are Editorial, a precise virtual line editor and copy editor.
        Improve grammar, rhythm, clarity, word choice, and sentence flow.
        Preserve the author's meaning, voice, formatting, markdown, and paragraph structure.

        User preferences:
        \(preferences.promptInstructions)

        Respond with ONLY a JSON object, no markdown fences, no explanation:
        {"improved_text": "...", "notes": ["note1", "note2"]}
        """

        var req = URLRequest(url: URL(string: "https://api.anthropic.com/v1/messages")!)
        req.httpMethod = "POST"
        req.setValue(apiKey, forHTTPHeaderField: "x-api-key")
        req.setValue("2023-06-01", forHTTPHeaderField: "anthropic-version")
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONEncoder().encode(AnthropicRequest(
            model: modelId, max_tokens: 4096, system: system,
            messages: [.init(role: "user", content: text)]
        ))

        let (data, response) = try await performRequest(req)
        let http = response as! HTTPURLResponse

        guard (200..<300).contains(http.statusCode) else {
            struct ErrBody: Decodable { let error: ErrDetail; struct ErrDetail: Decodable { let message: String; let type: String } }
            let err = try? JSONDecoder().decode(ErrBody.self, from: data)
            throw EditorialServiceFailure(
                message: err?.error.message ?? HTTPURLResponse.localizedString(forStatusCode: http.statusCode),
                statusCode: http.statusCode,
                rawBody: String(data: data, encoding: .utf8),
                underlyingDescription: err?.error.type
            )
        }

        struct AnthropicResponse: Decodable {
            let content: [Block]
            struct Block: Decodable { let type: String; let text: String? }
        }
        let resp = try JSONDecoder().decode(AnthropicResponse.self, from: data)
        guard let text = resp.content.first(where: { $0.type == "text" })?.text else {
            throw EditorialServiceFailure(message: "Anthropic response had no text.", statusCode: http.statusCode, rawBody: String(data: data, encoding: .utf8), underlyingDescription: nil)
        }

        return try parseEditorialResponse(text, statusCode: http.statusCode, rawBody: text)
    }

    private func performRequest(_ req: URLRequest) async throws -> (Data, URLResponse) {
        do {
            return try await session.data(for: req)
        } catch {
            throw EditorialServiceFailure(message: error.localizedDescription, statusCode: nil, rawBody: nil, underlyingDescription: String(reflecting: error))
        }
    }
}

// MARK: - Ollama

struct OllamaEditorialService: EditorialServicing {
    private let modelId: String
    private let baseURL: String
    private let session: URLSession

    init(modelId: String, baseURL: String = "http://localhost:11434", session: URLSession = .shared) {
        self.modelId = modelId
        self.baseURL = baseURL
        self.session = session
    }

    func improve(text: String, preferences: EditorialPreferences) async throws -> EditorialResult {
        try await editorialTimeout(seconds: 120) {
            try await requestImprovement(text: text, preferences: preferences)
        }
    }

    private func requestImprovement(text: String, preferences: EditorialPreferences) async throws -> EditorialResult {
        struct OllamaRequest: Encodable {
            let model: String
            let messages: [Msg]
            let stream: Bool
            let format: String
            struct Msg: Encodable { let role: String; let content: String }
        }

        let system = """
        You are Editorial, a precise virtual line editor and copy editor.
        Improve grammar, rhythm, clarity, word choice, and sentence flow.
        Preserve the author's meaning, voice, formatting, markdown, and paragraph structure.

        User preferences:
        \(preferences.promptInstructions)

        Return ONLY a JSON object in this exact format:
        {"improved_text": "...", "notes": ["note1", "note2"]}
        """

        guard let url = URL(string: "\(baseURL)/api/chat") else {
            throw EditorialServiceError.invalidResponse
        }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.httpBody = try JSONEncoder().encode(OllamaRequest(
            model: modelId,
            messages: [.init(role: "system", content: system), .init(role: "user", content: text)],
            stream: false,
            format: "json"
        ))

        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: req)
        } catch {
            throw EditorialServiceFailure(
                message: "Could not connect to Ollama at \(baseURL). Make sure Ollama is running.",
                statusCode: nil, rawBody: nil,
                underlyingDescription: String(reflecting: error)
            )
        }

        let http = response as! HTTPURLResponse
        guard (200..<300).contains(http.statusCode) else {
            throw EditorialServiceFailure(
                message: "Ollama error — is model '\(modelId)' installed? Run: ollama pull \(modelId)",
                statusCode: http.statusCode,
                rawBody: String(data: data, encoding: .utf8),
                underlyingDescription: nil
            )
        }

        struct OllamaResponse: Decodable {
            let message: Msg
            struct Msg: Decodable { let content: String }
        }
        let resp = try JSONDecoder().decode(OllamaResponse.self, from: data)
        return try parseEditorialResponse(resp.message.content, statusCode: nil, rawBody: resp.message.content)
    }

    static func fetchAvailableModels(baseURL: String = "http://localhost:11434") async -> [ModelOption] {
        guard let url = URL(string: "\(baseURL)/api/tags") else { return [] }
        guard let (data, resp) = try? await URLSession.shared.data(from: url),
              (resp as? HTTPURLResponse)?.statusCode == 200 else { return [] }

        struct Tags: Decodable { let models: [M]; struct M: Decodable { let name: String } }
        guard let tags = try? JSONDecoder().decode(Tags.self, from: data) else { return [] }

        return tags.models.map { m in
            let display = (m.name.components(separatedBy: ":").first ?? m.name).capitalized
            return ModelOption(id: "ollama-\(m.name)", name: display, modelId: m.name, provider: .ollama)
        }
    }
}

// MARK: - Shared helpers

private struct EditPayload: Decodable {
    let improvedText: String
    let notes: [String]
    enum CodingKeys: String, CodingKey {
        case improvedText = "improved_text"
        case notes
    }
}

private func parseEditorialResponse(_ text: String, statusCode: Int?, rawBody: String?) throws -> EditorialResult {
    let data = Data(text.utf8)
    if let payload = try? JSONDecoder().decode(EditPayload.self, from: data) {
        return EditorialResult(improvedText: payload.improvedText, notes: payload.notes)
    }
    // Attempt to extract JSON substring if the model added preamble/postamble
    if let start = text.firstIndex(of: "{"),
       let end = text.lastIndex(where: { $0 == "}" }) {
        let sub = String(text[start...end])
        if let payload = try? JSONDecoder().decode(EditPayload.self, from: Data(sub.utf8)) {
            return EditorialResult(improvedText: payload.improvedText, notes: payload.notes)
        }
    }
    throw EditorialServiceFailure(
        message: "Could not parse the editorial response JSON.",
        statusCode: statusCode,
        rawBody: rawBody,
        underlyingDescription: nil
    )
}

private func editorialTimeout<T: Sendable>(
    seconds: UInt64,
    operation: @Sendable @escaping () async throws -> T
) async throws -> T {
    try await withThrowingTaskGroup(of: T.self) { group in
        group.addTask { try await operation() }
        group.addTask {
            try await Task.sleep(for: .seconds(seconds))
            throw EditorialServiceError.timedOut
        }
        let value = try await group.next()!
        group.cancelAll()
        return value
    }
}
