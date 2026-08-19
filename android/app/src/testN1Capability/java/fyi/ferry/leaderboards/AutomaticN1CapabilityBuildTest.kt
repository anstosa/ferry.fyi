package fyi.ferry.leaderboards

import fyi.ferry.BuildConfig
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

// define the native contract
class AutomaticN1CapabilityBuildTest {
    // prove only n1 is enabled in the explicit capability build
    @Test
    fun capabilityBuildEnablesN1WithoutV0() {
        assertTrue(BuildConfig.AUTOMATIC_LEADERBOARD_N1_ENABLED)
        assertFalse(BuildConfig.AUTOMATIC_LEADERBOARD_V0_DIAGNOSTIC_ENABLED)
    }
}
