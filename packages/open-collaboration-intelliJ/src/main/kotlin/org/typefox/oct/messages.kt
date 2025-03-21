package org.typefox.oct


class Workspace(val name: String, folders: Array<String>) {}

class SessionData(val roomId: String,
                  val roomToken: String,
                  val authToken: String?)
