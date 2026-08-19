package fyi.ferry.leaderboards

import java.math.BigDecimal
import java.nio.charset.StandardCharsets

// define the native contract
internal sealed interface AutomaticV0JsonValue {
    // define the native contract
    data class ObjectValue(val entries: Map<String, AutomaticV0JsonValue>) : AutomaticV0JsonValue
    // define the native contract
    data class ArrayValue(val values: List<AutomaticV0JsonValue>) : AutomaticV0JsonValue
    // define the native contract
    data class StringValue(val value: String) : AutomaticV0JsonValue
    // define the native contract
    data class NumberValue(val value: BigDecimal) : AutomaticV0JsonValue
    // define the native contract
    data class BooleanValue(val value: Boolean) : AutomaticV0JsonValue
    // define the native contract
    data object NullValue : AutomaticV0JsonValue
}

// define the native contract
internal class AutomaticV0JsonParser private constructor(private val input: String) {
    private var offset = 0

    // define the native companion
    companion object {
        // parse one complete utf-8 document
        fun parse(bytes: ByteArray): AutomaticV0JsonValue? {
            val input = try {
                StandardCharsets.UTF_8.newDecoder().decode(java.nio.ByteBuffer.wrap(bytes)).toString()
            // fail closed on the error
            } catch (_: Exception) {
                return null
            }
            return AutomaticV0JsonParser(input).parseDocument()
        }
    }

    // parse without trailing data
    private fun parseDocument(): AutomaticV0JsonValue? {
        skipWhitespace()
        val value = parseValue() ?: return null
        skipWhitespace()
        // run the bounded callback
        return value.takeIf { offset == input.length }
    }

    // dispatch one json value
    private fun parseValue(): AutomaticV0JsonValue? {
        // reject missing input
        if (offset >= input.length) {
            return null
        }

        // select by leading token
        return when (input[offset]) {
            '{' -> parseObject()
            '[' -> parseArray()
            '"' -> parseString()?.let(AutomaticV0JsonValue::StringValue)
            't' -> parseLiteral("true", AutomaticV0JsonValue.BooleanValue(true))
            'f' -> parseLiteral("false", AutomaticV0JsonValue.BooleanValue(false))
            'n' -> parseLiteral("null", AutomaticV0JsonValue.NullValue)
            '-', in '0'..'9' -> parseNumber()
            // branch on the current state
            else -> null
        }
    }

    // parse a strict object
    private fun parseObject(): AutomaticV0JsonValue.ObjectValue? {
        offset += 1
        skipWhitespace()
        val entries = linkedMapOf<String, AutomaticV0JsonValue>()

        // accept an empty object
        if (consume('}')) {
            return AutomaticV0JsonValue.ObjectValue(entries)
        }

        // parse every unique member
        while (offset < input.length) {
            val key = parseString() ?: return null
            // reject duplicate keys
            if (entries.containsKey(key)) {
                return null
            }
            skipWhitespace()
            // require a member separator
            if (!consume(':')) {
                return null
            }
            skipWhitespace()
            entries[key] = parseValue() ?: return null
            skipWhitespace()
            // finish or continue
            when {
                consume('}') -> return AutomaticV0JsonValue.ObjectValue(entries)
                consume(',') -> skipWhitespace()
                // branch on the current state
                else -> return null
            }
        }

        return null
    }

    // parse a strict array
    private fun parseArray(): AutomaticV0JsonValue.ArrayValue? {
        offset += 1
        skipWhitespace()
        val values = mutableListOf<AutomaticV0JsonValue>()

        // accept an empty array
        if (consume(']')) {
            return AutomaticV0JsonValue.ArrayValue(values)
        }

        // parse every element
        while (offset < input.length) {
            values += parseValue() ?: return null
            skipWhitespace()
            // finish or continue
            when {
                consume(']') -> return AutomaticV0JsonValue.ArrayValue(values)
                consume(',') -> skipWhitespace()
                // branch on the current state
                else -> return null
            }
        }

        return null
    }

    // parse and unescape one string
    private fun parseString(): String? {
        // require an opening quote
        if (!consume('"')) {
            return null
        }
        val output = StringBuilder()

        // scan string code units
        while (offset < input.length) {
            val character = input[offset++]
            // handle terminal and escaped characters
            when {
                character == '"' -> return output.toString()
                character == '\\' -> {
                    // reject truncated escapes
                    if (offset >= input.length) {
                        return null
                    }
                    // decode the escape
                    when (val escaped = input[offset++]) {
                        '"', '\\', '/' -> output.append(escaped)
                        'b' -> output.append('\b')
                        'f' -> output.append('\u000c')
                        'n' -> output.append('\n')
                        'r' -> output.append('\r')
                        't' -> output.append('\t')
                        'u' -> output.append(parseUnicodeEscape() ?: return null)
                        // branch on the current state
                        else -> return null
                    }
                }
                character.code < 0x20 -> return null
                // branch on the current state
                else -> output.append(character)
            }
        }

        return null
    }

