package dev.awesome.myworkbench

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import org.json.JSONObject
import java.util.UUID

internal class CaptureStore(context: Context) : SQLiteOpenHelper(context, "phone-capture.db", null, 1) {
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE queue(id INTEGER PRIMARY KEY, owner TEXT NOT NULL, kind TEXT NOT NULL, event_key TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL, failed INTEGER NOT NULL DEFAULT 0, UNIQUE(owner,kind,event_key))")
        db.execSQL("CREATE INDEX queue_owner ON queue(owner,failed,id)")
    }
    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit
    fun enqueue(owner: String, kind: String, key: String, payload: JSONObject) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            // Bound retained personal data; never evict silently when full.
            val count = db.rawQuery("SELECT count(*) FROM queue", null).use { it.moveToFirst(); it.getInt(0) }
            if (count >= 2000) throw IllegalStateException("本机队列已满，请同步或清理后继续")
            val values = ContentValues().apply {
                put("owner", owner); put("kind", kind); put("event_key", key); put("payload", payload.toString())
                put("created_at", System.currentTimeMillis()); put("failed", 0)
            }
            // Daily steps are snapshots; a newer reading replaces an offline older snapshot.
            if (kind != "notification") db.insertWithOnConflict("queue", null, values, SQLiteDatabase.CONFLICT_REPLACE)
            else db.insertWithOnConflict("queue", null, values, SQLiteDatabase.CONFLICT_IGNORE)
            db.setTransactionSuccessful()
        } finally { db.endTransaction() }
    }
    data class Entry(val id: Long, val kind: String, val payload: String)
    fun next(owner: String, notifications: Boolean, steps: Boolean, healthKinds: Set<String> = emptySet()): List<Entry> = readableDatabase.rawQuery(
        "SELECT id,kind,payload FROM queue WHERE owner=? AND failed=0 AND ((kind='notification' AND ?='1') OR (kind='steps' AND ?='1') OR kind IN (${healthKinds.joinToString(",") { "?" }.ifEmpty { "NULL" }})) ORDER BY id LIMIT 2000",
        (listOf(owner, if (notifications) "1" else "0", if (steps) "1" else "0") + healthKinds).toTypedArray()
    ).use { c -> buildList { while (c.moveToNext()) add(Entry(c.getLong(0), c.getString(1), c.getString(2))) } }
    fun count(owner: String, failed: Boolean = false): Int = readableDatabase.rawQuery("SELECT count(*) FROM queue WHERE owner=? AND failed=?", arrayOf(owner, if (failed) "1" else "0")).use { it.moveToFirst(); it.getInt(0) }
    fun remove(id: Long) { writableDatabase.delete("queue", "id=?", arrayOf(id.toString())) }
    fun failed(id: Long) { writableDatabase.execSQL("UPDATE queue SET failed=1 WHERE id=?", arrayOf(id)) }
    fun clear(owner: String) { writableDatabase.delete("queue", "owner=?", arrayOf(owner)) }
}

