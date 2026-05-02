import AppKit
import SwiftUI

enum ViewTab: String, CaseIterable {
    case tracked = "Tracked Changes"
    case original = "Original"
    case clean = "Clean Edit"
}

struct EditorWindowView: View {
    @EnvironmentObject private var appModel: AppModel

    @State private var viewTab: ViewTab = .tracked
    @State private var showExport = false

    private var draft: EditorialDraft? {
        appModel.draft
    }

    private var originalText: String {
        draft?.original ?? appModel.focusedContext?.text ?? ""
    }

    private var improvedText: String {
        draft?.improved ?? originalText
    }

    private var isEditing: Bool {
        appModel.phase == .editing
    }

    private var changedTokenCount: Int {
        TextDiffEngine.diff(original: originalText, improved: improvedText)
            .filter { $0.kind == .inserted || $0.kind == .deleted }
            .count
    }

    var body: some View {
        ZStack {
            Color.edBg.ignoresSafeArea()
            FullScreenWindowConfigurator()
                .frame(width: 0, height: 0)

            VStack(spacing: 0) {
                toolbar
                statsBar
                mainContent
            }

            if isEditing {
                loadingOverlay
            }
        }
        .frame(minWidth: 800, minHeight: 500)
        .preferredColorScheme(.dark)
        .toolbar {
            ToolbarItemGroup {
                Button {
                    rerun()
                } label: {
                    Label("Re-run", systemImage: "arrow.triangle.2.circlepath")
                }
                .disabled(originalText.isEmpty || appModel.isBusy)

                Button {
                    appModel.copyDraft()
                } label: {
                    Label("Copy", systemImage: "doc.on.doc")
                }
                .disabled(draft == nil || appModel.isBusy)

                Button {
                    showExport = true
                } label: {
                    Label("Export", systemImage: "square.and.arrow.up")
                }
                .disabled(draft == nil)
            }
        }
        .sheet(isPresented: $showExport) {
            ExportSheetView(onClose: { showExport = false })
                .environmentObject(appModel)
                .preferredColorScheme(.dark)
        }
    }

