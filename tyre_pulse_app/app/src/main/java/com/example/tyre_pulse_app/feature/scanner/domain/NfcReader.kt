package com.example.tyre_pulse_app.feature.scanner.domain

import android.app.Activity
import android.nfc.NfcAdapter
import android.nfc.Tag
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.asSharedFlow

class NfcReader(private val activity: Activity) : NfcAdapter.ReaderCallback {

    private val nfcAdapter: NfcAdapter? = NfcAdapter.getDefaultAdapter(activity)
    
    private val _nfcEvents = MutableSharedFlow<String>(extraBufferCapacity = 1)
    val nfcEvents: SharedFlow<String> = _nfcEvents.asSharedFlow()

    fun enable() {
        if (nfcAdapter != null && nfcAdapter.isEnabled) {
            val flags = NfcAdapter.FLAG_READER_NFC_A or 
                        NfcAdapter.FLAG_READER_NFC_B or 
                        NfcAdapter.FLAG_READER_NFC_F or 
                        NfcAdapter.FLAG_READER_NFC_V
            nfcAdapter.enableReaderMode(activity, this, flags, null)
        }
    }

    fun disable() {
        nfcAdapter?.disableReaderMode(activity)
    }

    override fun onTagDiscovered(tag: Tag?) {
        tag?.let {
            val uidBytes = it.id
            val hexString = uidBytes.joinToString("") { byte -> "%02X".format(byte) }
            _nfcEvents.tryEmit(hexString)
        }
    }
}
