package org.typefox.oct

interface BaseMessage {
  val method: String
  val params: Array<String>?
}

class LoginRequest : BaseMessage {
  override val method: String = "login"
  override val params: Array<String>? = null
}

