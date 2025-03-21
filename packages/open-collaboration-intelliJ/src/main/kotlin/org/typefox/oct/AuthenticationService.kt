package org.typefox.oct

import com.intellij.openapi.components.Service
import com.intellij.openapi.ui.popup.JBPopup
import com.intellij.openapi.ui.popup.JBPopupFactory
import com.intellij.ui.jcef.JBCefApp
import com.intellij.ui.jcef.JBCefBrowser
import java.awt.Desktop
import java.net.URI
import javax.swing.SwingUtilities

@Service
class AuthenticationService {

    private var currentAuthPopup: JBPopup? = null

    fun openAuthUrl(url: String) {
        if(JBCefApp.isSupported()) {
            val browser = JBCefBrowser()

            browser.loadURL(url)
            this.currentAuthPopup = JBPopupFactory.getInstance()
                .createComponentPopupBuilder(browser.component, null)
                .setRequestFocus(true)
                .setFocusable(true)
                .createPopup()
            SwingUtilities.invokeLater {
                this.currentAuthPopup?.showInFocusCenter()
            }
        } else {
            Desktop.getDesktop().browse(URI("http://www.example.com"))
        }
    }

    fun onAuthenticated(authToken: String, serverUrl: String) {
        if(this.currentAuthPopup != null) {
            this.currentAuthPopup?.dispose()
        }
    }
}
