package org.typefox.oct

import com.fasterxml.jackson.annotation.JsonProperty

data class OCPMessage(
    @JsonProperty("method") val method: String,
    @JsonProperty("params") val params: Array<Any>,
    @JsonProperty("target") val target: String?
) {

}

data class BinaryResponse(val data: Any) {
    val type = "binaryResponse"
}

data class Workspace(
    val name: String,
    val folders: Array<String>
)

data class AuthMetadata(
    val providers: Array<AuthProviderMetadata>,
    val loginPageUrl: String?,
    val defaultSuccessUrl: String?
)

data class AuthProviderMetadata(
    val label: String,
    val type: String,
    val endpoint: String,
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

    companion object {
        fun fromInt(value: Int) = FileType.values().first { it.value == value }
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