internal class CapturePrefs(context: Context) {
    private val prefs = context.getSharedPreferences("phone-capture", Context.MODE_PRIVATE)
    var owner: String
        get() = prefs.getString("owner", "") ?: ""
        set(value) { prefs.edit().putString("owner", value).commit() }
    var ownerName: String
        get() = prefs.getString("owner_name", "") ?: ""
        set(value) { prefs.edit().putString("owner_name", value).apply() }
    var paused: Boolean
        get() = prefs.getBoolean("paused", true)
        set(value) { prefs.edit().putBoolean("paused", value).commit() }
    var notifications: Boolean
        get() = prefs.getBoolean("notifications", false)
        set(value) { prefs.edit().putBoolean("notifications", value).commit() }
    var steps: Boolean
        get() = prefs.getBoolean("steps", false)
        set(value) { prefs.edit().putBoolean("steps", value).commit() }
    var healthKinds: Set<String>
        get() = prefs.getStringSet("health_kinds", emptySet())?.toSet() ?: emptySet()
        set(value) { prefs.edit().putStringSet("health_kinds", value.toSet()).commit() }
    var exerciseSource: String
        get() = prefs.getString("exercise_source", "") ?: ""
        set(value) { prefs.edit().putString("exercise_source", value).commit() }
    private var exerciseLastSource: String
        get() = prefs.getString("exercise_last_source", "") ?: ""
        set(value) { prefs.edit().putString("exercise_last_source", value).commit() }
    var exerciseOriginSince: String
        get() = prefs.getString("exercise_origin_since", "") ?: ""
        set(value) { prefs.edit().putString("exercise_origin_since", value).commit() }
    fun willSwitchExerciseSource(source: String): Boolean = exerciseLastSource.ifBlank { exerciseSource }.let { it.isNotBlank() && it != source }
    fun selectExerciseSource(source: String, explicit: Boolean) {
        val previous = exerciseLastSource.ifBlank { exerciseSource }
        if (previous.isNotBlank() && previous != source) exerciseOriginSince = java.time.Instant.now().toString()
        exerciseSource = source; exerciseLastSource = source; exerciseSourceExplicit = explicit
        persistExerciseHistory()
    }
    private fun persistExerciseHistory() {
        if (owner.isBlank()) return
        prefs.edit().putString("exercise_last_source_owner:$owner", exerciseLastSource)
            .putString("exercise_since_owner:$owner", exerciseOriginSince).commit()
    }
    var exerciseSources: Set<String>
        get() = prefs.getStringSet("exercise_sources", emptySet())?.toSet() ?: emptySet()
        set(value) { prefs.edit().putStringSet("exercise_sources", value.toSet()).commit() }
    var exerciseSourceExplicit: Boolean
        get() = prefs.getBoolean("exercise_source_explicit", false)
        set(value) { prefs.edit().putBoolean("exercise_source_explicit", value).commit() }
    var distance: Boolean
        get() = prefs.getBoolean("distance", false)
        set(value) { prefs.edit().putBoolean("distance", value).commit() }
    var healthStatus: String
        get() = prefs.getString("health_status", "尚未读取其他健康数据") ?: ""
        set(value) { prefs.edit().putString("health_status", value).apply() }
    var background: Boolean
        get() = prefs.getBoolean("background", false)
        set(value) { prefs.edit().putBoolean("background", value).commit() }
    var selected: Set<String>
        get() = prefs.getStringSet("selected", emptySet())?.toSet() ?: emptySet()
        set(value) { prefs.edit().putStringSet("selected", value.toSet()).commit() }
    var error: String
        get() = prefs.getString("error", "") ?: ""
        set(value) { prefs.edit().putString("error", value).apply() }
    var lastSuccess: String
        get() = prefs.getString("last_success", "尚未上传") ?: "尚未上传"
        set(value) { prefs.edit().putString("last_success", value).apply() }
    var stepStatus: String
        get() = prefs.getString("step_status", "尚未读取") ?: "尚未读取"
        set(value) { prefs.edit().putString("step_status", value).apply() }
    val deviceId: String
        get() {
            val current = prefs.getString("device", null)
            if (current != null) return current
            return UUID.randomUUID().toString().also { prefs.edit().putString("device", it).commit() }
        }
    fun pause(reason: String) { paused = true; error = reason }
    fun bind(id: String, name: String) {
        if (owner != id) {
            persistExerciseHistory()
            notifications = false; steps = false; background = false; selected = emptySet(); healthKinds = emptySet(); distance = false; exerciseSource = ""; exerciseSources = emptySet(); exerciseSourceExplicit = false
            // Retain only source/cutover history by owner; never restore consent or a current source selection.
            exerciseOriginSince = prefs.getString("exercise_since_owner:$id", "") ?: ""
            exerciseLastSource = prefs.getString("exercise_last_source_owner:$id", "") ?: ""
            lastSuccess = "尚未上传"; stepStatus = "尚未读取"
        }
        owner = id; ownerName = name; paused = false; error = ""
    }
}
