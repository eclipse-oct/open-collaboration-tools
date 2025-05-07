package org.typefox.oct.sessionView

import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.actionSystem.ActionPlaces
import com.intellij.openapi.actionSystem.ActionToolbar
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.impl.ActionButton
import com.intellij.openapi.actionSystem.impl.SimpleDataContext
import com.intellij.openapi.application.invokeLater
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.JBColor
import com.intellij.ui.components.JBList
import com.intellij.util.EventDispatcher
import org.typefox.oct.*
import org.typefox.oct.actions.ToggleFollowAction
import java.awt.BorderLayout
import java.awt.Component
import java.awt.Graphics
import java.awt.GridLayout
import java.awt.geom.Ellipse2D
import javax.swing.*

class SessionViewFactory : ToolWindowFactory {
    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        toolWindow.title = "OCT"
        val sessionService = service<OCTSessionService>()

        val panel = JPanel()
        toolWindow.contentManager.addContent(
            toolWindow.contentManager.factory.createContent(panel, null, false))
        setViewForProject(panel, project, sessionService)

        sessionService.onSessionCreated.onEvent {
            if(it.project == project) {
                setViewForProject(panel, project, sessionService)
            }
        }

    }

    private fun setViewForProject(panel: JPanel, project: Project, sessionService: OCTSessionService) {
        invokeLater {
            val session = sessionService.currentCollaborationInstances[project]

            panel.removeAll()

            if (session != null) {
                panel.add(SessionView(project))
            } else {
                panel.add(NoSessionView(project))
            }
        }
    }
}

class SessionView(private val project: Project): JPanel() {

    class PeerColorIcon(private val color: JBColor) : Icon {

        override fun paintIcon(c: Component?, g: Graphics?, x: Int, y: Int) {
            val g2d = g!!.create() as java.awt.Graphics2D
            g2d.color = color
            g2d.fill(Ellipse2D.Double(x.toDouble(), y.toDouble(), iconWidth.toDouble(), iconHeight.toDouble()))
            g2d.dispose()
        }

        override fun getIconWidth(): Int {
            return 12
        }

        override fun getIconHeight(): Int {
            return 12
        }
    }

    init {

        layout = BorderLayout()

        renderPeerList()

        val session = service<OCTSessionService>().currentCollaborationInstances[project]!!
        session.onPeersChanged.onEvent {
            invokeLater {
                renderPeerList()
            }
        }
    }

    private fun renderPeerList() {
        val session = service<OCTSessionService>().currentCollaborationInstances[project]!!

        val peers = if(session.host != null)
            arrayOf(session.host!!, *session.guests.toTypedArray())
        else
            session.guests.toTypedArray()

        add(JPanel().apply {
            layout = GridLayout(peers.size, 2)
            peers.forEachIndexed() { index, peer ->
                add(JLabel(if (index == 0) "${peer.name} (Host)" else peer.name).apply {
                    icon = PeerColorIcon(session.peerColors.getColor(peer.id))
                    verticalAlignment = JLabel.CENTER
                    iconTextGap = 8
                })
                add(Box.createHorizontalGlue())
                val action = ToggleFollowAction(peer.id, project)
                add(JPanel().apply {
                    add(
                        ActionButton(
                            action,
                            action.templatePresentation.clone(),
                            ActionPlaces.UNKNOWN,
                            ActionToolbar.DEFAULT_MINIMUM_BUTTON_SIZE
                        ).apply {
                            isEnabled = true
                        })
                })
            }
        }, BorderLayout.PAGE_START)
    }
}

class NoSessionView(val project: Project): JPanel() {

    init {
        layout = BoxLayout(this, BoxLayout.Y_AXIS)

        add(JButton("join OCT Session").apply {
            alignmentX = CENTER_ALIGNMENT
            addActionListener {
                executeAction("org.typefox.oct.JoinSession")
            }
        })
        add(JButton("Create OCT Session").apply {
            alignmentX = CENTER_ALIGNMENT
            addActionListener {
                executeAction("org.typefox.oct.HostSession")
            }
        })
    }

    private fun executeAction(actionId: String) {
        val action = ActionManager.getInstance().getAction(actionId)
        if (action != null) {
            val event = AnActionEvent.createFromDataContext("", null,
                SimpleDataContext.getProjectContext(project))
            action.actionPerformed(event)
        } else {
            println("Aktion mit ID $actionId nicht gefunden.")
        }
    }
}
