import SwiftUI

// MARK: - Color helpers
extension Color {
    init(hex: String) {
        let h = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        var rgb: UInt64 = 0
        Scanner(string: h).scanHexInt64(&rgb)
        self.init(
            red: Double((rgb >> 16) & 0xFF) / 255,
            green: Double((rgb >> 8)  & 0xFF) / 255,
            blue:  Double( rgb        & 0xFF) / 255
        )
    }
}

extension Color {
    static let edBg        = Color(hex: "#16151c")
    static let edAccent    = Color(hex: "#e8a84c")
    static let edGreen     = Color(hex: "#34d399")
    static let edRedDel    = Color(hex: "#EF4444")
    static let edBlueIns   = Color(hex: "#93C5FD")
    static let edBorder    = Color.white.opacity(0.08)
    static let edSurface   = Color.white.opacity(0.025)
    static let edText      = Color.white.opacity(0.88)
    static let edTextSec   = Color.white.opacity(0.55)
    static let edTextMut   = Color.white.opacity(0.32)
    static let edTextFaint = Color.white.opacity(0.2)
}

// MARK: - Suggestion type
enum SuggestionType: String, CaseIterable, Sendable {
    case clarity, concision, style, grammar, tone

    var bg: Color {
        switch self {
        case .clarity:   Color(hex: "#60A5FA").opacity(0.13)
        case .concision: Color(hex: "#A78BFA").opacity(0.13)
        case .style:     Color(hex: "#34D399").opacity(0.13)
        case .grammar:   Color(hex: "#FBBF24").opacity(0.13)
        case .tone:      Color(hex: "#F472B6").opacity(0.13)
        }
    }
    var fg: Color {
        switch self {
        case .clarity:   Color(hex: "#93C5FD").opacity(0.9)
        case .concision: Color(hex: "#C4B5FD").opacity(0.9)
        case .style:     Color(hex: "#6EE7B7").opacity(0.9)
        case .grammar:   Color(hex: "#FDE047").opacity(0.9)
        case .tone:      Color(hex: "#F9A8D4").opacity(0.9)
        }
    }
}

enum SuggestionState: Sendable { case pending, accepted, rejected }

// MARK: - Data models
struct ConnectedApp: Identifiable, Sendable {
    let id: String
    let name: String
    let icon: String
    let accentHex: String
    let doc: String
    let words: Int
    let isLive: Bool
    let sampleText: String

    var accent: Color { Color(hex: accentHex) }
}

struct Suggestion: Identifiable, Sendable {
    let id: String
    let type: SuggestionType
    let original: String
    let suggestion: String
    let rationale: String
}

struct EditedSegment: Identifiable, Sendable {
    let id = UUID()
    let segmentId: String?
    let kind: Kind
    let text: String

    enum Kind: Sendable { case plain, deletion, insertion }
}

// MARK: - Shared button styles
struct ChipButtonStyle: ButtonStyle {
    var isActive: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 11.5, weight: .medium))
            .padding(.horizontal, 9)
            .padding(.vertical, 4)
            .background(
                isActive
                    ? Color.edAccent.opacity(0.14)
                    : (configuration.isPressed ? Color.white.opacity(0.05) : Color.clear)
            )
            .foregroundColor(isActive ? Color.edAccent : Color.edTextMut)
            .overlay(
                Capsule()
                    .stroke(isActive ? Color.edAccent.opacity(0.3) : Color.clear, lineWidth: 0.5)
            )
            .clipShape(Capsule())
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.easeOut(duration: 0.1), value: configuration.isPressed)
    }
}

struct ToolbarButtonStyle: ButtonStyle {
    var isActive: Bool = false
    var isGreen: Bool = false

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 12, weight: .medium))
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(bg)
            .foregroundColor(fg)
            .overlay(
                RoundedRectangle(cornerRadius: 7)
                    .stroke(border, lineWidth: 0.5)
            )
            .cornerRadius(7)
            .opacity(configuration.isPressed ? 0.7 : 1)
    }

    private var bg: Color {
        if isActive  { return Color.edAccent.opacity(0.11) }
        if isGreen   { return Color.edGreen.opacity(0.12) }
        return Color.white.opacity(0.04)
    }
    private var fg: Color {
        if isActive  { return Color.edAccent }
        if isGreen   { return Color(hex: "#6EE7B7").opacity(0.9) }
        return Color.edTextMut
    }
    private var border: Color {
        if isActive  { return Color.edAccent.opacity(0.28) }
        if isGreen   { return Color.edGreen.opacity(0.28) }
        return Color.white.opacity(0.09)
    }
}

// MARK: - Animated live dot
struct LiveDot: View {
    var color: Color = .edGreen
    var size: CGFloat = 6

    @State private var pulsing = false

    var body: some View {
        ZStack {
            Circle()
                .fill(color.opacity(pulsing ? 0 : 0.35))
                .frame(width: size * 2.2, height: size * 2.2)
                .scaleEffect(pulsing ? 1.4 : 0.8)
                .animation(.easeOut(duration: 1.4).repeatForever(autoreverses: false), value: pulsing)
            Circle()
                .fill(color)
                .frame(width: size, height: size)
        }
        .onAppear { pulsing = true }
    }
}