    private var toolbar: some View {
        HStack(spacing: 10) {
            HStack(spacing: 5) {
                Circle().fill(statusColor).frame(width: 6, height: 6)
                Text(statusTitle)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(Color.white.opacity(0.42))
                    .tracking(0.8)
            }

            Rectangle().fill(Color.white.opacity(0.07)).frame(width: 0.5, height: 18)

            ForEach(ViewTab.allCases, id: \.self) { tab in
                Button(tab.rawValue) { viewTab = tab }
                    .buttonStyle(ToolbarButtonStyle(isActive: viewTab == tab))
            }

            Spacer()

            if appModel.focusedContext != nil {
                Button {
                    appModel.applyDraft()
                } label: {
                    Label("Apply to Focused App", systemImage: "arrowshape.turn.up.left")
                }
                .buttonStyle(ToolbarButtonStyle(isGreen: true))
                .disabled(draft == nil || appModel.isBusy)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 9)
        .background(Color.black.opacity(0.12))
        .overlay(alignment: .bottom) {
            Rectangle().fill(Color.white.opacity(0.055)).frame(height: 0.5)
        }
    }

    private var statsBar: some View {
        HStack(spacing: 14) {
            statItem("Words", value: "\(originalText.split(whereSeparator: \.isWhitespace).count)")
            statItem("Changed tokens", value: "\(changedTokenCount)")
            statItem("Notes", value: "\(draft?.notes.count ?? 0)")

            Spacer()

            Text(appModel.lastErrorMessage ?? appModel.statusMessage)
                .font(.system(size: 11))
                .foregroundColor(appModel.lastErrorMessage == nil ? Color.edTextFaint : Color.edRedDel.opacity(0.9))
                .lineLimit(3)
                .multilineTextAlignment(.trailing)
                .textSelection(.enabled)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 6)
        .background(Color.black.opacity(0.04))
        .overlay(alignment: .bottom) {
            Rectangle().fill(Color.white.opacity(0.055)).frame(height: 0.5)
        }
    }

    private func statItem(_ label: String, value: String) -> some View {
        HStack(spacing: 5) {
            Text(label)
                .font(.system(size: 11))
                .foregroundColor(Color.edTextMut)
            Text(value)
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(Color.white.opacity(0.68))
                .monospacedDigit()
        }
    }

    private var mainContent: some View {
        HStack(spacing: 0) {
            editorPane
            Rectangle().fill(Color.white.opacity(0.055)).frame(width: 0.5)
            notesPanel
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var editorPane: some View {
        ScrollView {
            Group {
                if originalText.isEmpty {
                    emptyState
                } else {
                    editorContent
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 48)
            .padding(.vertical, 32)
        }
    }

    @ViewBuilder
    private var editorContent: some View {
        let monoFont = Font.system(size: 13.5, design: .monospaced)

        switch viewTab {
        case .original:
            Text(originalText)
                .font(monoFont)
                .foregroundColor(Color.white.opacity(0.52))
                .lineSpacing(8)
                .frame(maxWidth: 720, alignment: .leading)
                .textSelection(.enabled)

        case .clean:
            Text(improvedText)
                .font(monoFont)
                .foregroundColor(Color.edText)
                .lineSpacing(8)
                .frame(maxWidth: 720, alignment: .leading)
                .textSelection(.enabled)

        case .tracked:
            Text(buildTrackedAttrString())
                .font(monoFont)
                .lineSpacing(8)
                .frame(maxWidth: 720, alignment: .leading)
                .textSelection(.enabled)
        }
    }

    private var emptyState: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("No draft yet")
                .font(.system(size: 22, design: .serif))
                .foregroundColor(Color.white.opacity(0.75))
            Text("Capture focused text or paste text from the menu bar popover, then run a line edit.")
                .font(.system(size: 13))
                .foregroundColor(Color.edTextMut)
        }
        .frame(maxWidth: 520, alignment: .leading)
    }

    private func buildTrackedAttrString() -> AttributedString {
        var result = AttributedString()
        for token in TextDiffEngine.diff(original: originalText, improved: improvedText) {
            var part = AttributedString(token.text)
            switch token.kind {
            case .unchanged, .lineBreak:
                part.foregroundColor = Color.edText
            case .deleted:
                part.foregroundColor = Color.edRedDel.opacity(0.82)
                part.strikethroughStyle = Text.LineStyle(pattern: .solid)
                part.backgroundColor = Color.edRedDel.opacity(0.13)
            case .inserted:
                part.foregroundColor = Color.edBlueIns.opacity(0.92)
                part.underlineStyle = Text.LineStyle(pattern: .solid)
                part.backgroundColor = Color(hex: "#60A5FA").opacity(0.11)
            }
            result.append(part)
        }
        return result
    }

    private var notesPanel: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 7) {
                Text("Notes")
                    .font(.system(size: 14, design: .serif))
                    .foregroundColor(Color.white.opacity(0.75))

                Text(noteSubtitle)
                    .font(.system(size: 11))
                    .foregroundColor(Color.edTextFaint)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 14)
            .padding(.top, 12)
            .padding(.bottom, 10)
            .overlay(alignment: .bottom) {
                Rectangle().fill(Color.white.opacity(0.055)).frame(height: 0.5)
            }

            ScrollView {
                LazyVStack(spacing: 7) {
                    if isEditing {
                        ForEach(0..<3, id: \.self) { _ in
                            RoundedRectangle(cornerRadius: 8)
                                .fill(Color.edSurface)
                                .frame(height: 72)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 8)
                                        .stroke(Color.edBorder, lineWidth: 0.5)
                                )
                                .opacity(0.7)
                        }
                    } else if let notes = draft?.notes, !notes.isEmpty {
                        ForEach(Array(notes.enumerated()), id: \.offset) { index, note in
                            NoteCard(index: index + 1, note: note)
                        }
                    } else {
                        notesEmptyState
                    }
                }
                .padding(9)
            }

            HStack(spacing: 7) {
                Button {
                    appModel.copyDraft()
                } label: {
                    Label("Copy", systemImage: "doc.on.doc")
                }
                .font(.system(size: 12, weight: .semibold))
                .foregroundColor(Color.white.opacity(0.7))
                .frame(maxWidth: .infinity)
                .padding(.vertical, 7)
                .background(Color.white.opacity(0.04))
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(Color.white.opacity(0.09), lineWidth: 0.5)
                )
                .cornerRadius(8)
                .buttonStyle(.plain)
                .disabled(draft == nil)

                if appModel.focusedContext != nil {
                    Button {
                        appModel.applyDraft()
                    } label: {
                        Image(systemName: "arrowshape.turn.up.left")
                    }
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(Color(hex: "#6EE7B7").opacity(0.9))
                    .frame(width: 34, height: 31)
                    .background(Color.edGreen.opacity(0.1))
                    .overlay(
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(Color.edGreen.opacity(0.28), lineWidth: 0.5)
                    )
                    .cornerRadius(8)
                    .buttonStyle(.plain)
                    .disabled(draft == nil || appModel.isBusy)
                    .help("Apply to focused app")
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 9)
            .overlay(alignment: .top) {
                Rectangle().fill(Color.white.opacity(0.055)).frame(height: 0.5)
            }
        }
        .frame(width: 296)
        .background(Color.edBg)
    }

    private var notesEmptyState: some View {
        VStack(spacing: 8) {
            Image(systemName: draft == nil ? "text.badge.plus" : "checkmark")
                .font(.system(size: 16, weight: .semibold))
                .foregroundColor(Color.edAccent)
                .frame(width: 40, height: 40)
                .background(Color.edAccent.opacity(0.09))
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(Color.edAccent.opacity(0.18), lineWidth: 0.5)
                )
                .cornerRadius(8)

            Text(draft == nil ? "Waiting for a draft" : "No notes returned")
                .font(.system(size: 16, design: .serif))
                .foregroundColor(Color.white.opacity(0.55))
            Text(draft == nil ? "Run a line edit to see comments here." : "The clean edit is still available to copy or apply.")
                .font(.system(size: 11))
                .foregroundColor(Color.edTextFaint)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 40)
        .padding(.horizontal, 20)
        .multilineTextAlignment(.center)
    }

    private var loadingOverlay: some View {
        ZStack {
            Color(hex: "#16151c").opacity(0.9)
                .background(.ultraThinMaterial)

            VStack(spacing: 14) {
                ProgressView()
                    .scaleEffect(1.2)
                    .tint(Color.edAccent)

                VStack(spacing: 6) {
                    Text("Editing your prose...")
                        .font(.system(size: 19, design: .serif))
                        .foregroundColor(Color.white.opacity(0.65))
                    Text(appModel.statusMessage)
                        .font(.system(size: 12))
                        .foregroundColor(Color.white.opacity(0.28))
                    if let latestEvent = appModel.processEvents.first {
                        Text(latestEvent.detail)
                            .font(.system(size: 11))
                            .foregroundColor(Color.white.opacity(0.2))
                            .multilineTextAlignment(.center)
                            .frame(maxWidth: 320)
                    }
                }
            }
        }
        .ignoresSafeArea()
    }

    private var noteSubtitle: String {
        if isEditing { return "Editorial is reading the text." }
        if draft == nil { return "Comments from the line edit appear here." }
        return "Brief comments from the edit."
    }

    private var statusTitle: String {
        switch appModel.phase {
        case .idle:
            draft == nil ? "READY" : "DRAFT READY"
        case .loadingFocusedText:
            "CAPTURING"
        case .editing:
            "EDITING"
        case .applying:
            "APPLYING"
        case .failed:
            "NEEDS ATTENTION"
        }
    }

    private var statusColor: Color {
        switch appModel.phase {
        case .failed:
            Color.edRedDel
        case .editing, .loadingFocusedText, .applying:
            Color.edAccent
        case .idle:
            draft == nil ? Color.white.opacity(0.35) : Color.edGreen
        }
    }

    private func rerun() {
        guard !originalText.isEmpty else { return }
        appModel.improve(text: originalText, sourceApp: appModel.editorSourceApp, keepFocusedContext: appModel.focusedContext != nil)
    }
}

