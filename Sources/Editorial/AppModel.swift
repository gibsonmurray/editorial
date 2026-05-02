import AppKit
import Foundation

@MainActor
final class AppModel: ObservableObject {
    enum Phase: Equatable {
        case idle
        case loadingFocusedText
        case editing
        case applying
        case failed(String)
    }

    @Published var phase: Phase = .idle
    @Published var accessibilityTrusted = AccessibilityTextClient.isTrusted
    @Published var focusedContext: TextContext?
    @Published var draft: EditorialDraft?
    @Published var currentApplication: ActiveApplication?
    @Published var statusMessage = "Ready"
    @Published var lastErrorMessage: String?
    @Published var preferences: EditorialPreferences {
        didSet {
            preferences.save()
        }
    }
    @Published var processEvents: [ProcessEvent] = [
        .init(title: "Ready", detail: "Click into a text area, then capture text.")
    ]

    // Editor window source context (set from popover before opening the editor)
    @Published var editorSourceApp: ConnectedApp? = nil

    private var hasPromptedForPermissions = false
    private var activationObserver: NSObjectProtocol?
    private var editTask: Task<Void, Never>?
    private let textClient = AccessibilityTextClient()
    private let editor: EditorialServicing

    init(editor: EditorialServicing = OpenAIEditorialService()) {
        self.editor = editor
        self.preferences = EditorialPreferences.load()
        refreshCurrentApplication()
        activationObserver = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard
                let application = notification.userInfo?[NSWorkspace.applicationUserInfoKey] as? NSRunningApplication
            else { return }

            Task { @MainActor in
                self?.updateCurrentApplication(from: application)
            }
        }
    }

    var isBusy: Bool {
        switch phase {
        case .loadingFocusedText, .editing, .applying:
            true
        case .idle, .failed:
            false
        }
    }

    var progressValue: Double {
        switch phase {
        case .idle:
            draft == nil ? 0 : 1
        case .loadingFocusedText:
            0.25
        case .editing:
            0.65
        case .applying:
            0.9
        case .failed:
            1
        }
    }

    func refreshPermissionStatus() {
        accessibilityTrusted = AccessibilityTextClient.isTrusted
        statusMessage = accessibilityTrusted ? "Accessibility permission granted" : "Accessibility permission needed"
    }

    func refreshCurrentApplication() {
        updateCurrentApplication(from: NSWorkspace.shared.frontmostApplication)
    }

    func requestAccessibilityPermission() {
        hasPromptedForPermissions = true
        record("Requesting permission", detail: "Asking macOS to allow Editorial to read and update focused text.")
        AccessibilityTextClient.requestTrustPrompt()
        accessibilityTrusted = AccessibilityTextClient.isTrusted
        statusMessage = accessibilityTrusted
            ? "Accessibility permission granted"
            : "Allow Editorial in System Settings, then return and refresh."
        record(accessibilityTrusted ? "Permission granted" : "Permission pending", detail: statusMessage)
    }

    func openAccessibilitySettings() {
        hasPromptedForPermissions = true
        AccessibilityTextClient.openAccessibilitySettings()
        statusMessage = "Enable Editorial under Privacy & Security > Accessibility."
        record("Opened System Settings", detail: statusMessage)
    }

    func promptForRequiredPermissionsIfNeeded() {
        refreshPermissionStatus()
        guard !accessibilityTrusted, !hasPromptedForPermissions else { return }
        requestAccessibilityPermission()
    }

    func captureFocusedText() {
        refreshPermissionStatus()
        guard accessibilityTrusted else {
            fail("Grant Accessibility permission, then try again.")
            return
        }

        phase = .loadingFocusedText
        record("Finding focused editor", detail: "Looking at the active app through macOS Accessibility.")
        do {
            focusedContext = try textClient.focusedTextContext()
            currentApplication = ActiveApplication(
                name: focusedContext?.applicationName ?? "Focused app",
                icon: currentApplication?.icon
            )
            draft = nil
            phase = .idle
            statusMessage = "Captured text from \(focusedContext?.applicationName ?? "focused app")"
            record("Captured text", detail: "\(focusedContext?.text.count ?? 0) characters from \(focusedContext?.applicationName ?? "focused app").")
        } catch {
            fail(error.localizedDescription)
        }
    }

    func improveCapturedText() {
        guard let focusedContext else {
            fail("Capture text from the focused editor first.")
            return
        }

        improve(text: focusedContext.text, sourceApp: nil, keepFocusedContext: true)
    }

    func improve(text: String, sourceApp: ConnectedApp? = nil, keepFocusedContext: Bool = false) {
        let originalText = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !originalText.isEmpty else {
            fail("Add text to edit first.")
            return
        }

        let editor = editor
        let preferences = preferences
        if !keepFocusedContext {
            focusedContext = nil
        }
        editTask?.cancel()
        editorSourceApp = sourceApp
        draft = EditorialDraft(original: originalText, improved: originalText, notes: [])
        lastErrorMessage = nil
        phase = .editing
        statusMessage = "Editing..."
        record("Preparing edit", detail: "Sending \(originalText.count) characters to Editorial's line editor.")

        editTask = Task {
            do {
                record("Improving text", detail: "Checking grammar, clarity, rhythm, and word choice.")
                let result = try await editor.improve(text: originalText, preferences: preferences)
                guard !Task.isCancelled else { return }
                draft = EditorialDraft(original: originalText, improved: result.improvedText, notes: result.notes)
                phase = .idle
                statusMessage = "Draft ready"
                record("Draft ready", detail: "\(result.improvedText.count) characters returned with \(result.notes.count) notes.")
            } catch is CancellationError {
                phase = .idle
            } catch {
                draft = nil
                fail(errorMessage(from: error))
            }
        }
    }

    func applyDraft() {
        guard let draft else {
            fail("There is no draft to apply.")
            return
        }

        phase = .applying
        record("Applying draft", detail: "Writing the edited text back to the focused app.")
        do {
            try textClient.replaceFocusedText(with: draft.improved, context: focusedContext)
            focusedContext = focusedContext?.replacingText(draft.improved)
            phase = .idle
            statusMessage = "Applied edit"
            record("Applied edit", detail: "The focused app accepted the replacement text.")
        } catch {
            fail(error.localizedDescription)
        }
    }

    func copyDraft() {
        guard let draft else { return }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(draft.improved, forType: .string)
        statusMessage = "Copied edit"
        record("Copied draft", detail: "The improved text is on the clipboard.")
    }

    func resetPreferences() {
        preferences.reset()
        statusMessage = "Preferences reset"
        record("Preferences reset", detail: "Editorial is back to its default editing style.")
    }

    private func fail(_ message: String) {
        phase = .failed(message)
        lastErrorMessage = message
        statusMessage = message
        NSLog("Editorial error: %@", message)
        record("Needs attention", detail: message)
    }

    private func errorMessage(from error: Error) -> String {
        if let failure = error as? EditorialServiceFailure {
            return failure.fullDescription
        }

        return error.localizedDescription
    }

    private func record(_ title: String, detail: String) {
        processEvents.insert(.init(title: title, detail: detail), at: 0)
        processEvents = Array(processEvents.prefix(8))
    }

    private func updateCurrentApplication(from application: NSRunningApplication?) {
        guard let application else { return }
        guard application.processIdentifier != ProcessInfo.processInfo.processIdentifier else { return }
        currentApplication = ActiveApplication(
            name: application.localizedName ?? "Current app",
            icon: application.icon
        )
    }
}

struct ActiveApplication {
    let name: String
    let icon: NSImage?
}

struct EditorialDraft: Equatable {
    let original: String
    let improved: String
    let notes: [String]
}

struct ProcessEvent: Identifiable, Equatable {
    let id = UUID()
    let title: String
    let detail: String
    let date = Date()
}
