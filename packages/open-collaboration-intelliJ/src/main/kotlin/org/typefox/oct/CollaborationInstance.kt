package org.typefox.oct

import com.intellij.openapi.Disposable
import com.intellij.openapi.application.WriteAction
import com.intellij.openapi.editor.EditorFactory
import com.intellij.openapi.module.EmptyModuleType
import com.intellij.openapi.module.Module
import com.intellij.openapi.module.ModuleManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.roots.ModuleRootModificationUtil
import com.intellij.openapi.vfs.VirtualFileManager
import org.typefox.oct.editor.EditorManager
import org.typefox.oct.fileSystem.OCTSessionFileSystem
import org.typefox.oct.fileSystem.WorkspaceFileSystemService
import org.typefox.oct.messageHandlers.BaseMessageHandler
import org.typefox.oct.messageHandlers.OCTMessageHandler
import org.typefox.oct.util.EventEmitter


class CollaborationInstance(val remoteInterface: BaseMessageHandler.BaseRemoteInterface,
                            val project: Project,
                            private val sessionData: SessionData,
                            val isHost: Boolean) : Disposable {

    val workspaceFileSystem: WorkspaceFileSystemService = project.getService(WorkspaceFileSystemService::class.java)
    private val editorManager: EditorManager = EditorManager(remoteInterface as OCTMessageHandler.OCTService, project)

    val guests: ArrayList<Peer> = ArrayList()
    var host: Peer? = null

    val peerColors = PeerColors()

    val onPeersChanged = EventEmitter<Unit?>()

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
        if(!isHost) {
            initializeSharedFolders()
        }
        onPeersChanged.fire(null)
    }

    fun peerJoined(peer: Peer) {
        this.guests.add(peer)
        this.onPeersChanged.fire(Unit)
    }

    fun peerLeft(peer: Peer) {
        this.guests.remove(guests.find {
            it.id == peer.id
        } ?: return)
        this.onPeersChanged.fire(Unit)
    }

    private fun initializeSharedFolders() {
        (VirtualFileManager.getInstance().getFileSystem("oct") as OCTSessionFileSystem)
            .registerRoots(sessionData.workspace.folders, this)

        try {
            val module: Module = WriteAction.computeAndWait<Module, Throwable> {
                ModuleManager.getInstance(project)
                    .newNonPersistentModule(sessionData.workspace.name, EmptyModuleType.EMPTY_MODULE)
            }
            ModuleRootModificationUtil.updateModel(module) {
                for (entry in sessionData.workspace.folders) {
                    val root = VirtualFileManager.getInstance().findFileByUrl("oct://${entry}")
                        ?: throw IllegalStateException("Could not find shared root for entry $entry")
                    it.addContentEntry(root)
                }
            }
        } catch (e: Throwable) {
            this.dispose()
            e.printStackTrace()
        }

    }

    fun onFileChange() {
        if (isHost) {
            workspaceFileSystem.change()
        } else {

        }
    }

    fun followPeer(peerId: String) {
        editorManager.followPeer(peerId)
    }

    fun stopFollowingPeer() {
        editorManager.stopFollowing()
    }

    fun isFollowingPeer(peerId: String): Boolean {
        return editorManager.followingPeerId == peerId
    }

    override fun dispose() {

    }
}


