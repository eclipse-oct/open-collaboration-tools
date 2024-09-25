package org.typefox.oct.virtualFileSystem

import com.intellij.openapi.vfs.VirtualFile
import com.intellij.openapi.vfs.VirtualFileSystem
import java.io.InputStream
import java.io.OutputStream

class OCTSessionVirtualFile : VirtualFile() {
  override fun getName(): String {
    TODO("Not yet implemented")
  }

  override fun getFileSystem(): VirtualFileSystem {
    TODO("Not yet implemented")
  }

  override fun getPath(): String {
    TODO("Not yet implemented")
  }

  override fun isWritable(): Boolean {
    TODO("Not yet implemented")
  }

  override fun isDirectory(): Boolean {
    TODO("Not yet implemented")
  }

  override fun isValid(): Boolean {
    TODO("Not yet implemented")
  }

  override fun getParent(): VirtualFile {
    TODO("Not yet implemented")
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
