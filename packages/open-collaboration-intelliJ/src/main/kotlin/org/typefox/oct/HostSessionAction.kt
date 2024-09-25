package org.typefox.oct

import com.intellij.notification.Notification
import com.intellij.notification.NotificationType
import com.intellij.notification.Notifications
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent

class HostSessionAction : AnAction() {
  override fun actionPerformed(e: AnActionEvent) {
    Notifications.Bus.notify(Notification("OCT-Notifications", "Join session", NotificationType.INFORMATION))
  }
}
