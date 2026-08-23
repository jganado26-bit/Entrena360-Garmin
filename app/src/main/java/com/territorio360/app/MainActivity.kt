package com.territorio360.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.webkit.GeolocationPermissions
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.contracts.ExerciseRouteRequestContract
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.readRecord
import androidx.health.connect.client.records.DistanceRecord
import androidx.health.connect.client.records.ExerciseRoute
import androidx.health.connect.client.records.ExerciseRouteResult
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import androidx.lifecycle.lifecycleScope
import androidx.webkit.WebViewAssetLoader
import java.time.Duration
import java.time.Instant
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

class MainActivity : ComponentActivity() {

    private lateinit var webView: WebView
    private var filePathCallback: ValueCallback<Array<Uri>>? = null
    private var geolocationCallback: GeolocationPermissions.Callback? = null
    private var geolocationOrigin: String? = null
    private var webReady = false
    private var showPrivacyRationale = false
    private var healthConnectClient: HealthConnectClient? = null
    private var pendingRouteSessionId: String? = null
    private var lastAutomaticHealthSyncAt = 0L

    private val healthPermissions = setOf(
        HealthPermission.getReadPermission(ExerciseSessionRecord::class),
        HealthPermission.getReadPermission(DistanceRecord::class)
    )

    private val healthPermissionLauncher = registerForActivityResult(
        PermissionController.createRequestPermissionResultContract()
    ) { grantedPermissions ->
        if (grantedPermissions.containsAll(healthPermissions)) {
            sendHealthStatus("connected", "Health Connect conectado. Buscando actividades…", true)
            syncHealthConnect(manual = true)
        } else {
            sendHealthStatus("permission-denied", "Permiso incompleto. Territorio 360 no puede leer tus actividades.", false)
        }
    }

    private val exerciseRouteLauncher = registerForActivityResult(
        ExerciseRouteRequestContract()
    ) { route ->
        val sessionId = pendingRouteSessionId
        pendingRouteSessionId = null
        if (sessionId == null) return@registerForActivityResult
        if (route == null) {
            sendHealthError("No se autorizó el trazado de esta actividad.")
            return@registerForActivityResult
        }
        lifecycleScope.launch {
            deliverAuthorizedRoute(sessionId, route)
        }
    }

    @SuppressLint("SetJavaScriptEnabled", "JavascriptInterface")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        showPrivacyRationale = isPrivacyRationaleIntent(intent)

        webView = findViewById(R.id.webview)
        webView.addJavascriptInterface(HealthConnectBridge(), "TerritorioAndroid")

        val settings: WebSettings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.allowFileAccess = true
        settings.allowContentAccess = true
        settings.databaseEnabled = true
        settings.setGeolocationEnabled(true)
        settings.mediaPlaybackRequiresUserGesture = false

        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                assetLoader.shouldInterceptRequest(request.url)

            @Suppress("DEPRECATION")
            override fun shouldInterceptRequest(view: WebView, url: String): WebResourceResponse? =
                assetLoader.shouldInterceptRequest(Uri.parse(url))

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                openExternalNavigation(request.url)

            @Suppress("DEPRECATION")
            override fun shouldOverrideUrlLoading(view: WebView, url: String): Boolean =
                openExternalNavigation(Uri.parse(url))

            override fun onPageFinished(view: WebView, url: String) {
                webReady = true
                notifyHealthConnectStatus(autoSync = true)
                if (showPrivacyRationale) {
                    showPrivacyRationale = false
                    evaluateJavascript("if (typeof openLegalDialog === 'function') openLegalDialog('privacy');")
                }
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onGeolocationPermissionsShowPrompt(
                origin: String,
                callback: GeolocationPermissions.Callback
            ) {
                if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED) {
                    callback.invoke(origin, true, false)
                    return
                }
                geolocationOrigin = origin
                geolocationCallback = callback
                requestPermissions(
                    arrayOf(
                        Manifest.permission.ACCESS_FINE_LOCATION,
                        Manifest.permission.ACCESS_COARSE_LOCATION
                    ),
                    LOCATION_PERMISSION_REQUEST
                )
            }

