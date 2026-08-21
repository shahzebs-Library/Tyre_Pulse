package com.example.tyre_pulse_app

import androidx.compose.ui.graphics.vector.PathParser

fun test() {
    val parser = PathParser()
    parser.parsePathString("M 60,70 L 60,275 Z")
    val path = parser.toPath()
}
