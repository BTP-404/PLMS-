sap.ui.define([
	"sap/ui/core/mvc/Controller",
	"sap/ui/model/json/JSONModel",
	"sap/ui/model/odata/v2/ODataModel",
	"sap/ui/model/Filter",
	"sap/ui/model/FilterOperator",
	"sap/m/MessageToast"
], function (Controller, JSONModel, ODataModel, Filter, FilterOperator, MessageToast) {
	"use strict";

	var STAGE_CONFIG = [{
		key: "vehicleReporting",
		title: "Reporting",
		icon: "sap-icon://order-status",
		eventPrefixes: ["01"]
	}, {
		key: "gateIn",
		title: "Gate In",
		icon: "sap-icon://visits",
		eventPrefixes: ["03"]
	}, {
		key: "loading",
		title: "Loading",
		icon: "sap-icon://shipping-status",
		eventPrefixes: ["04"]
	}, {
		key: "gateOut",
		title: "Gate Out",
		icon: "sap-icon://outbox",
		eventPrefixes: ["05"]
	}];

	return Controller.extend("com.incresolZ_INC_PLMS.controller.subview.Activity", {

		onInit: function () {
			this._oActivityModel = new JSONModel({
				tatText: "—",
				lastUpdatedText: "—",
				eventsCount: 0,
				milestones: [],
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
				var sStage = that._detectStage(oItem.EventID || "");
				var sIcon = that._getStageIcon(sStage);
				// Format changed date/time if available
				var sChangedTimestamp = "";
				if (oItem.ChangedDate && oItem.ChangedTime) {
					var oChangedDate = that._toChangedDateObject(oItem);
					if (oChangedDate) {
						sChangedTimestamp = that._formatDateTime(oChangedDate);
					}
				}
				return {
					_nodeId: "node" + index,
					eventKey: (oItem.EventID || "") + " / " + (oItem.Seqno || ""),
					movementScenario: (oItem.MovementTypeDesc || "") + "-" + (oItem.MovementScenarioDesc || ""),
					displayTimestamp: that._formatDateTime(oDate),
					createdBy: oItem.CreatedBy || "",
					changedBy: oItem.ChangedBy || "",
					changedTimestamp: sChangedTimestamp,
					turnAroundTime: oItem.Turn_A_Time || "",
					remarks: oItem.Remarks || "",
					raw: oItem,
					_date: oDate,
					_stage: sStage,
					_icon: sIcon
				};
			});

			this._assignStageMetadata(aEnriched);
			this._oActivityModel.setProperty("/events", aEnriched);
			this._oActivityModel.setProperty("/eventsCount", aEnriched.length);
			this._oActivityModel.setProperty("/nodes", this._buildProcessFlowNodes(aEnriched));
			this._oActivityModel.setProperty("/tatText", this._calculateTat(aEnriched));
			this._oActivityModel.setProperty("/lastUpdatedText", this._getLastUpdatedText(aEnriched));
			this._oActivityModel.setProperty("/milestones", this._buildStageSummary(aEnriched));
		},

		_buildProcessFlowNodes: function (aEvents) {
			if (!aEvents.length) {
				return [];
			}
			var that = this;
			// Count occurrences of each stage to make titles unique
			var oStageCounts = {};
			aEvents.forEach(function(oItem) {
				var sStage = oItem._stage || "unknown";
				oStageCounts[sStage] = (oStageCounts[sStage] || 0) + 1;
			});
			var oStageIndices = {};
			
			return aEvents.map(function (oItem, index) {
				var sStageTitle = that._getStageTitle(oItem._stage);
				// Make title more concise and readable - use stage title, fallback to eventKey
				var sTitle = sStageTitle ? sStageTitle : oItem.eventKey;
				
				// Determine state based on position (last one is highlighted)
				var sState = index === aEvents.length - 1 ? "Positive" : "Positive";
				var bHighlighted = index === aEvents.length - 1;
				var bFocused = index === aEvents.length - 1;
				
				// Build unique title - if multiple events from same stage, add sequence number
				var sDisplayTitle = sTitle;
				if (sStageTitle) {
					var sStage = oItem._stage || "unknown";
					oStageIndices[sStage] = (oStageIndices[sStage] || 0) + 1;
					var iStageIndex = oStageIndices[sStage];
					var iStageCount = oStageCounts[sStage] || 1;
					
					// If multiple events from same stage, add sequence number
					if (iStageCount > 1) {
						sDisplayTitle = sStageTitle + " #" + iStageIndex;
					} else {
						sDisplayTitle = sStageTitle;
					}
				} else if (oItem.eventKey) {
					// Fallback to eventKey if no stage title
					sDisplayTitle = oItem.eventKey;
				}
				
				return {
					id: oItem._nodeId,
					laneId: "lane1",
					title: sDisplayTitle,
					text1: oItem.displayTimestamp,
					text2: oItem.remarks || oItem.movementScenario || "",
					state: sState,
					stateText: oItem.movementScenario || "",
					icon: oItem._icon || "sap-icon://activities",
					iconShape: "Circle",
					children: index < aEvents.length - 1 ? [aEvents[index + 1]._nodeId] : [],
					highlighted: bHighlighted,
					focused: bFocused
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
			return this._formatDurationMs(iDiff);
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

		_toChangedDateObject: function (oItem) {
			if (!oItem) {
				return null;
			}
			var oDate = this._parseODataDate(oItem.ChangedDate);
			var iTimeMs = this._parseODataTime(oItem.ChangedTime);
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
		},

		_assignStageMetadata: function (aEvents) {
			aEvents.forEach(function (oItem) {
				oItem._stageKey = this._resolveStageKey(oItem.raw);
			}, this);
		},

		_resolveStageKey: function (oRaw) {
			var sEventId = (oRaw && oRaw.EventID) ? String(oRaw.EventID) : "";
			sEventId = sEventId.replace(/[^\d]/g, "").substring(0, 2);
			var oMatch = STAGE_CONFIG.find(function (oStage) {
				return oStage.eventPrefixes.indexOf(sEventId) > -1;
			});
			return oMatch ? oMatch.key : null;
		},

		_buildStageSummary: function (aEvents) {
			return STAGE_CONFIG.map(function (oStage, iIndex) {
				var aStageEvents = aEvents.filter(function (oItem) {
					return oItem._stageKey === oStage.key;
				});
				var oStart = aStageEvents[0];
				var oLast = aStageEvents[aStageEvents.length - 1];
				var oNextStart = this._findNextStageStart(aEvents, iIndex);

				var bHasEvents = !!oStart;
				var bCompleted = bHasEvents && (iIndex === STAGE_CONFIG.length - 1 ? !!oLast : !!oNextStart);

				var iTatMs = null;
				if (oStart) {
					var oTatEnd = bCompleted ? (oNextStart || oLast || oStart) : (oLast || null);
					if (oTatEnd && oTatEnd._date && oStart._date && oTatEnd._date > oStart._date) {
						iTatMs = oTatEnd._date - oStart._date;
					}
				}

				var sTatText = this._formatDurationMs(iTatMs);
				var sStatus = "Pending";
				var sTimelineText = "Not started";
				var sInfoState = "None";

				if (bHasEvents && bCompleted) {
					sStatus = "Completed";
					sTimelineText = "Completed " + this._formatDateTime((oLast || oStart)._date);
					sInfoState = "Success";
				} else if (bHasEvents) {
					sStatus = "In Progress";
					sTimelineText = "In progress since " + this._formatDateTime(oStart._date);
					sInfoState = "Warning";
				}

				var sEventSummary = aStageEvents.length ?
					(aStageEvents.length + " " + (aStageEvents.length === 1 ? "event" : "events")) :
					"No events yet";

				return {
					key: oStage.key,
					title: oStage.title,
					icon: oStage.icon,
					tatText: sTatText,
					description: sStatus + " · " + sTimelineText + " · " + sEventSummary,
					infoState: sInfoState
				};
			}, this);
		},

		_findNextStageStart: function (aEvents, iStageIndex) {
			for (var i = iStageIndex + 1; i < STAGE_CONFIG.length; i++) {
				var sKey = STAGE_CONFIG[i].key;
				var oMatch = aEvents.find(function (oItem) {
					return oItem._stageKey === sKey;
				});
				if (oMatch) {
					return oMatch;
				}
			}
			return null;
		},

		_formatDurationMs: function (iMs) {
			if (typeof iMs !== "number" || isNaN(iMs) || iMs <= 0) {
				return "—";
			}
			var iHours = Math.floor(iMs / 3600000);
			var iMinutes = Math.floor((iMs % 3600000) / 60000);
			var iSeconds = Math.floor((iMs % 60000) / 1000);
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

		_detectStage: function (sEventID) {
			if (!sEventID) {
				return null;
			}
			var sPrefix = String(sEventID).replace(/[^\d]/g, "").substring(0, 2);
			var oMatch = STAGE_CONFIG.find(function (oStage) {
				return oStage.eventPrefixes.indexOf(sPrefix) > -1;
			});
			return oMatch ? oMatch.key : null;
		},

		_getStageIcon: function (sStageKey) {
			if (!sStageKey) {
				return "sap-icon://activities";
			}
			var oMatch = STAGE_CONFIG.find(function (oStage) {
				return oStage.key === sStageKey;
			});
			return oMatch ? oMatch.icon : "sap-icon://activities";
		},

		_getStageTitle: function (sStageKey) {
			if (!sStageKey) {
				return null;
			}
			var oMatch = STAGE_CONFIG.find(function (oStage) {
				return oStage.key === sStageKey;
			});
			return oMatch ? oMatch.title : null;
		}
	});
});

