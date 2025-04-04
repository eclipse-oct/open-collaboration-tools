package org.typefox.oct

import com.google.gson.Gson
import com.google.gson.TypeAdapter
import com.intellij.notification.Notification
import com.intellij.notification.NotificationType
import com.intellij.notification.Notifications
import com.intellij.openapi.components.service
import com.jetbrains.rd.util.printlnError
import org.eclipse.lsp4j.jsonrpc.Endpoint
import org.eclipse.lsp4j.jsonrpc.json.ResponseJsonAdapter
import org.eclipse.lsp4j.jsonrpc.services.JsonNotification
import org.eclipse.lsp4j.jsonrpc.services.JsonRequest
import org.typefox.oct.actions.JoinRequestAction
import java.util.concurrent.CompletableFuture
import com.google.gson.TypeAdapterFactory
import com.google.gson.reflect.TypeToken


class OCTMessageHandler() : Endpoint {

    interface OCTService {
        @JsonRequest
        fun login(): CompletableFuture<String>
        @JsonRequest(value = "room/joinRoom")
        fun joinRoom(roomId: String): CompletableFuture<SessionData>
        @JsonRequest(value = "room/createRoom")
        fun createRoom(workspace: Workspace): CompletableFuture<SessionData>
        @JsonRequest(value = "room/closeSession")
        fun closeSession(): CompletableFuture<Void>
        @JsonNotification(value = "awareness/openDocument")
        fun openDocument(type: String, documentUri: String, text: String)
        @JsonNotification(value = "awareness/updateTextSelection")
        fun updateTextSelection(url: String, textSelections: Array<ClientTextSelection>)
        @JsonNotification(value = "awareness/updateDocument")
        fun updateDocument(url: String, updates: Array<TextDocumentInsert>)

        @JsonRequest
        @ResponseJsonAdapter(OCPRequestResponseAdapter::class)
        fun <T> request(message: OCPMessage): CompletableFuture<T>
        @JsonNotification
        fun notification(message: OCPMessage)
        @JsonNotification
        fun broadcast(message: OCPMessage)

    }

    var collaborationInstance: CollaborationInstance? = null

    override fun request(method: String?, parameter: Any?): CompletableFuture<*> {
        throw RuntimeException("could not find request handler for $method")
    }

    override fun notify(method: String?, parameter: Any?) {
        throw RuntimeException("could not find notification handler for $method")
    }


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

    @JsonNotification(value = "awareness/updateTextSelection")
    fun updateTextSelection(url: String, selections: Array<ClientTextSelection>) {
        collaborationInstance?.updateTextSelection(url, selections)
    }

    @JsonNotification(value = "awareness/updateDocument")
    fun updateDocument(url: String, updates: Array<TextDocumentInsert>) {
        collaborationInstance?.updateDocument(url, updates)
    }

    @JsonRequest
    fun request(message: OCPMessage): CompletableFuture<*> {
        val collaborationInstance = this.collaborationInstance ?: throw RuntimeException("No open collaboration session found")

        val result: Any? = when (message.method) {
            "fileSystem/stat" -> collaborationInstance.workspaceFileSystem.stat(message.params[0] as String)
            "fileSystem/readFile" -> collaborationInstance.workspaceFileSystem.readFile(message.params[0] as String)
            "fileSystem/readDir" -> collaborationInstance.workspaceFileSystem.readDir(message.params[0] as String)
            "fileSystem/mkdir" -> collaborationInstance.workspaceFileSystem.mkdir(message.params[0] as String)
            "fileSystem/writeFile" -> collaborationInstance.workspaceFileSystem.writeFile(
                message.params[0] as String,
                message.params[1] as FileContent
            )

            "fileSystem/delete" -> collaborationInstance.workspaceFileSystem.delete(message.params[0] as String)
            "fileSystem/rename" -> collaborationInstance.workspaceFileSystem.rename(
                message.params[0] as String,
                message.params[1] as String
            )

            "fileSystem/change" -> collaborationInstance.onFileChange()
            else -> throw RuntimeException("no handler found for method ${message.method}")
        }

        return if (result is CompletableFuture<*>) result else CompletableFuture.completedFuture(result)
    }

    @JsonNotification
    fun notification(message: OCPMessage) {
        println(message.method)
    }

    @JsonNotification
    fun broadcast(message: OCPMessage) {
        println(message.method)
    }
}


class OCPRequestResponseAdapter: TypeAdapterFactory {
    override fun <T : Any?> create(p0: Gson?, p1: TypeToken<T>?): TypeAdapter<T> {
        println("adapter executed")
        println(p1?.type?.typeName)
        return BinaryOCPMessageTypeAdapter() as TypeAdapter<T>
    }
}
