package org.typefox.oct

import com.intellij.openapi.Disposable
import com.intellij.openapi.editor.EditorFactory
import com.intellij.openapi.project.Project
import org.typefox.oct.editor.EditorManager
import org.typefox.oct.fileSystem.WorkspaceFileSystemService


class CollaborationInstance(octService: OCTMessageHandler.OCTService, project: Project) : Disposable {

    val workspaceFileSystem: WorkspaceFileSystemService = project.getService(WorkspaceFileSystemService::class.java)
    private val editorManager: EditorManager = EditorManager(octService, project)

    private val guests: ArrayList<Peer> = ArrayList()
    private var host: Peer? = null

    init {
        EditorFactory.getInstance().addEditorFactoryListener(editorManager, this)
        println("initialized collaboration instance")
    }

    fun updateTextSelection(url: String, selections: Array<ClientTextSelection>) {
        editorManager.updateTextSelection(url, selections)
    }

    fun updateDocument(url: String, updates: Array<TextDocumentInsert>) {
        editorManager.updateDocument(url, updates)
    }

    fun initPeers(initData: InitData) {
        guests.addAll(initData.guests)
        host = initData.host
    }

    override fun dispose() {

    }
}


