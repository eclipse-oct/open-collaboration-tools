package org.typefox.oct.actions
import com.intellij.notification.Notification
import com.intellij.notification.NotificationType
import com.intellij.notification.Notifications
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import org.typefox.oct.DefaultMessageHandler
import org.typefox.oct.OCTServiceProcess


class JoinSessionAction : AnAction() {
  override fun actionPerformed(e: AnActionEvent) {
    val process = OCTServiceProcess.getInstance()
    if(process.communication() == null) {
      process.startProcess(DefaultMessageHandler())
    }

    process.communication()?.joinRoom("")

    Notifications.Bus.notify(Notification("Oct-Notifications", "Join session", NotificationType.INFORMATION))
  }
}
