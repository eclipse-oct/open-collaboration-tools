package org.typefox.oct.editor

import com.intellij.openapi.editor.event.*
import com.intellij.ui.JBColor
import org.typefox.oct.ClientTextSelection
import org.typefox.oct.OCTMessageHandler
import org.typefox.oct.TextDocumentInsert
import kotlin.io.path.Path
import kotlin.io.path.pathString


class EditorDocumentListener(private val octService: OCTMessageHandler.OCTService, private val path: String) :
    DocumentListener {
    override fun documentChanged(event: DocumentEvent) {
        octService.updateDocument(
            path, arrayOf(
                TextDocumentInsert(
                    event.offset,
                    event.oldFragment.length,
                    event.newFragment.toString()
                )
            )
        )
    }
}

class EditorCaretListener(private val octService: OCTMessageHandler.OCTService, private val path: String) :
    CaretListener {
    override fun caretPositionChanged(event: CaretEvent) {
        val caret = event.caret!!
        octService.updateTextSelection(
            path, arrayOf(
                ClientTextSelection(
                    "", // by default its always oneself
                    caret.offset,
                    caret.selectionEnd,
                    caret.selectionEnd < caret.offset
                )
            )
        )
    }
}

