package org.typefox.oct

import com.intellij.ide.plugins.PluginManager
import com.intellij.openapi.extensions.PluginId
import org.eclipse.lsp4j.jsonrpc.Launcher
import org.eclipse.lsp4j.jsonrpc.MessageConsumer
import org.typefox.oct.settings.OCTSettings
import java.nio.file.Path
import org.eclipse.lsp4j.jsonrpc.RemoteEndpoint

const val EXECUTABLE_LOCATION = "lib/service-process.exe"

class OCTServiceProcess() {
  private var currentProcess: Process? = null

  init {
    val pluginId = PluginId.getId("org.typefox.open-collaboration-intelliJ")
    val plugin = PluginManager.getInstance().findEnabledPlugin(pluginId)
    if (plugin != null) {
      val pluginPath: Path = plugin.pluginPath
      val executablePath: Path = pluginPath.resolve(EXECUTABLE_LOCATION)
      // start oct process
      currentProcess = ProcessBuilder()
        .command(executablePath.toString(), "--server-address=${OCTSettings.getInstance().state.defaultServerURL}")
        .start()

      val messageHandler = MessageHandler()
      val launcher = Launcher.createLauncher(messageHandler, MessageHandler::class.java,
        currentProcess?.inputStream,
        currentProcess?.outputStream)
      messageHandler.remoteEndpoint = launcher.remoteEndpoint
      launcher.startListening()

    }
  }
}

