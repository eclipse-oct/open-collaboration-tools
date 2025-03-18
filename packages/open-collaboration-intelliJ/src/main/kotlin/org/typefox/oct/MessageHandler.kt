package org.typefox.oct

import org.eclipse.lsp4j.jsonrpc.Endpoint
import org.eclipse.lsp4j.jsonrpc.RemoteEndpoint
import org.eclipse.lsp4j.jsonrpc.services.JsonRequest
import java.util.concurrent.CompletableFuture

class MessageHandler : Endpoint {
  var remoteEndpoint: RemoteEndpoint? = null

  interface OCTService {
    @JsonRequest fun login();
  }

  override fun request(method: String?, parameter: Any?): CompletableFuture<*> {
    TODO("Not yet implemented")
  }

  override fun notify(method: String?, parameter: Any?) {
    TODO("Not yet implemented")
  }

}

