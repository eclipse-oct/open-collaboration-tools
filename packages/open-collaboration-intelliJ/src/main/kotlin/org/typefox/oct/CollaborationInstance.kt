package org.typefox.oct

import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.editor.EditorFactory
import com.intellij.openapi.editor.event.DocumentEvent
import com.intellij.openapi.editor.event.DocumentListener
import com.intellij.openapi.editor.event.EditorFactoryEvent
import com.intellij.openapi.editor.event.EditorFactoryListener
import com.intellij.openapi.project.Project
import org.eclipse.lsp4j.jsonrpc.services.JsonNotification
import org.jetbrains.plugins.notebooks.visualization.addEditorDocumentListener
import org.typefox.oct.editor.EditorListener
import org.typefox.oct.fileSystem.WorkspaceFileSystemService


class CollaborationInstance(val octService: OCTMessageHandler.OCTService, project: Project ): Disposable {

  val workspaceFileSystem: WorkspaceFileSystemService = project.getService(WorkspaceFileSystemService::class.java)

  val guests: ArrayList<Peer> = ArrayList()
  var host: Peer? = null

  init {
    EditorFactory.getInstance().addEditorFactoryListener(EditorListener(octService), this)
    println("initialized collaboration instance")
  }

  fun updateTextSelection(url: String, selections: Array<ClientTextSelection>) {
    println("update Text Selection $url")
  }

  fun updateDocument(url: String, updates: Array<TextDocumentInsert>) {
    println("update Document $url")
  }

  fun initPeers(initData: InitData) {
    guests.addAll(initData.guests)
    host = initData.host
  }

  override fun dispose() {

  }
}


