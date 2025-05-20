package org.typefox.oct.fileSystem

import com.intellij.openapi.components.Service
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.ProjectManager
import com.intellij.openapi.vfs.*
import com.intellij.testFramework.utils.vfs.createDirectory
import com.intellij.testFramework.utils.vfs.createFile
import com.intellij.testFramework.utils.vfs.deleteRecursively
import org.typefox.oct.*
import java.io.FileNotFoundException
import kotlin.io.path.Path

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

    fun readFile(path: String): BinaryData<FileContent>? {
        try {
            val file = getRelativeFile(path)
            return BinaryData(FileContent(file.contentsToByteArray()))
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

    fun mkdir(path: String) {
        workspaceDir.createDirectory(toRelativeWorkspacePath(path))
    }

    fun writeFile(path: String, fileData: FileContent) {
        if (stat(path) == null) {
            workspaceDir.createFile(toRelativeWorkspacePath(path))
        }

        val file = getRelativeFile(path)
        file.writeBytes(fileData.content)
    }

    fun delete(path: String) {
        getRelativeFile(path).deleteRecursively()
    }

    fun rename(path: String, newName: String) {
        getRelativeFile(path).rename("externalUser", newName)
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

}
