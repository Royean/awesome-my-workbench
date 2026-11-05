package dev.awesome.myworkbench

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Before
import org.junit.After
import org.junit.Test
import org.junit.runner.RunWith

/** Run only on a disposable emulator: clears the test app's local capture preferences/DB. No network. */
@RunWith(AndroidJUnit4::class)
class CaptureIsolationTest {
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    @Before fun clean() { context.deleteDatabase("phone-capture.db"); context.getSharedPreferences("phone-capture", 0).edit().clear().commit() }
    @After fun cleanup() = clean()
    @Test fun privateQueueSurvivesReopenButNeverCrossesOwners() {
        CaptureStore(context).use { store ->
            store.enqueue("fictional-a", "notification", "e1", JSONObject().put("text", "虚构付款1.23元"))
            store.enqueue("fictional-a", "notification", "e1", JSONObject())
        }
        CaptureStore(context).use { store ->
            assertEquals(1, store.count("fictional-a"))
            assertTrue(store.next("fictional-b", true, true).isEmpty())
            assertTrue(store.next("fictional-a", false, true).isEmpty())
            assertEquals(1, store.next("fictional-a", true, false).size)
            store.failed(store.next("fictional-a", true, false).first().id)
            assertTrue(store.next("fictional-a", true, false).isEmpty())
            assertEquals(1, store.count("fictional-a", true))
            store.clear("fictional-b"); assertEquals(1, store.count("fictional-a", true))
        }
    }
    @Test fun dailyStepSnapshotUpdatesAndKeepsAnExplicitZero() {
        CaptureStore(context).use { store ->
            fun payload(steps: Int) = JSONObject().put("records", JSONArray().put(JSONObject().put("date", "2026-01-01").put("steps", steps)))
            store.enqueue("fictional-a", "steps", "2026-01-01", payload(200))
            store.enqueue("fictional-a", "steps", "2026-01-01", payload(0))
            val rows = store.next("fictional-a", false, true)
            assertEquals(1, rows.size)
            assertEquals(0, JSONObject(rows.first().payload).getJSONArray("records").getJSONObject(0).getInt("steps"))
        }
    }
    @Test fun accountChangeResetsConsentAndPausesArePersistent() {
        val prefs = CapturePrefs(context)
        assertTrue(prefs.paused); assertFalse(prefs.notifications); assertFalse(prefs.steps); assertTrue(prefs.selected.isEmpty()); assertTrue(prefs.healthKinds.isEmpty()); assertFalse(prefs.distance); assertEquals("", prefs.exerciseSource); assertTrue(prefs.exerciseSources.isEmpty()); assertFalse(prefs.exerciseSourceExplicit)
        prefs.bind("fictional-a", "虚构A"); prefs.notifications = true; prefs.steps = true; prefs.healthKinds = setOf("weight", "sleep"); prefs.distance = true; prefs.exerciseSource = "fictional.source"; prefs.exerciseSources = setOf("fictional.source"); prefs.exerciseSourceExplicit = true; prefs.selected = setOf("cmb.pb")
        prefs.pause("账号变化")
        assertTrue(CapturePrefs(context).paused)
        prefs.bind("fictional-b", "虚构B")
        assertFalse(prefs.notifications); assertFalse(prefs.steps); assertTrue(prefs.selected.isEmpty()); assertTrue(prefs.healthKinds.isEmpty()); assertFalse(prefs.distance); assertEquals("", prefs.exerciseSource); assertTrue(prefs.exerciseSources.isEmpty()); assertFalse(prefs.exerciseSourceExplicit)
    }
    @Test fun sourceDisableAndRevokedPermissionsStopQueuedData() {
        val prefs = CapturePrefs(context); prefs.bind("fictional-a", "虚构A"); prefs.notifications = true
        val notification = JSONObject().put("packageName", "cmb.pb").toString()
        assertNull(CaptureUploadPolicy.prepare(prefs, "notification", notification, emptySet(), true))
        prefs.selected = setOf("cmb.pb")
        assertNotNull(CaptureUploadPolicy.prepare(prefs, "notification", notification, emptySet(), true))
        assertNull(CaptureUploadPolicy.prepare(prefs, "notification", notification, emptySet(), false))
        prefs.selected = emptySet()
        assertNull(CaptureUploadPolicy.prepare(prefs, "notification", notification, emptySet(), true))
        prefs.healthKinds = setOf("weight")
        assertNull(CaptureUploadPolicy.prepare(prefs, "weight", "{}", emptySet(), true))
        assertNotNull(CaptureUploadPolicy.prepare(prefs, "weight", "{}", setOf(CaptureHealthReader.permissions.getValue("weight")), true))
        prefs.healthKinds = emptySet()
        assertNull(CaptureUploadPolicy.prepare(prefs, "weight", "{}", setOf(CaptureHealthReader.permissions.getValue("weight")), true))
    }
    @Test fun disablingDistanceRemovesAlreadyQueuedDistance() {
        val prefs = CapturePrefs(context); prefs.bind("fictional-a", "虚构A"); prefs.healthKinds = setOf("exercise")
        prefs.exerciseSource = "fictional.source"
        val raw = JSONObject().put("records", JSONArray().put(JSONObject().put("sourcePackage", "fictional.source").put("distanceKm", 3.14))).toString()
        val exercisePermission = CaptureHealthReader.permissions.getValue("exercise")
        fun hasDistance(granted: Set<String>): Boolean = JSONObject(CaptureUploadPolicy.prepare(prefs, "exercise", raw, granted, true)!!)
            .getJSONArray("records").getJSONObject(0).has("distanceKm")
        assertFalse(hasDistance(setOf(exercisePermission, CaptureHealthReader.distancePermission)))
        prefs.distance = true
        assertTrue(hasDistance(setOf(exercisePermission, CaptureHealthReader.distancePermission)))
        assertFalse(hasDistance(setOf(exercisePermission)))
    }

