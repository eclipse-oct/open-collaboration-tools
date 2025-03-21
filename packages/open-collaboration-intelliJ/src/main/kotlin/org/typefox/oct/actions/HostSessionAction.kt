package org.typefox.oct.actions

import com.intellij.notification.Notification
import com.intellij.notification.NotificationType
import com.intellij.notification.Notifications
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.service
import com.intellij.openapi.ide.CopyPasteManager
import com.intellij.openapi.project.modules
import com.intellij.openapi.roots.ModuleRootManager
import com.intellij.util.containers.toArray
import org.typefox.oct.AuthenticationService
import org.typefox.oct.DefaultMessageHandler
import org.typefox.oct.OCTServiceProcess
import org.typefox.oct.Workspace
import org.typefox.oct.settings.OCTSettings

class HostSessionAction : AnAction() {
  override fun actionPerformed(e: AnActionEvent) {
    val process = OCTServiceProcess.getInstance()
    if(process.communication() == null) {
      process.startProcess()
    }

    val rootUris =  e.project?.modules?.flatMap {
      ModuleRootManager.getInstance(it).contentRoots.asIterable()
    }?.map {
      it.name
    }

    process.communication()?.createRoom(Workspace("oct-session",
      rootUris?.toArray(Array(size = rootUris.size, init = { "" })) ?: emptyArray()
    ))?.thenAccept { sessionData ->
      println(sessionData.roomToken)

      if(sessionData.authToken != null) {
        service<AuthenticationService>().onAuthenticated()
      }

      val roomCreatedNotification = Notification("Oct-Notifications", "Hosted session", NotificationType.INFORMATION)
      roomCreatedNotification.addAction(CopyRoomTokenAction(sessionData.roomId))
      roomCreatedNotification.addAction(CopyRoomUrlAction(sessionData.roomId))
      Notifications.Bus.notify(roomCreatedNotification)

    }
  }
}

class CopyRoomTokenAction(val roomId: String) : AnAction("Copy Room ID") {
  override fun actionPerformed(e: AnActionEvent) {
    CopyPasteManager.copyTextToClipboard(roomId)
  }
}

class CopyRoomUrlAction(val roomId: String) : AnAction("Copy Room with URL") {
  override fun actionPerformed(e: AnActionEvent) {
    CopyPasteManager.copyTextToClipboard("${OCTSettings.getInstance().state.defaultServerURL}#$roomId")
  }
}
