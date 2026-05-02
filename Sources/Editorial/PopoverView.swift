import AppKit
import SwiftUI

struct PopoverView: View {
    @EnvironmentObject private var appModel: AppModel
    @Environment(\.openWindow) private var openWindow
    @Environment(\.openSettings) private var openSettings

    @State private var inputText = ""

    private var pastedTextIsEmpty: Bool {
        inputText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        VStack(spacing: 0) {
            header
            permissionBanner
            focusedTextSection
            divider
            pasteSection
            footer
        }
        .frame(width: 420)
        .background(Color(hex: "#16151d"))
        .preferredColorScheme(.dark)
        .onAppear {
            appModel.refreshPermissionStatus()
            appModel.refreshCurrentApplication()
        }
    }

    private var header: some View {
        HStack {
            editorialTitle
            Spacer()
            Button {
                openSettings()
            } label: {
                Image(systemName: "slider.horizontal.3")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(Color.edTextSec)
                    .frame(width: 28, height: 24)
                    .background(Color.white.opacity(0.05))
                    .overlay(
                        RoundedRectangle(cornerRadius: 7)
                            .stroke(Color.white.opacity(0.1), lineWidth: 0.5)
                    )
                    .cornerRadius(7)
            }
            .buttonStyle(.plain)
            .help("Preferences")

            Button {
                openWindow(id: "editor")
            } label: {
                Image(systemName: "arrow.up.left.and.arrow.down.right")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(Color.edTextSec)
                    .frame(width: 28, height: 24)
                    .background(Color.white.opacity(0.05))
                    .overlay(
                        RoundedRectangle(cornerRadius: 7)
                            .stroke(Color.white.opacity(0.1), lineWidth: 0.5)
                    )
                    .cornerRadius(7)
            }
            .buttonStyle(.plain)
            .help("Open editor")
        }
        .padding(.horizontal, 16)
        .padding(.top, 14)
        .padding(.bottom, 10)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Color.white.opacity(0.06)).frame(height: 0.5)
        }
    }

    private var editorialTitle: some View {
        HStack(spacing: 0) {
            Text("ed")
                .font(.system(size: 17, design: .serif).italic())
                .foregroundColor(Color.edAccent)
            Text("itorial")
                .font(.system(size: 17, design: .serif))
                .foregroundColor(Color.white.opacity(0.9))
        }
    }

    @ViewBuilder
    private var permissionBanner: some View {
        if !appModel.accessibilityTrusted {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    Image(systemName: "hand.raised")
                        .foregroundColor(Color.edAccent)
                    Text("Accessibility access is needed to capture and replace focused text.")
                        .font(.system(size: 12))
                        .foregroundColor(Color.edTextSec)
                        .fixedSize(horizontal: false, vertical: true)
                }

                HStack(spacing: 8) {
                    Button("Request Access") {
                        appModel.requestAccessibilityPermission()
                    }
                    .buttonStyle(ActionButtonStyle())

                    Button("Open Settings") {
                        appModel.openAccessibilitySettings()
                    }
                    .buttonStyle(SecondaryActionButtonStyle())
                }
            }
            .padding(12)
            .background(Color.edAccent.opacity(0.08))
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .stroke(Color.edAccent.opacity(0.18), lineWidth: 0.5)
            )
            .cornerRadius(10)
            .padding(12)
        }
    }

    private var focusedTextSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("CURRENT EDITOR")
                .font(.system(size: 10, weight: .semibold))
                .foregroundColor(Color.edTextMut)
                .tracking(1)

            if let context = appModel.focusedContext {
                VStack(alignment: .leading, spacing: 8) {
                    HStack {
                        Text(context.applicationName)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundColor(Color.white.opacity(0.82))
                        Spacer()
                        Text("\(context.text.count.formatted()) chars")
                            .font(.system(size: 11))
                            .foregroundColor(Color.edTextFaint)
                    }

                    Text(context.text)
                        .font(.system(size: 11.5, design: .monospaced))
                        .foregroundColor(Color.white.opacity(0.5))
                        .lineLimit(4)
                        .lineSpacing(3)
                }
                .padding(11)
                .background(Color.white.opacity(0.03))
                .overlay(
                    RoundedRectangle(cornerRadius: 9)
                        .stroke(Color.white.opacity(0.09), lineWidth: 0.5)
                )
                .cornerRadius(9)
            } else {
                currentApplicationCard
            }

            HStack(spacing: 8) {
                Button {
                    appModel.captureFocusedText()
                } label: {
                    Label("Capture", systemImage: "scope")
                }
                .buttonStyle(SecondaryActionButtonStyle())
                .disabled(appModel.isBusy)

                Button {
                    appModel.improveCapturedText()
                    openWindow(id: "editor")
                } label: {
                    Label("Edit Captured Text", systemImage: "pencil.line")
                }
                .buttonStyle(ActionButtonStyle())
                .disabled(appModel.focusedContext == nil || appModel.isBusy)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
    }

    @ViewBuilder
    private var currentApplicationCard: some View {
        if let application = appModel.currentApplication {
            HStack(spacing: 10) {
                AppIconView(icon: application.icon, size: 28)

                VStack(alignment: .leading, spacing: 2) {
                    Text(application.name)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(Color.white.opacity(0.82))
                    Text("Click into the editor text, then capture it.")
                        .font(.system(size: 11.5))
                        .foregroundColor(Color.edTextMut)
                }

                Spacer()
            }
            .padding(11)
            .background(Color.white.opacity(0.03))
            .overlay(
                RoundedRectangle(cornerRadius: 9)
                    .stroke(Color.white.opacity(0.09), lineWidth: 0.5)
            )
            .cornerRadius(9)
        } else {
            Text("Open an editor, click into its text, then capture it here.")
                .font(.system(size: 12))
                .foregroundColor(Color.edTextMut)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(11)
                .background(Color.white.opacity(0.025))
                .overlay(
                    RoundedRectangle(cornerRadius: 9)
                        .stroke(Color.white.opacity(0.08), lineWidth: 0.5)
                )
                .cornerRadius(9)
        }
    }

    private var divider: some View {
        Rectangle()
            .fill(Color.white.opacity(0.06))
            .frame(height: 0.5)
    }

    private var pasteSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("PASTE TEXT")
                .font(.system(size: 10, weight: .semibold))
                .foregroundColor(Color.edTextMut)
                .tracking(1)

            ZStack(alignment: .bottomTrailing) {
                TextEditor(text: $inputText)
                    .font(.system(size: 12.5, design: .monospaced))
                    .scrollContentBackground(.hidden)
                    .foregroundColor(Color.white.opacity(0.8))
                    .frame(height: 128)
                    .padding(10)
                    .background(Color.white.opacity(0.03))
                    .overlay(
                        RoundedRectangle(cornerRadius: 9)
                            .stroke(
                                pastedTextIsEmpty ? Color.white.opacity(0.09) : Color.edAccent.opacity(0.35),
                                lineWidth: 0.5
                            )
                    )
                    .cornerRadius(9)

                if !pastedTextIsEmpty {
                    Text("\(inputText.count.formatted())")
                        .font(.system(size: 11))
                        .foregroundColor(Color.edTextFaint)
                        .padding(.trailing, 10)
                        .padding(.bottom, 8)
                        .allowsHitTesting(false)
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
    }

    private var footer: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(appModel.lastErrorMessage ?? appModel.statusMessage)
                .font(.system(size: 11))
                .foregroundColor(appModel.lastErrorMessage == nil ? Color.edTextFaint : Color.edRedDel.opacity(0.9))
                .lineLimit(nil)
                .fixedSize(horizontal: false, vertical: true)
                .textSelection(.enabled)

            HStack(spacing: 10) {
                Spacer(minLength: 0)

                Button {
                    appModel.improve(text: inputText)
                    openWindow(id: "editor")
                } label: {
                    if appModel.phase == .editing {
                        HStack(spacing: 6) {
                            ProgressView()
                                .scaleEffect(0.55)
                                .frame(width: 13, height: 13)
                            Text("Editing...")
                        }
                    } else {
                        Label("Line Edit", systemImage: "pencil.line")
                    }
                }
                .buttonStyle(ActionButtonStyle())
                .disabled(pastedTextIsEmpty || appModel.isBusy)
            }
        }
        .padding(.horizontal, 12)
        .padding(.top, 8)
        .padding(.bottom, 12)
    }
}

