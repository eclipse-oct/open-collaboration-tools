package org.typefox.oct.editor

import com.intellij.openapi.editor.EditorCustomElementRenderer
import com.intellij.openapi.editor.Inlay
import com.intellij.openapi.editor.markup.TextAttributes
import com.intellij.ui.JBColor
import java.awt.Graphics
import java.awt.Rectangle


class CursorRenderer(private val color: JBColor) : EditorCustomElementRenderer {
  override fun calcWidthInPixels(inlay: Inlay<*>): Int {
    return 1 // Cursor width
  }

  override fun paint(inlay: Inlay<*>, g: Graphics, targetRegion: Rectangle, textAttributes: TextAttributes) {
    g.color = color
    g.fillRect(targetRegion.x, targetRegion.y, 2, targetRegion.height)
  }

}
