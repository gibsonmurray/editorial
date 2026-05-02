import AppKit
import SwiftUI

enum SnappedEdge { case left, right, top, bottom }

@MainActor
final class FloatingButtonController: ObservableObject {
    static let shared = FloatingButtonController()

    @Published var snappedEdge: SnappedEdge = .right

    private var panel: NSPanel?
    private var dragStartFrame: NSRect?

    private let collapsedSize = CGSize(width: 52, height: 52)
    private let expandedWidth: CGFloat = 200
    private let edgeInset: CGFloat = 10

    private init() {}

    func configure(appModel: AppModel) {
        guard panel == nil else { return }

        let panel = DraggableFloatingPanel(
            contentRect: NSRect(origin: defaultOrigin(), size: collapsedSize),
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
            controller: self,
            appModel: appModel,
            onToggle: { self.toggleEditorWindow(appModel: appModel) },
            onHoverChanged: { self.handleHoverChanged($0) }
        )
        panel.contentView = NSHostingView(rootView: root)
        panel.orderFrontRegardless()
        self.panel = panel
    }

    func show() {
        panel?.orderFrontRegardless()
    }

    func handleHoverChanged(_ isHovered: Bool) {
        guard let panel else { return }
        let targetWidth = isHovered ? expandedWidth : collapsedSize.width
        let currentFrame = panel.frame
        var newOrigin = currentFrame.origin

        switch snappedEdge {
        case .right, .top, .bottom:
            newOrigin.x = currentFrame.maxX - targetWidth
        case .left:
            break
        }

        let newFrame = NSRect(origin: newOrigin, size: CGSize(width: targetWidth, height: collapsedSize.height))
        NSAnimationContext.runAnimationGroup { ctx in
            ctx.duration = 0.22
            ctx.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            panel.animator().setFrame(newFrame, display: true)
        }
    }

    private func toggleEditorWindow(appModel: AppModel) {
        FloatingButtonController.openEditorWindow(appModel: appModel)
    }

    static func openEditorWindow(appModel: AppModel) {
        let existing = NSApp.windows.first { $0.title == "Editorial" && !($0 is NSPanel) }
        if let win = existing {
            win.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            return
        }

        let window = NSWindow(
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
            rootView: EditorWindowView().environmentObject(appModel)
        )
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func defaultOrigin() -> CGPoint {
        guard let screen = NSScreen.main else { return CGPoint(x: 20, y: 500) }
        let frame = screen.visibleFrame
        return CGPoint(
            x: frame.maxX - collapsedSize.width - edgeInset,
            y: frame.midY - collapsedSize.height / 2
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
            snappedEdge = .left
            origin.x = bounds.minX
            origin.y = clamp(frame.origin.y, min: bounds.minY, max: bounds.maxY - frame.height)
        case 1:
            snappedEdge = .right
            origin.x = bounds.maxX - frame.width
            origin.y = clamp(frame.origin.y, min: bounds.minY, max: bounds.maxY - frame.height)
        case 2:
            snappedEdge = .bottom
            origin.y = bounds.minY
            origin.x = clamp(frame.origin.x, min: bounds.minX, max: bounds.maxX - frame.width)
        default:
            snappedEdge = .top
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
        let current = NSEvent.mouseLocation
        setFrameOrigin(CGPoint(
            x: dragStartOrigin.x + current.x - dragStartLocation.x,
            y: dragStartOrigin.y + current.y - dragStartLocation.y
        ))
    }

    override func mouseUp(with event: NSEvent) {
        if let snap = snapToPerimeter {
            animator().setFrame(snap(frame), display: true)
        }
        dragStartLocation = nil
        dragStartOrigin = nil
    }
}

private struct FloatingButtonView: View {
    @ObservedObject var controller: FloatingButtonController
    @ObservedObject var appModel: AppModel
    let onToggle: () -> Void
    let onHoverChanged: (Bool) -> Void

    @State private var isHovered = false

    private var textOnLeft: Bool { controller.snappedEdge != .left }

    var body: some View {
        GeometryReader { geo in
            let expanded = geo.size.width > 80

            Button(action: onToggle) {
                ZStack {
                    pillBackground(expanded: expanded)

                    HStack(spacing: 0) {
                        if expanded && textOnLeft {
                            editorialLabel
                                .padding(.leading, 16)
                                .transition(.opacity.combined(with: .move(edge: .trailing)))
                            Spacer(minLength: 0)
                        }

                        iconArea
                            .frame(width: 52, height: 52)

                        if expanded && !textOnLeft {
                            Spacer(minLength: 0)
                            editorialLabel
                                .padding(.trailing, 16)
                                .transition(.opacity.combined(with: .move(edge: .leading)))
                        }
                    }
                    .animation(.easeInOut(duration: 0.15), value: expanded)
                }
                .frame(width: geo.size.width, height: 52)
                .scaleEffect(isHovered ? 1.02 : 1)
                .animation(.easeOut(duration: 0.12), value: isHovered)
            }
            .buttonStyle(.plain)
            .onHover { hovered in
                isHovered = hovered
                onHoverChanged(hovered)
            }
            .help("Editorial")
        }
        .frame(height: 52)
    }

    private func pillBackground(expanded: Bool) -> some View {
        let detected = appModel.hasActiveTextField

        return RoundedRectangle(cornerRadius: 26)
            .fill(Color(hex: "#191820").opacity(0.96))
            .overlay(
                RoundedRectangle(cornerRadius: 26)
                    .stroke(
                        detected
                            ? Color.edAccent.opacity(isHovered ? 0.55 : 0.35)
                            : Color.white.opacity(isHovered ? 0.22 : 0.11),
                        lineWidth: detected ? 1 : 0.75
                    )
            )
            .shadow(color: detected ? Color.edAccent.opacity(0.2) : .clear, radius: 8, x: 0, y: 0)
    }

    private var iconArea: some View {
        ZStack {
            Image(systemName: "pencil.line")
                .font(.system(size: 17, weight: .semibold))
                .foregroundColor(appModel.hasActiveTextField ? Color.edAccent : Color.white.opacity(0.72))

            Circle()
                .fill(statusColor)
                .frame(width: 7, height: 7)
                .overlay(Circle().stroke(Color(hex: "#191820"), lineWidth: 1.5))
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
                .padding(10)
        }
    }

    private var editorialLabel: some View {
        HStack(spacing: 0) {
            Text("ed")
                .font(.system(size: 14, design: .serif).italic())
                .foregroundColor(Color.edAccent)
            Text("itorial")
                .font(.system(size: 14, design: .serif))
                .foregroundColor(Color.white.opacity(0.88))
        }
    }

    private var statusColor: Color {
        switch appModel.phase {
        case .failed: Color.edRedDel
        case .editing, .loadingFocusedText, .applying: Color.edAccent
        case .idle: Color.edGreen
        }
    }
}
