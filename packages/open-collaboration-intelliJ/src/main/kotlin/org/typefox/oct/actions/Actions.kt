package org.typefox.oct.actions

import com.intellij.notification.Notification
import com.intellij.notification.NotificationType
import com.intellij.notification.Notifications
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.components.service
import com.intellij.openapi.ide.CopyPasteManager
import com.intellij.openapi.project.modules
import com.intellij.openapi.roots.ModuleRootManager
import com.intellij.openapi.ui.DialogBuilder
import com.intellij.util.containers.toArray
import org.typefox.oct.*
import org.typefox.oct.settings.OCTSettings
import java.util.concurrent.CompletableFuture
import javax.swing.JTextField

class HostSessionAction : AnAction() {
  override fun actionPerformed(e: AnActionEvent) {

    val rootUris =  e.project?.modules?.flatMap {
      ModuleRootManager.getInstance(it).contentRoots.asIterable()
    }?.map {
      it.name
    }
    service<OCTSessionService>().createRoom(Workspace("oct-session",
      rootUris?.toArray(Array(size = rootUris.size, init = { "" })) ?: emptyArray()
    ), e.project!!)
  }
}

class JoinSessionAction : AnAction() {
  override fun actionPerformed(e: AnActionEvent) {
    val roomIdInput = JTextField()
    val dialog = DialogBuilder()
      .title("Room ID")
      .centerPanel(roomIdInput)

    if (dialog.show() == 0) {
      service<OCTSessionService>().joinRoom(roomIdInput.text, e.project)
      dialog.dispose()
    }

  }

}

class CloseSessionAction: AnAction() {
    override fun actionPerformed(e: AnActionEvent) {
        service<OCTSessionService>().closeCurrentSession()
    }
}


class CopyRoomTokenAction(private val roomId: String, private val onClick: () -> Unit) : AnAction("Copy Room ID") {
  override fun actionPerformed(e: AnActionEvent) {
    CopyPasteManager.copyTextToClipboard(roomId)
    onClick()
  }
}

class CopyRoomUrlAction(private val roomId: String, private val onClick: () -> Unit) : AnAction("Copy Room with URL") {
  override fun actionPerformed(e: AnActionEvent) {
    CopyPasteManager.copyTextToClipboard("${OCTSettings.getInstance().state.defaultServerURL}#$roomId")
    onClick()
  }
}

class JoinRequestAction(label: String,
                        private val value: Boolean,
                        private val future: CompletableFuture<Boolean>): AnAction(label) {
  override fun actionPerformed(e: AnActionEvent) {
    future.complete(value)
  }
}