private struct FullScreenWindowConfigurator: NSViewRepresentable {
    func makeNSView(context: Context) -> NSView {
        let view = NSView()
        DispatchQueue.main.async {
            configure(view.window)
        }
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        DispatchQueue.main.async {
            configure(nsView.window)
        }
    }

    private func configure(_ window: NSWindow?) {
        guard let window else { return }
        window.styleMask.insert([.titled, .closable, .miniaturizable, .resizable])
        window.collectionBehavior.insert([.fullScreenPrimary, .managed])
        window.standardWindowButton(.zoomButton)?.isEnabled = true
        window.standardWindowButton(.miniaturizeButton)?.isEnabled = true
    }
}

private struct NoteCard: View {
    let index: Int
    let note: String

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Text("\(index)")
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(Color.edAccent)
                .frame(width: 22, height: 22)
                .background(Color.edAccent.opacity(0.1))
                .clipShape(Circle())

            Text(note)
                .font(.system(size: 12))
                .foregroundColor(Color.white.opacity(0.67))
                .lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)

            Spacer(minLength: 0)
        }
        .padding(11)
        .background(Color.edSurface)
        .overlay(
            RoundedRectangle(cornerRadius: 8)
                .stroke(Color.edBorder, lineWidth: 0.5)
        )
        .cornerRadius(8)
    }
}

