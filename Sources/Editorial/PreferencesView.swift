import SwiftUI

struct PreferencesView: View {
    @EnvironmentObject private var appModel: AppModel

    var body: some View {
        VStack(spacing: 0) {
            header

            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    preferenceGroup("Editing") {
                        Picker("Mode", selection: $appModel.preferences.editingMode) {
                            ForEach(EditingMode.allCases) { mode in
                                Text(mode.title).tag(mode)
                            }
                        }
                        .pickerStyle(.segmented)

                        VStack(alignment: .leading, spacing: 8) {
                            HStack {
                                Text("Rewrite Strength")
                                Spacer()
                                Text(strengthLabel)
                                    .foregroundColor(Color.edTextMut)
                            }
                            .font(.system(size: 12, weight: .medium))

                            Slider(value: $appModel.preferences.rewriteStrength, in: 0...1)
                                .tint(Color.edAccent)
                        }
                    }

                    preferenceGroup("Voice") {
                        pickerRow("Tone", selection: $appModel.preferences.tone) { tone in
                            tone.title
                        }

                        pickerRow("Audience", selection: $appModel.preferences.audience) { audience in
                            audience.title
                        }

                        Toggle("Preserve formatting", isOn: $appModel.preferences.preserveFormatting)
                            .toggleStyle(.switch)
                    }

                    preferenceGroup("Output") {
                        pickerRow("Notes", selection: $appModel.preferences.noteDetail) { detail in
                            detail.title
                        }

                        VStack(alignment: .leading, spacing: 8) {
                            Text("Custom Instructions")
                                .font(.system(size: 12, weight: .medium))
                                .foregroundColor(Color.edTextSec)

                            TextEditor(text: $appModel.preferences.customInstructions)
                                .font(.system(size: 12.5))
                                .scrollContentBackground(.hidden)
                                .foregroundColor(Color.edText)
                                .frame(minHeight: 110)
                                .padding(10)
                                .background(Color.white.opacity(0.035))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 8)
                                        .stroke(Color.white.opacity(0.1), lineWidth: 0.5)
                                )
                                .cornerRadius(8)
                        }
                    }
                }
                .padding(18)
            }
        }
        .frame(width: 520, height: 560)
        .background(Color.edBg)
        .preferredColorScheme(.dark)
    }

    private var header: some View {
        HStack {
            Text("Preferences")
                .font(.system(size: 18, design: .serif))
                .foregroundColor(Color.edText)

            Spacer()

            Button {
                appModel.resetPreferences()
            } label: {
                Label("Reset", systemImage: "arrow.counterclockwise")
            }
            .buttonStyle(ToolbarButtonStyle())
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 14)
        .background(Color.black.opacity(0.12))
        .overlay(alignment: .bottom) {
            Rectangle().fill(Color.white.opacity(0.06)).frame(height: 0.5)
        }
    }

    private var strengthLabel: String {
        switch appModel.preferences.rewriteStrength {
        case ..<0.25: "Minimal"
        case ..<0.5: "Light"
        case ..<0.75: "Moderate"
        default: "Strong"
        }
    }

    private func preferenceGroup<Content: View>(
        _ title: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title.uppercased())
                .font(.system(size: 10, weight: .semibold))
                .foregroundColor(Color.edTextMut)
                .tracking(1)

            VStack(alignment: .leading, spacing: 14) {
                content()
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.white.opacity(0.025))
            .overlay(
                RoundedRectangle(cornerRadius: 8)
                    .stroke(Color.white.opacity(0.08), lineWidth: 0.5)
            )
            .cornerRadius(8)
        }
    }

    private func pickerRow<Value: CaseIterable & Hashable & Identifiable, Label: StringProtocol>(
        _ title: String,
        selection: Binding<Value>,
        label: @escaping (Value) -> Label
    ) -> some View where Value.AllCases: RandomAccessCollection {
        HStack {
            Text(title)
                .font(.system(size: 12, weight: .medium))
                .foregroundColor(Color.edTextSec)

            Spacer()

            Picker(title, selection: selection) {
                ForEach(Array(Value.allCases)) { value in
                    Text(String(label(value))).tag(value)
                }
            }
            .labelsHidden()
            .frame(width: 190)
        }
    }
}
