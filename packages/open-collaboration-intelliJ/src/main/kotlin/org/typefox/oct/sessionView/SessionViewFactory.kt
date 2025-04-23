package org.typefox.oct.sessionView

import com.intellij.icons.AllIcons.Icons
import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.DataContext
import com.intellij.openapi.actionSystem.ex.ActionUtil
import com.intellij.openapi.actionSystem.impl.ActionButtonWithText
import com.intellij.openapi.actionSystem.impl.SimpleDataContext
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.JBColor
import com.intellij.ui.components.JBList
import com.intellij.ui.util.minimumHeight
import com.intellij.ui.util.minimumWidth
import com.intellij.ui.util.preferredWidth
import com.intellij.util.ui.JButtonAction
import org.jdesktop.swingx.renderer.DefaultListRenderer
import org.typefox.oct.OCTSessionService
import org.typefox.oct.Peer
import org.typefox.oct.PeerColors
import java.awt.BorderLayout
import java.awt.Component
import java.awt.Graphics
import java.awt.GridBagConstraints
import java.awt.GridBagLayout
import java.awt.geom.Ellipse2D
import javax.swing.Action
import javax.swing.Box
import javax.swing.BoxLayout
import javax.swing.DefaultListCellRenderer
import javax.swing.Icon
import javax.swing.JButton
import javax.swing.JComponent
import javax.swing.JLabel
import javax.swing.JList
import javax.swing.JPanel
import javax.swing.ListCellRenderer
import javax.swing.SwingUtilities

class SessionViewFactory : ToolWindowFactory {
    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        toolWindow.title = "OCT"
        val sessionService = service<OCTSessionService>()

        createView(toolWindow, project, sessionService)
        sessionService.onSessionCreated.onEvent {
            if(it.project == project) {
                createView(toolWindow, project, sessionService)
            }
        }
    }

    private fun createView(toolWindow: ToolWindow, project: Project, sessionService: OCTSessionService) {
        val session = sessionService.currentCollaborationInstances[project]

        if (session != null) {
            toolWindow.contentManager.addContent(
                toolWindow.contentManager.factory.createContent(SessionView(project), null, false))
        } else {
            toolWindow.contentManager.addContent(
                toolWindow.contentManager.factory.createContent(NoSessionView(project), null, false))
        }
    }
}

class SessionView(project: Project): JPanel() {

    class PeerColorIcon(private val color: JBColor): Icon {

        override fun paintIcon(c: Component?, g: Graphics?, x: Int, y: Int) {
            val g2d = g!!.create() as java.awt.Graphics2D
            g2d.color = color
            g2d.fill(Ellipse2D.Double(6.0, 6.0, iconWidth.toDouble(), iconHeight.toDouble()))
            g2d.dispose()
        }

        override fun getIconWidth(): Int {
            return 12
        }

        override fun getIconHeight(): Int {
            return 12
        }
    }

    class PeerCellRenderer(val peerColors: PeerColors): ListCellRenderer<Peer> {
        override fun getListCellRendererComponent(
            list: JList<out Peer>?,
            peer: Peer,
            index: Int,
            isSelected: Boolean,
            cellHasFocus: Boolean
        ): Component {
            return JLabel(if (index == 0) "${peer.name} (Host)" else peer.name).apply {
                icon = PeerColorIcon(peerColors.getColor(peer.id))
                iconTextGap = 8
            }
        }

    }

    init {
        val session = service<OCTSessionService>().currentCollaborationInstances[project]!!

        layout = BorderLayout()

        val list = JBList(session.host!!, *session.guests.toTypedArray()).apply {
            cellRenderer = PeerCellRenderer(session.peerColors)
        }
        add(list, BorderLayout.PAGE_START)

        session.onPeersChanged.onEvent {
            list.setListData(arrayOf(session.host!!, *session.guests.toTypedArray()))
        }
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
                executeAction("org.typefox.oct.CreateSession")
            }
        })
    }

    fun executeAction(actionId: String) {
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
