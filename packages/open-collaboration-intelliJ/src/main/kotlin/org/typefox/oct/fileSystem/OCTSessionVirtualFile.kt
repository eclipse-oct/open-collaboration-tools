package org.typefox.oct.fileSystem

import com.intellij.openapi.project.BaseProjectDirectories.Companion.getBaseDirectories
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.openapi.vfs.VirtualFileSystem
import org.typefox.oct.FileSystemStat
import org.typefox.oct.OCPMessage
import java.io.InputStream
import java.io.OutputStream
import java.nio.file.FileSystemException
import java.nio.file.Path
import kotlin.io.path.name
import org.typefox.oct.FileType
import java.util.concurrent.ExecutionException
import kotlin.io.path.Path

open class OCTSessionVirtualFile(
    protected val path: Path,
    protected val type: FileType,
    protected val parent: OCTSessionVirtualFile?,
    protected val fileSystem: OCTSessionFileSystem,
    protected var stat: FileSystemStat? = null
) : VirtualFile() {

    private fun retrieveStat(): FileSystemStat? {
        if (stat != null) {
            return stat
        }

        return fileSystem.stat(path)?.get()
    }

    override fun getName(): String {
        return path.name
    }

    override fun getFileSystem(): VirtualFileSystem {
        return fileSystem
    }

    override fun getPath(): String {
        return path.toString()
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


        val collab = fileSystem.rootFromPath(path)

        val content: Map<String, Number>?
        try {
            content = collab?.octService?.request<Map<String, Number>>(
                OCPMessage(
                    "fileSystem/readDir", arrayOf(toOctPath(path)), collab.host?.id ?: ""
                )
            )?.get()
        } catch (exception: ExecutionException) {
            println("Error reading directory ${path.name}")
            return emptyArray()
        }

        if (content == null) {
            return emptyArray()
        }

        return content.map {
            OCTSessionVirtualFile(
                path.resolve(it.key),
                FileType.fromInt(it.value.toInt()),
                this,
                fileSystem,

                )
        }.toTypedArray()
    }

    override fun getOutputStream(requestor: Any?, newModificationStamp: Long, newTimeStamp: Long): OutputStream {
        return OutputStream.nullOutputStream()
    }

    override fun contentsToByteArray(): ByteArray {
        //val resp = fileSystem.readFile(path)?.get()
        //println(resp)
        return "test".toByteArray()
    }

    override fun getModificationStamp(): Long {
        return 0
    }

    override fun getTimeStamp(): Long {
        return 1231233
    }

    override fun getLength(): Long {
        return 121
    }

    override fun refresh(asynchronous: Boolean, recursive: Boolean, postRunnable: Runnable?) {
        println("refresh ${path.name}")
        TODO("Not yet implemented")
    }

    override fun getInputStream(): InputStream {
        return InputStream.nullInputStream()
    }
}

class OCTSessionRootFile(
    name: String,
    fileSystem: OCTSessionFileSystem,
    private val project: Project
) :
    OCTSessionVirtualFile(Path.of(name), FileType.Directory, null, fileSystem) {

    override fun getParent(): VirtualFile {
        return project.getBaseDirectories().first();
    }
}
