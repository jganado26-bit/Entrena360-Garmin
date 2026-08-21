package com.entrena360.garmin

import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.DistanceRecord
import androidx.health.connect.client.records.ExerciseSessionRecord
import androidx.health.connect.client.records.HeartRateRecord
import androidx.health.connect.client.records.RestingHeartRateRecord
import androidx.health.connect.client.records.SleepSessionRecord
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.time.Duration
import java.time.Instant
import java.time.temporal.ChronoUnit

class HealthSyncBridge(
    private val activity: ComponentActivity,
    private val webView: WebView
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    private val permissions = setOf(
        HealthPermission.getReadPermission(ExerciseSessionRecord::class),
        HealthPermission.getReadPermission(HeartRateRecord::class),
        HealthPermission.getReadPermission(RestingHeartRateRecord::class),
        HealthPermission.getReadPermission(SleepSessionRecord::class),
        HealthPermission.getReadPermission(StepsRecord::class),
        HealthPermission.getReadPermission(DistanceRecord::class)
    )

    private val permissionLauncher = activity.registerForActivityResult(
        PermissionController.createRequestPermissionResultContract()
    ) { granted ->
        sendEvent(JSONObject().apply {
            put("type", "permissions")
            put("granted", granted.containsAll(permissions))
        })
        if (granted.containsAll(permissions)) syncNowInternal()
    }

    @JavascriptInterface
    fun getStatus(): String {
        val status = HealthConnectClient.getSdkStatus(activity)
        return JSONObject().apply {
            put("available", status == HealthConnectClient.SDK_AVAILABLE)
            put("needsUpdate", status == HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED)
            put("status", status)
        }.toString()
    }

    @JavascriptInterface
    fun requestPermissions() {
        activity.runOnUiThread {
            val status = HealthConnectClient.getSdkStatus(activity)
            if (status == HealthConnectClient.SDK_AVAILABLE) {
                permissionLauncher.launch(permissions)
            } else {
                sendEvent(JSONObject().apply {
                    put("type", "error")
                    put("message", if (status == HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED)
                        "Health Connect necesita actualizarse" else "Health Connect no está disponible en este dispositivo")
                })
            }
        }
    }

    @JavascriptInterface
    fun syncNow() {
        activity.runOnUiThread { syncNowInternal() }
    }

    fun autoSyncIfPossible() {
        if (HealthConnectClient.getSdkStatus(activity) != HealthConnectClient.SDK_AVAILABLE) return
        scope.launch {
            try {
                val client = HealthConnectClient.getOrCreate(activity)
                val granted = client.permissionController.getGrantedPermissions()
                if (granted.containsAll(permissions)) sync(client)
            } catch (_: Exception) { }
        }
    }

    private fun syncNowInternal() {
        if (HealthConnectClient.getSdkStatus(activity) != HealthConnectClient.SDK_AVAILABLE) {
            sendEvent(JSONObject().apply {
                put("type", "error")
                put("message", "Health Connect no está disponible")
            })
            return
        }
        scope.launch {
            try {
                val client = HealthConnectClient.getOrCreate(activity)
                val granted = client.permissionController.getGrantedPermissions()
                if (!granted.containsAll(permissions)) {
                    sendEvent(JSONObject().apply { put("type", "need_permissions") })
                    return@launch
                }
                sync(client)
            } catch (e: Exception) {
                sendEvent(JSONObject().apply {
                    put("type", "error")
                    put("message", e.message ?: "No se pudieron leer los datos")
                })
            }
        }
    }

    private suspend fun sync(client: HealthConnectClient) {
        val now = Instant.now()
        val start7d = now.minus(7, ChronoUnit.DAYS)
        val start2d = now.minus(2, ChronoUnit.DAYS)
        val startToday = now.truncatedTo(ChronoUnit.DAYS)

        val sessions = client.readRecords(
            ReadRecordsRequest<ExerciseSessionRecord>(
                timeRangeFilter = TimeRangeFilter.between(start7d, now)
            )
        ).records.sortedByDescending { it.startTime }

        val activitiesJson = JSONArray()
        for (session in sessions.take(25)) {
            val hrRecords = client.readRecords(
                ReadRecordsRequest<HeartRateRecord>(
                    timeRangeFilter = TimeRangeFilter.between(session.startTime, session.endTime)
                )
            ).records
            val hrSamples = hrRecords.flatMap { it.samples }.map { it.beatsPerMinute.toDouble() }

            val distanceRecords = client.readRecords(
                ReadRecordsRequest<DistanceRecord>(
                    timeRangeFilter = TimeRangeFilter.between(session.startTime, session.endTime)
                )
            ).records
            val distanceMeters = distanceRecords.sumOf { it.distance.inMeters }

            activitiesJson.put(JSONObject().apply {
                put("sourceId", session.metadata.id.ifBlank { session.startTime.toString() })
                put("name", session.title ?: sportName(session.exerciseType))
                put("sport", sportName(session.exerciseType))
                put("date", session.startTime.toString())
                put("duration", Duration.between(session.startTime, session.endTime).seconds)
                put("distanceKm", distanceMeters / 1000.0)
                if (hrSamples.isNotEmpty()) {
                    put("avgHr", hrSamples.average())
                    put("maxHr", hrSamples.maxOrNull())
                    put("hrSamples", JSONArray(hrSamples.takeLast(400)))
                }
                put("source", "Health Connect · Garmin")
            })
        }

        val resting = client.readRecords(
            ReadRecordsRequest<RestingHeartRateRecord>(
                timeRangeFilter = TimeRangeFilter.between(start7d, now)
            )
        ).records.maxByOrNull { it.time }

        val sleeps = client.readRecords(
            ReadRecordsRequest<SleepSessionRecord>(
                timeRangeFilter = TimeRangeFilter.between(start2d, now)
            )
        ).records.sortedByDescending { it.endTime }
        val lastSleep = sleeps.firstOrNull()
        val sleepHours = lastSleep?.let { Duration.between(it.startTime, it.endTime).toMinutes() / 60.0 }

        val steps = client.readRecords(
            ReadRecordsRequest<StepsRecord>(
                timeRangeFilter = TimeRangeFilter.between(startToday, now)
            )
        ).records.sumOf { it.count }

        val payload = JSONObject().apply {
            put("type", "sync")
            put("syncedAt", now.toString())
            put("activities", activitiesJson)
            if (resting != null) put("restingHr", resting.beatsPerMinute)
            if (sleepHours != null) put("sleepHours", sleepHours)
            put("stepsToday", steps)
        }
        sendEvent(payload)
    }

    private fun sportName(type: Int): String = when (type) {
        ExerciseSessionRecord.EXERCISE_TYPE_RUNNING,
        ExerciseSessionRecord.EXERCISE_TYPE_RUNNING_TREADMILL -> "Running"
        ExerciseSessionRecord.EXERCISE_TYPE_BIKING,
        ExerciseSessionRecord.EXERCISE_TYPE_BIKING_STATIONARY -> "Ciclismo"
        ExerciseSessionRecord.EXERCISE_TYPE_SWIMMING_POOL,
        ExerciseSessionRecord.EXERCISE_TYPE_SWIMMING_OPEN_WATER -> "Natación"
        ExerciseSessionRecord.EXERCISE_TYPE_STRENGTH_TRAINING,
        ExerciseSessionRecord.EXERCISE_TYPE_WEIGHTLIFTING -> "Fitness"
        ExerciseSessionRecord.EXERCISE_TYPE_WALKING -> "Caminata"
        ExerciseSessionRecord.EXERCISE_TYPE_HIKING -> "Senderismo"
        else -> "Actividad"
    }

    private fun sendEvent(payload: JSONObject) {
        val encoded = JSONObject.quote(payload.toString())
        activity.runOnUiThread {
            webView.evaluateJavascript(
                "window.onEntrenaHealthEvent && window.onEntrenaHealthEvent(JSON.parse($encoded));",
                null
            )
        }
    }
}
