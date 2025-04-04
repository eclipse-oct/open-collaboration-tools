package org.typefox.oct

import com.fasterxml.jackson.databind.ObjectMapper
import com.google.gson.Gson
import com.google.gson.TypeAdapter
import com.google.gson.stream.JsonReader
import com.google.gson.stream.JsonWriter
import com.intellij.ide.plugins.PluginManager
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.extensions.PluginId
import org.eclipse.lsp4j.jsonrpc.Launcher
import org.eclipse.lsp4j.jsonrpc.MessageConsumer
import org.eclipse.lsp4j.jsonrpc.messages.Message
import org.msgpack.jackson.dataformat.MessagePackFactory
import java.io.PrintWriter
import java.nio.file.Path
import java.util.Base64

const val EXECUTABLE_LOCATION = "lib/oct-service-process.exe"

class OCTServiceProcess(private val serverUrl: String, val messageHandler: OCTMessageHandler) : Disposable {
    private var currentProcess: Process? = null
    private var jsonRpc: Launcher<OCTMessageHandler.OCTService>? = null

    val octService: OCTMessageHandler.OCTService?
        get() {
            return jsonRpc?.remoteProxy
        }

    init {
        startProcess()
    }

    private fun startProcess() {
        val pluginId = PluginId.getId("org.typefox.open-collaboration-intelliJ")
        val plugin = PluginManager.getInstance().findEnabledPlugin(pluginId)
        if (plugin != null) {
            val pluginPath: Path = plugin.pluginPath
            val executablePath: Path = pluginPath.resolve(EXECUTABLE_LOCATION)
            val savedAuthToken = ApplicationManager.getApplication().getService(AuthenticationService::class.java)
                .getAuthToken(serverUrl)
            // start oct process
            currentProcess = ProcessBuilder()
                //.command(executablePath.toString(), "--server-address=${this.serverUrl}")
                .command(
                    "node", "--inspect",
                    "C:\\Typefox\\Open_Source\\open-collaboration-tools\\packages\\open-collaboration-service-process\\lib\\process.js",
                    "--server-address=${this.serverUrl}", "--auth-token=${savedAuthToken}"
                )
                .start()
            currentProcess?.onExit()?.thenRun {
                println(
                    "current process exited with \n" + currentProcess?.errorStream?.readAllBytes()
                        ?.toString(Charsets.UTF_8)
                )
                currentProcess = null
            }

            this.jsonRpc = Launcher.Builder<OCTMessageHandler.OCTService>()
                .setLocalService(messageHandler)
                .setRemoteInterface(OCTMessageHandler.OCTService::class.java)
                .setInput(currentProcess?.inputStream)
                .setOutput(currentProcess?.outputStream)
                // .traceMessages(PrintWriter(System.out))
                .configureGson {
                    it.registerTypeAdapter(OCPMessage::class.java, BinaryOCPMessageTypeAdapter())
                    it.registerTypeAdapter(BinaryResponse::class.java, BinaryResponseTypeAdapter())
                }
                .create()


            this.jsonRpc?.startListening()
        }
    }

    override fun dispose() {
        currentProcess?.destroy()
    }

}

class BinaryOCPMessageTypeAdapter : TypeAdapter<OCPMessage>() {

    private val msgPackObjectMapper = ObjectMapper(MessagePackFactory())

    override fun write(writer: JsonWriter, value: OCPMessage?) {
        val encoded = msgPackObjectMapper.writeValueAsBytes(value)
        writer.value(Base64.getEncoder().encodeToString(encoded))
    }

    override fun read(reader: JsonReader): OCPMessage {
        val content = reader.nextString()

        return if (content.startsWith("{")) {
            Gson().fromJson(content, OCPMessage::class.java)
        } else {
            msgPackObjectMapper.readValue(Base64.getDecoder().decode(content), OCPMessage::class.java)
        }
    }
}

class BinaryResponseTypeAdapter : TypeAdapter<BinaryResponse>() {
    private val msgPackObjectMapper = ObjectMapper(MessagePackFactory())

    override fun write(writer: JsonWriter, response: BinaryResponse) {
        val encoded = msgPackObjectMapper.writeValueAsBytes(response.data)
        val base64 = Base64.getEncoder().encodeToString(encoded)
        writer
            .beginObject()
            .name("type").value(response.type)
            .name("data").value(base64)
            .endObject()
    }

    override fun read(p0: JsonReader?): BinaryResponse {
        throw NotImplementedError("received a Binary Response which should not happen")
    }

}
