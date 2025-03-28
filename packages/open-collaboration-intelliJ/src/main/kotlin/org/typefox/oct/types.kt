package org.typefox.oct

import com.fasterxml.jackson.annotation.JsonProperty

data class OCPMessage(@JsonProperty("method") val method: String,
                      @JsonProperty("params") val params: Array<Any>,
                      @JsonProperty("target")val target: String?) {

}

data class BinaryResponse(val data: Any) {
  val type = "binaryResponse"
}

data class Workspace(val name: String,
                     val folders: Array<String>)

data class AuthMetadata (
  val providers: Array<AuthProviderMetadata>,
  val loginPageUrl: String?,
  val defaultSuccessUrl: String?
)

data class AuthProviderMetadata (
  val label: String,
  val type: String,
  val endpoint: String,
)


data class SessionData(val roomId: String,
                  val roomToken: String?,
                  val authToken: String?,
                  val workspace: Workspace)

data class User(val name: String,
                val email: String?,
                val authProvider: String)

data class Peer(
  val id: String,
  val host: String,
  val name: String,
  val email: String,
  val metadata: PeerMetaData
)

data class PeerMetaData(
  val encryption:  EncryptionMetaData,
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
enum class FileType {
  Unknown,
  File,
  Directory,
  SymbolicLink
}

data class FileSystemStat(
  val type: FileType,
  val mtime: Int,
  val ctime: Int,
  val size: Int,
  val permissions: Int?
)

data class FileContent(val content: ByteArray)

data class ClientTextSelection(
  val start: Int,
  val end: Int,
  val isReversed: Boolean
)

data class TextDocumentInsert(
  val startOffset: Int,
  val endOffset: Int?,
  val text: String
)
