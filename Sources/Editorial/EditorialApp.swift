import SwiftUI
import AppKit

private final class EditorialAppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        FloatingButtonController.shared.show()
    }
}

@main
struct EditorialApp: App {
    @NSApplicationDelegateAdaptor(EditorialAppDelegate.self) private var delegate
    @StateObject private var appModel: AppModel

    init() {
        let model = AppModel()
        _appModel = StateObject(wrappedValue: model)
        FloatingButtonController.shared.configure(appModel: model)
    }

    var body: some Scene {
        MenuBarExtra {
            MenuBarMenuView()
                .environmentObject(appModel)
        } label: {
            MenuBarLabel(phase: appModel.phase)
        }
        .menuBarExtraStyle(.menu)

        Window("Editorial", id: "editor") {
            EditorWindowView()
                .environmentObject(appModel)
        }
        .defaultSize(width: 1120, height: 730)
        .windowResizability(.contentMinSize)

        Settings {
            PreferencesView()
                .environmentObject(appModel)
        }
    }
}

private struct MenuBarMenuView: View {
    @EnvironmentObject private var appModel: AppModel
    @Environment(\.openWindow) private var openWindow
    @Environment(\.openSettings) private var openSettings

    var body: some View {
        statusRow
        Divider()
        Button("Open Editorial") {
            openWindow(id: "editor")
            NSApp.activate(ignoringOtherApps: true)
        }
        Divider()
        Button("Preferences…") {
            openSettings()
            NSApp.activate(ignoringOtherApps: true)
        }
        Divider()
        Button("Quit Editorial") {
            NSApp.terminate(nil)
        }
    }

    private var statusRow: some View {
        Label {
            Text(appModel.statusMessage)
                .foregroundColor(.secondary)
        } icon: {
            Circle()
                .fill(statusColor)
                .frame(width: 7, height: 7)
        }
        .disabled(true)
    }

    private var statusColor: Color {
        switch appModel.phase {
        case .failed: Color.edRedDel
        case .editing, .loadingFocusedText, .applying: Color.edAccent
        case .idle: Color.edGreen
        }
    }
}

private struct MenuBarLabel: View {
    let phase: AppModel.Phase

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            Image(systemName: "text.alignleft")
                .font(.system(size: 15, weight: .semibold))
                .symbolRenderingMode(.hierarchical)

            Circle()
                .fill(statusColor)
                .frame(width: 5, height: 5)
                .offset(x: 2, y: 1)
        }
        .help("Editorial")
    }

    private var statusColor: Color {
        switch phase {
        case .failed: Color.edRedDel
        case .editing, .loadingFocusedText, .applying: Color.edAccent
        case .idle: Color.edGreen
        }
    }
}
