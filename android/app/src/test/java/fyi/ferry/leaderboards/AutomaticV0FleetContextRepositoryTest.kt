package fyi.ferry.leaderboards

import java.io.File
import java.nio.file.Files
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

// define the native contract
class AutomaticV0FleetContextRepositoryTest {
    // define the native contract
    private class MemoryCache(var entry: AutomaticV0FleetCacheEntry? = null) : AutomaticV0FleetCacheStore {
        var replaceCount = 0
        var deleteCount = 0

        // read memory state
        override fun read(): AutomaticV0FleetCacheEntry? = entry

        // replace memory state
        override fun replace(entry: AutomaticV0FleetCacheEntry): Boolean {
            replaceCount += 1
            this.entry = entry
            return true
        }

        // delete memory state
        override fun delete() {
            deleteCount += 1
            entry = null
        }
    }

    // define the native contract
    private class FakeTransport(var responseBytes: ByteArray? = AutomaticV0TestFixtures.envelope()) : AutomaticV0HttpTransport {
        val urls = mutableListOf<String>()

        // return one fixed response
        override fun get(url: String): AutomaticV0HttpResponse? {
            urls += url
            val bytes = responseBytes ?: return null
            return AutomaticV0HttpResponse(200, url, url, false, bytes)
        }
    }

    // parse one cache entry
    private fun entry(sourceSeconds: Long, receivedAtMs: Long): AutomaticV0FleetCacheEntry {
        val body = AutomaticV0FleetEnvelopeParser.parse(
            AutomaticV0TestFixtures.envelope(body = AutomaticV0TestFixtures.body(sourceSeconds)),
        )!!
        return AutomaticV0FleetCacheEntry(
            body = body,
            bodyHashHex = AutomaticPayloadDigestV1.sha256Hex(body.canonicalBytes),
            receivedAtMs = receivedAtMs,
        )
    }

    // prove exact source and receive max-age boundaries
    @Test
    fun freshnessEqualityPassesAndPlusOneFails() {
        val nowMs = 1_720_000_120_000L
        val boundary = entry(1_720_000_000L, nowMs - 120_000L)
        assertTrue(AutomaticV0FleetFreshness.isFresh(boundary, nowMs))
        assertFalse(
            AutomaticV0FleetFreshness.isFresh(
                boundary.copy(body = boundary.body.copy(sourceUpdatedAtMs = nowMs - 120_001L)),
                nowMs,
            ),
        )
        assertFalse(AutomaticV0FleetFreshness.isFresh(boundary.copy(receivedAtMs = nowMs - 120_001L), nowMs))
        assertFalse(
            AutomaticV0FleetFreshness.isFresh(
                boundary.copy(body = boundary.body.copy(sourceUpdatedAtMs = nowMs + 1L)),
                nowMs,
            ),
        )
        assertFalse(AutomaticV0FleetFreshness.isFresh(boundary.copy(receivedAtMs = nowMs + 1L), nowMs))
        assertFalse(
            AutomaticV0FleetFreshness.isFresh(
                boundary.copy(body = boundary.body.copy(sourceUpdatedAtMs = Long.MIN_VALUE)),
                Long.MAX_VALUE,
            ),
        )
    }

    // reuse receive age below fifty-five seconds
    @Test
    fun freshReceiveCachePerformsNoGet() {
        val nowMs = 1_720_000_010_000L
        val cache = MemoryCache(entry(1_720_000_000L, nowMs - 54_999L))
        val transport = FakeTransport()
        val repository = AutomaticV0FleetContextRepository(
            cache,
            AutomaticV0FleetClient("https://ferry.fyi", transport),
            // run the bounded callback
            responseReceiptNowMs = { nowMs },
        )

        assertNotNull(repository.contextForCallback(nowMs))
        assertEquals(0, repository.snapshotGetCount)
        assertEquals(emptyList<String>(), transport.urls)
    }

    // fetch exactly at fifty-five seconds
    @Test
    fun refreshBoundaryPerformsExactlyOneNamedGet() {
        val nowMs = 1_720_000_010_000L
        val cache = MemoryCache(entry(1_720_000_000L, nowMs - 55_000L))
        val transport = FakeTransport(AutomaticV0TestFixtures.envelope(body = AutomaticV0TestFixtures.body(1_720_000_010L)))
        val repository = AutomaticV0FleetContextRepository(
            cache,
            AutomaticV0FleetClient("https://ferry.fyi", transport),
            // run the bounded callback
            responseReceiptNowMs = { nowMs },
        )

        assertNotNull(repository.contextForCallback(nowMs))
        assertEquals(1, repository.snapshotGetCount)
        assertEquals(listOf("https://ferry.fyi/api/vessels/snapshot"), transport.urls)
        assertEquals(1, cache.replaceCount)
    }

    // prefetch uses the same exact refresh boundary
    @Test
    fun prefetchReusesBelowBoundaryAndFetchesAtEquality() {
        val nowMs = 1_720_000_010_000L
        val freshTransport = FakeTransport()
        val freshRepository = AutomaticV0FleetContextRepository(
            MemoryCache(entry(1_720_000_000L, nowMs - 54_999L)),
            AutomaticV0FleetClient("https://ferry.fyi", freshTransport),
            // run the bounded callback
            responseReceiptNowMs = { nowMs },
        )
        val dueTransport = FakeTransport(
            AutomaticV0TestFixtures.envelope(body = AutomaticV0TestFixtures.body(1_720_000_010L)),
        )
        val dueRepository = AutomaticV0FleetContextRepository(
            MemoryCache(entry(1_720_000_000L, nowMs - 55_000L)),
            AutomaticV0FleetClient("https://ferry.fyi", dueTransport),
            // run the bounded callback
            responseReceiptNowMs = { nowMs },
        )

        assertTrue(freshRepository.prefetchIfDue(nowMs))
        assertEquals(0, freshRepository.snapshotGetCount)
        assertEquals(0, freshTransport.urls.size)
        assertTrue(dueRepository.prefetchIfDue(nowMs))
        assertEquals(1, dueRepository.snapshotGetCount)
        assertEquals(listOf("https://ferry.fyi/api/vessels/snapshot"), dueTransport.urls)
    }

