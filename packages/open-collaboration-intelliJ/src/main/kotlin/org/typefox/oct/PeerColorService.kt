package org.typefox.oct

import com.intellij.ui.JBColor
import java.awt.Color

val defaultColors = arrayOf<JBColor>(
    JBColor.YELLOW,
    JBColor.GREEN,
    JBColor.ORANGE,
    JBColor.BLUE
)

class PeerColors {

    val knownColors =  mutableSetOf<String>()

    private val colors: MutableMap<String, JBColor> = mutableMapOf()

    fun getColor(peerId: String): JBColor {
        if(colors.containsKey(peerId)) {
            return colors[peerId]!!
        }

        if(colors.size < defaultColors.size) {
            colors[peerId] = defaultColors[colors.size]
            return colors[peerId]!!
        }

        // TODO add color generation
        throw NotImplementedError("Color generation not implemented, all default colors in use")
    }
}