    @Test fun overlappingSleepWindowsMergeBeforeEndDateGrouping() {
        fun instant(value: String) = java.time.Instant.parse(value)
        val windows = listOf(
            instant("2026-01-01T14:00:00Z") to instant("2026-01-01T15:59:00Z"),
            instant("2026-01-01T14:05:00Z") to instant("2026-01-01T16:05:00Z"),
            instant("2026-01-02T05:00:00Z") to instant("2026-01-02T06:00:00Z")
        )
        val merged = CaptureHealthReader.merge(windows)
        assertEquals(2, merged.size)
        assertEquals(instant("2026-01-01T14:00:00Z"), merged.first().first)
        assertEquals(instant("2026-01-01T16:05:00Z"), merged.first().second)
        assertEquals("2026-01-02", merged.first().second.atZone(java.time.ZoneId.of("Asia/Shanghai")).toLocalDate().toString())
    }

    @Test fun queuedExerciseOnlyUploadsFromCurrentSelectedSource() {
        val prefs = CapturePrefs(context); prefs.bind("fictional-a", "虚构A"); prefs.healthKinds = setOf("exercise")
        val raw = JSONObject().put("records", JSONArray().put(JSONObject().put("sourcePackage", "fictional.source.a"))).toString()
        val granted = setOf(CaptureHealthReader.permissions.getValue("exercise"))
        assertNull(CaptureUploadPolicy.prepare(prefs, "exercise", raw, granted, true))
        prefs.exerciseSource = "fictional.source.b"
        assertNull(CaptureUploadPolicy.prepare(prefs, "exercise", raw, granted, true))
        prefs.exerciseSource = "fictional.source.a"
        assertNotNull(CaptureUploadPolicy.prepare(prefs, "exercise", raw, granted, true))
    }

