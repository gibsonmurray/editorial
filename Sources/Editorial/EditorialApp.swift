import SwiftUI
import AppKit

private final class EditorialAppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
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
            PopoverView()
                .environmentObject(appModel)
        } label: {
            MenuBarLabel(phase: appModel.phase)
        }
        .menuBarExtraStyle(.window)

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

// MARK: - Menu bar button label
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
        case .failed:
            Color.edRedDel
        case .editing, .loadingFocusedText, .applying:
            Color.edAccent
        case .idle:
            Color.edGreen
        }
    }
}
