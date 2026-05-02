import SwiftUI

struct PreferencesView: View {
    @EnvironmentObject private var appModel: AppModel
    @State private var selectedProvider: ModelProvider = .openai

    var body: some View {
        VStack(spacing: 0) {
            header

            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    modelGroup
                    editingGroup
                    voiceGroup
                    outputGroup
                }
                .padding(18)
            }
        }
        .frame(width: 520, height: 640)
        .background(Color.edBg)
        .preferredColorScheme(.dark)
        .onAppear {
            selectedProvider = appModel.preferences.selectedModel.provider
            appModel.fetchOllamaModels()
        }
        .onChange(of: selectedProvider) { _, provider in
            let candidates: [ModelOption]
            if provider == .ollama {
                candidates = appModel.availableOllamaModels
            } else {
                candidates = ModelOption.builtIn.filter { $0.provider == provider }
            }
            if let first = candidates.first {
                appModel.preferences.selectedModel = first
            }
        }
    }

    // MARK: - Model group

    private var modelGroup: some View {
        preferenceGroup("Model") {
            // Provider picker
            Picker("Provider", selection: $selectedProvider) {
                ForEach(ModelProvider.allCases) { provider in
                    Text(provider.title).tag(provider)
                }
            }
            .pickerStyle(.segmented)
            .onChange(of: appModel.preferences.selectedModel) { _, model in
                selectedProvider = model.provider
            }

            // Model picker
            let models = modelsForProvider(selectedProvider)
            if !models.isEmpty {
                Picker("Model", selection: $appModel.preferences.selectedModel) {
                    ForEach(models) { model in
                        Text(model.name).tag(model)
                    }
                }
                .labelsHidden()
                .frame(maxWidth: .infinity)
            } else if selectedProvider == .ollama {
                Text("No Ollama models found. Run: ollama pull llama3.2")
                    .font(.system(size: 12))
                    .foregroundColor(Color.edTextMut)
            }

            // API key field
            switch selectedProvider {
            case .openai:
                apiKeyField(
                    label: "OpenAI API Key",
                    placeholder: "sk-…  (or set OPENAI_API_KEY in environment)",
                    binding: $appModel.preferences.openaiAPIKey
                )
            case .anthropic:
                apiKeyField(
                    label: "Anthropic API Key",
                    placeholder: "sk-ant-…  (or set ANTHROPIC_API_KEY in environment)",
                    binding: $appModel.preferences.anthropicAPIKey
                )
            case .ollama:
                ollamaStatus
            }
        }
    }

    private func modelsForProvider(_ provider: ModelProvider) -> [ModelOption] {
        if provider == .ollama {
            return appModel.availableOllamaModels
        }
        return ModelOption.builtIn.filter { $0.provider == provider }
    }

    private func apiKeyField(label: String, placeholder: String, binding: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.system(size: 12, weight: .medium))
                .foregroundColor(Color.edTextSec)

            SecureField(placeholder, text: binding)
                .textFieldStyle(.plain)
                .font(.system(size: 12, design: .monospaced))
                .foregroundColor(Color.edText)
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
                .background(Color.white.opacity(0.035))
                .overlay(
                    RoundedRectangle(cornerRadius: 7)
                        .stroke(Color.white.opacity(0.1), lineWidth: 0.5)
                )
                .cornerRadius(7)
        }
    }

    private var ollamaStatus: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(appModel.availableOllamaModels.isEmpty ? Color.edRedDel : Color.edGreen)
                .frame(width: 6, height: 6)
            Text(appModel.availableOllamaModels.isEmpty
                 ? "Ollama not running — start it with: ollama serve"
                 : "\(appModel.availableOllamaModels.count) model\(appModel.availableOllamaModels.count == 1 ? "" : "s") available locally")
                .font(.system(size: 12))
                .foregroundColor(Color.edTextSec)

            Spacer()

            Button("Refresh") {
                appModel.fetchOllamaModels()
            }
            .buttonStyle(ToolbarButtonStyle())
            .font(.system(size: 11))
        }
    }

    // MARK: - Other groups

    private var editingGroup: some View {
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
    }

    private var voiceGroup: some View {
        preferenceGroup("Voice") {
            pickerRow("Tone", selection: $appModel.preferences.tone) { $0.title }
            pickerRow("Audience", selection: $appModel.preferences.audience) { $0.title }
            Toggle("Preserve formatting", isOn: $appModel.preferences.preserveFormatting)
                .toggleStyle(.switch)
        }
    }

    private var outputGroup: some View {
        preferenceGroup("Output") {
            pickerRow("Notes", selection: $appModel.preferences.noteDetail) { $0.title }

            VStack(alignment: .leading, spacing: 8) {
                Text("Custom Instructions")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(Color.edTextSec)

                TextEditor(text: $appModel.preferences.customInstructions)
                    .font(.system(size: 12.5))
                    .scrollContentBackground(.hidden)
                    .foregroundColor(Color.edText)
                    .frame(minHeight: 90)
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

    // MARK: - Shared

    private var header: some View {
        HStack {
            Text("Preferences")
                .font(.system(size: 18, design: .serif))
                .foregroundColor(Color.edText)

            Spacer()

            Button {
                appModel.resetPreferences()
                selectedProvider = appModel.preferences.selectedModel.provider
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
        case ..<0.5:  "Light"
        case ..<0.75: "Moderate"
        default:      "Strong"
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
