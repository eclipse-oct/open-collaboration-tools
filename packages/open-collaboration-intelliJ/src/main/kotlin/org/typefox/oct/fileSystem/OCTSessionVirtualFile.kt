package org.typefox.oct.fileSystem

import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.openapi.vfs.VirtualFileManager
import com.intellij.openapi.vfs.VirtualFileSystem
import org.typefox.oct.*
import java.io.InputStream
import java.io.OutputStream
import java.nio.file.Path
import kotlin.io.path.name
import kotlin.io.path.Path

open class OCTSessionVirtualFile(
    protected val path: Path,
    protected val type: FileType,
    protected val parent: OCTSessionVirtualFile?,
    protected val fileSystem: OCTSessionFileSystem,
    protected var stat: FileSystemStat? = null
) : VirtualFile() {

    private var cachedChildren: Array<VirtualFile>? = null

    private fun retrieveStat(): FileSystemStat? {
        if (stat != null) {
            return stat
        }

        stat = fileSystem.stat(path)?.get()
        return stat
    }

    override fun getName(): String {
        return path.name
    }

    override fun getFileSystem(): VirtualFileSystem {
        return fileSystem
    }

    override fun getPath(): String {
        return path.toString().replace("\\", "/")
    }

    override fun isWritable(): Boolean {
        return !fileSystem.isReadOnly
    }

    override fun isDirectory(): Boolean {
        return type == FileType.Directory
    }

    override fun isValid(): Boolean {
        return true
    }

    override fun getParent(): VirtualFile? {
        return parent
    }

    override fun getChildren(): Array<VirtualFile>? {
        if (type != FileType.Directory) {
            return null
        }

        if(cachedChildren != null) {
            return cachedChildren
        }

        val content = fileSystem.readDir(path)?.get() ?: return emptyArray()

        cachedChildren = content.map {
            OCTSessionVirtualFile(
                path.resolve(it.key),
                FileType.fromInt(it.value.toInt()),
                this,
                fileSystem)
        }.toTypedArray()
        return cachedChildren
    }

    override fun getOutputStream(requestor: Any?, newModificationStamp: Long, newTimeStamp: Long): OutputStream {
        return OutputStream.nullOutputStream()
    }

    override fun contentsToByteArray(): ByteArray {
        val resp = fileSystem.readFile(path)?.get()
        return resp?.content ?: ByteArray(0)
    }

    override fun getModificationStamp(): Long {
        return retrieveStat()?.mtime ?: 0
    }

    override fun getTimeStamp(): Long {
        return retrieveStat()?.ctime ?: 0
    }

    override fun getLength(): Long {
        return retrieveStat()?.size ?: 0
    }

    override fun refresh(asynchronous: Boolean, recursive: Boolean, postRunnable: Runnable?) {
        this.stat = null
        this.cachedChildren = null
    }

    override fun getInputStream(): InputStream {
        return InputStream.nullInputStream()
    }
}

class OCTSessionRootFile(
    name: String,
    fileSystem: OCTSessionFileSystem,
    private val project: Project,
    val collaborationInstance: CollaborationInstance,
) :
    OCTSessionVirtualFile(Path.of(name), FileType.Directory, null, fileSystem) {

    override fun getParent(): VirtualFile? {
        return VirtualFileManager.getInstance().findFileByNioPath(Path(project.basePath!!))
    }
}