    @Test fun switchingExerciseSourceStopsHistoricalBackfillAndOldQueue() {
        val prefs = CapturePrefs(context); prefs.bind("fictional-a", "虚构A"); prefs.healthKinds = setOf("exercise")
        prefs.selectExerciseSource("fictional.source.a", false)
        assertEquals("", prefs.exerciseOriginSince)
        prefs.exerciseSource = "" // Multiple sources discovered after automatic single-source initialization.
        prefs.selectExerciseSource("fictional.source.b", true)
        assertTrue(prefs.exerciseOriginSince.isNotBlank())
        val since = java.time.Instant.parse(prefs.exerciseOriginSince)
        val granted = setOf(CaptureHealthReader.permissions.getValue("exercise"))
        fun payload(start: java.time.Instant) = JSONObject().put("records", JSONArray().put(JSONObject().put("sourcePackage", "fictional.source.b").put("startAt", start.toString()))).toString()
        assertNull(CaptureUploadPolicy.prepare(prefs, "exercise", payload(since.minusSeconds(60)), granted, true))
        assertNotNull(CaptureUploadPolicy.prepare(prefs, "exercise", payload(since), granted, true))
        prefs.bind("fictional-b", "虚构B")
        assertEquals("", prefs.exerciseOriginSince)
    }

    @Test fun undeployedEndpointRetainsQueueAndLaterSuccessRemovesIt() {
        CaptureStore(context).use { store ->
            store.enqueue("fictional-a", "notification", "rollout", JSONObject().put("text", "虚构付款1.23元"))
            val id = store.next("fictional-a", true, false).single().id
            assertEquals(CaptureResponsePolicy.Outcome.RETRY, CaptureResponsePolicy.apply(store, id, 404))
            assertEquals(1, store.count("fictional-a")); assertEquals(0, store.count("fictional-a", true))
            assertEquals(id, store.next("fictional-a", true, false).single().id)
            assertEquals(CaptureResponsePolicy.Outcome.UPLOADED, CaptureResponsePolicy.apply(store, id, 200))
            assertEquals(0, store.count("fictional-a")); assertTrue(store.next("fictional-a", true, false).isEmpty())
            for (status in listOf(400, 403, 413, 422)) {
                assertEquals(CaptureResponsePolicy.Outcome.REJECTED, CaptureResponsePolicy.classify(status))
            }
        }
    }

    @Test fun returningOwnerKeepsSourceHistoryWithoutRestoringConsent() {
        val prefs = CapturePrefs(context)
        prefs.bind("fictional-a", "虚构A"); prefs.selectExerciseSource("fictional.source.x", false)
        prefs.healthKinds = setOf("exercise"); prefs.notifications = true
        prefs.bind("fictional-b", "虚构B")
        assertEquals("", prefs.exerciseSource); assertTrue(prefs.healthKinds.isEmpty()); assertFalse(prefs.notifications)
        prefs.selectExerciseSource("fictional.source.z", true)
        assertEquals("", prefs.exerciseOriginSince)
        prefs.bind("fictional-a", "虚构A")
        assertEquals("", prefs.exerciseSource); assertTrue(prefs.healthKinds.isEmpty()); assertFalse(prefs.notifications)
        assertTrue(prefs.willSwitchExerciseSource("fictional.source.y"))
        assertFalse(prefs.willSwitchExerciseSource("fictional.source.x"))
        prefs.selectExerciseSource("fictional.source.y", true)
        assertTrue(prefs.exerciseOriginSince.isNotBlank())
        val cutoff = prefs.exerciseOriginSince
        prefs.bind("fictional-b", "虚构B")
        assertFalse(prefs.willSwitchExerciseSource("fictional.source.z"))
        prefs.bind("fictional-a", "虚构A")
        assertEquals(cutoff, prefs.exerciseOriginSince)
        assertEquals("", prefs.exerciseSource); assertTrue(prefs.healthKinds.isEmpty())
    }

}
