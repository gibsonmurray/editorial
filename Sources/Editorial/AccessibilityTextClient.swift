import AppKit
import ApplicationServices
import Foundation

struct TextContext: Equatable {
    let applicationName: String
    let text: String
    let selectedRange: CFRange?
    fileprivate let element: AXUIElement

    func replacingText(_ newText: String) -> TextContext {
        TextContext(applicationName: applicationName, text: newText, selectedRange: selectedRange, element: element)
    }

    static func == (lhs: TextContext, rhs: TextContext) -> Bool {
        lhs.applicationName == rhs.applicationName &&
        lhs.text == rhs.text &&
        lhs.selectedRange?.location == rhs.selectedRange?.location &&
        lhs.selectedRange?.length == rhs.selectedRange?.length
    }
}

enum AccessibilityTextError: LocalizedError {
    case noFocusedApplication
    case noFocusedElement
    case noWritableText
    case emptyText
    case cannotWriteText

    var errorDescription: String? {
        switch self {
        case .noFocusedApplication:
            "No focused application was found."
        case .noFocusedElement:
            "No focused text area was found. Click inside a text editor and try again."
        case .noWritableText:
            "The focused element does not expose editable text through Accessibility."
        case .emptyText:
            "The focused text area is empty."
        case .cannotWriteText:
            "Editorial could read the text, but this app did not allow replacing it through Accessibility. Copy the draft instead."
        }
    }
}

@MainActor
final class AccessibilityTextClient {
    static var isTrusted: Bool {
        AXIsProcessTrusted()
    }

    static func requestTrustPrompt() {
        let options = ["AXTrustedCheckOptionPrompt": true] as CFDictionary
        _ = AXIsProcessTrustedWithOptions(options)
    }

    static func openAccessibilitySettings() {
        let urls = [
            "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
            "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_Accessibility"
        ]

        for urlString in urls {
            guard let url = URL(string: urlString) else { continue }
            if NSWorkspace.shared.open(url) {
                return
            }
        }
    }

    func focusedTextContext() throws -> TextContext {
        guard let frontmostApplication = NSWorkspace.shared.frontmostApplication else {
            throw AccessibilityTextError.noFocusedApplication
        }

        let appElement = AXUIElementCreateApplication(frontmostApplication.processIdentifier)
        let focusedElement = try focusedElement(in: appElement)
        let readableElement = try nearestReadableTextElement(from: focusedElement)

        let text = try textValue(from: readableElement).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { throw AccessibilityTextError.emptyText }

        return TextContext(
            applicationName: frontmostApplication.localizedName ?? "Focused app",
            text: text,
            selectedRange: selectedTextRange(from: readableElement),
            element: readableElement
        )
    }

    func replaceFocusedText(with newText: String, context: TextContext?) throws {
        let target = try context?.element ?? focusedTextContext().element

        let selectedRange = selectedTextRange(from: target)
        if let selectedRange, selectedRange.length > 0 {
            let result = AXUIElementSetAttributeValue(target, kAXSelectedTextAttribute as CFString, newText as CFTypeRef)
            guard result == .success else { throw AccessibilityTextError.cannotWriteText }
            return
        }

        let result = AXUIElementSetAttributeValue(target, kAXValueAttribute as CFString, newText as CFTypeRef)
        guard result == .success else { throw AccessibilityTextError.cannotWriteText }
    }

    private func focusedElement(in appElement: AXUIElement) throws -> AXUIElement {
        var rawValue: CFTypeRef?
        let result = AXUIElementCopyAttributeValue(appElement, kAXFocusedUIElementAttribute as CFString, &rawValue)
        guard result == .success, let element = rawValue else {
            throw AccessibilityTextError.noFocusedElement
        }
        return element as! AXUIElement
    }

    private func nearestReadableTextElement(from element: AXUIElement) throws -> AXUIElement {
        if (try? textValue(from: element)) != nil {
            return element
        }

        var current = element
        for _ in 0..<6 {
            var rawParent: CFTypeRef?
            let result = AXUIElementCopyAttributeValue(current, kAXParentAttribute as CFString, &rawParent)
            guard result == .success, let parent = rawParent else { break }
            let parentElement = parent as! AXUIElement
            if (try? textValue(from: parentElement)) != nil {
                return parentElement
            }
            current = parentElement
        }

        throw AccessibilityTextError.noWritableText
    }

    private func textValue(from element: AXUIElement) throws -> String {
        if let value = stringAttribute(kAXValueAttribute, from: element) {
            return value
        }
        if let value = stringAttribute(kAXSelectedTextAttribute, from: element), !value.isEmpty {
            return value
        }
        throw AccessibilityTextError.noWritableText
    }

    private func stringAttribute(_ attribute: String, from element: AXUIElement) -> String? {
        var rawValue: CFTypeRef?
        let result = AXUIElementCopyAttributeValue(element, attribute as CFString, &rawValue)
        guard result == .success else { return nil }
        return rawValue as? String
    }

    private func selectedTextRange(from element: AXUIElement) -> CFRange? {
        var rawValue: CFTypeRef?
        let result = AXUIElementCopyAttributeValue(element, kAXSelectedTextRangeAttribute as CFString, &rawValue)
        guard result == .success, let rawValue else { return nil }

        var range = CFRange()
        guard AXValueGetValue(rawValue as! AXValue, .cfRange, &range) else { return nil }
        return range
    }
}
