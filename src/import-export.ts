import type { Editor, JSONContent } from "@tiptap/react"

export type ExportFormat = "html" | "txt" | "md" | "docx" | "pdf"

export interface ImportedDocument {
    title: string
    html: string
}

export async function fileToImportedDocument(
    file: File,
): Promise<ImportedDocument> {
    const name = file.name.replace(/\.[^.]+$/, "") || "Imported manuscript"
    const lower = file.name.toLowerCase()

    if (lower.endsWith(".docx")) {
        const buffer = await file.arrayBuffer()
        const mammoth = (await import("mammoth/mammoth.browser")).default
        const result = await mammoth.convertToHtml({ arrayBuffer: buffer })
        return { title: name, html: result.value || "<p></p>" }
    }

    if (lower.endsWith(".html") || lower.endsWith(".htm")) {
        return { title: name, html: await file.text() }
    }

    const text = await file.text()
    const paragraphs = text
        .split(/\n{2,}/)
        .map((part) => `<p>${escapeHtml(part).replace(/\n/g, "<br>")}</p>`)
        .join("")
    return { title: name, html: paragraphs || "<p></p>" }
}

export function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
}

export async function exportDocument(
    editor: Editor,
    title: string,
    format: ExportFormat,
) {
    const safeTitle = slug(title || "editorial-document")
    if (format === "html") {
        downloadBlob(
            new Blob([editor.getHTML()], { type: "text/html;charset=utf-8" }),
            `${safeTitle}.html`,
        )
        return
    }

    if (format === "txt") {
        downloadBlob(
            new Blob([editor.getText({ blockSeparator: "\n\n" })], {
                type: "text/plain;charset=utf-8",
            }),
            `${safeTitle}.txt`,
        )
        return
    }

    if (format === "md") {
        const TurndownService = (await import("turndown")).default
        const turndown = new TurndownService({ headingStyle: "atx" })
        downloadBlob(
            new Blob([turndown.turndown(editor.getHTML())], {
                type: "text/markdown;charset=utf-8",
            }),
            `${safeTitle}.md`,
        )
        return
    }

    if (format === "docx") {
        const blob = await htmlToDocx(editor.getJSON(), title)
        downloadBlob(blob, `${safeTitle}.docx`)
        return
    }

    openPrintWindow(editor.getHTML(), title)
}

function openPrintWindow(html: string, title: string) {
    const win = window.open(
        "",
        "_blank",
        "noopener,noreferrer,width=900,height=1100",
    )
    if (!win)
        throw new Error(
            "Could not open a print window. Check popup settings and try again.",
        )
    win.document.write(`<!doctype html>
<html>
<head>
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: Georgia, serif; color: #111827; margin: 0; }
    main { max-width: 720px; margin: 48px auto; line-height: 1.65; font-size: 12pt; }
    h1, h2, h3 { line-height: 1.2; }
    @media print { main { margin: 0.7in auto; } }
  </style>
</head>
<body><main>${html}</main><script>window.onload = () => window.print();</script></body>
</html>`)
    win.document.close()
}

async function htmlToDocx(json: JSONContent, title: string) {
    const docx = await import("docx")
    const children = (json.content ?? []).flatMap((node) =>
        nodeToParagraphs(node, docx),
    )
    const doc = new docx.Document({
        creator: "Editorial",
        title,
        sections: [
            { children: children.length ? children : [new docx.Paragraph("")] },
        ],
    })
    const blob = await docx.Packer.toBlob(doc)
    return blob
}

function nodeToParagraphs(node: JSONContent, docx: typeof import("docx")) {
    if (node.type === "heading") {
        return [
            new docx.Paragraph({
                heading:
                    node.attrs?.level === 1
                        ? docx.HeadingLevel.HEADING_1
                        : node.attrs?.level === 2
                          ? docx.HeadingLevel.HEADING_2
                          : docx.HeadingLevel.HEADING_3,
                children: inlineRuns(node, docx),
            }),
        ]
    }

    if (node.type === "bulletList" || node.type === "orderedList") {
        return (node.content ?? []).flatMap((item, index) =>
            (item.content ?? []).map(
                (child) =>
                    new docx.Paragraph({
                        bullet:
                            node.type === "bulletList"
                                ? { level: 0 }
                                : undefined,
                        numbering:
                            node.type === "orderedList"
                                ? {
                                      reference: "default-numbering",
                                      level: 0,
                                      instance: index,
                                  }
                                : undefined,
                        children: inlineRuns(child, docx),
                    }),
            ),
        )
    }

    if (node.type === "blockquote") {
        return (node.content ?? []).map(
            (child) =>
                new docx.Paragraph({
                    children: inlineRuns(child, docx),
                    indent: { left: 360 },
                }),
        )
    }

    return [new docx.Paragraph({ children: inlineRuns(node, docx) })]
}

function inlineRuns(node: JSONContent, docx: typeof import("docx")) {
    const runs: Array<InstanceType<typeof docx.TextRun>> = []
    const visit = (child: JSONContent) => {
        if (child.type === "text") {
            const opts: {
                text: string
                bold?: boolean
                italics?: boolean
                strike?: boolean
                underline?: { type: typeof docx.UnderlineType.SINGLE }
            } = { text: child.text ?? "" }
            for (const mark of child.marks ?? []) {
                if (mark.type === "bold") opts.bold = true
                if (mark.type === "italic") opts.italics = true
                if (mark.type === "strike") opts.strike = true
                if (mark.type === "underline")
                    opts.underline = { type: docx.UnderlineType.SINGLE }
            }
            runs.push(new docx.TextRun(opts))
            return
        }
        if (child.type === "hardBreak") {
            runs.push(new docx.TextRun({ text: "", break: 1 }))
            return
        }
        ;(child.content ?? []).forEach(visit)
    }
    ;(node.content ?? []).forEach(visit)
    return runs.length ? runs : [new docx.TextRun("")]
}

function escapeHtml(value: string) {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;")
}

function slug(value: string) {
    return (
        value
            .toLowerCase()
            .trim()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/(^-|-$)/g, "") || "editorial-document"
    )
}
