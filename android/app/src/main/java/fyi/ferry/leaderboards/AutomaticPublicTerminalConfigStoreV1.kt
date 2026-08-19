package fyi.ferry.leaderboards

import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.io.File

private const val AUTOMATIC_PUBLIC_CONFIG_FILE_LIMIT_V1 = 65_536L

// define the native contract
internal class AutomaticPublicTerminalConfigStoreV1(
    directory: File,
    private val maxOwnedRegionCount: Int,
    private val fileOps: AutomaticAtomicFileOpsV1 = AutomaticNoBackupAtomicFileOpsV1,
) {
    private val configDirectory = File(directory, "public-terminal-configs-v1")

    // persist one validated public generation without removing crash fallback generations
    @Synchronized
    fun replace(config: AutomaticTerminalConfigGeneration): Boolean {
        // reject unsafe config before file creation
        if (!AutomaticTerminalConfigValidatorV1.isValid(config, maxOwnedRegionCount)) {
            return false
        }
        val bytes = ByteArrayOutputStream()
        // run the bounded callback
        DataOutputStream(bytes).use { output ->
            output.writeInt(1)
            output.writeInt(config.schemaVersion)
            output.writeLong(config.configGeneration.value)
            output.writeLong(config.serverPolicyGeneration.value)
            output.writeUTF(config.contentHashHex)
            output.writeInt(config.regions.size)
            // persist every exact immutable public region
            for (region in config.regions) {
                output.writeUTF(region.terminalId)
                output.writeInt(region.latitudeE7)
                output.writeInt(region.longitudeE7)
                output.writeLong(region.radiusMillimeters)
                output.writeLong(region.configGeneration.value)
            }
            output.flush()
        }
        return fileOps.replace(file(config.configGeneration), bytes.toByteArray())
    }

    // restore only the requested validated public generation
    @Synchronized
    fun read(generation: ConfigGeneration): AutomaticTerminalConfigGeneration? {
        // reject unsafe file identities
        if (generation.value !in 1..9_007_199_254_740_991L) {
            return null
        }
        val source = file(generation)
        // reject absent or oversized public state
        if (!source.isFile || source.length() !in 1..AUTOMATIC_PUBLIC_CONFIG_FILE_LIMIT_V1) {
            return null
        }
        return try {
            // run the bounded callback
            DataInputStream(ByteArrayInputStream(source.readBytes())).use { input ->
                // require the fixed storage schema
                if (input.readInt() != 1) {
                    return null
                }
                val schemaVersion = input.readInt()
                val configGeneration = ConfigGeneration(input.readLong())
                val policyGeneration = ServerPolicyGeneration(input.readLong())
                val contentHash = input.readUTF()
                val regionCount = input.readInt()
                // bound allocation before reading regions
                if (regionCount !in 1..maxOwnedRegionCount) {
                    return null
                }
                val regions = ArrayList<AutomaticTerminalRegion>(regionCount)
                // restore every exact immutable public region
                for (index in 0 until regionCount) {
                    regions += AutomaticTerminalRegion(
                        terminalId = input.readUTF(),
                        latitudeE7 = input.readInt(),
                        longitudeE7 = input.readInt(),
                        radiusMillimeters = input.readLong(),
                        configGeneration = ConfigGeneration(input.readLong()),
                    )
                }
                val config = AutomaticTerminalConfigGeneration(
                    schemaVersion = schemaVersion,
                    configGeneration = configGeneration,
                    serverPolicyGeneration = policyGeneration,
                    contentHashHex = contentHash,
                    regions = regions,
                )
                // reject substitution trailing bytes or invalid content
                if (
                    config.configGeneration != generation ||
                    input.available() != 0 ||
                    !AutomaticTerminalConfigValidatorV1.isValid(config, maxOwnedRegionCount)
                ) {
                    return null
                }
                config
            }
        // fail closed on the error
        } catch (_: Exception) {
            null
        }
    }

    // retain only the committed aggregate generation after activation
    @Synchronized
    fun retainOnly(generation: ConfigGeneration): Boolean {
        var complete = true
        val retained = file(generation).name
        // delete only owned public config files
        for (candidate in configDirectory.listFiles().orEmpty()) {
            // branch on the current state
            if (candidate.name.matches(Regex("terminal-config-[0-9]+\\.bin")) && candidate.name != retained) {
                complete = fileOps.delete(candidate) && complete
            }
        }
        return complete
    }

    // remove all owned public config generations on logical invalidation
    @Synchronized
    fun clear(): Boolean {
        var complete = true
        // delete only owned public config files
        for (candidate in configDirectory.listFiles().orEmpty()) {
            // branch on the current state
            if (candidate.name.matches(Regex("terminal-config-[0-9]+\\.bin"))) {
                complete = fileOps.delete(candidate) && complete
            }
        }
        return complete
    }

    // bind one safe generation to its fixed file name
    private fun file(generation: ConfigGeneration): File =
        File(configDirectory, "terminal-config-${generation.value}.bin")
}
