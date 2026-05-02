import AppKit
import SwiftUI

@MainActor
final class FloatingButtonController {
    static let shared = FloatingButtonController()

    private var panel: NSPanel?
    private var editorWindow: NSWindow?
    private var appModel: AppModel?
    private var dragStartFrame: NSRect?

    private let size = CGSize(width: 46, height: 46)
    private let edgeInset: CGFloat = 10

    private init() {}

    func configure(appModel: AppModel) {
        self.appModel = appModel
        guard panel == nil else { return }

        let panel = DraggableFloatingPanel(
            contentRect: NSRect(origin: defaultOrigin(), size: size),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.isReleasedWhenClosed = false
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        panel.backgroundColor = .clear
        panel.isOpaque = false
        panel.hasShadow = true
        panel.hidesOnDeactivate = false
        panel.ignoresMouseEvents = false
        panel.snapToPerimeter = { [weak self] frame in
            self?.snappedFrame(for: frame) ?? frame
        }

        let root = FloatingButtonView(
            appModel: appModel,
            onToggle: {
                self.toggleEditorWindow()
            },
            onDragChanged: { translation in
                self.updateDrag(translation: translation)
            },
            onDragEnded: {
                self.endDrag()
            }
        )
        panel.contentView = NSHostingView(rootView: root)
        panel.orderFrontRegardless()
        self.panel = panel
    }

    func show() {
        panel?.orderFrontRegardless()
    }

    func toggleEditorWindow() {
        if let editorWindow, editorWindow.isVisible {
            editorWindow.close()
            return
        }

        showEditorWindow()
    }

    func updateDrag(translation: CGSize) {
        guard let panel else { return }
        if dragStartFrame == nil {
            dragStartFrame = panel.frame
        }
        guard let dragStartFrame else { return }

        panel.setFrameOrigin(CGPoint(
            x: dragStartFrame.origin.x + translation.width,
            y: dragStartFrame.origin.y - translation.height
        ))
    }

    func endDrag() {
        guard let panel else { return }
        panel.animator().setFrame(snappedFrame(for: panel.frame), display: true)
        dragStartFrame = nil
    }

    private func showEditorWindow() {
        guard let appModel else { return }

        let window = editorWindow ?? NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1120, height: 730),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Editorial"
        window.minSize = NSSize(width: 800, height: 500)
        window.collectionBehavior.insert([.fullScreenPrimary, .managed])
        window.isReleasedWhenClosed = false
        window.contentView = NSHostingView(
            rootView: EditorWindowView()
                .environmentObject(appModel)
        )
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        editorWindow = window
    }

    private func defaultOrigin() -> CGPoint {
        guard let screen = NSScreen.main else {
            return CGPoint(x: 20, y: 500)
        }

        let frame = screen.visibleFrame
        return CGPoint(
            x: frame.maxX - size.width - edgeInset,
            y: frame.midY - size.height / 2
        )
    }

    private func snappedFrame(for frame: NSRect) -> NSRect {
        guard let screen = NSScreen.screens.first(where: { $0.visibleFrame.intersects(frame) }) ?? NSScreen.main else {
            return frame
        }

        let bounds = screen.visibleFrame.insetBy(dx: edgeInset, dy: edgeInset)
        let center = CGPoint(x: frame.midX, y: frame.midY)

        let distances = [
            abs(center.x - bounds.minX),
            abs(center.x - bounds.maxX),
            abs(center.y - bounds.minY),
            abs(center.y - bounds.maxY)
        ]
        let nearestEdge = distances.enumerated().min(by: { $0.element < $1.element })?.offset ?? 1

        var origin = frame.origin
        switch nearestEdge {
        case 0:
            origin.x = bounds.minX
            origin.y = clamp(frame.origin.y, min: bounds.minY, max: bounds.maxY - frame.height)
        case 1:
            origin.x = bounds.maxX - frame.width
            origin.y = clamp(frame.origin.y, min: bounds.minY, max: bounds.maxY - frame.height)
        case 2:
            origin.y = bounds.minY
            origin.x = clamp(frame.origin.x, min: bounds.minX, max: bounds.maxX - frame.width)
        default:
            origin.y = bounds.maxY - frame.height
            origin.x = clamp(frame.origin.x, min: bounds.minX, max: bounds.maxX - frame.width)
        }

        return NSRect(origin: origin, size: frame.size)
    }

    private func clamp(_ value: CGFloat, min lower: CGFloat, max upper: CGFloat) -> CGFloat {
        Swift.min(Swift.max(value, lower), upper)
    }
}

private final class DraggableFloatingPanel: NSPanel {
    var snapToPerimeter: ((NSRect) -> NSRect)?

    private var dragStartLocation: NSPoint?
    private var dragStartOrigin: NSPoint?

    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }

    override func mouseDown(with event: NSEvent) {
        dragStartLocation = NSEvent.mouseLocation
        dragStartOrigin = frame.origin
    }

    override func mouseDragged(with event: NSEvent) {
        guard let dragStartLocation, let dragStartOrigin else { return }

        let currentLocation = NSEvent.mouseLocation
        let delta = CGPoint(
            x: currentLocation.x - dragStartLocation.x,
            y: currentLocation.y - dragStartLocation.y
        )

        setFrameOrigin(CGPoint(
            x: dragStartOrigin.x + delta.x,
            y: dragStartOrigin.y + delta.y
        ))
    }

    override func mouseUp(with event: NSEvent) {
        if let snapToPerimeter {
            animator().setFrame(snapToPerimeter(frame), display: true)
        }
        dragStartLocation = nil
        dragStartOrigin = nil
    }
}

private struct FloatingButtonView: View {
    @ObservedObject var appModel: AppModel
    let onToggle: () -> Void
    let onDragChanged: (CGSize) -> Void
    let onDragEnded: () -> Void

    @State private var isHovered = false

    var body: some View {
        Button(action: onToggle) {
            ZStack(alignment: .bottomTrailing) {
                RoundedRectangle(cornerRadius: 12)
                    .fill(Color(hex: "#191820").opacity(0.96))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12)
                            .stroke(Color.white.opacity(isHovered ? 0.22 : 0.11), lineWidth: 0.75)
                    )

                Image(systemName: "text.alignleft")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundColor(Color.edAccent)

                Circle()
                    .fill(statusColor)
                    .frame(width: 8, height: 8)
                    .overlay(Circle().stroke(Color(hex: "#191820"), lineWidth: 1.5))
                    .padding(7)
            }
            .frame(width: 46, height: 46)
            .scaleEffect(isHovered ? 1.04 : 1)
            .animation(.easeOut(duration: 0.12), value: isHovered)
        }
        .buttonStyle(.plain)
        .simultaneousGesture(
            DragGesture(minimumDistance: 4)
                .onChanged { value in
                    onDragChanged(value.translation)
                }
                .onEnded { _ in
                    onDragEnded()
                }
        )
        .onHover { isHovered = $0 }
        .help("Open Editorial")
    }

    private var statusColor: Color {
        switch appModel.phase {
        case .failed:
            Color.edRedDel
        case .editing, .loadingFocusedText, .applying:
            Color.edAccent
        case .idle:
            Color.edGreen
        }
    }
}
