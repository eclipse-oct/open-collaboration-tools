package org.typefox.oct

import com.fasterxml.jackson.databind.ObjectMapper
import com.fasterxml.jackson.module.kotlin.registerKotlinModule
import com.google.gson.Gson
import com.google.gson.TypeAdapter
import com.google.gson.TypeAdapterFactory
import com.google.gson.reflect.TypeToken
import com.google.gson.stream.JsonReader
import com.google.gson.stream.JsonWriter
import com.intellij.ide.plugins.PluginManager
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.extensions.PluginId
import org.eclipse.lsp4j.jsonrpc.Launcher
import org.eclipse.lsp4j.jsonrpc.messages.Message
import org.eclipse.lsp4j.jsonrpc.messages.NotificationMessage
import org.eclipse.lsp4j.jsonrpc.messages.RequestMessage
import org.msgpack.jackson.dataformat.MessagePackFactory
import org.typefox.oct.messageHandlers.BaseMessageHandler
import org.typefox.oct.messageHandlers.OCTMessageHandler
import java.io.PrintWriter
import java.nio.file.Path
import java.util.Base64

const val EXECUTABLE_LOCATION = "lib/oct-service-process.exe"

class OCTServiceProcess(private val serverUrl: String, val messageHandlers: List<BaseMessageHandler>) : Disposable {
    private var currentProcess: Process? = null
    private var jsonRpc: Launcher<BaseMessageHandler.BaseRemoteInterface>? = null

    fun <T : BaseMessageHandler.BaseRemoteInterface> getOctService(): T {
        if(jsonRpc == null) {
            throw RuntimeException("OCTServiceProcess is not initialized")
        }
        return jsonRpc?.remoteProxy as T
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
                //.command(executablePath.toString(), "--server-address=${this.serverUrl}", "--auth-token=${savedAuthToken}")
                .command(
                    "node", "--inspect=23698",
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

            this.jsonRpc = Launcher.Builder<BaseMessageHandler.BaseRemoteInterface>()
                .setLocalServices(messageHandlers)
                .setClassLoader(OCTMessageHandler.OCTService::class.java.classLoader)
                .setRemoteInterfaces(messageHandlers.map { it.remoteInterface })
                .setInput(currentProcess?.inputStream)
                .setOutput(currentProcess?.outputStream)
                .configureGson { gson ->
                    binaryDataTypes.forEach {
                        gson.registerTypeAdapter(it, BinaryDataAdapter(it))
                    }
                }
                .traceMessages(PrintWriter(System.out))
                .create()

            this.jsonRpc?.startListening()
        }
    }

    override fun dispose() {
        currentProcess?.destroy()
    }

}

val binaryDataTypes: Array<Class<*>> = arrayOf(
    FileContent::class.java
)

class BinaryDataAdapter<T>(private val type: Class<T>) : TypeAdapter<T>() {

    private val objectMapper = ObjectMapper(MessagePackFactory()).registerKotlinModule()

    private val gson = Gson()

    override fun write(out: JsonWriter, value: T) {
        val encoded = objectMapper.writeValueAsBytes(value)
        val base64 = Base64.getEncoder().encodeToString(encoded)

        val binary = BinaryData(base64)

        gson.toJson(binary, BinaryData::class.java, out)
    }

    override fun read(input: JsonReader): T? {
        val binaryData = gson.fromJson<BinaryData<String>>(input, BinaryData::class.java)
        val decodedBinary = Base64.getDecoder().decode(binaryData.data)
        return objectMapper.readValue(decodedBinary, type)
    }
}

/**
 * this is required because gson serializes Lists to nested arrays.
 * like a method like m(p1, p2) will be serialized to {method: "m", params: [[p1, p2]]}
 */
class MessageTypeAdapter: TypeAdapter<Message>() {
    private val gson = Gson()

    override fun write(out: JsonWriter, value: Message) {
        if(value is NotificationMessage) {
            if(value.params is List<*>) {
                value.params = (value.params as List<*>).toTypedArray()
            }
        }
        if(value is RequestMessage) {
            if(value.params is List<*>) {
                value.params = (value.params as List<*>).toTypedArray()
            }
        }
        gson.toJson(value, Message::class.java)
    }

    override fun read(input: JsonReader): Message? {
        return gson.fromJson(input, Message::class.java)
    }
}
