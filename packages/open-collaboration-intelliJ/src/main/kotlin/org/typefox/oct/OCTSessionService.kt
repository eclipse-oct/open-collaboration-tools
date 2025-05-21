package org.typefox.oct

import com.intellij.ide.lightEdit.project.LightEditProjectManager
import com.intellij.notification.Notification
import com.intellij.notification.NotificationType
import com.intellij.notification.Notifications
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.ProjectCloseListener
import com.intellij.openapi.project.ProjectManager
import com.intellij.openapi.project.ProjectManagerListener
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.openapi.util.Disposer
import com.intellij.ui.AnimatedIcon
import kotlinx.coroutines.repackaged.net.bytebuddy.implementation.bytecode.Throw
import org.typefox.oct.actions.CopyRoomTokenAction
import org.typefox.oct.actions.CopyRoomUrlAction
import org.typefox.oct.messageHandlers.BaseMessageHandler
import org.typefox.oct.messageHandlers.FileSystemMessageHandler
import org.typefox.oct.messageHandlers.OCTMessageHandler
import org.typefox.oct.settings.OCTSettings
import org.typefox.oct.util.EventEmitter
import java.io.File
import javax.swing.*
import kotlin.io.path.createTempDirectory
import kotlin.io.path.pathString

val messageHandlers: Array<Class<out BaseMessageHandler>> = arrayOf(
    FileSystemMessageHandler::class.java,
    OCTMessageHandler::class.java
)

@Service
class OCTSessionService() {

    private var currentProcesses: MutableMap<Project, OCTServiceProcess> = mutableMapOf()

    private var tempProjectsToDelete = mutableListOf<Project>()

    var currentCollaborationInstances: MutableMap<Project, CollaborationInstance> = mutableMapOf()

    var onSessionCreated: EventEmitter<CollaborationInstance> = EventEmitter()

    fun hasOpenSession(project: Project): Boolean {
        return currentCollaborationInstances.containsKey(project)
    }

    fun createRoom(workspace: Workspace, project: Project) {

        if (currentCollaborationInstances.contains(project)) {
            return
        }

        val serverUrl = service<OCTSettings>().state.defaultServerURL

        if (!currentProcesses.contains(project)) {
            currentProcesses[project] = createServiceProcess(serverUrl)
        }
        val currentProcess = currentProcesses[project]!!

        currentProcess.getOctService<OCTMessageHandler.OCTService>().createRoom(workspace).thenAccept { sessionData ->
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

        }.exceptionally {
            createErrorNotification(it, "Error Creating Room")
            null
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

        currentProcess.getOctService<OCTMessageHandler.OCTService>().joinRoom(roomToken).thenAccept { sessionData ->
            SwingUtilities.invokeAndWait {
                joiningDialog.close(0)
            }
            val projectDir = createTempDirectory(sessionData.workspace.name)
            val newProject = ProjectManager.getInstance().loadAndOpenProject(projectDir.pathString)
                ?: throw IllegalStateException("Could not create project for session")
            currentProcesses[newProject] = currentProcess
            sessionCreated(sessionData, serverUrl, newProject, false)
        }.exceptionally {
            joiningDialog.close(0)
            createErrorNotification(it, "Error Joining Room")
            null
        }
    }

    fun closeCurrentSession(project: Project) {
        currentProcesses[project]?.getOctService<OCTMessageHandler.OCTService>()?.closeSession()?.get()
        currentProcesses[project]?.let {
            Disposer.dispose(it)
        }
        currentProcesses.remove(project)
        currentCollaborationInstances[project]?.let {
            Disposer.dispose(it)
            tempProjectsToDelete.add(project)
        }
        currentCollaborationInstances.remove(project)
    }

    fun projectClosed(project: Project) {
        // delete temporary oct project
        if (tempProjectsToDelete.contains(project)) {
            project.basePath?.let {
                File(it).deleteRecursively()
            }
        }
    }

    private fun sessionCreated(sessionData: SessionData, serverUrl: String, project: Project, isHost: Boolean) {
        if (sessionData.authToken != null) {
            service<AuthenticationService>().onAuthenticated(sessionData.authToken, serverUrl)
        }

        val currentProcess = currentProcesses[project] ?: throw IllegalStateException("No current process found for project")
        val collaborationInstance = CollaborationInstance(currentProcess.getOctService(), project, sessionData, isHost)
        Disposer.register(currentProcesses[project]!!, collaborationInstance)
        this.currentCollaborationInstances[project] = collaborationInstance
        // TODO fire project specific emitter passed to message handlers
        onSessionCreated.fire(collaborationInstance)
    }

    private fun createServiceProcess(serverUrl: String): OCTServiceProcess {
        return OCTServiceProcess(serverUrl, messageHandlers.map {
            it.getConstructor(EventEmitter::class.java).newInstance(onSessionCreated)
        })
    }

    private fun createErrorNotification(e: Throwable, title: String) {
        val errorNotification = Notification(
            "Oct-Notifications",
            title,
            e.message ?: title,
            NotificationType.ERROR
        )
        Notifications.Bus.notify(errorNotification)
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


class ProjectListener: ProjectCloseListener {

    override fun projectClosing(project: Project) {
        service<OCTSessionService>().closeCurrentSession(project)
    }

    override fun projectClosed(project: Project) {
        service<OCTSessionService>().projectClosed(project)
    }
}
