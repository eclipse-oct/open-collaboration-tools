package org.typefox.oct.virtualFileSystem

import com.intellij.openapi.vfs.VirtualFile
import com.intellij.openapi.vfs.VirtualFileListener
import com.intellij.openapi.vfs.VirtualFileSystem

class SessionFileSystem : VirtualFileSystem() {
  override fun getProtocol(): String {
    return "oct"
  }

  override fun findFileByPath(path: String): VirtualFile? {
    TODO("Not yet implemented")
  }

  override fun refresh(asynchronous: Boolean) {
    TODO("Not yet implemented")
  }

  override fun refreshAndFindFileByPath(path: String): VirtualFile? {
    TODO("Not yet implemented")
  }

  override fun addVirtualFileListener(listener: VirtualFileListener) {
    TODO("Not yet implemented")
  }

  override fun removeVirtualFileListener(listener: VirtualFileListener) {
    TODO("Not yet implemented")
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
    TODO("Not yet implemented")
  }
}
