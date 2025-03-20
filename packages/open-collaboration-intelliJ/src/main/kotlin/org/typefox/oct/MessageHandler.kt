package org.typefox.oct

import com.intellij.openapi.ui.popup.ComponentPopupBuilder
import com.intellij.openapi.ui.popup.JBPopupFactory
import com.intellij.ui.jcef.JBCefApp
import com.intellij.ui.jcef.JBCefBrowser
import com.jetbrains.rd.util.printlnError
import org.eclipse.lsp4j.jsonrpc.Endpoint
import org.eclipse.lsp4j.jsonrpc.RemoteEndpoint
import org.eclipse.lsp4j.jsonrpc.services.JsonNotification
import org.eclipse.lsp4j.jsonrpc.services.JsonRequest
import java.awt.Desktop
import java.net.URI
import java.util.concurrent.CompletableFuture
import javax.swing.SwingUtilities

class MessageHandler : Endpoint {

  interface OCTService {
    @JsonRequest fun login(): CompletableFuture<String>
    @JsonRequest(value = "room/joinRoom") fun joinRoom(): CompletableFuture<String>
    @JsonRequest(value = "room/createRoom") fun createRoom(workspace: Workspace): CompletableFuture<Array<String>>
    @JsonRequest(value = "room/closeSession")fun closeSession(): CompletableFuture<String>
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
    if(JBCefApp.isSupported()) {
      val browser = JBCefBrowser()

      browser.loadURL(url)
      val popup = JBPopupFactory.getInstance()
        .createComponentPopupBuilder(browser.component, null)
        .setRequestFocus(true)
        .setFocusable(true)
        .createPopup()
      SwingUtilities.invokeLater {
        popup.showInFocusCenter()
      }
    } else {
      Desktop.getDesktop().browse(URI("http://www.example.com"))
    }
  }

  @JsonNotification
  fun error(error: String, stack: String?) {
    printlnError(error)
  }
}

