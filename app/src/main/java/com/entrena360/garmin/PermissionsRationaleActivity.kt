package com.entrena360.garmin

import android.os.Bundle
import android.widget.TextView
import androidx.activity.ComponentActivity

class PermissionsRationaleActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(TextView(this).apply {
            text = "Entrena360 usa los datos de Health Connect únicamente para mostrar y analizar tus entrenamientos, frecuencia cardiaca, sueño y recuperación en este dispositivo. No vende ni comparte estos datos con terceros."
            textSize = 18f
            setPadding(48, 72, 48, 48)
        })
    }
}