private struct ActionButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 12.5, weight: .semibold))
            .foregroundColor(Color(hex: "#1a1408"))
            .padding(.horizontal, 13)
            .padding(.vertical, 7)
            .background(Color.edAccent.opacity(configuration.isPressed ? 0.8 : 1))
            .cornerRadius(8)
    }
}

private struct SecondaryActionButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 12.5, weight: .medium))
            .foregroundColor(Color.edTextSec)
            .padding(.horizontal, 13)
            .padding(.vertical, 7)
            .background(Color.white.opacity(configuration.isPressed ? 0.08 : 0.045))
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(Color.white.opacity(0.1), lineWidth: 0.5)
            )
            .cornerRadius(8)
    }
}

private struct AppIconView: View {
    let icon: NSImage?
    let size: CGFloat

    var body: some View {
        Group {
            if let icon {
                Image(nsImage: icon)
                    .resizable()
                    .scaledToFit()
            } else {
                Image(systemName: "macwindow")
                    .font(.system(size: size * 0.55, weight: .medium))
                    .foregroundColor(Color.edAccent)
            }
        }
        .frame(width: size, height: size)
        .background(Color.white.opacity(0.05))
        .overlay(
            RoundedRectangle(cornerRadius: 7)
                .stroke(Color.white.opacity(0.09), lineWidth: 0.5)
        )
        .cornerRadius(7)
    }
}
