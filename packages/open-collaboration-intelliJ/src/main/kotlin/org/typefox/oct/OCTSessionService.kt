package org.typefox.oct

import com.intellij.notification.Notification
import com.intellij.notification.NotificationType
import com.intellij.notification.Notifications
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.application.WriteAction
import com.intellij.openapi.application.invokeLater
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.service
import com.intellij.openapi.module.Module
import com.intellij.openapi.module.ModuleManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.ProjectManager
import com.intellij.openapi.project.modifyModules
import com.intellij.openapi.project.modules
import com.intellij.openapi.roots.ModuleRootManager
import com.intellij.openapi.ui.DialogBuilder
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.openapi.vfs.VirtualFileManager
import com.intellij.platform.backend.workspace.workspaceModel
import com.intellij.ui.AnimatedIcon
import org.typefox.oct.actions.CopyRoomTokenAction
import org.typefox.oct.actions.CopyRoomUrlAction
import org.typefox.oct.settings.OCTSettings
import javax.swing.*
import kotlin.io.path.Path
import kotlin.io.path.createTempDirectory
import kotlin.io.path.pathString

@Service
class OCTSessionService() {

  private var currentProcess: OCTServiceProcess? = null

  private var currentCollaborationInstance: CollaborationInstance? = null

  fun createRoom(workspace: Workspace, project: Project) {

    if(currentCollaborationInstance != null) {
      return
    }

    val serverUrl = service<OCTSettings>().state.defaultServerURL

    if(currentProcess == null) {
      currentProcess = createServiceProcess(serverUrl)
    }

    currentProcess!!.octService!!.createRoom(workspace).thenAccept { sessionData ->
      // create session created message
      val roomCreatedNotification = Notification("Oct-Notifications", "Hosted session", NotificationType.INFORMATION)
      roomCreatedNotification.addAction(CopyRoomTokenAction(sessionData.roomId) {
        roomCreatedNotification.expire()
      })
      roomCreatedNotification.addAction(CopyRoomUrlAction(sessionData.roomId) {
        roomCreatedNotification.expire()
      })
      Notifications.Bus.notify(roomCreatedNotification)

      sessionCreated(sessionData, serverUrl, project)

    }
  }

  fun joinRoom(roomToken: String, project: Project?) {
    if (currentCollaborationInstance != null) {
      return
    }

    // TODO add parsing for serverUrl#id
    val serverUrl = service<OCTSettings>().state.defaultServerURL

    if (currentProcess == null) {
      currentProcess = createServiceProcess(serverUrl)
    }

    val joiningDialog = JoiningDialog(project ?: ProjectManager.getInstance().defaultProject)

    SwingUtilities.invokeLater {
      joiningDialog.show()
    }

    currentProcess!!.octService!!.joinRoom(roomToken).thenAccept { sessionData ->
      SwingUtilities.invokeAndWait {
        joiningDialog.close(0)
      }
      val projectDir = createTempDirectory(sessionData.workspace.name)
      val newProject = ProjectManager.getInstance().loadAndOpenProject(projectDir.pathString)
      sessionCreated(sessionData, serverUrl, newProject!!)

      try {
        val module: Module = WriteAction.computeAndWait<Module, Throwable> {
          ModuleManager.getInstance(newProject).newModule(projectDir.resolve("${sessionData.workspace.name}.iml"), "")
        }
        val model = ModuleRootManager.getInstance(module).modifiableModel
        for (entry in sessionData.workspace.folders) {
          val root = VirtualFileManager.getInstance().findFileByUrl("oct://${entry}")
          model.addContentEntry("oct://${entry}").addSourceFolder("oct://${entry}", false)
        }
        invokeLater(ModalityState.defaultModalityState()) {
          model.commit()
        }
      } catch (e: Throwable) {
        e.printStackTrace()
      }
    }
  }

  private fun sessionCreated(sessionData: SessionData, serverUrl: String, project: Project) {
    if(sessionData.authToken != null) {
      service<AuthenticationService>().onAuthenticated(sessionData.authToken, serverUrl)
    }

    createCollaborationInstance(project)
  }

  private fun createCollaborationInstance(project: Project) {
    this.currentCollaborationInstance = CollaborationInstance(currentProcess!!.octService!!, project)
    currentProcess!!.messageHandler.collaborationInstance = this.currentCollaborationInstance
  }

  private fun createServiceProcess(serverUrl: String): OCTServiceProcess {
    return OCTServiceProcess(serverUrl, OCTMessageHandler())
  }
}

class JoiningDialog(project: Project): DialogWrapper(project) {

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
