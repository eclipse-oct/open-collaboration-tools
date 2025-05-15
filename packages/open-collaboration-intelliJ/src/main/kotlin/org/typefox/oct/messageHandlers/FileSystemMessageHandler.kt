package org.typefox.oct.messageHandlers

import org.eclipse.lsp4j.jsonrpc.CompletableFutures
import org.eclipse.lsp4j.jsonrpc.services.JsonRequest
import org.eclipse.lsp4j.jsonrpc.services.JsonSegment
import org.typefox.oct.*
import org.typefox.oct.util.EventEmitter
import java.util.concurrent.CompletableFuture

@JsonSegment("fileSystem")
class FileSystemMessageHandler(onSessionCreated: EventEmitter<CollaborationInstance>) : BaseMessageHandler(onSessionCreated) {

    @JsonSegment("fileSystem")
    interface FileSystemService: BaseRemoteInterface {
        @JsonRequest
        fun stat(path: String, target: String): CompletableFuture<FileSystemStat?>
        @JsonRequest
        fun readFile(path: String, target: String): CompletableFuture<FileContent>
        @JsonRequest
        fun readDir(path: String, target: String): CompletableFuture<Map<String, FileType>>
        @JsonRequest
        fun mkdir(path: String, target: String): CompletableFuture<Unit>
        @JsonRequest
        fun writeFile(path: String, content: FileContent, target: String): CompletableFuture<Unit>
        @JsonRequest
        fun delete(path: String, target: String): CompletableFuture<Unit>
        @JsonRequest
        fun rename(oldPath: String, newPath: String, target: String): CompletableFuture<Unit>
    }

    override val remoteInterface = FileSystemService::class.java

    @JsonRequest
    fun stat(path: String, origin: String): CompletableFuture<FileSystemStat?> {
        return CompletableFutures.computeAsync {
            this.collaborationInstance?.workspaceFileSystem?.stat(path)
        }
    }

    @JsonRequest
    fun readFile(path: String, origin: String): CompletableFuture<BinaryData<FileContent>?> {
        return CompletableFutures.computeAsync {
            this.collaborationInstance?.workspaceFileSystem?.readFile(path)
        }
    }

    @JsonRequest
    fun readDir(path: String,origin: String): CompletableFuture<Map<String, FileType>?> {
        return CompletableFutures.computeAsync {

            this.collaborationInstance?.workspaceFileSystem?.readDir(path)
        }
    }

    @JsonRequest
    fun mkdir(path: String, origin: String): CompletableFuture<Unit> {
        return CompletableFutures.computeAsync {
            this.collaborationInstance?.workspaceFileSystem?.mkdir(path)
        }
    }

    @JsonRequest
    fun writeFile(path: String, content: FileContent, origin: String): CompletableFuture<Unit> {
        return CompletableFutures.computeAsync {
            this.collaborationInstance?.workspaceFileSystem?.writeFile(path, content)
        }
    }

    @JsonRequest
    fun delete(path: String, origin: String): CompletableFuture<Unit> {
        return CompletableFutures.computeAsync {
            this.collaborationInstance?.workspaceFileSystem?.delete(path)
        }
    }

    @JsonRequest
    fun rename(oldPath: String, newPath: String, origin: String): CompletableFuture<Unit> {
        return CompletableFutures.computeAsync {
            this.collaborationInstance?.workspaceFileSystem?.rename(oldPath, newPath)
        }
    }

}
