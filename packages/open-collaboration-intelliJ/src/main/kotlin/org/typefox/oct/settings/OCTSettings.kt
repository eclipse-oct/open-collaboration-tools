package org.typefox.oct.settings

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage
import com.intellij.openapi.options.Configurable
import com.intellij.ui.components.JBTextField
import com.intellij.util.ui.FormBuilder
import javax.swing.JComponent
import javax.swing.JPanel


class OCTSettingsConfigurable : Configurable {
  private var octSettingsComponent: OCTSettingsComponent? = null

  override fun createComponent(): JComponent {
    octSettingsComponent = OCTSettingsComponent()
    return octSettingsComponent!!.getPanel()!!
  }

  override fun isModified(): Boolean {
    val state = OCTSettings.getInstance().state
    return !octSettingsComponent?.serverAddressField?.text.equals(state.defaultServerURL)
  }

  override fun apply() {
    val state = OCTSettings.getInstance().state
    if(octSettingsComponent?.serverAddressField != null) {
      state.defaultServerURL = octSettingsComponent!!.serverAddressField.text
    }
  }

  override fun getDisplayName(): String {
    return "Open Collaboration Tools"
  }

  override fun disposeUIResources() {
    octSettingsComponent = null
  }

  override fun reset() {
    val state: OCTSettings.State = OCTSettings.getInstance().state
    octSettingsComponent?.serverAddressField?.text = state.defaultServerURL
  }

}

class OCTSettingsComponent {
  val serverAddressField = JBTextField()
  private var myMainPanel: JPanel? = FormBuilder.createFormBuilder()
    .addLabeledComponent("Default server address", serverAddressField, 1)
    .getPanel()

  fun getPanel(): JPanel? {
    return myMainPanel
  }
}

@State(name = "org.intellij.sdk.settings.AppSettings",
  storages = [Storage("SdkSettingsPlugin.xml")]
)
class OCTSettings : PersistentStateComponent<OCTSettings.State>  {
  class State {
    var defaultServerURL: String = "https://api.open-collab.tools/"
  }

  private var myState = State()

  companion object  {
    fun getInstance(): OCTSettings {
      return ApplicationManager.getApplication()
        .getService(OCTSettings::class.java)
    }
  }

  override fun getState(): State {
    return myState
  }

  override fun loadState(state: State) {
    myState = state
  }
}



