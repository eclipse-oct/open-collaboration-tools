package org.typefox.oct.fileSystem

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.ProjectManager
import com.intellij.openapi.roots.ProjectFileIndex
import com.intellij.openapi.vfs.*
import com.intellij.openapi.vfs.newvfs.BulkFileListener
import com.intellij.openapi.vfs.newvfs.events.*
import com.intellij.testFramework.utils.vfs.createDirectory
import com.intellij.testFramework.utils.vfs.createFile
import com.intellij.testFramework.utils.vfs.deleteRecursively
import com.intellij.util.io.size
import org.typefox.oct.*
import org.typefox.oct.messageHandlers.FileSystemMessageHandler
import java.io.FileNotFoundException
import java.util.concurrent.CompletableFuture
import kotlin.io.path.Path
import kotlin.io.path.name
import kotlin.io.path.pathString

/**
 * File system service for accessing files in the current workspace
 */
@Service(Service.Level.PROJECT)
class WorkspaceFileSystemService(project: Project) {

    private val workspaceDir: VirtualFile =
        VirtualFileManager.getInstance().findFileByNioPath(Path(project.basePath!!))!!


    fun stat(path: String): FileSystemStat? {
        try {
            val file = getRelativeFile(path)

            return FileSystemStat(
                getFileType(file),
                file.modificationStamp,
                file.timeStamp,
                file.length,
                null
            )
        } catch (e: FileNotFoundException) {
            return null;
        }
    }

    fun readFile(path: String): FileContent? {
        try {
            val file = getRelativeFile(path)
            return FileContent(file.contentsToByteArray())
        } catch (e: FileNotFoundException) {
            return null
        }
    }

    fun readDir(path: String): Map<String, FileType> {
        try {
            val file = getRelativeFile(path)

            val files = HashMap<String, FileType>()
            if (!file.isDirectory) {
                return files
            }

            file.children.forEach {
                files[it.name] = getFileType(it)
            }
            return files
        } catch (e: FileNotFoundException) {
            return mapOf()
        }
    }

    fun mkdir(path: String): CompletableFuture<Unit> {
        return this.runAsyncInWriteContext {
            workspaceDir.createChildDirectory(this, toRelativeWorkspacePath(path))
        }
    }

    fun writeFile(pathString: String, fileData: FileContent): CompletableFuture<Unit> {
        return this.runAsyncInWriteContext {
            if (stat(pathString) == null) {
                val path = Path(toRelativeWorkspacePath(pathString))
                val parentDir = if(path.nameCount == 1) workspaceDir else workspaceDir.findFileByRelativePath(path.parent.pathString)

                parentDir!!.createChildData(this, path.name)
            }

            val file = getRelativeFile(pathString)
            file.writeBytes(fileData.content)
        }
    }

    fun delete(path: String): CompletableFuture<Unit> {
        return this.runAsyncInWriteContext {
            val file = getRelativeFile(path)
            file.delete(file.fileSystem)
        }
    }

    fun rename(path: String, newName: String): CompletableFuture<Unit> {
        return this.runAsyncInWriteContext {
            getRelativeFile(path).rename("externalUser", newName)
        }
    }


    private fun getFileType(file: VirtualFile): FileType {
        if (file.isRecursiveOrCircularSymlink) {
            return FileType.SymbolicLink
        } else if (file.isDirectory) {
            return FileType.Directory
        } else if (file.isFile) {
            return FileType.File
        } else {
            return FileType.Unknown
        }
    }

    fun getRelativeFile(path: String): VirtualFile {
        val relativePath = toRelativeWorkspacePath(path)
        val file = workspaceDir.findFileByRelativePath(relativePath)
            ?: throw FileNotFoundException("could not find workspace file with path: $path")
        return file
    }

    private fun toRelativeWorkspacePath(path: String): String {
        return if (path.startsWith(workspaceDir.name)) path.substring(workspaceDir.name.length) else path
    }

    private fun <T> runAsyncInWriteContext(action: () -> T): CompletableFuture<T> {
        val future = CompletableFuture<T>()
        ApplicationManager.getApplication().invokeLater {
            ApplicationManager.getApplication().runWriteAction {
                future.complete(action())
            }
        }
        return future
    }
}

class OCTFileListener: BulkFileListener {
    override fun after(events: MutableList<out VFileEvent>) {
        val octSessionService = service<OCTSessionService>()
        // Map von Project zu Liste von FileChange
        val projectChangeEvents: MutableMap<Project, MutableList<FileChange>> = mutableMapOf()

        events.forEach { event ->
            for (octProject in octSessionService.currentCollaborationInstances.keys) {
                if (event.path.startsWith(octProject.basePath.toString())) {
                    val changes = when (event) {
                        is VFileCreateEvent -> listOf(FileChange(FileChangeEventType.Create, event.path))
                        is VFileDeleteEvent -> listOf(FileChange(FileChangeEventType.Delete, event.path))
                        is VFileMoveEvent -> listOf(
                            FileChange(FileChangeEventType.Delete, event.oldPath),
                            FileChange(FileChangeEventType.Create, event.newPath)
                        )
                        is VFileCopyEvent -> listOf(
                            FileChange(FileChangeEventType.Create, event.findCreatedFile()?.path ?: event.newChildName)
                        )
                        is VFilePropertyChangeEvent -> listOf(FileChange(FileChangeEventType.Update, event.path))
                        is VFileContentChangeEvent -> listOf()
                        else -> throw IllegalArgumentException("Unknown event type: ${event.javaClass.name}")
                    }
                    projectChangeEvents.getOrPut(octProject) { mutableListOf() }.addAll(changes)
                    break
                }
            }
        }

        for((project, changes) in projectChangeEvents) {
            val octSession = octSessionService.currentCollaborationInstances[project]
            if (octSession != null) {
                (octSession.remoteInterface as FileSystemMessageHandler.FileSystemService)
                    .change(FileChangeEvent(changes.toTypedArray()), "broadcast")
            }
        }
    }

}
