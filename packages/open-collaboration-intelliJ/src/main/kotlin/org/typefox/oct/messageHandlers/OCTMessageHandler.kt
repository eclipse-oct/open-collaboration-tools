package org.typefox.oct.messageHandlers

import com.intellij.notification.Notification
import com.intellij.notification.NotificationType
import com.intellij.notification.Notifications
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.writeAction
import com.intellij.openapi.components.service
import com.intellij.openapi.project.ProjectManager
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.util.ProjectManagerScope
import com.intellij.testFramework.closeProjectAsync
import com.intellij.testFramework.useProject
import com.jetbrains.rd.util.printlnError
import kotlinx.coroutines.MainScope
import kotlinx.coroutines.async
import org.eclipse.lsp4j.jsonrpc.Endpoint
import org.eclipse.lsp4j.jsonrpc.json.ResponseJsonAdapter
import org.eclipse.lsp4j.jsonrpc.services.JsonNotification
import org.eclipse.lsp4j.jsonrpc.services.JsonRequest
import org.typefox.oct.*
import org.typefox.oct.actions.JoinRequestAction
import org.typefox.oct.util.EventEmitter
import java.util.concurrent.CompletableFuture

class OCTMessageHandler(onSessionCreated: EventEmitter<CollaborationInstance>) : BaseMessageHandler(onSessionCreated) {

    interface OCTService: BaseRemoteInterface {
        @JsonRequest
        fun login(): CompletableFuture<String>
        @JsonRequest(value = "room/joinRoom")
        fun joinRoom(roomId: String): CompletableFuture<SessionData>
        @JsonRequest(value = "room/createRoom")
        fun createRoom(workspace: Workspace): CompletableFuture<SessionData>
        @JsonRequest(value = "room/closeSession")
        fun closeSession(): CompletableFuture<Unit>
        @JsonNotification(value = "awareness/openDocument")
        fun openDocument(type: String, documentUri: String, text: String): CompletableFuture<Unit>
        @JsonNotification(value = "awareness/updateTextSelection")
        fun updateTextSelection(path: String, textSelections: Array<ClientTextSelection>): CompletableFuture<Unit>
        @JsonNotification(value = "awareness/updateDocument")
        fun updateDocument(path: String, updates: Array<TextDocumentInsert>): CompletableFuture<Unit>
        @JsonRequest(value = "awareness/getDocumentContent")
        fun getDocumentContent(path: String): CompletableFuture<FileContent?>
    }
    override val remoteInterface = OCTService::class.java

    @JsonNotification
    fun authentication(token: String, metadata: AuthMetadata) {
        service<AuthenticationService>().authenticate(token, metadata)
    }

    @JsonNotification
    fun error(error: String, stack: String?) {
        printlnError(error)
        printlnError(stack ?: "")
    }

    @JsonRequest(value = "room/joinSessionRequest")
    fun joinRoomRequest(user: User): CompletableFuture<Boolean> {
        val joinRequestNotification = Notification(
            "Oct-Notifications",
            "User ${
                if (user.email != "") "${user.name} (${user.email})" else user.name
            } via ${user.authProvider} wants to join the collaboration session",
            NotificationType.INFORMATION
        )
        val result = CompletableFuture<Boolean>()
        result.thenRun {
            joinRequestNotification.expire()
        }
        joinRequestNotification.addAction(JoinRequestAction("Accept", true, result))
        joinRequestNotification.addAction(JoinRequestAction("Decline", false, result))
        Notifications.Bus.notify(joinRequestNotification)

        return result
    }

    //peer init
    @JsonNotification
    fun init(initData: InitData) {
        collaborationInstance?.initPeers(initData)
    }

    @JsonNotification
    fun peerJoined(peer: Peer) {
        collaborationInstance?.peerJoined(peer)
    }

    @JsonNotification
    fun peerLeft(peer: Peer) {
        collaborationInstance?.peerLeft(peer)
    }

    @JsonNotification(value = "awareness/updateTextSelection")
    fun updateTextSelection(url: String, selections: Array<ClientTextSelection>) {
        collaborationInstance?.updateTextSelection(url, selections)
    }

    @JsonNotification(value = "awareness/updateDocument")
    fun updateDocument(url: String, updates: Array<TextDocumentInsert>) {
        collaborationInstance?.updateDocument(url, updates)
    }

    @JsonNotification
    fun editorOpened(documentPath: String, peerId: String) {
        println("editor opened $documentPath by $peerId")
    }

    @JsonNotification
    fun sessionClosed() {
        ApplicationManager.getApplication().invokeLater {
            collaborationInstance?.project?.let {
                ProjectManager.getInstance().closeAndDispose(it)
            }
        }
    }
}

abstract class BaseMessageHandler(onSessionCreated: EventEmitter<CollaborationInstance>): Endpoint {

    protected var collaborationInstance: CollaborationInstance? = null

    interface BaseRemoteInterface {}

    abstract val remoteInterface: Class<out BaseRemoteInterface>

    init {
        onSessionCreated.onEvent {
            this.collaborationInstance = it
        }
    }

    override fun request(method: String?, parameter: Any?): CompletableFuture<*> {
        throw RuntimeException("unhandled request $method")
    }

    override fun notify(method: String?, parameter: Any?) {
        throw RuntimeException("unhandled notification $method")
    }
}
