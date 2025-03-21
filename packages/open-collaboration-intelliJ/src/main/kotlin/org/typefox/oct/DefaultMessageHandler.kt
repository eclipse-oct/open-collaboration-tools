package org.typefox.oct

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import com.intellij.openapi.ui.popup.JBPopupFactory
import com.intellij.ui.jcef.JBCefApp
import com.intellij.ui.jcef.JBCefBrowser
import com.jetbrains.rd.util.printlnError
import org.eclipse.lsp4j.jsonrpc.Endpoint
import org.eclipse.lsp4j.jsonrpc.services.JsonNotification
import org.eclipse.lsp4j.jsonrpc.services.JsonRequest
import java.awt.Desktop
import java.net.URI
import java.util.concurrent.CompletableFuture
import javax.swing.SwingUtilities

@Service
class DefaultMessageHandler : Endpoint {

  interface OCTService {
    @JsonRequest fun login(): CompletableFuture<String>
    @JsonRequest(value = "room/joinRoom") fun joinRoom(roomId: String): CompletableFuture<SessionData>
    @JsonRequest(value = "room/createRoom") fun createRoom(workspace: Workspace): CompletableFuture<SessionData>
    @JsonRequest(value = "room/closeSession")fun closeSession(): CompletableFuture<Void>
    @JsonNotification(value = "awareness/openDocument") fun openDocument()
    @JsonNotification(value = "awareness/updateTextSelection") fun updateTextSelection()
    @JsonNotification(value = "awareness/updateDocument") fun updateDocument()
  }

  override fun request(method: String?, parameter: Any?): CompletableFuture<*> {
    throw RuntimeException("could not find request handler for $method")
  }

  override fun notify(method: String?, parameter: Any?) {
    throw RuntimeException("could not find notification handler for $method")
  }


  @JsonNotification
  fun onOpenUrl(url: String) {
    service<AuthenticationService>().openAuthUrl(url)
  }

  @JsonNotification
  fun error(error: String, stack: String?) {
    printlnError(error)
    printlnError(stack ?: "")
  }

}

