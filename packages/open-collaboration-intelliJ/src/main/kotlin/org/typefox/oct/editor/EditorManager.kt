package org.typefox.oct.editor

import com.intellij.openapi.application.invokeLater
import com.intellij.openapi.command.WriteCommandAction
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.editor.Inlay
import com.intellij.openapi.editor.event.EditorFactoryEvent
import com.intellij.openapi.editor.event.EditorFactoryListener
import com.intellij.openapi.editor.markup.HighlighterTargetArea
import com.intellij.openapi.editor.markup.TextAttributes
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.fileEditor.TextEditor
import com.intellij.openapi.progress.ModalTaskOwner.project
import com.intellij.openapi.project.Project
import com.intellij.ui.JBColor
import io.ktor.util.reflect.*
import org.jetbrains.plugins.notebooks.visualization.r.inlays.EditorInlaysManager
import org.typefox.oct.ClientTextSelection
import org.typefox.oct.OCTMessageHandler
import org.typefox.oct.TextDocumentInsert
import java.awt.Color
import javax.swing.SwingUtilities
import kotlin.io.path.Path
import kotlin.io.path.pathString


class EditorManager(private val octService: OCTMessageHandler.OCTService, val project: Project): EditorFactoryListener {
    private val editors: MutableMap<String, Editor> = mutableMapOf()
    private val cursors: MutableMap<String, Array<Inlay<CursorRenderer>>> = mutableMapOf()

/*    init {
        FileEditorManager.getInstance(project).allEditors.forEach {
            val editor = it as Editor
            editors[octPathFromEditor(editor)] = editor
        }
    }*/

    override fun editorCreated(event: EditorFactoryEvent) {
        val path = octPathFromEditor(event.editor)

        editors[path] = event.editor

        octService.openDocument("text", path, event.editor.document.text)


        event.editor.document.addDocumentListener(EditorDocumentListener(octService, path))
        event.editor.caretModel.addCaretListener(EditorCaretListener(octService, path))
    }

    override fun editorReleased(event: EditorFactoryEvent) {
        editors.remove(octPathFromEditor(event.editor))
    }

    fun updateTextSelection(path: String, selections: Array<ClientTextSelection>) {
        val editor = editors[path]

        SwingUtilities.invokeAndWait {
            cursors[path]?.forEach { it.dispose() }
            cursors[path] = Array(selections.size) { idx ->
                val selection = selections[idx]
                if(selection.start != selection.end) {
                    editor?.markupModel?.addRangeHighlighter(selection.start,
                        selection.end ?: selection.start,
                        1,
                        TextAttributes(null, JBColor.BLUE, null, null, 0),
                        HighlighterTargetArea.EXACT_RANGE)
                }
                editor!!.inlayModel.addInlineElement(selection.start, CursorRenderer(JBColor.BLUE))!!


            }
        }
    }

    fun updateDocument(path: String, updates: Array<TextDocumentInsert>) {
        val editor = editors[path]
        if(editor != null) {
            WriteCommandAction.runWriteCommandAction(
                editor.project
            ) {
                for (update in updates) {
                    editor.document.replaceString(
                        update.startOffset,
                        update.endOffset ?: update.startOffset,
                        update.text)
                }
            }
        }
    }

    fun octPathFromEditor(editor: Editor): String {
        return editor.virtualFile.path.replace(
            Path(editor.project!!.basePath!!).parent.pathString.replace("\\", "/") + "/",
            "")
    }


}
