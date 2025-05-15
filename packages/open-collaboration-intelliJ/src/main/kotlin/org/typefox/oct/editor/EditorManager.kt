package org.typefox.oct.editor

import com.intellij.openapi.application.invokeLater
import com.intellij.openapi.command.WriteCommandAction
import com.intellij.openapi.components.service
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.editor.Inlay
import com.intellij.openapi.editor.LogicalPosition
import com.intellij.openapi.editor.ScrollType
import com.intellij.openapi.editor.event.EditorFactoryEvent
import com.intellij.openapi.editor.event.EditorFactoryListener
import com.intellij.openapi.editor.markup.HighlighterLayer
import com.intellij.openapi.editor.markup.HighlighterTargetArea
import com.intellij.openapi.editor.markup.RangeHighlighter
import com.intellij.openapi.editor.markup.TextAttributes
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.fileEditor.TextEditor
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.vfs.VirtualFileManager
import org.typefox.oct.ClientTextSelection
import org.typefox.oct.messageHandlers.OCTMessageHandler
import org.typefox.oct.OCTSessionService
import org.typefox.oct.TextDocumentInsert
import javax.swing.SwingUtilities
import kotlin.io.path.Path
import kotlin.io.path.pathString


class EditorManager(private val octService: OCTMessageHandler.OCTService, val project: Project) :
    EditorFactoryListener {
    private val editors: MutableMap<String, Editor> = mutableMapOf()
    private val cursorDisposables: MutableMap<String, Array<Inlay<CursorRenderer>>> = mutableMapOf()
    private val documentListeners: MutableMap<String, EditorDocumentListener> = mutableMapOf()

    var followingPeerId: String? = null

    init {
        FileEditorManager.getInstance(project).allEditors.forEach {
            val editor: Editor? = when (it) {
                is TextEditor ->  it.editor
                is Editor -> it
                else -> {
                    println("Warn: editor is not a TextEditorWithPreview or Editor")
                    null
                }
            }
            if (editor != null) {
                registerEditor(editor)
            }
        }
    }

    override fun editorCreated(event: EditorFactoryEvent) {
        registerEditor(event.editor)
    }

    override fun editorReleased(event: EditorFactoryEvent) {
        val path = octPathFromEditor(event.editor)
        editors.remove(path)
        event.editor.document.removeDocumentListener(documentListeners.remove(path)!!)

    }

    private fun registerEditor(editor: Editor) {
        if(editor.virtualFile == null) {
            return;
        }
        val path = octPathFromEditor(editor)

        editors[path] = editor

        octService.openDocument("text", path, editor.document.text)

        documentListeners[path] = EditorDocumentListener(octService, path)
        editor.document.addDocumentListener(documentListeners[path]!!)
        editor.caretModel.addCaretListener(EditorCaretListener(octService, path))
    }

    fun updateTextSelection(path: String, selections: Array<ClientTextSelection>) {
        val editor = editors[path]
        val session = service<OCTSessionService>().currentCollaborationInstances[project]

        for (selection in selections) {
            if (selection.peer == followingPeerId) {
                invokeLater {
                    val editorManager = FileEditorManager.getInstance(this.project)
                    val file = if (session?.isHost == true) {
                        session.workspaceFileSystem.getRelativeFile(path)
                    } else {
                        VirtualFileManager.getInstance().findFileByUrl("oct://$path")
                    }
                    if(file == null) {
                        return@invokeLater
                    }
                    editorManager.openFile(file, true)
                    editors[path]?.scrollingModel?.scrollTo(
                        LogicalPosition(selection.start, selection.end ?: selection.start), ScrollType.CENTER)
                }
                break;
            }
        }

        if(editor != null) {
            SwingUtilities.invokeAndWait {
                cursorDisposables[path]?.forEach { Disposer.dispose(it) }
                cursorDisposables[path] = Array(selections.size) { idx ->
                    val selection = selections[idx]
                    createPeerCursor(selection, editor)
                }
            }
        }
    }

    private fun createPeerCursor(selection: ClientTextSelection, editor: Editor): Inlay<CursorRenderer> {
        val color = service<OCTSessionService>().currentCollaborationInstances[editor.project]!!
            .peerColors.getColor(selection.peer)
        var textHighlighter: RangeHighlighter? = null
        val start = selection.start
        val end = selection.end ?: selection.start
        if (start != end) {
            textHighlighter = editor.markupModel.addRangeHighlighter(
                start,
                end,
                HighlighterLayer.CARET_ROW + 1,
                TextAttributes(null, color, null, null, 0),
                HighlighterTargetArea.EXACT_RANGE
            )
        }
        val cursor = editor.inlayModel.addInlineElement(start, CursorRenderer(color))!!
        if(textHighlighter != null) {
            Disposer.register(cursor) {
                editor.markupModel.removeHighlighter(textHighlighter)
            }
        }
        return cursor
    }

    fun updateDocument(path: String, updates: Array<TextDocumentInsert>) {
        val editor = editors[path] ?: return
        WriteCommandAction.runWriteCommandAction(
            editor.project
        ) {
            val listener =  documentListeners[path]
            listener?.sendUpdates = false
            try {
                for (update in updates) {
                    editor.document.replaceString(
                        update.startOffset,
                       update.endOffset ?: update.startOffset,
                        update.text.replace("\r\n", "\n")
                    )
                }
            } finally {
                listener?.sendUpdates = true
            }

        }

    }

    private fun octPathFromEditor(editor: Editor): String {
        return editor.virtualFile.path.replace(
            Path(editor.project!!.basePath!!).parent.pathString.replace("\\", "/") + "/",
            ""
        )
    }

    fun followPeer(peerId: String) {
        followingPeerId = peerId
    }

    fun stopFollowing() {
        followingPeerId = null
    }
}
