import Foundation

enum DiffKind: Equatable {
    case unchanged
    case deleted
    case inserted
    case lineBreak
}

struct DiffToken: Identifiable, Equatable {
    let id = UUID()
    let text: String
    let kind: DiffKind
}

enum TextDiffEngine {
    static func diff(original: String, improved: String) -> [DiffToken] {
        let oldWords = semanticTokens(in: original)
        let newWords = semanticTokens(in: improved)
        guard !oldWords.isEmpty || !newWords.isEmpty else { return [] }
        guard !oldWords.isEmpty else {
            return newWords.map { .init(text: $0, kind: .inserted) }
        }
        guard !newWords.isEmpty else {
            return oldWords.map { .init(text: $0, kind: .deleted) }
        }

        var lengths = Array(
            repeating: Array(repeating: 0, count: newWords.count + 1),
            count: oldWords.count + 1
        )

        for oldIndex in stride(from: oldWords.count - 1, through: 0, by: -1) {
            for newIndex in stride(from: newWords.count - 1, through: 0, by: -1) {
                if oldWords[oldIndex] == newWords[newIndex] {
                    lengths[oldIndex][newIndex] = lengths[oldIndex + 1][newIndex + 1] + 1
                } else {
                    lengths[oldIndex][newIndex] = max(lengths[oldIndex + 1][newIndex], lengths[oldIndex][newIndex + 1])
                }
            }
        }

        var oldIndex = 0
        var newIndex = 0
        var tokens: [DiffToken] = []

        while oldIndex < oldWords.count, newIndex < newWords.count {
            if oldWords[oldIndex] == newWords[newIndex] {
                tokens.append(.init(text: oldWords[oldIndex], kind: .unchanged))
                oldIndex += 1
                newIndex += 1
            } else if lengths[oldIndex + 1][newIndex] >= lengths[oldIndex][newIndex + 1] {
                tokens.append(.init(text: oldWords[oldIndex], kind: .deleted))
                oldIndex += 1
            } else {
                tokens.append(.init(text: newWords[newIndex], kind: .inserted))
                newIndex += 1
            }
        }

        while oldIndex < oldWords.count {
            tokens.append(.init(text: oldWords[oldIndex], kind: .deleted))
            oldIndex += 1
        }

        while newIndex < newWords.count {
            tokens.append(.init(text: newWords[newIndex], kind: .inserted))
            newIndex += 1
        }

        return tokens
    }

    static func paragraphs(original: String, improved: String) -> [[DiffToken]] {
        splitIntoParagraphs(diff(original: original, improved: improved))
    }

    private static func semanticTokens(in text: String) -> [String] {
        var tokens: [String] = []
        var current = ""
        var currentClass: CharacterClass?

        for character in text {
            let nextClass = CharacterClass(character)
            if currentClass == nextClass {
                current.append(character)
            } else {
                if !current.isEmpty {
                    tokens.append(current)
                }
                current = String(character)
                currentClass = nextClass
            }
        }

        if !current.isEmpty {
            tokens.append(current)
        }

        return tokens
    }

    private static func splitIntoParagraphs(_ tokens: [DiffToken]) -> [[DiffToken]] {
        var paragraphs: [[DiffToken]] = [[]]

        for token in tokens {
            let lineParts = token.text.components(separatedBy: .newlines)
            for index in lineParts.indices {
                let part = lineParts[index]
                if !part.isEmpty {
                    paragraphs[paragraphs.count - 1].append(.init(text: part, kind: token.kind))
                }

                if index < lineParts.count - 1 {
                    if paragraphs.last?.isEmpty == false {
                        paragraphs.append([])
                    } else {
                        paragraphs[paragraphs.count - 1].append(.init(text: "", kind: .lineBreak))
                        paragraphs.append([])
                    }
                }
            }
        }

        return paragraphs.filter { paragraph in
            paragraph.contains { !$0.text.isEmpty || $0.kind == .lineBreak }
        }
    }
}

private enum CharacterClass: Equatable {
    case newline
    case whitespace
    case word
    case punctuation

    init(_ character: Character) {
        if character.isNewline {
            self = .newline
        } else if character.isWhitespace {
            self = .whitespace
        } else if character.isLetter || character.isNumber {
            self = .word
        } else {
            self = .punctuation
        }
    }
}
