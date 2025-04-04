package org.typefox.oct.fileSystem

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

    protected val roots: MutableMap<String, CollaborationInstance> = mutableMapOf()

    fun registerRoots(roots: Array<String>, collaborationInstance: CollaborationInstance) {
        for (root in roots) {
            if (this.roots.containsKey(root)) {
                throw IllegalArgumentException("Root already registered: $root")
            }
            this.roots[root] = collaborationInstance
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

    override fun findFileByPath(path: String): VirtualFile? {
        if(roots.containsKey(path)) {
            val root = roots[path]!!
            return OCTSessionRootFile(path, this, root.project)
        }


        val stat = this.stat(Path(path))?.get() ?: return null

        return OCTSessionVirtualFile(Path(path), stat.type, null, this, stat)
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
        val collab = rootFromPath(path)
        return collab?.octService?.request(
            OCPMessage("fileSystem/stat", arrayOf(toOctPath(path)), collab.host?.id ?: ""))

    }

    fun readFile(path: Path): CompletableFuture<FileContent>? {
        val collab = rootFromPath(path)
        return collab?.octService?.request(
            OCPMessage("fileSystem/readFile", arrayOf(toOctPath(path)), collab.host?.id ?: ""))
    }


    fun rootFromPath(path: Path): CollaborationInstance? {
        return roots[path.getName(0).name]
    }
}

fun toOctPath(path: Path): String {
    return path.toString().replace("\\", "/")
}
