package org.typefox.oct

import com.intellij.ProjectTopics
import com.intellij.notification.Notification
import com.intellij.notification.NotificationType
import com.intellij.notification.Notifications
import com.intellij.openapi.application.*
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import com.intellij.openapi.module.EmptyModuleType
import com.intellij.openapi.module.Module
import com.intellij.openapi.module.ModuleManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.ProjectManager
import com.intellij.openapi.project.ProjectManagerListener
import com.intellij.openapi.roots.ModuleRootManager
import com.intellij.openapi.roots.ModuleRootModificationUtil
import com.intellij.openapi.roots.ProjectRootManager
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.vfs.VirtualFileManager
import com.intellij.ui.AnimatedIcon
import org.typefox.oct.actions.CopyRoomTokenAction
import org.typefox.oct.actions.CopyRoomUrlAction
import org.typefox.oct.fileSystem.OCTSessionFileSystem
import org.typefox.oct.fileSystem.OCTSessionRootFile
import org.typefox.oct.settings.OCTSettings
import javax.swing.*
import kotlin.io.path.createTempDirectory
import kotlin.io.path.pathString

@Service
class OCTSessionService() {

    private var currentProcesses: MutableMap<Project, OCTServiceProcess> = mutableMapOf()

    var currentCollaborationInstances: MutableMap<Project, CollaborationInstance> = mutableMapOf()

    fun createRoom(workspace: Workspace, project: Project) {

        if (!currentCollaborationInstances.contains(project)) {
            return
        }

        val serverUrl = service<OCTSettings>().state.defaultServerURL

        if (!currentProcesses.contains(project)) {
            currentProcesses[project] = createServiceProcess(serverUrl)
        }
        val currentProcess = currentProcesses[project]!!

        currentProcess.octService!!.createRoom(workspace).thenAccept { sessionData ->
            // create session created message
            val roomCreatedNotification =
                Notification("Oct-Notifications", "Hosted session", NotificationType.INFORMATION)
            roomCreatedNotification.addAction(CopyRoomTokenAction(sessionData.roomId) {
                roomCreatedNotification.expire()
            })
            roomCreatedNotification.addAction(CopyRoomUrlAction(sessionData.roomId) {
                roomCreatedNotification.expire()
            })
            Notifications.Bus.notify(roomCreatedNotification)

            sessionCreated(sessionData, serverUrl, project, true)

        }
    }

    fun joinRoom(roomToken: String, project: Project?) {

        // TODO add parsing for serverUrl#id
        val serverUrl = service<OCTSettings>().state.defaultServerURL

        val currentProcess = createServiceProcess(serverUrl)

        val joiningDialog = JoiningDialog(project ?: ProjectManager.getInstance().defaultProject)

        SwingUtilities.invokeLater {
            joiningDialog.show()
        }

        currentProcess.octService!!.joinRoom(roomToken).thenAccept { sessionData ->
            SwingUtilities.invokeAndWait {
                joiningDialog.close(0)
            }
            val projectDir = createTempDirectory(sessionData.workspace.name)
            val newProject = ProjectManager.getInstance().loadAndOpenProject(projectDir.pathString)
                ?: throw IllegalStateException("Could not create project for session")
            currentProcesses[newProject] = currentProcess
            sessionCreated(sessionData, serverUrl, newProject, false)
            (VirtualFileManager.getInstance().getFileSystem("oct") as OCTSessionFileSystem)
                .registerRoots(sessionData.workspace.folders, currentCollaborationInstances[newProject]!!)

            try {
                val module: Module = WriteAction.computeAndWait<Module, Throwable> {
                    ModuleManager.getInstance(newProject)
                        .newModule(projectDir.resolve("${sessionData.workspace.name}.iml"), EmptyModuleType.EMPTY_MODULE)
                }
                ModuleRootModificationUtil.updateModel(module) {
                    for (entry in sessionData.workspace.folders) {
                        val root = VirtualFileManager.getInstance().findFileByUrl("oct://${entry}")
                            ?: throw IllegalStateException("Could not find shared root for entry $entry")
                        it.addContentEntry(root)
                    }
                }
            } catch (e: Throwable) {
                currentProcess.dispose()
                e.printStackTrace()
            }
        }
    }

    fun closeCurrentSession(project: Project) {
        currentProcesses[project]?.octService?.closeSession()
        currentProcesses[project]?.dispose()
        currentProcesses.remove(project)
        currentCollaborationInstances[project]?.dispose()
        currentCollaborationInstances.remove(project)
    }

    private fun sessionCreated(sessionData: SessionData, serverUrl: String, project: Project, isHost: Boolean) {
        if (sessionData.authToken != null) {
            service<AuthenticationService>().onAuthenticated(sessionData.authToken, serverUrl)
        }

        createCollaborationInstance(project, isHost)
    }

    private fun createCollaborationInstance(project: Project, isHost: Boolean) {
        val currentProcess = currentProcesses[project]
        val collaborationInstance = CollaborationInstance(currentProcess!!.octService!!, project, isHost)
        this.currentCollaborationInstances[project] = collaborationInstance
        currentProcess.messageHandler.collaborationInstance = this.currentCollaborationInstances[project]
    }

    private fun createServiceProcess(serverUrl: String): OCTServiceProcess {
        return OCTServiceProcess(serverUrl, OCTMessageHandler())
    }
}

class JoiningDialog(project: Project) : DialogWrapper(project) {

    init {
        init()
        buttonMap.clear()
    }

    override fun createCenterPanel(): JComponent {
        return JLabel(
            "Joining Room...",
            AnimatedIcon.Default(),
            SwingConstants.LEFT
        )

    }

    override fun createSouthPanel(): JComponent {
        return JPanel()
    }
}


class ProjectListener: ProjectManagerListener {

    override fun projectClosing(project: Project) {
        service<OCTSessionService>().closeCurrentSession(project)
    }
}
