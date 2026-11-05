package dev.awesome.myworkbench

import android.app.NotificationManager
import android.os.Build
import android.provider.Settings
import android.app.job.JobInfo
import android.app.job.JobParameters
import android.app.job.JobScheduler
import android.app.job.JobService
import android.content.ComponentName
import android.content.Context
import android.webkit.CookieManager
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.HealthConnectFeatures
import androidx.health.connect.client.permission.HealthPermission
import androidx.health.connect.client.records.StepsRecord
import androidx.health.connect.client.request.AggregateRequest
import androidx.health.connect.client.time.TimeRangeFilter
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter

internal class CaptureHttpException(val status: Int) : Exception("服务器返回 $status")

/** Only this fixed origin and CookieManager's session are used; no JS bridge or exported submission API. */
object CaptureCoordinator {
    internal const val ORIGIN = "https://vivid-dream.online"
    internal const val BACKGROUND_PERMISSION = "android.permission.health.READ_HEALTH_DATA_IN_BACKGROUND"
    internal val stepsPermission = HealthPermission.getReadPermission(StepsRecord::class)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val mutex = Mutex()
    private const val PERIODIC_JOB = 70301
    private const val RETRY_JOB = 70302

    internal fun cookie(): String = CookieManager.getInstance().getCookie(ORIGIN) ?: ""
    internal fun request(path: String, owner: String, sessionCookie: String, body: String? = null): JSONObject {
        require(path.startsWith("/api/"))
        if (sessionCookie.isBlank()) throw CaptureHttpException(401)
        val connection = URL(ORIGIN + path).openConnection() as HttpURLConnection
        try {
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 12000; connection.readTimeout = 15000
            connection.setRequestProperty("Origin", ORIGIN)
            connection.setRequestProperty("Cookie", sessionCookie)
            connection.setRequestProperty("X-Workbench-Owner", owner)
            connection.setRequestProperty("Accept", "application/json")
            if (body != null) {
                connection.requestMethod = "POST"; connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            }
            val status = connection.responseCode
            if (status !in 200..299) throw CaptureHttpException(status)
            // No secrets or notification payloads are written to logs or exception messages.
            val raw = connection.inputStream.bufferedReader().use { it.readText() }
            return JSONObject(raw)
        } finally { connection.disconnect() }
    }
    internal suspend fun bind(context: Context) = withContext(Dispatchers.IO) {
        mutex.withLock {
            val prefs = CapturePrefs(context)
            val snapshot = cookie()
            val user = request("/api/auth/me", prefs.owner, snapshot).optJSONObject("user")
                ?: throw CaptureHttpException(401)
            val id = user.optString("id")
            if (id.isBlank() || snapshot != cookie()) throw CaptureHttpException(409)
            prefs.bind(id, user.optString("name", "当前账号"))
            schedule(context)
        }
    }
    @JvmStatic fun kick(context: Context, foreground: Boolean) {
        val app = context.applicationContext
        scope.launch { sync(app, foreground) }
    }
    internal suspend fun sync(context: Context, foreground: Boolean) = mutex.withLock {
        val prefs = CapturePrefs(context)
        if (prefs.owner.isBlank() || prefs.paused || (!prefs.notifications && !prefs.steps && prefs.healthKinds.isEmpty())) return@withLock
        schedule(context)
        try {
            val owner = prefs.owner
            val session = cookie()
            val current = request("/api/auth/me", owner, session).optJSONObject("user")?.optString("id")
            if (current != owner || session != cookie()) throw CaptureHttpException(409)
            if (prefs.steps) readSteps(context, prefs, foreground, owner)
            if (prefs.healthKinds.isNotEmpty()) CaptureHealthReader.read(context, prefs, foreground, owner)
            if (prefs.paused || prefs.owner != owner || session != cookie()) throw CaptureHttpException(409)
            CaptureStore(context).use { store ->
                val rows = store.next(owner, prefs.notifications, prefs.steps, prefs.healthKinds)
                var uploaded = 0
                for (row in rows) {
                    currentCoroutineContext().ensureActive()
                    // Pause/selection changes are effective before the next upload.
                    if (prefs.paused || prefs.owner != owner || session != cookie()) throw CaptureHttpException(409)
                    if (uploaded >= 100) { retry(context); break }
                    val granted = if (row.kind == "notification") emptySet() else grantedHealthPermissions(context)
                    val payload = CaptureUploadPolicy.prepare(prefs, row.kind, row.payload, granted, notificationGranted(context)) ?: continue
                    try {
                        val path = if (row.kind == "notification") "/api/capture/notifications?workbench=finance&space=personal" else if (row.kind == "steps") "/api/capture/steps?workbench=health&space=personal" else "/api/capture/health?workbench=health&space=personal"
                        request(path, owner, session, payload)
                        uploaded++
                        CaptureResponsePolicy.apply(store, row.id, 200)
                        prefs.lastSuccess = DateTimeFormatter.ofPattern("MM-dd HH:mm:ss").withZone(ZoneId.of("Asia/Shanghai")).format(Instant.now()) + "（北京时间）"
                        prefs.error = ""
                    } catch (e: CaptureHttpException) {
                        if (CaptureResponsePolicy.apply(store, row.id, e.status) == CaptureResponsePolicy.Outcome.REJECTED) {
                            prefs.error = "部分数据被服务器拒绝（${e.status}），已停止重试，可清理本机队列"
                        } else throw e
                    }
                }

            }
        } catch (e: CancellationException) { throw e }
        catch (e: CaptureHttpException) {
            if (e.status == 401 || e.status == 409) prefs.pause("登录已失效或账号已变化，请回到工作台登录，再重新绑定账号")
            else { prefs.error = if (e.status == 404) "服务器尚未支持手机采集，部署后重试；本机队列已保留" else "同步失败（${e.status}），联网后自动重试"; retry(context) }
        } catch (e: Exception) {
            prefs.error = "暂时无法同步，请检查网络和系统权限后重试"
            retry(context)
        }
    }
    internal fun notificationGranted(context: Context): Boolean {
        val component = ComponentName(context, TransactionNotificationListener::class.java)
        return if (Build.VERSION.SDK_INT >= 27) context.getSystemService(NotificationManager::class.java).isNotificationListenerAccessGranted(component)
        else Settings.Secure.getString(context.contentResolver, "enabled_notification_listeners")?.split(':')?.contains(component.flattenToString()) == true
    }
    private suspend fun grantedHealthPermissions(context: Context): Set<String> = try {
        if (healthStatus(context) == HealthConnectClient.SDK_AVAILABLE) HealthConnectClient.getOrCreate(context).permissionController.getGrantedPermissions() else emptySet()
    } catch (_: Exception) { emptySet() }
    internal fun healthStatus(context: Context): Int = try { HealthConnectClient.getSdkStatus(context) } catch (_: Exception) { HealthConnectClient.SDK_UNAVAILABLE }
    internal fun supportsBackground(context: Context): Boolean = try {
        healthStatus(context) == HealthConnectClient.SDK_AVAILABLE && HealthConnectClient.getOrCreate(context).features.getFeatureStatus(HealthConnectFeatures.FEATURE_READ_HEALTH_DATA_IN_BACKGROUND) == HealthConnectFeatures.FEATURE_STATUS_AVAILABLE
    } catch (_: Exception) { false }
    private suspend fun readSteps(context: Context, prefs: CapturePrefs, foreground: Boolean, owner: String) {
        if (healthStatus(context) != HealthConnectClient.SDK_AVAILABLE) { prefs.stepStatus = "Health Connect 不可用或需要安装/更新"; return }
        try {
            val client = HealthConnectClient.getOrCreate(context)
            val permissions = client.permissionController.getGrantedPermissions()
            if (stepsPermission !in permissions) { prefs.stepStatus = "未获得读取步数权限，请在采集设置授权"; return }
            if (!foreground && (!prefs.background || !supportsBackground(context) || BACKGROUND_PERMISSION !in permissions)) return
            val zone = ZoneId.of("Asia/Shanghai")
            val today = LocalDate.now(zone)
            val observed = Instant.now()
            var days = 0
            CaptureStore(context).use { store ->
                for (offset in 6 downTo 0) {
                    if (!prefs.steps || prefs.paused || prefs.owner != owner) return
                    val date = today.minusDays(offset.toLong())
                    val start = date.atStartOfDay(zone).toInstant()
                    val end = minOf(date.plusDays(1).atStartOfDay(zone).toInstant(), observed)
                    if (!start.isBefore(end)) continue
                    val result = client.aggregate(AggregateRequest(setOf(StepsRecord.COUNT_TOTAL), TimeRangeFilter.between(start, end)))
                    val total = result[StepsRecord.COUNT_TOTAL] ?: continue // No data is not zero.
                    val record = JSONObject().put("date", date.toString()).put("steps", total).put("observedAt", observed.toString())
                    val payload = JSONObject().put("deviceId", prefs.deviceId).put("source", "health-connect").put("records", JSONArray().put(record))
                    store.enqueue(owner, "steps", date.toString(), payload)
                    days++
                }
            }
            prefs.stepStatus = if (days == 0) "最近7天没有可读取步数，未上传0；请确认运动应用已写入 Health Connect" else "已读取最近7天中 $days 天步数（北京时间），等待/完成上传"
        } catch (e: SecurityException) { prefs.stepStatus = "步数权限已关闭；请重新授权。系统不支持后台读取时，请打开App同步" }
        catch (e: CancellationException) { throw e }
        catch (_: Exception) { prefs.stepStatus = "读取步数失败，请打开 Health Connect 检查数据与权限后手动同步" }
    }
    internal fun schedule(context: Context) {
        val scheduler = context.getSystemService(JobScheduler::class.java)
        if (scheduler.getPendingJob(PERIODIC_JOB) == null) scheduler.schedule(JobInfo.Builder(PERIODIC_JOB, ComponentName(context, CaptureJobService::class.java))
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPersisted(true).setPeriodic(60 * 60 * 1000L).build())
    }
    internal fun retry(context: Context) {
        val scheduler = context.getSystemService(JobScheduler::class.java)
        if (scheduler.getPendingJob(RETRY_JOB) == null) scheduler.schedule(JobInfo.Builder(RETRY_JOB, ComponentName(context, CaptureJobService::class.java))
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setMinimumLatency(30000).setPersisted(true).setBackoffCriteria(30000, JobInfo.BACKOFF_POLICY_EXPONENTIAL).build())
    }
}

class CaptureJobService : JobService() {
    private var task: Job? = null
    override fun onStartJob(params: JobParameters): Boolean {
        task = CoroutineScope(Dispatchers.IO).launch {
            try { CaptureCoordinator.sync(applicationContext, false) }
            finally { jobFinished(params, false) }
        }
        return true
    }
    override fun onStopJob(params: JobParameters): Boolean { task?.cancel(); return true }
}