    // parse four hexadecimal digits
    private fun parseUnicodeEscape(): Char? {
        // reject truncated escapes
        if (offset + 4 > input.length) {
            return null
        }
        val value = input.substring(offset, offset + 4).toIntOrNull(16) ?: return null
        offset += 4
        return value.toChar()
    }

    // parse one json number
    private fun parseNumber(): AutomaticV0JsonValue.NumberValue? {
        val start = offset
        consume('-')

        // parse the integer portion
        if (consume('0')) {
            // reject leading zeroes
            if (offset < input.length && input[offset].isDigit()) {
                return null
            }
        // branch on the current state
        } else {
            // require a nonzero digit
            if (offset >= input.length || input[offset] !in '1'..'9') {
                return null
            }
            // consume remaining digits
            while (offset < input.length && input[offset].isDigit()) {
                offset += 1
            }
        }

        // parse an optional fraction
        if (consume('.')) {
            val fractionStart = offset
            // consume fraction digits
            while (offset < input.length && input[offset].isDigit()) {
                offset += 1
            }
            // require at least one digit
            if (fractionStart == offset) {
                return null
            }
        }

        // parse an optional exponent
        if (offset < input.length && input[offset] in charArrayOf('e', 'E')) {
            offset += 1
            // accept an exponent sign
            if (offset < input.length && input[offset] in charArrayOf('+', '-')) {
                offset += 1
            }
            val exponentStart = offset
            // consume exponent digits
            while (offset < input.length && input[offset].isDigit()) {
                offset += 1
            }
            // require at least one digit
            if (exponentStart == offset) {
                return null
            }
        }

        return try {
            AutomaticV0JsonValue.NumberValue(BigDecimal(input.substring(start, offset)))
        // fail closed on the error
        } catch (_: NumberFormatException) {
            null
        }
    }

    // parse one fixed literal
    private fun parseLiteral(token: String, value: AutomaticV0JsonValue): AutomaticV0JsonValue? {
        // require the complete token
        if (!input.startsWith(token, offset)) {
            return null
        }
        offset += token.length
        return value
    }

    // consume one expected character
    private fun consume(expected: Char): Boolean {
        // reject any different character
        if (offset >= input.length || input[offset] != expected) {
            return false
        }
        offset += 1
        return true
    }

    // skip json whitespace
    private fun skipWhitespace() {
        // consume only json whitespace
        while (offset < input.length && input[offset] in charArrayOf(' ', '\t', '\r', '\n')) {
            offset += 1
        }
    }
}

// define the native contract
internal object AutomaticV0CanonicalJson {
    // serialize with sorted object keys
    fun bytes(value: AutomaticV0JsonValue): ByteArray = buildString {
        appendValue(this, value)
    }.toByteArray(StandardCharsets.UTF_8)

    // append one canonical value
    private fun appendValue(output: StringBuilder, value: AutomaticV0JsonValue) {
        // select canonical representation
        when (value) {
            is AutomaticV0JsonValue.ObjectValue -> appendObject(output, value)
            is AutomaticV0JsonValue.ArrayValue -> appendArray(output, value)
            is AutomaticV0JsonValue.StringValue -> appendString(output, value.value)
            is AutomaticV0JsonValue.NumberValue -> output.append(canonicalNumber(value.value))
            is AutomaticV0JsonValue.BooleanValue -> output.append(if (value.value) "true" else "false")
            AutomaticV0JsonValue.NullValue -> output.append("null")
        }
    }

    // append sorted members
    private fun appendObject(output: StringBuilder, value: AutomaticV0JsonValue.ObjectValue) {
        output.append('{')
        // append every sorted member
        value.entries.toSortedMap().entries.forEachIndexed { index, entry ->
            // separate members
            if (index > 0) {
                output.append(',')
            }
            appendString(output, entry.key)
            output.append(':')
            appendValue(output, entry.value)
        }
        output.append('}')
    }

    // append ordered elements
    private fun appendArray(output: StringBuilder, value: AutomaticV0JsonValue.ArrayValue) {
        output.append('[')
        // append every element
        value.values.forEachIndexed { index, element ->
            // separate elements
            if (index > 0) {
                output.append(',')
            }
            appendValue(output, element)
        }
        output.append(']')
    }

    // append an escaped string
    private fun appendString(output: StringBuilder, value: String) {
        output.append('"')
        // escape every code unit
        value.forEach { character ->
            // select the json escape
            when (character) {
                '"' -> output.append("\\\"")
                '\\' -> output.append("\\\\")
                '\b' -> output.append("\\b")
                '\u000c' -> output.append("\\f")
                '\n' -> output.append("\\n")
                '\r' -> output.append("\\r")
                '\t' -> output.append("\\t")
                // branch on the current state
                else -> {
                    // escape remaining controls
                    if (character.code < 0x20) {
                        output.append("\\u%04x".format(character.code))
                    // branch on the current state
                    } else {
                        output.append(character)
                    }
                }
            }
        }
        output.append('"')
    }

    // normalize decimal spelling
    private fun canonicalNumber(value: BigDecimal): String {
        val normalized = value.stripTrailingZeros()
        return if (normalized.compareTo(BigDecimal.ZERO) == 0) "0" else normalized.toPlainString()
    }
}
