package org.typefox.oct.editor

import com.intellij.openapi.editor.event.*
import org.typefox.oct.ClientTextSelection
import org.typefox.oct.messageHandlers.OCTMessageHandler
import org.typefox.oct.TextDocumentInsert


class EditorDocumentListener(private val octService: OCTMessageHandler.OCTService, private val path: String) :
    DocumentListener {

    var sendUpdates = true

    override fun documentChanged(event: DocumentEvent) {
        if(sendUpdates) {
            val offset = event.offset
            octService.updateDocument(
                path, arrayOf(
                    TextDocumentInsert(
                         offset,
                        offset + event.oldFragment.length,
                        event.newFragment.toString()
                    )
                )
            )
        }
    }
}

class EditorCaretListener(private val octService: OCTMessageHandler.OCTService, private val path: String) :
    CaretListener {
    override fun caretPositionChanged(event: CaretEvent) {
        val caret = event.caret!!
        val selectionStart = caret.selectionStart
        val selectionEnd = caret.selectionEnd
        octService.updateTextSelection(
            path, arrayOf(
                ClientTextSelection(
                    "", // by default its always oneself
                    selectionStart,
                    selectionEnd,
                    selectionEnd < selectionStart
                )
            )
        )
    }
}
