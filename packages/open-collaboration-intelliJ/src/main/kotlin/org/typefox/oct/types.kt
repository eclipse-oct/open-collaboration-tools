package org.typefox.oct

import com.google.api.Endpoint

data class OCPMessage(
    val method: String,
    val params: Array<Any>,
    val target: String?
) {

}

data class BinaryData<T>(val data: T) {
    val type = "binaryData"
}

data class Workspace(
    val name: String,
    val folders: Array<String>
)

data class AuthMetadata(
    val providers: Array<AuthProvider>,
    val loginPageUrl: String?,
    val defaultSuccessUrl: String?
)

data class AuthProvider(
    val name: String,
    val group: InfoMessage,
    val label: InfoMessage,
    val details: InfoMessage?,
    val type: String,
    val endpoint: String,
    val fields: Array<FormAuthProviderField>?
)

data class FormAuthProviderField(
    val name: String,
    val required: Boolean,
    val label: InfoMessage,
    val placeHolder: InfoMessage?
)

data class InfoMessage(
    val code: String,
    val params: Array<String>,
    val message: String
)


data class SessionData(
    val roomId: String,
    val roomToken: String?,
    val authToken: String?,
    val workspace: Workspace
)

data class User(
    val name: String,
    val email: String?,
    val authProvider: String
)

data class Peer(
    val id: String,
    val host: String,
    val name: String,
    val email: String,
    val metadata: PeerMetaData
)

data class PeerMetaData(
    val encryption: EncryptionMetaData,
    val compression: CompressionMetaData
)

data class EncryptionMetaData(val publicKey: String)
data class CompressionMetaData(val supported: Array<String>)

data class InitData(
    val protocol: String,
    val host: Peer,
    val guests: Array<Peer>,
    val permissions: Map<String, Boolean>,
    val capabilities: Map<String, Any>,
    val workspace: Workspace
)


// filesystem
enum class FileType(private val value: Int) {
    Unknown(0),
    File(1),
    Directory(2),
    SymbolicLink(64);

    override fun toString(): String {
        return value.toString()
    }
}


data class FileSystemStat(
    val type: FileType,
    val mtime: Long,
    val ctime: Long,
    val size: Long,
    val permissions: Long? = null
)

data class FileContent(val content: ByteArray)

data class ClientTextSelection(
    val peer: String,
    val start: Int,
    val end: Int?,
    val isReversed: Boolean
)

data class TextDocumentInsert(
    val startOffset: Int,
    val endOffset: Int?,
    val text: String
)


data class FileChangeEvent(
    val changes: Array<FileChange>
)

data class FileChange(
    val type: FileChangeEventType,
    val path: String
) {}

enum class FileChangeEventType(private val value: Int) {
    Create(0),
    Update(1),
    Delete(2);

    override fun toString(): String {
        return value.toString()
    }
}
