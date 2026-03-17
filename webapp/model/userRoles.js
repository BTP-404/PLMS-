sap.ui.define([
	"sap/ui/model/odata/v2/ODataModel",
	"sap/ui/model/Filter",
	"sap/ui/model/FilterOperator",
	"sap/ui/model/json/JSONModel"
], function (ODataModel, Filter, FilterOperator, JSONModel) {
	"use strict";

	var _emptyRoles = {
		AddReporting: "",
		EditReporting: "",
		DelReporting: "",
		AddRef: "",
		EditRef: "",
		DelRef: "",
		AddGatein: "",
		EditGatein: "",
		DelGatein: "",
		AddLoading: "",
		EditLoading: "",
		DelLoading: "",
		AddUnloading: "",
		EditUnloading: "",
		DelUnloading: "",
		AddGateout: "",
		EditGateout: "",
		DelGateout: "",
		ReopenLoading: "",
		ReopenUnload: ""
	};

	/**
	 * Returns a copy of the empty-role object (no permissions).
	 * Use when plant has no matching role so UI shows "no access" instead of wrong plant's permissions.
	 * @returns {object} Copy of empty role fields
	 */
	function getEmptyRoles() {
		return jQuery.extend({}, _emptyRoles);
	}

	// User-roles feature has been removed from the application.
	// This module is kept only as a stub so existing imports (if any remain)
	// do not break. loadUserRoles is now a no-op.

	function loadUserRoles() {
		// no-op
	}

	return {
		loadUserRoles: loadUserRoles,
		getEmptyRoles: getEmptyRoles
	};
});