    // stop after one failed named get
    @Test
    fun networkAndWrapperFailuresDoNotRetryOrCache() {
        val invalidBodies = listOf<ByteArray?>(null, AutomaticV0TestFixtures.body().toByteArray(), "{}".toByteArray())
        // run every failure independently
        for (invalidBody in invalidBodies) {
            val cache = MemoryCache()
            val transport = FakeTransport(invalidBody)
            val repository = AutomaticV0FleetContextRepository(
                cache,
                AutomaticV0FleetClient("https://ferry.fyi", transport),
                // run the bounded callback
                responseReceiptNowMs = { 1_720_000_010_000L },
            )

            assertNull(repository.contextForCallback(1_720_000_010_000L))
            assertEquals(1, repository.snapshotGetCount)
            assertEquals(1, transport.urls.size)
            assertEquals(0, cache.replaceCount)
        }
    }

    // stamp and classify with fresh post-response trusted time
    @Test
    fun fetchedContextUsesPostResponseReceiptTime() {
        val preFetchNowMs = 1_720_000_119_000L
        val postResponseNowMs = 1_720_000_120_000L
        val cache = MemoryCache()
        val transport = FakeTransport(
            AutomaticV0TestFixtures.envelope(body = AutomaticV0TestFixtures.body(1_720_000_000L)),
        )
        val repository = AutomaticV0FleetContextRepository(
            cache,
            AutomaticV0FleetClient("https://ferry.fyi", transport),
            // run the bounded callback
            responseReceiptNowMs = { postResponseNowMs },
        )

        assertNotNull(repository.contextForCallback(preFetchNowMs))
        assertEquals(postResponseNowMs, cache.entry?.receivedAtMs)
        assertTrue(AutomaticV0FleetFreshness.isFresh(cache.entry!!, postResponseNowMs))
        assertEquals(1, repository.snapshotGetCount)
    }

    // reject a source that expires during the blocking request
    @Test
    fun postResponseClassificationRejectsPreFetchOnlyFreshSource() {
        val preFetchNowMs = 1_720_000_120_000L
        val postResponseNowMs = preFetchNowMs + 1L
        val cache = MemoryCache()
        val transport = FakeTransport(
            AutomaticV0TestFixtures.envelope(body = AutomaticV0TestFixtures.body(1_720_000_000L)),
        )
        val repository = AutomaticV0FleetContextRepository(
            cache,
            AutomaticV0FleetClient("https://ferry.fyi", transport),
            // run the bounded callback
            responseReceiptNowMs = { postResponseNowMs },
        )

        assertNull(repository.contextForCallback(preFetchNowMs))
        assertEquals(0, cache.replaceCount)
        assertEquals(1, repository.snapshotGetCount)
        assertEquals(1, transport.urls.size)
    }

    // reject redirects substitutions and wrong origins
    @Test
    fun endpointAllowsOnlyExactHttpsSnapshot() {
        val redirectTransport = object : AutomaticV0HttpTransport {
            // simulate one redirected response
            override fun get(url: String): AutomaticV0HttpResponse = AutomaticV0HttpResponse(
                statusCode = 302,
                requestedUrl = url,
                resolvedUrl = "https://other.test/api/vessels/snapshot",
                wasRedirected = true,
                bodyBytes = AutomaticV0TestFixtures.envelope(),
            )
        }
        assertNull(AutomaticV0FleetClient("http://ferry.fyi", FakeTransport()).fetch())
        assertNull(AutomaticV0FleetClient("https://ferry.fyi/path", FakeTransport()).fetch())
        assertNull(AutomaticV0FleetClient("https://ferry.fyi", redirectTransport).fetch())
    }

    // persist only authenticated canonical body data
    @Test
    fun noBackupCachePersistsBodyHashAndFailsClosedOnValidJsonMutation() {
        val directory = Files.createTempDirectory("automatic-v0-cache").toFile()
        // attempt the protected operation
        try {
            val store = AutomaticV0NoBackupFleetCacheStore(directory)
            val original = entry(1_720_000_000L, 1_720_000_001_000L)
            assertTrue(store.replace(original))
            val file = File(directory, "leaderboard-v0-fleet-context.bin")
            val stored = file.readBytes()
            val storedText = stored.toString(Charsets.ISO_8859_1)
            assertFalse(storedText.contains("wsfStatus"))
            assertFalse(storedText.contains("offline"))
            assertFalse(storedText.contains("bearer"))
            assertFalse(storedText.contains("latitudeE7"))
            assertNotNull(store.read())

            val needle = "Tacoma".toByteArray()
            val replacement = "Tacomb".toByteArray()
            val index = stored.indexOfSubsequence(needle)
            assertTrue(index >= 0)
            replacement.copyInto(stored, destinationOffset = index)
            file.writeBytes(stored)

            assertNull(store.read())
            assertFalse(file.exists())
        // release protected state
        } finally {
            directory.deleteRecursively()
        }
    }

    // find a byte subsequence
    private fun ByteArray.indexOfSubsequence(needle: ByteArray): Int {
        // inspect every possible start
        for (start in 0..size - needle.size) {
            // return the first exact match
            if (needle.indices.all { index -> this[start + index] == needle[index] }) {
                return start
            }
        }
        return -1
    }
}
