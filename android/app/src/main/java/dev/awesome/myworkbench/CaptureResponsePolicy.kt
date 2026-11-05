package dev.awesome.myworkbench

/** A rollout 404 is temporary: retain the queue until the fixed endpoint is deployed. */
internal object CaptureResponsePolicy {
    enum class Outcome { UPLOADED, REJECTED, RETRY }
    fun classify(status: Int): Outcome = when {
        status in 200..299 -> Outcome.UPLOADED
        status in setOf(400, 403, 413, 422) -> Outcome.REJECTED
        else -> Outcome.RETRY
    }
    fun apply(store: CaptureStore, id: Long, status: Int): Outcome = classify(status).also {
        when (it) {
            Outcome.UPLOADED -> store.remove(id)
            Outcome.REJECTED -> store.failed(id)
            Outcome.RETRY -> Unit
        }
    }
}
