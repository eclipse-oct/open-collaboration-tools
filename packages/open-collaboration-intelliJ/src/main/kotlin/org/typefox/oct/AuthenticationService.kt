package org.typefox.oct

import com.intellij.credentialStore.Credentials
import com.intellij.credentialStore.OneTimeString
import com.intellij.ide.passwordSafe.PasswordSafe
import com.intellij.openapi.components.Service
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.ProjectManager
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.remoteServer.util.CloudConfigurationUtil.createCredentialAttributes
import com.intellij.ui.jcef.JBCefApp
import com.intellij.ui.jcef.JBCefBrowser
import java.awt.Desktop
import java.net.URI
import javax.swing.JComponent
import javax.swing.JPanel
import javax.swing.SwingUtilities


const val OCT_TOKEN_SERVICE_KEY = "OCT-Auth-Token"

@Service
class AuthenticationService {

  private var currentAuthPopup: AuthDialog? = null

  fun authenticate(token: String, metadata: AuthMetadata) {
    if(JBCefApp.isSupported() && metadata.loginPageUrl != null) {
      SwingUtilities.invokeLater {
        this.currentAuthPopup = AuthDialog(metadata.loginPageUrl, ProjectManager.getInstance().openProjects[0])
        this.currentAuthPopup?.show()
      }
    } else if(!JBCefApp.isSupported()) {
      Desktop.getDesktop().browse(URI(metadata.loginPageUrl!!))
    }
  }

  fun onAuthenticated(authToken: String, serverUrl: String) {
    if(this.currentAuthPopup != null) {
      SwingUtilities.invokeLater {
        this.currentAuthPopup?.close(0)
        this.currentAuthPopup = null;
      }
    }
    val attributes = createCredentialAttributes(OCT_TOKEN_SERVICE_KEY, serverUrl)!!
    val credentials = Credentials(serverUrl, authToken)
    PasswordSafe.instance.set(attributes, credentials)

  }

  fun getAuthToken(serverUrl: String): OneTimeString? {
    val attributes = createCredentialAttributes(OCT_TOKEN_SERVICE_KEY, serverUrl)!!

    val credentials = PasswordSafe.instance.get(attributes)
    return credentials?.password
  }
}


class AuthDialog(private val url: String, project: Project): DialogWrapper(project) {

  init {
    title = "Login"
    buttonMap.clear()
    init()
  }

  override fun createCenterPanel(): JComponent {
    val browser = JBCefBrowser()
    browser.loadURL(url)
    return browser.component
  }

  override fun createSouthPanel(): JComponent {
    return JPanel()
  }
}
