package fyi.ferry

import fyi.ferry.leaderboards.AutomaticCredentialV1
import fyi.ferry.leaderboards.AutomaticEndpointSource
import fyi.ferry.leaderboards.AutomaticNativeEndpointUrls
import fyi.ferry.leaderboards.AutomaticNativeEndpointValidator
import fyi.ferry.leaderboards.ServerPolicyGeneration
import fyi.ferry.leaderboards.canonicalAutomaticBearerTokenV1
import org.json.JSONObject

private const val AUTOMATIC_BRIDGE_COMPILED_ORIGIN_V1 = "https://ferry.fyi"
private const val AUTOMATIC_BRIDGE_MAX_SAFE_INTEGER_V1 = 9_007_199_254_740_991L

// define the native contract
internal object AutomaticBridgeEnrollmentCredentialParserV1 {
    private val exactKeys = setOf(
        "bearerToken",
        "enrollmentId",
        "expiresAtMs",
        "rotateAfterMs",
        "schemaVersion",
        "scopes",
        "serverPolicyGeneration",
        "urls",
    )
    private val exactUrlKeys = setOf("candidates", "config", "enrollment", "status")
    private val exactScopes = setOf(
        "automatic-checkins:candidates:write",
        "automatic-checkins:config:read",
        "automatic-checkins:enrollment:revoke",
        "automatic-checkins:status:read",
    )

    // parse one exact server enrollment credential
    fun parse(value: JSONObject): AutomaticCredentialV1? = parse(jsonObject(value))

    // parse one normalized exact server enrollment credential
    internal fun parse(value: Map<String, Any?>): AutomaticCredentialV1? {
        // reject missing extra or locally merged fields
        if (value.keys != exactKeys) {
            return null
        }
        val bearerToken = value["bearerToken"] as? String ?: return null
        val enrollmentId = value["enrollmentId"] as? String ?: return null
        val expiresAtMs = strictLong(value["expiresAtMs"]) ?: return null
        val rotateAfterMs = strictLong(value["rotateAfterMs"]) ?: return null
        val schemaVersion = strictLong(value["schemaVersion"]) ?: return null
        val serverPolicyGeneration = strictLong(value["serverPolicyGeneration"]) ?: return null
        val scopes = value["scopes"] as? List<*> ?: return null
        val rawUrls = value["urls"] as? Map<*, *> ?: return null
        // require fixed identity lifecycle and generation semantics
        if (
            !enrollmentId.matches(
                Regex("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89aAbB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}"),
            ) ||
            expiresAtMs !in 1..AUTOMATIC_BRIDGE_MAX_SAFE_INTEGER_V1 ||
            rotateAfterMs !in 1 until expiresAtMs ||
            schemaVersion != 1L ||
            serverPolicyGeneration !in 0..AUTOMATIC_BRIDGE_MAX_SAFE_INTEGER_V1 ||
            parseScopes(scopes) != exactScopes ||
            rawUrls.keys != exactUrlKeys
        ) {
            return null
        }
        val urls = AutomaticNativeEndpointUrls(
            candidates = rawUrls["candidates"] as? String ?: return null,
            config = rawUrls["config"] as? String ?: return null,
            enrollment = rawUrls["enrollment"] as? String ?: return null,
            status = rawUrls["status"] as? String ?: return null,
        )
        val bearerTokenBytes = bearerToken.toByteArray(Charsets.US_ASCII)
        val endpointValidator = AutomaticNativeEndpointValidator(AUTOMATIC_BRIDGE_COMPILED_ORIGIN_V1)
        // require canonical token bytes and the exact compiled endpoint set
        if (
            !canonicalAutomaticBearerTokenV1(bearerTokenBytes) ||
            !endpointValidator.validate(urls, AutomaticEndpointSource.TRUSTED_SERVER_CONFIG)
        ) {
            bearerTokenBytes.fill(0)
            return null
        }
        return AutomaticCredentialV1(
            bearerToken = bearerTokenBytes,
            enrollmentId = enrollmentId,
            expiresAtMs = expiresAtMs,
            rotateAfterMs = rotateAfterMs,
            serverPolicyGeneration = ServerPolicyGeneration(serverPolicyGeneration),
            urls = urls,
        )
    }

    // normalize one bridge json object without coercion
    private fun jsonObject(value: JSONObject): Map<String, Any?> {
        val result = mutableMapOf<String, Any?>()
        val iterator = value.keys()
        // consume every provided bridge key
        while (iterator.hasNext()) {
            val key = iterator.next()
            result[key] = jsonValue(value.opt(key))
        }
        return result
    }

    // normalize nested objects and arrays without type coercion
    private fun jsonValue(value: Any?): Any? = when (value) {
        is JSONObject -> jsonObject(value)
        // handle the fixed branch
        is org.json.JSONArray -> {
            val result = mutableListOf<Any?>()
            // consume every array value in order
            for (index in 0 until value.length()) {
                result += jsonValue(value.opt(index))
            }
            result
        }
        JSONObject.NULL -> null
        // branch on the current state
        else -> value
    }

    // parse four unique fixed string scopes
    private fun parseScopes(value: List<*>): Set<String>? {
        // require exactly four entries before set conversion
        if (value.size != exactScopes.size) {
            return null
        }
        val result = mutableSetOf<String>()
        // require every scope to remain a string
        for (scopeValue in value) {
            val scope = scopeValue as? String ?: return null
            // reject duplicates before equality comparison
            if (!result.add(scope)) {
                return null
            }
        }
        return result
    }

    // parse only integral json-safe numbers
    private fun strictLong(value: Any?): Long? = when (value) {
        is Int -> value.toLong()
        is Long -> value
        // branch on the current state
        else -> null
    }
}
