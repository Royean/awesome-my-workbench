package dev.awesome.myworkbench

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import kotlinx.coroutines.*
import org.json.JSONObject
import java.security.MessageDigest
import java.time.Instant

class TransactionNotificationListener : NotificationListenerService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    override fun onNotificationPosted(sbn: StatusBarNotification) {
        val prefs = CapturePrefs(this)
        if (prefs.paused || !prefs.notifications || prefs.owner.isBlank() || sbn.packageName !in prefs.selected) return
        val owner = prefs.owner
        val notification = sbn.notification
        if (notification.flags and Notification.FLAG_GROUP_SUMMARY != 0) return
        val title = notification.extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.trim() ?: ""
        val text = (notification.extras.getCharSequence(Notification.EXTRA_BIG_TEXT)
            ?: notification.extras.getCharSequence(Notification.EXTRA_TEXT))?.toString()?.trim() ?: ""
        val messaging = notification.category == Notification.CATEGORY_MESSAGE || notification.extras.containsKey("android.messages")
        if (!CaptureFilter.accepts(sbn.packageName, title, text, messaging)) return
        val eventId = MessageDigest.getInstance("SHA-256").digest("${prefs.deviceId}|${sbn.packageName}|${sbn.key}|${sbn.postTime}|$title|$text".toByteArray()).joinToString("") { "%02x".format(it) }
        val payload = JSONObject().put("deviceId", prefs.deviceId).put("eventId", eventId).put("packageName", sbn.packageName)
            .put("title", title).put("text", text).put("postedAt", Instant.ofEpochMilli(sbn.postTime).toString())
        scope.launch {
            if (prefs.owner != owner || prefs.paused || !prefs.notifications || sbn.packageName !in prefs.selected) return@launch
            try {
                CaptureStore(applicationContext).use { it.enqueue(owner, "notification", eventId, payload) }
                CaptureCoordinator.retry(applicationContext)
                CaptureCoordinator.kick(applicationContext, false)
            } catch (_: Exception) { prefs.error = "本机通知队列无法保存，请检查存储空间或清理队列" }
        }
    }
    override fun onListenerConnected() { CaptureCoordinator.kick(applicationContext, false) }
    override fun onDestroy() { scope.cancel(); super.onDestroy() }
}
