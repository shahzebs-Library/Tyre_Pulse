package com.example.tyre_pulse_app.core.location

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import com.google.android.gms.location.Geofence
import com.google.android.gms.location.GeofencingEvent

class GeofenceReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        val geofencingEvent = GeofencingEvent.fromIntent(intent)
        if (geofencingEvent != null) {
            if (geofencingEvent.hasError()) {
                Log.e("GeofenceReceiver", "Error receiving geofence event")
                return
            }

            val geofenceTransition = geofencingEvent.geofenceTransition

            // Test if the transition was entering the yard
            if (geofenceTransition == Geofence.GEOFENCE_TRANSITION_ENTER) {
                // In a production app, we would use NotificationManager 
                // to trigger a local push notification here.
                Log.i("GeofenceReceiver", "User entered the yard. Triggering PMV Checklist Push Notification.")
            }
        }
    }
}
