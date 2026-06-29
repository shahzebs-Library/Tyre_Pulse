package com.tyrepulse.inspector

import com.tyrepulse.inspector.core.network.Envelope
import com.tyrepulse.inspector.core.network.HttpClientFactory
import com.tyrepulse.inspector.core.network.Profile
import kotlinx.serialization.builtins.serializer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Verifies the client decodes the Go API's {data,error,meta} envelope. */
class EnvelopeTest {

    private val json = HttpClientFactory.json

    @Test
    fun decodesProfileData() {
        val body = """
            {"data":{"id":"u1","role":"inspector","site":"Riyadh",
                     "country":["KSA"],"approved":true,"locked":false}}
        """.trimIndent()
        val env = json.decodeFromString(Envelope.serializer(Profile.serializer()), body)
        assertEquals("u1", env.data?.id)
        assertEquals("inspector", env.data?.role)
        assertTrue(env.data?.approved == true)
        assertNull(env.error)
    }

    @Test
    fun decodesErrorEnvelope() {
        val body = """{"error":{"code":"unauthorized","message":"Authentication required."}}"""
        val env = json.decodeFromString(Envelope.serializer(String.serializer()), body)
        assertEquals("unauthorized", env.error?.code)
        assertNull(env.data)
    }

    @Test
    fun toleratesUnknownFields() {
        // Additive API changes must not break older clients.
        val body = """{"data":{"id":"u2","role":"admin","future_field":123},"meta":{"x":1}}"""
        val env = json.decodeFromString(Envelope.serializer(Profile.serializer()), body)
        assertEquals("admin", env.data?.role)
    }
}
