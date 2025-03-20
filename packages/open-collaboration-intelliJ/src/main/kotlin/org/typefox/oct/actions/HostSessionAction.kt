package org.typefox.oct.actions

import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.project.modules
import com.intellij.openapi.roots.ModuleRootManager
import com.intellij.util.containers.toArray
import org.typefox.oct.OCTServiceProcess
import org.typefox.oct.Workspace

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
    ))?.thenAccept {
      println("room created")
    }

    // Notifications.Bus.notify(Notification("OCT-Notifications", "Hosted session", NotificationType.INFORMATION))
  }
}
