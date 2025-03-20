package org.typefox.oct.actions
import com.intellij.notification.Notification
import com.intellij.notification.NotificationType
import com.intellij.notification.Notifications
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.application.ApplicationManager
import org.typefox.oct.OCTServiceProcess


class JoinSessionAction : AnAction() {
  override fun actionPerformed(e: AnActionEvent) {
    val process = OCTServiceProcess.getInstance()
    if(process.communication() == null) {
      process.startProcess()
    }

    process.communication()?.joinRoom()

    Notifications.Bus.notify(Notification("OCT-Notifications", "Join session", NotificationType.INFORMATION))
  }
}