            override fun onShowFileChooser(
                webView: WebView,
                callback: ValueCallback<Array<Uri>>,
                fileChooserParams: FileChooserParams
            ): Boolean {
                filePathCallback?.onReceiveValue(null)
                filePathCallback = callback
                val chooserIntent = fileChooserParams.createIntent().apply {
                    type = "*/*"
                    putExtra(
                        Intent.EXTRA_MIME_TYPES,
                        arrayOf(
                            "application/octet-stream",
                            "application/gpx+xml",
                            "application/xml",
                            "text/xml",
                            "text/csv",
                            "text/plain"
                        )
                    )
                    putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
                }
                return try {
                    startActivityForResult(chooserIntent, FILE_CHOOSER_REQUEST)
                    true
                } catch (_: Exception) {
                    filePathCallback = null
                    false
                }
            }
        }

        initializeHealthConnectClient()
        webView.loadUrl(APP_URL)
    }

    override fun onResume() {
        super.onResume()
        if (webReady) notifyHealthConnectStatus(autoSync = true)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (isPrivacyRationaleIntent(intent)) {
            if (webReady) evaluateJavascript("if (typeof openLegalDialog === 'function') openLegalDialog('privacy');")
            else showPrivacyRationale = true
        }
    }

    private fun initializeHealthConnectClient() {
        if (HealthConnectClient.getSdkStatus(this) == HealthConnectClient.SDK_AVAILABLE) {
            healthConnectClient = HealthConnectClient.getOrCreate(this)
        }
    }

    private fun notifyHealthConnectStatus(autoSync: Boolean) {
        val status = HealthConnectClient.getSdkStatus(this)
        if (status == HealthConnectClient.SDK_UNAVAILABLE) {
            sendHealthStatus("unavailable", "Health Connect no está disponible en este móvil.", false)
            return
        }
        if (status == HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) {
            sendHealthStatus("update-required", "Health Connect necesita instalarse o actualizarse.", false)
            return
        }
        if (healthConnectClient == null) initializeHealthConnectClient()
        val client = healthConnectClient ?: return
        lifecycleScope.launch {
            try {
                val granted = client.permissionController.getGrantedPermissions()
                val connected = granted.containsAll(healthPermissions)
                sendHealthStatus(
                    if (connected) "connected" else "available",
                    if (connected) "Conectado. Las actividades nuevas se comprueban al abrir la app." else "Disponible. Conecta Health Connect para leer tus actividades.",
                    connected
                )
                if (connected && autoSync && System.currentTimeMillis() - lastAutomaticHealthSyncAt > AUTO_SYNC_INTERVAL_MS) {
                    syncHealthConnect(manual = false)
                }
            } catch (error: Exception) {
                sendHealthError(error.message ?: "No se pudo comprobar Health Connect.")
            }
        }
    }

    private fun requestHealthPermissions() {
        if (HealthConnectClient.getSdkStatus(this) != HealthConnectClient.SDK_AVAILABLE) {
            notifyHealthConnectStatus(autoSync = false)
            return
        }
        healthPermissionLauncher.launch(healthPermissions)
    }

    private fun syncHealthConnect(manual: Boolean) {
        val client = healthConnectClient
        if (client == null) {
            notifyHealthConnectStatus(autoSync = false)
            return
        }
        lifecycleScope.launch {
            try {
                val granted = client.permissionController.getGrantedPermissions()
                if (!granted.containsAll(healthPermissions)) {
                    sendHealthStatus("available", "Concede permiso antes de buscar actividades.", false)
                    return@launch
                }
                if (manual) sendHealthStatus("syncing", "Buscando actividades recientes…", true)
                val end = Instant.now().plusSeconds(60)
                val start = end.minus(Duration.ofDays(30))
                val response = client.readRecords(
                    ReadRecordsRequest(
                        ExerciseSessionRecord::class,
                        timeRangeFilter = TimeRangeFilter.between(start, end),
                        ascendingOrder = false,
                        pageSize = 100
                    )
                )
                val sessions = JSONArray()
                response.records
                    .filter { territoryMode(it.exerciseType) != null }
                    .sortedByDescending { it.startTime }
                    .forEach { record ->
                        try {
                            val detailed = client.readRecord(ExerciseSessionRecord::class, record.metadata.id).record
                            sessions.put(sessionJson(detailed, null))
                        } catch (_: Exception) {
                            sessions.put(sessionJson(record, null))
                        }
                    }
                lastAutomaticHealthSyncAt = System.currentTimeMillis()
                sendHealthSessions(sessions)
                sendHealthStatus(
                    "connected",
                    if (sessions.length() == 0) "Conectado. No hay actividades compatibles en los últimos 30 días." else "${sessions.length()} actividades encontradas. Las rutas disponibles se importan una sola vez.",
                    true
                )
            } catch (error: Exception) {
                sendHealthError(error.message ?: "No se pudieron leer las actividades.")
            }
        }
    }

    private fun requestExerciseRoute(sessionId: String) {
        if (sessionId.isBlank()) return
        val client = healthConnectClient ?: run {
            notifyHealthConnectStatus(autoSync = false)
            return
        }
        lifecycleScope.launch {
            try {
                val record = client.readRecord(ExerciseSessionRecord::class, sessionId).record
                when (val result = record.exerciseRouteResult) {
                    is ExerciseRouteResult.Data -> sendHealthRoute(sessionJson(record, result.exerciseRoute))
                    is ExerciseRouteResult.ConsentRequired -> {
                        pendingRouteSessionId = sessionId
                        exerciseRouteLauncher.launch(sessionId)
                    }
                    is ExerciseRouteResult.NoData -> sendHealthError("Esta actividad no contiene un trazado GPS compartido por Garmin Connect.")
                }
            } catch (error: Exception) {
                sendHealthError(error.message ?: "No se pudo solicitar el trazado.")
            }
        }
    }

    private suspend fun deliverAuthorizedRoute(sessionId: String, route: ExerciseRoute) {
        val client = healthConnectClient ?: return
        try {
            val record = client.readRecord(ExerciseSessionRecord::class, sessionId).record
            sendHealthRoute(sessionJson(record, route))
        } catch (error: Exception) {
            sendHealthError(error.message ?: "No se pudo importar el trazado autorizado.")
        }
    }

    private suspend fun sessionJson(record: ExerciseSessionRecord, routeOverride: ExerciseRoute?): JSONObject {
        val client = healthConnectClient
        val routeResult = record.exerciseRouteResult
        val route = routeOverride ?: (routeResult as? ExerciseRouteResult.Data)?.exerciseRoute
        val routeState = when {
            route != null && route.route.isNotEmpty() -> "data"
            routeResult is ExerciseRouteResult.ConsentRequired -> "consent"
            else -> "none"
        }
        var distanceMeters = 0.0
        if (client != null) {
            try {
                val distances = client.readRecords(
                    ReadRecordsRequest(
                        DistanceRecord::class,
                        timeRangeFilter = TimeRangeFilter.between(record.startTime, record.endTime),
                        dataOriginFilter = setOf(record.metadata.dataOrigin),
                        ascendingOrder = true,
                        pageSize = 100
                    )
                ).records
                distanceMeters = distances.sumOf { it.distance.inMeters }
            } catch (_: Exception) {
                distanceMeters = 0.0
            }
        }
        val points = JSONArray()
        route?.route?.forEach { location ->
            points.put(
                JSONObject()
                    .put("lat", location.latitude)
                    .put("lng", location.longitude)
                    .put("time", location.time.toEpochMilli())
                    .put("accuracy", location.horizontalAccuracy?.inMeters ?: JSONObject.NULL)
            )
        }
        return JSONObject()
            .put("id", record.metadata.id)
            .put("startTime", record.startTime.toEpochMilli())
            .put("endTime", record.endTime.toEpochMilli())
            .put("durationSeconds", Duration.between(record.startTime, record.endTime).seconds)
            .put("title", record.title ?: "Actividad del reloj")
            .put("mode", territoryMode(record.exerciseType) ?: "run")
            .put("sourceApp", record.metadata.dataOrigin.packageName)
            .put("distanceMeters", distanceMeters)
            .put("routeState", routeState)
            .put("points", points)
    }

    private fun territoryMode(exerciseType: Int): String? = when (exerciseType) {
        ExerciseSessionRecord.EXERCISE_TYPE_RUNNING -> "run"
        ExerciseSessionRecord.EXERCISE_TYPE_WALKING,
        ExerciseSessionRecord.EXERCISE_TYPE_HIKING -> "walk"
        ExerciseSessionRecord.EXERCISE_TYPE_BIKING -> "bike"
        ExerciseSessionRecord.EXERCISE_TYPE_SWIMMING_OPEN_WATER,
        ExerciseSessionRecord.EXERCISE_TYPE_SWIMMING_POOL -> "swim"
        else -> null
    }

    private fun sendHealthStatus(code: String, message: String, connected: Boolean) {
        val payload = JSONObject().put("code", code).put("message", message).put("connected", connected)
        callHealthJavascript("onStatus", payload.toString())
    }

    private fun sendHealthSessions(sessions: JSONArray) {
        callHealthJavascript("onSessions", sessions.toString())
    }

    private fun sendHealthRoute(session: JSONObject) {
        callHealthJavascript("onRoute", session.toString())
    }

    private fun sendHealthError(message: String) {
        callHealthJavascript("onError", JSONObject().put("message", message).toString())
    }

    private fun callHealthJavascript(method: String, payload: String) {
        if (!webReady) return
        val quotedPayload = JSONObject.quote(payload)
        evaluateJavascript("if (window.TerritorioHealthConnect) window.TerritorioHealthConnect.$method($quotedPayload);")
    }

    private fun evaluateJavascript(script: String) {
        webView.post { webView.evaluateJavascript(script, null) }
    }

    private fun openHealthConnectSettings() {
        try {
            startActivity(HealthConnectClient.getHealthConnectManageDataIntent(this))
        } catch (_: Exception) {
            val launchIntent = packageManager.getLaunchIntentForPackage(HEALTH_CONNECT_PACKAGE)
            if (launchIntent != null) startActivity(launchIntent)
            else sendHealthError("No se pudo abrir Health Connect.")
        }
    }

    private fun openExternalNavigation(uri: Uri): Boolean {
        if (uri.scheme == "https" && uri.host == "appassets.androidplatform.net") return false
        return try {
            startActivity(Intent(Intent.ACTION_VIEW, uri))
            true
        } catch (_: Exception) {
            true
        }
    }

    private fun isPrivacyRationaleIntent(intent: Intent?): Boolean {
        val action = intent?.action ?: return false
        return action == "androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE" ||
            action == "android.intent.action.VIEW_PERMISSION_USAGE"
    }

    inner class HealthConnectBridge {
        @JavascriptInterface
        fun getStatus() = runOnUiThread { notifyHealthConnectStatus(autoSync = true) }

        @JavascriptInterface
        fun requestPermissions() = runOnUiThread { requestHealthPermissions() }

        @JavascriptInterface
        fun syncNow() = runOnUiThread { syncHealthConnect(manual = true) }

        @JavascriptInterface
        fun requestRoute(sessionId: String) = runOnUiThread { requestExerciseRoute(sessionId) }

        @JavascriptInterface
        fun openSettings() = runOnUiThread { openHealthConnectSettings() }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode != LOCATION_PERMISSION_REQUEST || geolocationCallback == null) return
        val granted = grantResults.isNotEmpty() && grantResults[0] == PackageManager.PERMISSION_GRANTED
        geolocationCallback?.invoke(geolocationOrigin, granted, false)
        geolocationCallback = null
        geolocationOrigin = null
    }

    @Deprecated("Deprecated in Android")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        if (requestCode == FILE_CHOOSER_REQUEST) {
            val callback = filePathCallback ?: return
            var results: Array<Uri>? = null
            if (resultCode == Activity.RESULT_OK && data != null) {
                results = when {
                    data.clipData != null -> Array(data.clipData!!.itemCount) { index -> data.clipData!!.getItemAt(index).uri }
                    data.data != null -> arrayOf(data.data!!)
                    else -> null
                }
            }
            callback.onReceiveValue(results)
            filePathCallback = null
            return
        }
        super.onActivityResult(requestCode, resultCode, data)
    }

    @Deprecated("Deprecated in Android")
    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    companion object {
        private const val APP_URL = "https://appassets.androidplatform.net/assets/index.html"
        private const val HEALTH_CONNECT_PACKAGE = "com.google.android.apps.healthdata"
        private const val FILE_CHOOSER_REQUEST = 1001
        private const val LOCATION_PERMISSION_REQUEST = 1002
        private const val AUTO_SYNC_INTERVAL_MS = 60_000L
    }
}
