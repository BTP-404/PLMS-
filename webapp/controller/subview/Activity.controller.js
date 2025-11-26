sap.ui.define([
	"sap/ui/core/mvc/Controller",
	"sap/ui/model/json/JSONModel",
	"sap/ui/model/odata/v2/ODataModel",
	"sap/ui/model/Filter",
	"sap/ui/model/FilterOperator",
	"sap/m/MessageToast"
], function (Controller, JSONModel, ODataModel, Filter, FilterOperator, MessageToast) {
	"use strict";

	return Controller.extend("com.incresolZ_INC_PLMS.controller.subview.Activity", {

		onInit: function () {
			this._oActivityModel = new JSONModel({
				tatText: "—",
				lastUpdatedText: "—",
				eventsCount: 0,
				nodes: [],
				lanes: [{
					id: "lane1",
					position: 0,
					icon: "sap-icon://activities",
					text: "Trip Activity",
					state: "Positive"
				}],
				events: []
			});
			this.getView().setModel(this._oActivityModel, "activityModel");

			this._oService = new ODataModel("/sap/opu/odata/sap/YIGP_PLMS_SRV/", {
				useBatch: false
			});

			this._oEventBus = sap.ui.getCore().getEventBus();
			this._oEventBus.subscribe("TripData", "Updated", this._loadActivityHistory, this);

			this._loadActivityHistory();
		},

		onExit: function () {
			this._oEventBus?.unsubscribe("TripData", "Updated", this._loadActivityHistory, this);
		},

		_loadActivityHistory: function () {
			var sTripNumber = sap.ui.getCore().getModel("globalData")?.getProperty("/TripNumber") || "";
			var oView = this.getView();

			if (!sTripNumber) {
				this._setActivityData([]);
				return;
			}

			oView.setBusy(true);
			this._oService.read("/ActivityHistory", {
				filters: [
					new Filter("TripNumber", FilterOperator.EQ, sTripNumber)
				],
				success: function (oData) {
					oView.setBusy(false);
					this._setActivityData(oData.results || []);
				}.bind(this),
				error: function () {
					oView.setBusy(false);
					MessageToast.show("Unable to load activity history");
					this._setActivityData([]);
				}.bind(this)
			});
		},

		_setActivityData: function (aEvents) {
			var that = this;
			var aSorted = (aEvents || []).slice().sort(function (a, b) {
				return that._toDateObject(a) - that._toDateObject(b);
			}).filter(function (oItem) {
				return !!that._toDateObject(oItem);
			});

			var aEnriched = aSorted.map(function (oItem, index) {
				var oDate = that._toDateObject(oItem);
				return {
					_nodeId: "node" + index,
					eventKey: (oItem.EventID || "") + " / " + (oItem.Seqno || ""),
					movementScenario: (oItem.MovementType || "") + "-" + (oItem.MovementScenario || ""),
					displayTimestamp: that._formatDateTime(oDate),
					createdBy: oItem.CreatedBy || "",
					changedBy: oItem.ChangedBy || "",
					remarks: oItem.Remarks || "",
					raw: oItem,
					_date: oDate
				};
			});

			this._oActivityModel.setProperty("/events", aEnriched);
			this._oActivityModel.setProperty("/eventsCount", aEnriched.length);
			this._oActivityModel.setProperty("/nodes", this._buildProcessFlowNodes(aEnriched));
			this._oActivityModel.setProperty("/tatText", this._calculateTat(aEnriched));
			this._oActivityModel.setProperty("/lastUpdatedText", this._getLastUpdatedText(aEnriched));
		},

		_buildProcessFlowNodes: function (aEvents) {
			if (!aEvents.length) {
				return [];
			}
			return aEvents.map(function (oItem, index) {
				return {
					id: oItem._nodeId,
					laneId: "lane1",
					title: oItem.eventKey,
					text1: oItem.displayTimestamp,
					text2: oItem.remarks,
					state: "Positive",
					stateText: oItem.movementScenario,
					children: index < aEvents.length - 1 ? [aEvents[index + 1]._nodeId] : []
				};
			});
		},

		_calculateTat: function (aEvents) {
			if (aEvents.length < 2) {
				return aEvents.length === 1 ? "0 min" : "—";
			}
			var iDiff = aEvents[aEvents.length - 1]._date - aEvents[0]._date;
			if (isNaN(iDiff) || iDiff < 0) {
				return "—";
			}
			var iHours = Math.floor(iDiff / 3600000);
			var iMinutes = Math.floor((iDiff % 3600000) / 60000);
			var iSeconds = Math.floor((iDiff % 60000) / 1000);

			var aParts = [];
			if (iHours) {
				aParts.push(iHours + "h");
			}
			if (iMinutes) {
				aParts.push(iMinutes + "m");
			}
			if (!aParts.length) {
				aParts.push(iSeconds + "s");
			}
			return aParts.join(" ");
		},

		_getLastUpdatedText: function (aEvents) {
			var oLast = aEvents[aEvents.length - 1];
			return oLast ? oLast.displayTimestamp : "—";
		},

		_toDateObject: function (oItem) {
			if (!oItem) {
				return null;
			}
			var oDate = this._parseODataDate(oItem.CreatedDate);
			var iTimeMs = this._parseODataTime(oItem.CreatedTime);
			if (!oDate || iTimeMs === null) {
				return null;
			}
			return new Date(oDate.getTime() + iTimeMs);
		},

		_parseODataDate: function (vDate) {
			if (!vDate) {
				return null;
			}
			if (vDate instanceof Date) {
				return vDate;
			}
			if (typeof vDate === "string") {
				var iTimestamp = parseInt(vDate.replace(/\D/g, ""), 10);
				if (!isNaN(iTimestamp)) {
					return new Date(iTimestamp);
				}
			}
			return null;
		},

		_parseODataTime: function (vTime) {
			if (vTime === null || vTime === undefined) {
				return null;
			}
			if (typeof vTime === "object" && typeof vTime.ms === "number") {
				return vTime.ms;
			}
			if (typeof vTime === "number") {
				return vTime;
			}
			if (typeof vTime === "string") {
				var oMatch = vTime.match(/PT(\d+)H(\d+)M(\d+)S/);
				if (oMatch) {
					var iHours = parseInt(oMatch[1], 10) || 0;
					var iMinutes = parseInt(oMatch[2], 10) || 0;
					var iSeconds = parseInt(oMatch[3], 10) || 0;
					return ((iHours * 60 + iMinutes) * 60 + iSeconds) * 1000;
				}
			}
			return 0;
		},

		_formatDateTime: function (oDate) {
			if (!oDate || isNaN(oDate.getTime())) {
				return "";
			}
			return oDate.toLocaleString(undefined, {
				year: "numeric",
				month: "short",
				day: "2-digit",
				hour: "2-digit",
				minute: "2-digit",
				second: "2-digit"
			});
		}
	});
});

