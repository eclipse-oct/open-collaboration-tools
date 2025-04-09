package org.typefox.oct.fileSystem

import com.google.gson.Gson
import com.google.gson.internal.LinkedTreeMap
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.openapi.vfs.VirtualFileListener
import com.intellij.openapi.vfs.VirtualFileSystem
import com.jetbrains.rd.util.remove
import org.typefox.oct.*
import java.nio.file.Path
import java.util.concurrent.CompletableFuture
import kotlin.io.path.Path
import kotlin.io.path.name

class OCTSessionFileSystem() : VirtualFileSystem() {

    protected val roots: MutableMap<String, OCTSessionRootFile> = mutableMapOf()

    fun registerRoots(roots: Array<String>, collaborationInstance: CollaborationInstance) {
        for (root in roots) {
            if (this.roots.containsKey(root)) {
                throw IllegalArgumentException("Root already registered: $root")
            }
            this.roots[root] = OCTSessionRootFile(
                root,
                this,
                collaborationInstance.project,
                collaborationInstance
            )

        }
        Disposer.register(collaborationInstance) {
            for (root in roots) {
                roots.remove(root)
            }
        }
    }

    override fun getProtocol(): String {
        return "oct"
    }

    override fun findFileByPath(pathString: String): VirtualFile? {
        val path = Path(pathString)
        if (!roots.contains(path.getName(0).name)) {
            return null
        }

        var current: VirtualFile? = null
        for (segment in path.iterator()) {
            current = if (current == null) {
                roots[segment.name]
            } else {
                current.findChild(segment.name) ?: return null
            }
        }

        return current

    }

    override fun refresh(asynchronous: Boolean) {
        println("refreshing file system")
    }

    override fun refreshAndFindFileByPath(path: String): VirtualFile? {
        return findFileByPath(path)
    }

    override fun addVirtualFileListener(listener: VirtualFileListener) {

    }

    override fun removeVirtualFileListener(listener: VirtualFileListener) {

    }

    override fun deleteFile(requestor: Any?, vFile: VirtualFile) {
        TODO("Not yet implemented")
    }

    override fun moveFile(requestor: Any?, vFile: VirtualFile, newParent: VirtualFile) {
        TODO("Not yet implemented")
    }

    override fun renameFile(requestor: Any?, vFile: VirtualFile, newName: String) {
        TODO("Not yet implemented")
    }

    override fun createChildFile(requestor: Any?, vDir: VirtualFile, fileName: String): VirtualFile {
        TODO("Not yet implemented")
    }

    override fun createChildDirectory(requestor: Any?, vDir: VirtualFile, dirName: String): VirtualFile {
        TODO("Not yet implemented")
    }

    override fun copyFile(
        requestor: Any?,
        virtualFile: VirtualFile,
        newParent: VirtualFile,
        copyName: String
    ): VirtualFile {
        TODO("Not yet implemented")
    }

    override fun isReadOnly(): Boolean {
        return false
    }

    fun stat(path: Path): CompletableFuture<FileSystemStat>? {
        val collab = getCollaborationInstance(path)
        return collab?.octService?.request<FileSystemStat>(
            OCPMessage("fileSystem/stat", arrayOf(toOctPath(path)), collab.host?.id ?: "")
        )?.thenApply {
                it.data
            }
    }

    fun readFile(path: Path): CompletableFuture<FileContent>? {
        val collab = getCollaborationInstance(path)
        return collab?.octService?.request<FileContent>(
            OCPMessage("fileSystem/readFile", arrayOf(toOctPath(path)), collab.host?.id ?: "")
        )?.thenApply {
                it.data
            }
    }

    fun readDir(path: Path): CompletableFuture<Map<String, Number>>? {
        val collab = getCollaborationInstance(path)
        return collab?.octService?.request<Map<String, Number>>(
            OCPMessage("fileSystem/readDir", arrayOf(toOctPath(path)), collab.host?.id ?: "")
        )?.thenApply {
            it.data
        }
    }


    private fun getCollaborationInstance(path: Path): CollaborationInstance? {
        return roots[path.getName(0).name]?.collaborationInstance
    }
}

fun toOctPath(path: Path): String {
    return path.toString().replace("\\", "/")
}
