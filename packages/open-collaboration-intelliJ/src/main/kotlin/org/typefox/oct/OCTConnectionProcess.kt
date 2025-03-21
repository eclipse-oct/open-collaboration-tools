package org.typefox.oct

import com.intellij.ide.plugins.PluginManager
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import com.intellij.openapi.extensions.PluginId
import org.eclipse.lsp4j.jsonrpc.Launcher
import org.typefox.oct.settings.OCTSettings
import java.io.PrintWriter
import java.nio.file.Path

const val EXECUTABLE_LOCATION = "lib/oct-service-process.exe"

class OCTServiceProcess(private val serverUrl: String): Disposable {
  private var currentProcess: Process? = null
  private var jsonRpc: Launcher<DefaultMessageHandler.OCTService>? = null

  fun communication(): DefaultMessageHandler.OCTService? {
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
          "--server-address=${this.serverUrl}")
        .start()
      currentProcess?.onExit()?.thenRun {
        currentProcess = null
      }

      this.jsonRpc = Launcher.createLauncher(
        service<DefaultMessageHandler>(),
        DefaultMessageHandler.OCTService::class.java,
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

