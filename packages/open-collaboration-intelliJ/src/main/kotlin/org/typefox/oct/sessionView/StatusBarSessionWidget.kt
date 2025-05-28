package org.typefox.oct.sessionView

import com.intellij.openapi.actionSystem.ActionGroup
import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.StatusBarWidget
import com.intellij.openapi.wm.StatusBarWidgetFactory
import com.intellij.util.Consumer
import org.typefox.oct.CollaborationInstance
import org.typefox.oct.OCTSessionService
import java.awt.Component
import java.awt.event.MouseEvent


private const val ID = "org.typefox.oct.sessionView.StatusBarSessionWidget"

class OCTSessionStatusBarWidgetFactory : StatusBarWidgetFactory {
    override fun getId(): String {
        return ID
    }

    override fun getDisplayName(): String {
        return "OCT Session Status"
    }

    override fun isAvailable(project: Project): Boolean {
        return service<OCTSessionService>().hasOpenSession(project)
    }

    override fun createWidget(project: Project): StatusBarWidget {
        return OCTSessionStatusBarWidget(
            service<OCTSessionService>().currentCollaborationInstances[project] ?:
                throw IllegalStateException("No active session found for project")
        )
    }
}

class OCTSessionStatusBarWidget(private val currentSession: CollaborationInstance): StatusBarWidget, StatusBarWidget.TextPresentation {
    override fun ID(): String {
        return ID
    }

    override fun getPresentation(): StatusBarWidget.WidgetPresentation {
        return this
    }

    override fun getAlignment(): Float {
        return Component.RIGHT_ALIGNMENT
    }

    override fun getText(): String {
        // TODO localization
        // TODO add an icon
        return if(currentSession.isHost) {
            "OCT: Sharing"
        } else {
            "OCT: Collaborating"
        }
    }

    override fun getTooltipText(): String {
        return "Open Collaboration Tools Status"
    }

    override fun getClickConsumer(): Consumer<MouseEvent> {
        return Consumer<MouseEvent> { mouseEvent: MouseEvent ->
            val group = ActionManager.getInstance().getAction("org.typefox.oct.actions.OCTActions") as ActionGroup
            val popupMenu = ActionManager.getInstance().createActionPopupMenu("PopupMenu", group)
            popupMenu.component.show(mouseEvent.component, mouseEvent.x, mouseEvent.y)
        }
    }

}