struct ExportSheetView: View {
    @EnvironmentObject private var appModel: AppModel
    @Environment(\.dismiss) private var dismiss

    let onClose: () -> Void
    @State private var copied = false

    private var draft: EditorialDraft? {
        appModel.draft
    }

    private var outputText: String {
        draft?.improved ?? ""
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("Export edited text")
                    .font(.system(size: 17, design: .serif))
                    .foregroundColor(Color.white.opacity(0.88))
                Spacer()
                Button {
                    dismiss()
                    onClose()
                } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundColor(Color.edTextSec)
                        .frame(width: 24, height: 24)
                        .background(Color.white.opacity(0.07))
                        .cornerRadius(6)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 18)
            .padding(.top, 16)
            .padding(.bottom, 12)
            .overlay(alignment: .bottom) {
                Rectangle().fill(Color.white.opacity(0.07)).frame(height: 0.5)
            }

            VStack(spacing: 10) {
                if appModel.focusedContext != nil {
                    exportOption(
                        icon: "arrowshape.turn.up.left",
                        iconBg: Color.edGreen.opacity(0.12),
                        iconFg: Color(hex: "#6EE7B7").opacity(0.8),
                        title: "Apply to focused app",
                        desc: "Replace the captured text through macOS Accessibility.",
                        arrow: "->"
                    ) {
                        appModel.applyDraft()
                        dismiss()
                        onClose()
                    }
                }

                exportOption(
                    icon: copied ? "checkmark" : "doc.on.doc",
                    iconBg: Color.edAccent.opacity(0.12),
                    iconFg: Color.edAccent,
                    title: copied ? "Copied clean text" : "Copy clean text",
                    desc: "Plain edited text, ready to paste anywhere.",
                    arrow: copied ? "OK" : "->"
                ) {
                    copyToClipboard(outputText)
                }

                textPreview

                exportOption(
                    icon: "text.badge.diff",
                    iconBg: Color.edBlueIns.opacity(0.1),
                    iconFg: Color.edBlueIns.opacity(0.7),
                    title: "Copy with diff",
                    desc: "Original text followed by the edited version.",
                    arrow: "->"
                ) {
                    let diff = "[ORIGINAL]\n\(draft?.original ?? "")\n\n[EDITED]\n\(outputText)"
                    copyToClipboard(diff)
                }
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 14)
        }
        .frame(width: 480)
        .background(Color(hex: "#16151d"))
        .cornerRadius(16)
    }

    private func exportOption(
        icon: String,
        iconBg: Color,
        iconFg: Color,
        title: String,
        desc: String,
        arrow: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: icon)
                    .font(.system(size: 16))
                    .foregroundColor(iconFg)
                    .frame(width: 36, height: 36)
                    .background(iconBg)
                    .overlay(
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(Color.white.opacity(0.07), lineWidth: 0.5)
                    )
                    .cornerRadius(8)

                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(Color.white.opacity(0.85))
                    Text(desc)
                        .font(.system(size: 11.5))
                        .foregroundColor(Color.white.opacity(0.38))
                        .lineSpacing(2)
                }

                Spacer()
                Text(arrow)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(Color.white.opacity(0.25))
            }
            .padding(14)
            .background(Color.edSurface)
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(Color.edBorder, lineWidth: 0.5)
            )
            .cornerRadius(8)
        }
        .buttonStyle(.plain)
        .disabled(outputText.isEmpty)
    }

    private var textPreview: some View {
        Text(outputText)
            .font(.system(size: 11.5, design: .monospaced))
            .foregroundColor(Color.white.opacity(0.6))
            .lineSpacing(4)
            .lineLimit(6)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(12)
            .background(Color.white.opacity(0.03))
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(Color.white.opacity(0.09), lineWidth: 0.5)
            )
            .cornerRadius(8)
    }

    private func copyToClipboard(_ text: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)
        copied = true
    }
}
