package org.typefox.oct.editor

import com.intellij.openapi.editor.event.*
import com.intellij.ui.JBColor
import org.typefox.oct.ClientTextSelection
import org.typefox.oct.OCTMessageHandler
import org.typefox.oct.TextDocumentInsert
import kotlin.io.path.Path
import kotlin.io.path.pathString

class EditorListener(private val octService: OCTMessageHandler.OCTService): EditorFactoryListener {

  override fun editorCreated(event: EditorFactoryEvent) {
    val path = event.editor.virtualFile.path.replace(
      Path(event.editor.project!!.basePath!!).parent.pathString.replace("\\", "/") + "/",
      "")

    octService.openDocument("text", path, event.editor.document.text)

    event.editor.inlayModel.addInlineElement(2, CursorRenderer(JBColor.GREEN))

    event.editor.document.addDocumentListener(EditorDocumentListener(octService, path))
    event.editor.caretModel.addCaretListener(EditorCaretListener(octService, path))
  }

}

class EditorDocumentListener(private val octService: OCTMessageHandler.OCTService, private val path: String): DocumentListener {
  override fun documentChanged(event: DocumentEvent) {
    octService.updateDocument(path, arrayOf(
      TextDocumentInsert(
        event.offset,
        event.oldFragment.length,
        event.newFragment.toString()
      )
    ))
  }
}

class EditorCaretListener(private val octService: OCTMessageHandler.OCTService, private val path: String): CaretListener {
  override fun caretPositionChanged(event: CaretEvent) {
    val caret = event.caret!!
    octService.updateTextSelection(
      path, arrayOf(
        ClientTextSelection(
          caret.offset,
          caret.selectionEnd,
          caret.selectionEnd < caret.offset
        )
      )
    )
  }
}

