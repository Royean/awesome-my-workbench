package dev.awesome.myworkbench

import org.json.JSONObject

/** Applied immediately before sending every queued record, including records captured before a source was disabled. */
internal object CaptureUploadPolicy {
    fun prepare(prefs: CapturePrefs, kind: String, raw: String, granted: Set<String>, notificationAccess: Boolean): String? {
        if (prefs.paused) return null
        val payload = JSONObject(raw)
        when (kind) {
            "notification" -> {
                val packageName = payload.optString("packageName")
                if (!prefs.notifications || !notificationAccess || packageName !in prefs.selected) return null
                if (!CaptureFilter.accepts(packageName, payload.optString("title"), payload.optString("text"))) return null
            }
            "steps" -> if (!prefs.steps || CaptureCoordinator.stepsPermission !in granted) return null
            else -> {
                if (kind !in prefs.healthKinds || CaptureHealthReader.permissions[kind] !in granted) return null
                if (kind == "exercise") {
                    val records = payload.optJSONArray("records") ?: return null
                    if (prefs.exerciseSource.isBlank()) return null
                    for (index in 0 until records.length()) {
                        val record = records.getJSONObject(index)
                        if (record.optString("sourcePackage") != prefs.exerciseSource) return null
                        if (prefs.exerciseOriginSince.isNotBlank()) {
                            val start = try { java.time.Instant.parse(record.optString("startAt")) } catch (_: Exception) { return null }
                            if (start < java.time.Instant.parse(prefs.exerciseOriginSince)) return null
                        }
                    }
                }
                if (kind == "exercise" && (!prefs.distance || CaptureHealthReader.distancePermission !in granted)) {
                    val records = payload.optJSONArray("records")
                    if (records != null) for (index in 0 until records.length()) records.getJSONObject(index).remove("distanceKm")
                }
            }
        }
        return payload.toString()
    }
}
