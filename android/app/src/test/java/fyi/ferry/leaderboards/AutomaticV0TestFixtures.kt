package fyi.ferry.leaderboards

// define the native contract
internal object AutomaticV0TestFixtures {
    // build one complete public vessel record
    fun vessel(
        id: String = "144",
        latitude: Double = 47.602,
        longitude: Double = -122.339,
        inService: Boolean = true,
    ): String = """
        {
          "abbreviation":"TAC","arrivingTerminalId":7,"departingTerminalId":3,
          "beam":"87 ft","classId":"jumbo-mark-ii","departedTime":1720000000,
          "departureDelta":0,"dockedTime":1720000000,"estimatedArrivalTime":1720000600,
          "hasCarDeckRestroom":true,"hasElevator":true,"hasGalley":true,"hasRestroom":true,
          "hasWiFi":true,"heading":180,"horsepower":16000,"id":"$id",
          "inMaintenance":false,"inService":$inService,"info":{"ada":"yes","crossing":"30 min"},
          "isAdaAccessible":true,"isAtDock":false,"length":"460 ft",
          "location":{"latitude":$latitude,"longitude":$longitude},"maxClearance":15.5,
          "mmsi":366772760,"name":"Tacoma","passengerCapacity":2500,"speed":17.2,
          "tallVehicleCapacity":60,"vesselWatchUrl":"https://example.test/vessel/144",
          "vehicleCapacity":202,"weight":5000,"yearBuilt":1997,"yearRebuilt":1997
        }
    """.trimIndent().replace("\n", "")

    // build one complete snapshot body
    fun body(
        sourceUpdatedAtSeconds: String = "1720000000.123",
        vessels: Map<String, String> = mapOf("144" to vessel()),
    ): String = "{\"sourceUpdatedAt\":$sourceUpdatedAtSeconds,\"vessels\":{" +
        vessels.entries.joinToString(",") { (id, record) -> "\"$id\":$record" } +
        "}}"

    // build one whole-second snapshot body
    fun body(
        sourceUpdatedAtSeconds: Long,
        vessels: Map<String, String> = mapOf("144" to vessel()),
    ): String = body(sourceUpdatedAtSeconds.toString(), vessels)

    // wrap the ordinary api response
    fun envelope(
        status: String = "{\"offline\":false,\"coreReady\":true,\"warming\":false}",
        body: String = body(),
    ): ByteArray = "{\"wsfStatus\":$status,\"body\":$body}".toByteArray()
}
