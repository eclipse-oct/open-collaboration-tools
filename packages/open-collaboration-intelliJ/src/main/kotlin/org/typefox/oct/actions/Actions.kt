package org.typefox.oct.actions

import com.intellij.concurrency.resetThreadContext
import com.intellij.icons.AllIcons
import com.intellij.icons.ExpUiIcons
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.components.service
import com.intellij.openapi.ide.CopyPasteManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.modules
import com.intellij.openapi.roots.ModuleRootManager
import com.intellij.openapi.ui.DialogBuilder
import com.intellij.util.containers.toArray
import org.typefox.oct.*
import org.typefox.oct.settings.OCTSettings
import java.util.concurrent.CompletableFuture
import javax.swing.JPanel
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

    override fun update(e: AnActionEvent) {
        e.presentation.isEnabled = e.project != null && !e.project!!.isDefault
    }

    override fun getActionUpdateThread(): ActionUpdateThread {
        return ActionUpdateThread.EDT
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
        service<OCTSessionService>().closeCurrentSession(e.project ?:
            throw IllegalStateException("Can not close non-existing session"))
    }

    override fun getActionUpdateThread(): ActionUpdateThread {
        return ActionUpdateThread.BGT
    }

    override fun update(e: AnActionEvent) {
        e.presentation.isEnabled = e.project != null && service<OCTSessionService>().currentCollaborationInstances.contains(e.project)
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

class ToggleFollowAction(val peerId: String, val project: Project) : AnAction(AllIcons.General.InspectionsEye) {

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val sessionService = service<OCTSessionService>()
        val session = sessionService.currentCollaborationInstances[project] ?: return
        if (session.isFollowingPeer(peerId)) {
            session.stopFollowingPeer()
        } else {
            session.followPeer(peerId)
        }
        update(e)
    }

    override fun update(e: AnActionEvent) {
        val isFollowing = service<OCTSessionService>().currentCollaborationInstances[e.project]?.isFollowingPeer(peerId) ?: false
        e.presentation.icon = if(isFollowing) ExpUiIcons.General.Close else AllIcons.General.InspectionsEye
        e.presentation.text = if (isFollowing) "Stop Following" else "Follow"
    }

    override fun getActionUpdateThread(): ActionUpdateThread {
        return ActionUpdateThread.EDT
    }

}
