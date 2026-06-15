sap.ui.define([], function () {
	"use strict";

	/**
	 * Customizing: /ConfigValues where ConfigGroup = "VehicleType".
	 * Example row:
	 *   ConfigID "01", Description "Internal", TripNumber "", ParentConfig "".
	 * TripData.VehicleType stores ConfigID from this table.
	 */
	var INTERNAL_VEHICLE_TYPE_CONFIG_ID = "01";
	var INTERNAL_VEHICLE_TYPE_DESCRIPTION = "Internal";

	function normalizeVehicleTypeCode(sRaw) {
		var s = String(sRaw || "").trim();
		return s.replace(/^0+/, "") || "0";
	}

	/**
	 * Create mode on Stage: show Gate Out first when vehicle type is Internal (ConfigID 01).
	 */
	function isGateOutFirstInCreateMode(sVehicleTypeRaw) {
		return (
			normalizeVehicleTypeCode(sVehicleTypeRaw) ===
			normalizeVehicleTypeCode(INTERNAL_VEHICLE_TYPE_CONFIG_ID)
		);
	}

	return {
		INTERNAL_VEHICLE_TYPE_CONFIG_ID: INTERNAL_VEHICLE_TYPE_CONFIG_ID,
		INTERNAL_VEHICLE_TYPE_DESCRIPTION: INTERNAL_VEHICLE_TYPE_DESCRIPTION,
		isGateOutFirstInCreateMode: isGateOutFirstInCreateMode,
	};
});
