package org.typefox.oct

import com.intellij.ide.plugins.PluginManager
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.diagnostic.thisLogger
import com.intellij.openapi.extensions.PluginId
import org.eclipse.lsp4j.jsonrpc.Launcher
import org.eclipse.lsp4j.jsonrpc.TracingMessageConsumer
import org.typefox.oct.settings.OCTSettings
import java.io.InputStream
import java.io.PrintWriter
import java.nio.file.Path

const val EXECUTABLE_LOCATION = "lib/oct-service-process.exe"

class OCTServiceProcess(): Disposable {
  private var currentProcess: Process? = null
  private var jsonRpc: Launcher<MessageHandler.OCTService>? = null

  companion object {
    fun getInstance(): OCTServiceProcess {
        return ApplicationManager.getApplication().getService(OCTServiceProcess::class.java)
    }
  }

  fun communication(): MessageHandler.OCTService? {
    return jsonRpc?.remoteProxy
  }

  fun startProcess() {
    val pluginId = PluginId.getId("org.typefox.open-collaboration-intelliJ")
    val plugin = PluginManager.getInstance().findEnabledPlugin(pluginId)
    if (plugin != null) {
      val pluginPath: Path = plugin.pluginPath
      val executablePath: Path = pluginPath.resolve(EXECUTABLE_LOCATION)
      // start oct process
      currentProcess = ProcessBuilder()
        //.command(executablePath.toString(), "--server-address=${OCTSettings.getInstance().state.defaultServerURL}")
        .command("node", "--inspect",
          "C:\\Typefox\\Open_Source\\open-collaboration-server\\packages\\open-collaboration-service-process\\lib\\process.js",
          "--server-address=${OCTSettings.getInstance().state.defaultServerURL}")
        .start()

      val messageHandler = MessageHandler()
      this.jsonRpc = Launcher.createLauncher(messageHandler, MessageHandler.OCTService::class.java,
        currentProcess?.inputStream,
        currentProcess?.outputStream,
        false,
        PrintWriter(System.out)
      )
      this.jsonRpc?.startListening()
    }
  }

  fun stopCurrentProcess() {
    currentProcess?.destroy()
    currentProcess = null
    jsonRpc = null
  }

  override fun dispose() {
    stopCurrentProcess()
  }

}

