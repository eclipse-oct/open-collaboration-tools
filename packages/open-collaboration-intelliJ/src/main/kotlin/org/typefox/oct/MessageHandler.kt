package org.typefox.oct

import com.jetbrains.rd.util.printlnError
import org.eclipse.lsp4j.jsonrpc.Endpoint
import org.eclipse.lsp4j.jsonrpc.RemoteEndpoint
import org.eclipse.lsp4j.jsonrpc.services.JsonNotification
import org.eclipse.lsp4j.jsonrpc.services.JsonRequest
import java.util.concurrent.CompletableFuture

class MessageHandler : Endpoint {
  var remoteEndpoint: RemoteEndpoint? = null

  interface OCTService {
    @JsonRequest fun login(): CompletableFuture<String>
    @JsonRequest(value = "room/joinRoom") fun joinRoom(): CompletableFuture<String>
    @JsonRequest(value = "room/createRoom") fun createRoom(workspace: Workspace): CompletableFuture<String>
    @JsonRequest(value = "room/closeSession")fun closeSession(): CompletableFuture<String>
    @JsonNotification(value = "awareness/openDocument") fun openDocument()
    @JsonNotification(value = "awareness/updateTextSelection") fun updateTextSelection()
    @JsonNotification(value = "awareness/updateDocument") fun updateDocument()
  }

  override fun request(method: String?, parameter: Any?): CompletableFuture<*> {
    throw RuntimeException("could not find request handler for ${method}")
  }

  override fun notify(method: String?, parameter: Any?) {
    throw RuntimeException("could not find notification handler for ${method}")
  }


  @JsonNotification
  fun onOpenUrl(url: String) {
    println(url)
  }

  @JsonNotification
  fun error(error: String, stack: String?) {
    printlnError(error)
  }
}

