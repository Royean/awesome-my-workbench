package dev.awesome.myworkbench

import android.app.Activity
import android.app.AlertDialog
import android.content.ComponentName
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.provider.Settings
import android.view.View
import android.view.WindowInsets
import android.widget.*
import androidx.activity.ComponentActivity
import androidx.health.connect.client.HealthConnectClient
import androidx.health.connect.client.PermissionController
import kotlinx.coroutines.*

class CaptureSettingsActivity : ComponentActivity() {
    private val scope = MainScope()
    private val handler = Handler(Looper.getMainLooper())
    private lateinit var prefs: CapturePrefs
    private lateinit var page: LinearLayout
    private lateinit var scroll: ScrollView
    private lateinit var status: TextView
    private var busy = false
    private var manualSync: Job? = null
    private val syncing get() = manualSync != null
    private val launcher = registerForActivityResult(PermissionController.createRequestPermissionResultContract()) {
        scope.launch {
            if (it.isEmpty()) prefs.error = "没有获得所请求的权限；未授权的数据源不会读取"
            refresh(); CaptureCoordinator.kick(applicationContext, true)
        }
    }
    private val refreshStatus = object : Runnable {
        override fun run() { if (::status.isInitialized) updateStatus(); handler.postDelayed(this, 2000) }
    }
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = CapturePrefs(this)
        refresh()
    }
    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
    private fun text(value: String, size: Float = 15f): TextView = TextView(this).apply {
        text = value; textSize = size; setTextColor(Color.rgb(35, 56, 47)); setPadding(0, dp(8), 0, dp(8))
    }
    private fun button(label: String, enabled: Boolean = true, action: () -> Unit) {
        page.addView(Button(this).apply { text = label; isEnabled = enabled && !busy; setOnClickListener { action() } }, LinearLayout.LayoutParams(-1, -2))
    }
    private fun toggle(label: String, value: Boolean, enabled: Boolean = true, action: (Boolean) -> Unit) {
        page.addView(Switch(this).apply {
            text = label; textSize = 16f; isChecked = value; isEnabled = enabled && !busy
            setPadding(0, dp(14), 0, dp(14)); setOnCheckedChangeListener { _, checked -> action(checked) }
        }, LinearLayout.LayoutParams(-1, -2))
    }
    private fun refresh(preserveScroll: Boolean = false) {
        val scrollY = if (preserveScroll && ::scroll.isInitialized) scroll.scrollY else 0
        val scroll = ScrollView(this)
        this.scroll = scroll
        page = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(22), dp(16), dp(22), dp(32)); setBackgroundColor(Color.rgb(245, 246, 244)) }
        scroll.addView(page); setContentView(scroll)
        if (scrollY > 0) scroll.post { scroll.scrollTo(0, scrollY) }
        scroll.setOnApplyWindowInsetsListener { view, insets ->
            if (Build.VERSION.SDK_INT >= 30) {
                val bars = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
                view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            } else view.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop, insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
            insets
        }
        page.addView(text("手机采集", 26f))
        page.addView(text("交易通知只进入资产工作台待核对，经你确认才生成流水。健康数据同步到当前账号的个人健康空间。所有采集默认关闭。"))
        status = text(""); page.addView(status); updateStatus()
        button(if (prefs.owner.isBlank()) "绑定当前登录账号" else "重新绑定当前登录账号 / 恢复", enabled = !syncing) {
            busy = true; refresh()
            scope.launch {
                try { CaptureCoordinator.bind(applicationContext) }
                catch (_: Exception) { prefs.pause("无法绑定，请先返回工作台登录，并检查网络") }
                finally { busy = false; refresh() }
            }
        }
        toggle("暂停全部采集与上传", prefs.paused, prefs.owner.isNotBlank()) { paused ->
            // Resume always revalidates identity; never clear an auth pause with a local toggle.
            if (paused) {
                prefs.paused = true
                manualSync?.cancel()
                manualSync = null
                refresh(preserveScroll = true)
            } else {
                prefs.paused = true
                Toast.makeText(this, "请点击重新绑定，核对当前登录账号后恢复", Toast.LENGTH_LONG).show()
                refresh()
            }
        }
        page.addView(text("交易通知", 21f))
        page.addView(text("Android 通知使用权由系统授予，可能允许本App看到全部通知。本App只保存你勾选应用中的交易提示；聊天、验证码、营销内容会先在本机丢弃。微信只接受固定支付/收款模板，部分手机的交易通知可能无法采集。Android 13+ 侧载安装后若开关受限，请在系统“应用信息”菜单查看“允许受限设置”，再由你决定是否开启。"))
        toggle("采集新交易通知", prefs.notifications, prefs.owner.isNotBlank() && !prefs.paused) {
            prefs.notifications = it; refresh(); if (it) CaptureCoordinator.kick(applicationContext, false)
        }
        button(if (notificationGranted()) "通知使用权已开启 · 管理权限" else "开启系统通知使用权") {
            safeStart(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
        }
        page.addView(text("选择应用（默认均不采集）"))
        CaptureFilter.apps.forEach { (packageName, name) ->
            page.addView(CheckBox(this).apply {
                text = name; textSize = 16f; isChecked = packageName in prefs.selected
                isEnabled = prefs.owner.isNotBlank() && !prefs.paused && !busy
                setOnCheckedChangeListener { _, selected -> prefs.selected = if (selected) prefs.selected + packageName else prefs.selected - packageName }
            }, LinearLayout.LayoutParams(-1, -2))
        }
        page.addView(text("Health Connect 步数", 21f))
        page.addView(text(when (CaptureCoordinator.healthStatus(this)) {
            HealthConnectClient.SDK_AVAILABLE -> "Health Connect 可用。按其聚合结果读取，不累加不同来源；同步今天及过去6天，日期固定为北京时间。没有记录不会写成0步，有明确0步记录时会同步0。"
            HealthConnectClient.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED -> "请安装或更新 Health Connect。Android 9–13 使用独立App，Android 14+ 使用系统模块。"
            else -> "此设备暂不支持 Health Connect。需要 Android 9+ 与可用的 Health Connect；工作资料或缺少系统支持时可能不可用。"
        }))
        toggle("同步 Health Connect 步数", prefs.steps, prefs.owner.isNotBlank() && !prefs.paused) {
            prefs.steps = it; refresh(); if (it) CaptureCoordinator.kick(applicationContext, true)
        }
        button("授予步数读取权限") { grantDataPermission("steps") }
        button("打开 / 安装 Health Connect") { openHealthConnect() }
        page.addView(text("其他健康数据（全部可选）", 21f))
        page.addView(text("每项只申请对应读取权限，最近7天没有数据会跳过。体重/静息心率按日取最新测量；静息心率只认静息记录。睡眠按合并睡眠区间的结束日汇总，系统会剔除已标记的清醒阶段。运动保留记录类型与起止边界，时长采用同来源区间的系统运动时长聚合；没有有效聚合值时跳过，不用经过时间冒充运动时长。不读取运动路线。"))
        CaptureHealthReader.labels.forEach { (kind, label) ->
            toggle("同步$label", kind in prefs.healthKinds, prefs.owner.isNotBlank() && !prefs.paused) {
                prefs.healthKinds = if (it) prefs.healthKinds + kind else prefs.healthKinds - kind
                refresh(); if (it) CaptureCoordinator.kick(applicationContext, true)
            }
            button("授予${label}读取权限") { grantDataPermission(kind) }
        }
        button("选择 / 更换运动数据来源") { chooseExerciseSource() }
        toggle("为运动记录附加区间距离", prefs.distance, "exercise" in prefs.healthKinds && !prefs.paused) {
            prefs.distance = it; refresh(); if (it) requestDataPermissions(setOf(CaptureHealthReader.distancePermission))
        }
        page.addView(text("距离是运动来源在同一时间区间的聚合值，可能包含来源记录的其他活动。未授权或无距离数据时只同步时长，不填0。"))
        if (CaptureCoordinator.supportsBackground(this)) {
            toggle("允许系统后台读取健康数据", prefs.background, (prefs.steps || prefs.healthKinds.isNotEmpty()) && !prefs.paused) {
                prefs.background = it; refresh(); if (it) requestDataPermissions(setOf(CaptureCoordinator.BACKGROUND_PERMISSION))
            }
        }
        page.addView(text(if (CaptureCoordinator.supportsBackground(this)) "后台读取需要单独授权；系统会延迟任务，无法保证实时。未授权时，打开App或点下方按钮同步。" else "此设备未提供后台健康读取能力。健康数据在打开App或手动同步时读取；已入队数据联网后由系统重试。"))
        button(if (syncing) "正在同步，请稍候" else "立即读取健康数据并重试上传", enabled = !syncing) { syncNow() }
        button("查看交易通知待核对", enabled = !syncing) { openResults("finance", "transactions") }
        page.addView(text("同步后，可在健康监测查看体重、静息心率和睡眠时长。运动记录显示运动时长，距离在授权且来源有数据时一并显示。"))
        button("查看健康采集结果", enabled = !syncing) { openResults("health", "dashboard") }
        button("查看健康监测", enabled = !syncing) { openResults("health", "metric") }
        button("查看运动记录", enabled = !syncing) { openResults("health", "exercise") }
        button("清理当前绑定账号的本机队列") {
            AlertDialog.Builder(this).setTitle("清理本机待上传数据？").setMessage("仅清理当前绑定账号的本机待上传采集队列。清理后无法恢复，已上传的记录会保留。")
                .setNegativeButton("取消", null).setPositiveButton("清理") { _, _ ->
                    scope.launch(Dispatchers.IO) { CaptureStore(applicationContext).use { it.clear(prefs.owner) }; withContext(Dispatchers.Main) { updateStatus() } }
                }.show()
        }
        button("采集隐私说明") { startActivity(Intent(this, CapturePrivacyActivity::class.java)) }
        button("返回工作台") { scope.cancel(); finish() }
    }
    private fun syncNow() {
        if (busy || syncing) return
        if (prefs.owner.isBlank() || prefs.paused) {
            Toast.makeText(this, "请先绑定当前登录账号并恢复采集", Toast.LENGTH_SHORT).show()
            return
        }
        if (!prefs.notifications && !prefs.steps && prefs.healthKinds.isEmpty()) {
            Toast.makeText(this, "请先开启要采集的数据源", Toast.LENGTH_SHORT).show()
            return
        }
        val job = scope.launch(start = CoroutineStart.LAZY) {
            try {
                withContext(Dispatchers.IO) { CaptureCoordinator.sync(applicationContext, true) }
            } catch (e: CancellationException) {
                throw e
            } catch (_: Exception) {
                prefs.error = "暂时无法同步，请检查网络和系统权限后重试"
            } finally {
                if (manualSync === coroutineContext[Job]) {
                    manualSync = null
                    if (scope.isActive && !isFinishing && !isDestroyed) refresh(preserveScroll = true)
                }
            }
        }
        manualSync = job
        refresh(preserveScroll = true)
        job.start()
    }
    private fun openResults(workbench: String, fragment: String) {
        val url = Uri.parse("${CaptureCoordinator.ORIGIN}/").buildUpon()
            .appendQueryParameter("phoneCapture", workbench)
            .fragment(fragment)
        if (workbench == "health" && (fragment == "metric" || fragment == "exercise")) {
            url.appendQueryParameter("phoneCapturePage", fragment)
        }
        startActivity(Intent(this, MainActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
            .setData(url.build()))
        finish()
    }
    private fun notificationGranted(): Boolean = CaptureCoordinator.notificationGranted(this)
    private fun updateStatus() {
        val owner = prefs.owner
        val counts = try { CaptureStore(applicationContext).use { it.count(owner) to it.count(owner, true) } } catch (_: Exception) { 0 to 0 }
        status.text = "绑定账号：${if (owner.isBlank()) "尚未绑定，请先在工作台登录" else "${prefs.ownerName}\n$owner"}\n状态：${if (prefs.paused) "已暂停" else "已绑定，按下方开关采集"}\n通知使用权：${if (notificationGranted()) "已授权" else "未授权"}\n待上传：${counts.first} 条 · 已拒绝：${counts.second} 条\n最后上传：${prefs.lastSuccess}\n步数：${prefs.stepStatus}\n${prefs.healthStatus}\n运动来源：${if (prefs.exerciseSource.isBlank()) "尚未选定（多来源时先手动选择）" else sourceLabel(prefs.exerciseSource)}${if (prefs.exerciseOriginSince.isBlank()) "" else "\n运动切换后起点：${prefs.exerciseOriginSince}（仅同步此后新开始的运动）"}${if (prefs.error.isNotBlank()) "\n提示：${prefs.error}" else ""}"
    }
    private fun sourceLabel(packageName: String): String {
        val known = mapOf("com.sec.android.app.shealth" to "三星健康", "com.google.android.apps.fitness" to "Google Fit", "com.huawei.health" to "华为运动健康", "com.xiaomi.wearable" to "小米运动健康", "com.huami.watch.hmwatchmanager" to "Zepp", "com.vivo.health" to "vivo健康")
        val name = known[packageName] ?: try { packageManager.getApplicationLabel(packageManager.getApplicationInfo(packageName, 0)).toString() } catch (_: Exception) { "Health Connect 数据来源" }
        return "$name\n$packageName"
    }
    private fun chooseExerciseSource() {
        val sources = prefs.exerciseSources.sorted()
        if (sources.isEmpty()) { Toast.makeText(this, "请先开启运动、授权，再点立即同步以发现最近7天的数据来源", Toast.LENGTH_LONG).show(); return }
        AlertDialog.Builder(this).setTitle("单选运动来源")
            .setSingleChoiceItems(sources.map { sourceLabel(it) }.toTypedArray(), sources.indexOf(prefs.exerciseSource)) { dialog, index ->
                val selected = sources[index]
                fun applySelection() { prefs.selectExerciseSource(selected, true); updateStatus(); CaptureCoordinator.kick(applicationContext, true) }
                dialog.dismiss()
                if (prefs.willSwitchExerciseSource(selected)) {
                    AlertDialog.Builder(this).setTitle("更换运动来源？").setMessage("切换后仅同步新开始的运动，已同步历史保留。不会回补新来源过去7天的运动，原来源和切换前开始的本机队列暂停上传。首次选择来源可回补最近7天。")
                        .setNegativeButton("取消", null).setPositiveButton("选择此来源") { _, _ -> applySelection() }.show()
                } else applySelection()
            }.setNegativeButton("取消", null).show()
    }
    private fun grantDataPermission(kind: String) {
        if (prefs.paused || prefs.owner.isBlank() || (kind == "steps" && !prefs.steps) || (kind != "steps" && kind !in prefs.healthKinds)) {
            Toast.makeText(this, "先绑定账号并打开对应数据源开关", Toast.LENGTH_LONG).show(); return
        }
        requestDataPermissions(setOf(if (kind == "steps") CaptureCoordinator.stepsPermission else CaptureHealthReader.permissions.getValue(kind)))
    }
    private fun requestDataPermissions(permissions: Set<String>) {
        if (CaptureCoordinator.healthStatus(this) != HealthConnectClient.SDK_AVAILABLE) { openHealthConnect(); return }
        try { launcher.launch(permissions) } catch (_: Exception) { prefs.error = "无法打开权限页面，请更新 Health Connect 后重试"; updateStatus() }
    }
    private fun openHealthConnect() {
        if (CaptureCoordinator.healthStatus(this) == HealthConnectClient.SDK_AVAILABLE) {
            safeStart(if (Build.VERSION.SDK_INT >= 34) Intent("android.health.connect.action.HEALTH_HOME_SETTINGS") else Intent("androidx.health.ACTION_HEALTH_CONNECT_SETTINGS").setPackage("com.google.android.apps.healthdata"))
        } else safeStart(Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=com.google.android.apps.healthdata")))
    }
    private fun safeStart(intent: Intent) { try { startActivity(intent) } catch (_: Exception) { Toast.makeText(this, "没有可用的系统页面，请在系统设置中查找对应权限", Toast.LENGTH_LONG).show() } }
    override fun onResume() {
        super.onResume()
        if (::prefs.isInitialized) {
            refresh(preserveScroll = busy || syncing)
            if (!busy && !syncing) CaptureCoordinator.kick(applicationContext, true)
        }
        handler.post(refreshStatus)
    }
    override fun onPause() { handler.removeCallbacks(refreshStatus); super.onPause() }
    override fun onDestroy() { scope.cancel(); super.onDestroy() }
}

class CapturePrivacyActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val page = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(36, 72, 36, 48) }
        page.addView(TextView(this).apply { textSize = 18f; text = "采集隐私说明\n\n所有数据源默认关闭。你可以随时暂停，并在系统设置撤销权限。\n\n通知：只保存主动选择的金融应用交易提示。私人聊天、验证码、营销通知先在本机过滤；通知原文会传至你登录的 vivid-dream.online 个人资产空间供核对，不会自动记账或改余额。\n\n健康数据：只读取你单独开启并授权的 Health Connect 最近7天步数、睡眠时长、体重、静息心率和运动记录，运动距离另行可选。采用北京时间日期，不读取路线或其他指标，不写入 Health Connect。数据传至同账号个人健康空间，同日更新而非相加。无数据不会写为0。\n\n已过滤数据不会落盘。待上传队列保存在App私有目录，不启用备份；退出登录或账号变化暂停上传。可在采集设置清理绑定账号的本机队列；卸载会清理全部本地队列。服务器记录可在对应工作台管理。" })
        page.addView(Button(this).apply { text = "返回"; setOnClickListener { finish() } })
        setContentView(ScrollView(this).apply { addView(page) })
    }
}
