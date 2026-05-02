import Foundation

struct EditorialPreferences: Codable, Equatable, Sendable {
    var editingMode: EditingMode = .lineEdit
    var rewriteStrength: Double = 0.45
    var tone: Tone = .natural
    var audience: Audience = .general
    var noteDetail: NoteDetail = .brief
    var preserveFormatting = true
    var customInstructions = ""

    private static let storageKey = "editorial.preferences.v1"

    static func load() -> EditorialPreferences {
        guard
            let data = UserDefaults.standard.data(forKey: storageKey),
            let preferences = try? JSONDecoder().decode(EditorialPreferences.self, from: data)
        else {
            return EditorialPreferences()
        }

        return preferences
    }

    func save() {
        guard let data = try? JSONEncoder().encode(self) else { return }
        UserDefaults.standard.set(data, forKey: Self.storageKey)
    }

    mutating func reset() {
        self = EditorialPreferences()
    }

    var promptInstructions: String {
        let strengthDescription: String
        switch rewriteStrength {
        case ..<0.25:
            strengthDescription = "very light touch; fix only clear issues"
        case ..<0.5:
            strengthDescription = "light line edit; improve clarity while staying close to the draft"
        case ..<0.75:
            strengthDescription = "moderate rewrite; freely smooth awkward phrasing"
        default:
            strengthDescription = "strong rewrite; prioritize the best version while preserving meaning"
        }

        var lines = [
            "Editing mode: \(editingMode.promptDescription)",
            "Rewrite strength: \(strengthDescription)",
            "Tone: \(tone.promptDescription)",
            "Audience: \(audience.promptDescription)",
            "Notes: \(noteDetail.promptDescription)",
            preserveFormatting
                ? "Preserve formatting, markdown, paragraph breaks, and list structure."
                : "Formatting may be cleaned up when it clearly improves readability."
        ]

        let trimmedCustomInstructions = customInstructions.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedCustomInstructions.isEmpty {
            lines.append("Additional user instructions: \(trimmedCustomInstructions)")
        }

        return lines.joined(separator: "\n")
    }
}

enum EditingMode: String, Codable, CaseIterable, Identifiable, Sendable {
    case proofread
    case lineEdit
    case concise
    case polished

    var id: String { rawValue }

    var title: String {
        switch self {
        case .proofread: "Proofread"
        case .lineEdit: "Line Edit"
        case .concise: "Concise"
        case .polished: "Polished"
        }
    }

    var promptDescription: String {
        switch self {
        case .proofread:
            "proofread for grammar, spelling, punctuation, and obvious clarity issues only"
        case .lineEdit:
            "line edit for grammar, rhythm, clarity, word choice, and sentence flow"
        case .concise:
            "tighten the prose and remove redundancy while preserving meaning"
        case .polished:
            "make the writing feel polished, confident, and publication-ready"
        }
    }
}

enum Tone: String, Codable, CaseIterable, Identifiable, Sendable {
    case natural
    case professional
    case warm
    case direct
    case academic

    var id: String { rawValue }

    var title: String {
        switch self {
        case .natural: "Natural"
        case .professional: "Professional"
        case .warm: "Warm"
        case .direct: "Direct"
        case .academic: "Academic"
        }
    }

    var promptDescription: String {
        switch self {
        case .natural: "natural, clear, and close to the author's voice"
        case .professional: "professional, composed, and work-appropriate"
        case .warm: "warm, human, and approachable"
        case .direct: "direct, plainspoken, and efficient"
        case .academic: "precise, careful, and academically credible"
        }
    }
}

enum Audience: String, Codable, CaseIterable, Identifiable, Sendable {
    case general
    case executives
    case technical
    case customers
    case friends

    var id: String { rawValue }

    var title: String {
        switch self {
        case .general: "General"
        case .executives: "Executives"
        case .technical: "Technical"
        case .customers: "Customers"
        case .friends: "Friends"
        }
    }

    var promptDescription: String {
        switch self {
        case .general: "a general reader"
        case .executives: "busy executives who value crisp, decision-ready prose"
        case .technical: "technical readers who value precision and specificity"
        case .customers: "customers who need clarity, trust, and useful detail"
        case .friends: "friends or peers; keep it casual and human"
        }
    }
}

enum NoteDetail: String, Codable, CaseIterable, Identifiable, Sendable {
    case none
    case brief
    case detailed

    var id: String { rawValue }

    var title: String {
        switch self {
        case .none: "None"
        case .brief: "Brief"
        case .detailed: "Detailed"
        }
    }

    var promptDescription: String {
        switch self {
        case .none: "return an empty notes array"
        case .brief: "return a few brief practical notes"
        case .detailed: "return specific notes explaining the most important editorial choices"
        }
    }
}
