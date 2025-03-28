package org.typefox.oct.fileSystem

import com.intellij.openapi.vfs.VirtualFile
import com.intellij.openapi.vfs.VirtualFileSystem
import java.io.InputStream
import java.io.OutputStream
import java.nio.file.Path
import kotlin.io.path.name

class OCTSessionVirtualFile(
  private val path: Path,
  private val type: FileType,
  private val fileSystem: OCTSessionFileSystem
) : VirtualFile() {

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
    return type === FileType.Directory
  }

  override fun isValid(): Boolean {
    return true
  }

  override fun getParent(): VirtualFile {
    return fileSystem.findFileByPath(path.parent.toString())!!
  }

  override fun getChildren(): Array<VirtualFile> {
    TODO("Not yet implemented")
  }

  override fun getOutputStream(requestor: Any?, newModificationStamp: Long, newTimeStamp: Long): OutputStream {
    TODO("Not yet implemented")
  }

  override fun contentsToByteArray(): ByteArray {
    TODO("Not yet implemented")
  }

  override fun getTimeStamp(): Long {
    TODO("Not yet implemented")
  }

  override fun getLength(): Long {
    TODO("Not yet implemented")
  }

  override fun refresh(asynchronous: Boolean, recursive: Boolean, postRunnable: Runnable?) {
    TODO("Not yet implemented")
  }

  override fun getInputStream(): InputStream {
    TODO("Not yet implemented")
  }
}
