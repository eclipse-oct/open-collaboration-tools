package org.typefox.oct

import org.typefox.oct.util.EventEmitter


class OCT_Connection_Process() {

  val EXECUTABLE_LOCATION = ""

  val onMessageEmitter = EventEmitter<Message>()

  init {
    // start oct process
    ProcessBuilder()
  }

  fun sendMessage(message: Message) {

  }

  private fun onMessage() {
    onMessageEmitter.fire(Message())
  }
}

class Message {

}
