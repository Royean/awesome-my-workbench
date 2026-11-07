package dev.awesome.myworkbench

import android.content.Context
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.*
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.request.ReadRecordsRequest
import androidx.health.connect.client.time.TimeRangeFilter
import kotlinx.coroutines.CancellationException
import org.json.JSONArray
import org.json.JSONObject
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter

/** Optional, read-only types. Never interprets regular heart-rate samples as resting heart rate. */
internal object CaptureHealthReader {
    val labels = linkedMapOf("sleep" to "睡眠时长", "weight" to "体重", "resting_heart_rate" to "静息心率", "exercise" to "运动记录")
    val permissions = mapOf(
        "sleep" to HealthPermission.getReadPermission(SleepSessionRecord::class),
        "weight" to HealthPermission.getReadPermission(WeightRecord::class),
        "resting_heart_rate" to HealthPermission.getReadPermission(RestingHeartRateRecord::class),
        "exercise" to HealthPermission.getReadPermission(ExerciseSessionRecord::class)
    )
    val distancePermission = HealthPermission.getReadPermission(DistanceRecord::class)
    private val zone = ZoneId.of("Asia/Shanghai")
    private val timeFormat = DateTimeFormatter.ofPattern("HH:mm").withZone(zone)
    private suspend inline fun <reified T : Record> readAll(client: HealthConnectClient, start: Instant, end: Instant): List<T> {
        val records = mutableListOf<T>()
        var token: String? = null
        do {
            val page = client.readRecords(ReadRecordsRequest(T::class, TimeRangeFilter.between(start, end), pageSize = 1000, pageToken = token))
            records.addAll(page.records); token = page.pageToken
            // Bound resource use and fail the type as a whole instead of uploading an incomplete daily total.
            check(records.size <= 20000) { "Health Connect records exceed safe bound" }
        } while (token != null)
        return records
    }
    /** Merge duplicate/overlapping windows before requesting aggregate, never add overlapping sources. */
    fun merge(windows: List<Pair<Instant, Instant>>): List<Pair<Instant, Instant>> {
        val output = mutableListOf<Pair<Instant, Instant>>()
        for (window in windows.filter { it.first < it.second }.sortedBy { it.first }) {
            val last = output.lastOrNull()
            if (last != null && window.first <= last.second) output[output.lastIndex] = last.first to maxOf(last.second, window.second)
            else output.add(window)
        }
        return output
    }
    suspend fun read(context: Context, prefs: CapturePrefs, foreground: Boolean, owner: String) {
        if (CaptureCoordinator.healthStatus(context) != HealthConnectClient.SDK_AVAILABLE) { prefs.healthStatus = "其他健康数据：Health Connect 不可用或需要更新"; return }
        val status = mutableListOf<String>()
        try {
            val client = HealthConnectClient.getOrCreate(context)
            val granted = client.permissionController.getGrantedPermissions()
            if (!foreground && (!prefs.background || !CaptureCoordinator.supportsBackground(context) || CaptureCoordinator.BACKGROUND_PERMISSION !in granted)) return
            val now = Instant.now()
            val firstDate = LocalDate.now(zone).minusDays(6)
            val start = firstDate.atStartOfDay(zone).toInstant()
            CaptureStore(context).use { store ->
                fun enqueue(kind: String, key: String, record: JSONObject) {
                    if (prefs.paused || prefs.owner != owner || kind !in prefs.healthKinds) return
                    val payload = JSONObject().put("deviceId", prefs.deviceId).put("source", "health-connect").put("records", JSONArray().put(record))
                    store.enqueue(owner, kind, key, payload)
                }
                for (kind in prefs.healthKinds.sorted()) {
                    if (prefs.paused || prefs.owner != owner) return
                    if (permissions[kind] !in granted) { status.add("${labels[kind]}：未授权"); continue }
                    try {
                        var count = 0
                        when (kind) {
                            "weight" -> {
                                val records = readAll<WeightRecord>(client, start, now).filter { it.time <= now }
                                    .groupBy { it.time.atZone(zone).toLocalDate() }.mapValues { (_, rows) -> rows.maxWith(compareBy<WeightRecord> { it.time }.thenBy { it.metadata.lastModifiedTime }) }
                                for ((date, row) in records) {
                                    val value = row.weight.inKilograms
                                    if (!value.isFinite() || value <= 0 || value > 1000) continue
                                    enqueue(kind, date.toString(), metric(kind, row.metadata.id, date, value, maxOf(row.time, minOf(row.metadata.lastModifiedTime, now))).put("time", timeFormat.format(row.time))); count++
                                }
                            }
                            "resting_heart_rate" -> {
                                val records = readAll<RestingHeartRateRecord>(client, start, now).filter { it.time <= now }
                                    .groupBy { it.time.atZone(zone).toLocalDate() }.mapValues { (_, rows) -> rows.maxWith(compareBy<RestingHeartRateRecord> { it.time }.thenBy { it.metadata.lastModifiedTime }) }
                                for ((date, row) in records) {
                                    if (row.beatsPerMinute !in 20..300) continue
                                    enqueue(kind, date.toString(), metric(kind, row.metadata.id, date, row.beatsPerMinute, maxOf(row.time, minOf(row.metadata.lastModifiedTime, now))).put("time", timeFormat.format(row.time))); count++
                                }
                            }
                            "sleep" -> {
                                // Extend read start to include sessions that start before the 7-day window but end inside it.
                                val sessions = readAll<SleepSessionRecord>(client, start.minus(Duration.ofDays(2)), now)
                                    .filter { it.endTime <= now && it.endTime.atZone(zone).toLocalDate() >= firstDate }
                                // Merge across dates too: two trackers straddling midnight must not count the same night on two days.
                                val byEndDate = merge(sessions.map { it.startTime to it.endTime }).groupBy { it.second.atZone(zone).toLocalDate() }
                                for ((date, windows) in byEndDate) {
                                    var duration = Duration.ZERO
                                    var hasData = false
                                    for ((from, until) in windows) {
                                        val total = client.aggregate(AggregateRequest(setOf(SleepSessionRecord.SLEEP_DURATION_TOTAL), TimeRangeFilter.between(from, until)))[SleepSessionRecord.SLEEP_DURATION_TOTAL]
                                        if (total != null) { duration = duration.plus(total); hasData = true }
                                    }
                                    val hours = duration.toMillis() / 3600000.0
                                    if (!hasData || hours <= 0 || hours > 24) continue
                                    val observed = now // Source priority changes can alter the aggregate without changing session timestamps.
                                    enqueue(kind, date.toString(), metric(kind, "sleep:$date", date, hours, observed)); count++
                                }
                            }
                            "exercise" -> {
                                val sessions = readAll<ExerciseSessionRecord>(client, start, now).filter { it.startTime >= start && it.endTime <= now }
                                val sources = sessions.map { it.metadata.dataOrigin.packageName }.filter { it.isNotBlank() }.toSet()
                                prefs.exerciseSources = sources
                                if (sources.size > 1 && !prefs.exerciseSourceExplicit) prefs.exerciseSource = ""
                                if (sources.size == 1 && prefs.exerciseSource.isBlank()) prefs.selectExerciseSource(sources.first(), false)
                                if (sources.size > 1 && prefs.exerciseSource.isBlank()) {
                                    status.add("运动：发现多个来源，请在采集设置单选来源后同步，尚未入队")
                                    continue
                                }
                                val since = prefs.exerciseOriginSince.takeIf { it.isNotBlank() }?.let { Instant.parse(it) }
                                for (row in sessions.filter { it.metadata.dataOrigin.packageName == prefs.exerciseSource && (since == null || it.startTime >= since) }) {
                                    val elapsedMinutes = Duration.between(row.startTime, row.endTime).toMillis() / 60000.0
                                    // Health Connect subtracts marked pause/rest segments; an absent aggregate must not become elapsed time.
                                    val activeDuration = client.aggregate(AggregateRequest(setOf(ExerciseSessionRecord.EXERCISE_DURATION_TOTAL), TimeRangeFilter.between(row.startTime, row.endTime), dataOriginFilter = setOf(row.metadata.dataOrigin)))[ExerciseSessionRecord.EXERCISE_DURATION_TOTAL] ?: continue
                                    val minutes = activeDuration.toMillis() / 60000.0
                                    if (row.metadata.id.isBlank() || minutes <= 0 || minutes > 1440 || minutes > elapsedMinutes + 0.01) continue
                                    val date = row.startTime.atZone(zone).toLocalDate()
                                    val observed = now // Distance/pause aggregates may change without changing the exercise session metadata.
                                    val record = JSONObject().put("kind", kind).put("sourceId", row.metadata.id).put("date", date.toString())
                                        .put("time", timeFormat.format(row.startTime)).put("startAt", row.startTime.toString()).put("endAt", row.endTime.toString())
                                        .put("durationMinutes", minutes).put("sourcePackage", row.metadata.dataOrigin.packageName).put("exerciseType", exerciseName(row.exerciseType)).put("exerciseTypeCode", row.exerciseType).put("observedAt", observed.toString())
                                    if (prefs.distance && distancePermission in granted) {
                                        // Only this session's source; never add distance from every overlapping tracker.
                                        val distance = client.aggregate(AggregateRequest(setOf(DistanceRecord.DISTANCE_TOTAL), TimeRangeFilter.between(row.startTime, row.endTime), dataOriginFilter = setOf(row.metadata.dataOrigin)))[DistanceRecord.DISTANCE_TOTAL]?.inKilometers
                                        if (distance != null && distance.isFinite() && distance > 0 && distance <= 1000) record.put("distanceKm", distance)
                                    }
                                    enqueue(kind, row.metadata.id, record); count++
                                }
                                if (prefs.distance && distancePermission !in granted) status.add("运动距离：未授权，仅同步记录时长")
                            }
                        }
                        status.add("${labels[kind]}：${if (count == 0) (if (kind == "exercise") "最近7天无有效聚合时长可用，已跳过" else "最近7天无可用数据") else "已读取${count}条"}")
                    } catch (e: CancellationException) { throw e }
                    catch (_: SecurityException) { status.add("${labels[kind]}：权限已撤销，请重新授权") }
                    catch (_: Exception) { status.add("${labels[kind]}：读取失败，请检查数据来源后重试") }
                }
            }
        } catch (e: CancellationException) { throw e }
        catch (_: Exception) { status.add("健康读取失败，请检查 Health Connect 权限") }
        prefs.healthStatus = status.joinToString("\n")
    }
    private fun metric(kind: String, sourceId: String, date: LocalDate, value: Number, observed: Instant): JSONObject = JSONObject()
        .put("kind", kind).put("sourceId", sourceId).put("date", date.toString()).put("time", timeFormat.format(observed)).put("value", value).put("observedAt", observed.toString())
    private fun exerciseName(type: Int): String = when (type) {
        ExerciseSessionRecord.EXERCISE_TYPE_WALKING -> "步行"
        ExerciseSessionRecord.EXERCISE_TYPE_RUNNING -> "跑步"
        ExerciseSessionRecord.EXERCISE_TYPE_RUNNING_TREADMILL -> "跑步机"
        ExerciseSessionRecord.EXERCISE_TYPE_BIKING -> "骑行"
        ExerciseSessionRecord.EXERCISE_TYPE_BIKING_STATIONARY -> "室内骑行"
        ExerciseSessionRecord.EXERCISE_TYPE_SWIMMING_POOL -> "泳池游泳"
        ExerciseSessionRecord.EXERCISE_TYPE_SWIMMING_OPEN_WATER -> "开放水域游泳"
        ExerciseSessionRecord.EXERCISE_TYPE_HIKING -> "徒步"
        ExerciseSessionRecord.EXERCISE_TYPE_YOGA -> "瑜伽"
        ExerciseSessionRecord.EXERCISE_TYPE_STRENGTH_TRAINING -> "力量训练"
        ExerciseSessionRecord.EXERCISE_TYPE_BADMINTON -> "羽毛球"
        ExerciseSessionRecord.EXERCISE_TYPE_OTHER_WORKOUT -> "其他运动"
        else -> "运动类型$type"
    }
}
