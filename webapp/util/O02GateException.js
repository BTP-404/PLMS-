sap.ui.define(
	["com/incresolZ_INC_PLMS/util/VehicleTypeConfig"],
	function (VehicleTypeConfig) {
		"use strict";

		/**
		 * MovementScenario O02: ItemKey "O02" from OrderTypeSH, or MovementType O + scenario segment 2.
		 */
		function isO02FromTripData(oTripData) {
			if (!oTripData) {
				return false;
			}
			var sMt = String(oTripData.getProperty("/MovementType") || "")
				.trim()
				.toUpperCase();
			var sMsRaw = String(oTripData.getProperty("/MovementScenario") || "").trim();
			var sMs = sMsRaw.replace(/^0+/, "") || "0";
			// Authoritative check: only O/02 is O02 scenario.
			if (sMt || sMsRaw) {
				return sMt === "O" && sMs === "2";
			}

			// Fallback only when movement type/scenario are not available.
			var sItemKey = String(oTripData.getProperty("/MovementScenarioItemKey") || "")
				.trim()
				.toUpperCase();
			return sItemKey === "O02";
		}

		/**
		 * Exception flow: O02 AND VehicleType Config 01 (Internal).
		 * Gate Out first, reporting on Gate Out, mandatory bins at Gate Out only (not again at Gate In).
		 */
		function isO02InternalException(oTripData) {
			if (!oTripData) {
				return false;
			}
			var sVt = String(oTripData.getProperty("/VehicleType") || "").trim();
			return (
				isO02FromTripData(oTripData) &&
				VehicleTypeConfig.isGateOutFirstInCreateMode(sVt)
			);
		}

		return {
			isO02FromTripData: isO02FromTripData,
			isO02InternalException: isO02InternalException
		};
	}
);
