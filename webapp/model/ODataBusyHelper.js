sap.ui.define([
	"sap/ui/core/BusyIndicator"
], function (BusyIndicator) {
	"use strict";

	var _pendingRequests = 0;

	function _onRequestSent() {
		_pendingRequests++;
		if (_pendingRequests === 1) {
			BusyIndicator.show(0);
		}
	}

	function _onRequestCompleted() {
		_pendingRequests = Math.max(0, _pendingRequests - 1);
		if (_pendingRequests === 0) {
			BusyIndicator.hide();
		}
	}

	/**
	 * Shows global BusyIndicator while any OData request on this model is in flight.
	 * Safe for concurrent requests across multiple model instances (shared counter).
	 */
	function wireGlobalBusy(oModel) {
		if (!oModel || oModel._zIncPlmsGlobalBusyWired) {
			return;
		}
		oModel._zIncPlmsGlobalBusyWired = true;
		oModel.attachRequestSent(_onRequestSent);
		oModel.attachRequestCompleted(_onRequestCompleted);
	}

	return {
		wireGlobalBusy: wireGlobalBusy
	};
});
