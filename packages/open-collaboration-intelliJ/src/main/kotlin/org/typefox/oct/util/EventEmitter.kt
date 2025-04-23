package org.typefox.oct.util

class EventEmitter<T> {

  var listeners: ArrayList<(T) -> Unit> = ArrayList()

  fun onEvent(listener: (T) -> Unit): Disposable {
    listeners.add(listener)
    return Disposable {
      this.listeners.remove(listener)
    }
  }

  fun fire(arg: T) {
    for(listener in this.listeners) {
        listener(arg)
    }
  }
}

class Disposable(val dispose: () -> Unit) {

  fun dispose() {
    this.dispose()
  }
}
