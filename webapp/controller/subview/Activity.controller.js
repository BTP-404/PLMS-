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
		key: "referenceDocuments",
		title: "Reference Documents",
		icon: "sap-icon://documents",
		eventPrefixes: ["02"]
	}, {
		key: "gateIn",
		title: "Gate In",
		icon: "sap-icon://visits",
		eventPrefixes: ["03"]
	}, {
		key: "loadingStart",
		title: "Start Loading",
		icon: "sap-icon://shipping-status",
		eventPrefixes: ["04"]
	}, {
		key: "loadingEnd",
		title: "End Loading",
		icon: "sap-icon://shipping-status",
		eventPrefixes: ["05"]
	}, {
		key: "gateOut",
		title: "Gate Out",
		icon: "sap-icon://outbox",
		eventPrefixes: ["06"]
	}];

	return Controller.extend("com.incresolZ_INC_PLMS.controller.subview.Activity", {

		onInit: function () {
			var that = this;
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
				events: [],
				timelineCards: [],
				timelineViewMode: "processflow" // "processflow" or "cards"
			});
			this.getView().setModel(this._oActivityModel, "activityModel");

			this._oService = new ODataModel("/sap/opu/odata/sap/YIGP_PLMS_SRV/", {
				useBatch: false
			});
			this._oEventBus = sap.ui.getCore().getEventBus();
			// Store bound function reference for proper unsubscription
			this._onTripDataUpdated = function() {
				this._loadActivityHistory(true); // Pass true for delay
			}.bind(this);
			// Subscribe with delay flag for updates to allow backend processing time
			this._oEventBus.subscribe("TripData", "Updated", this._onTripDataUpdated, this);
			
			// Initial load in case TripData was already set before this view was created
			// (e.g., when navigating from HomePage where TripData is prepared first)
			this._loadActivityHistory();

			this._oEventBus.subscribe("Stage", "ClearAllTabs", this._clearAllData, this);
		},

		onExit: function () {
			// Unsubscribe from event bus using stored reference
			if (this._oEventBus && this._onTripDataUpdated) {
				this._oEventBus.unsubscribe("TripData", "Updated", this._onTripDataUpdated, this);
				this._oEventBus.unsubscribe("Stage", "ClearAllTabs", this._clearAllData, this);
			}
		},
		
		_clearAllData: function () {
			// Clear activity model
			if (this._oActivityModel) {
				this._oActivityModel.setData({
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
			}
		},

		_loadActivityHistory: function (bDelay) {
			var sTripNumber = sap.ui.getCore().getModel("globalData")?.getProperty("/TripNumber") || "";

			if (!sTripNumber) {
				this._setActivityData([]);
				return;
			}

			// 1) Fast path: render whatever is already in TripData (if any)
			var oTripData = sap.ui.getCore().getModel("TripData");
			var bRenderedFromTripData = false;
			if (oTripData) {
				var vActivityHistory = oTripData.getProperty("/ActivityHistory");
				var aActivityHistory = this._extractActivityHistoryResults(vActivityHistory);
				if (aActivityHistory && aActivityHistory.length) {
					this._setActivityData(aActivityHistory);
					bRenderedFromTripData = true;
				}
			}

			// 2) Always refresh from backend on updates so Analysis reflects new events immediately
			// (some events are created asynchronously and may not be present in TripData yet)
			var fnFetch = function () {
				this._readActivityHistoryFromBackend(sTripNumber);
			}.bind(this);

			if (bDelay) {
				clearTimeout(this._activityReloadTimer);
				this._activityReloadTimer = setTimeout(fnFetch, 400);
			} else if (!bRenderedFromTripData) {
				fnFetch();
			}
		},

		_readActivityHistoryFromBackend: function (sTripNumber) {
			if (!sTripNumber) {
				this._setActivityData([]);
				return;
			}

			this._oService.read("/ActivityHistory", {
				filters: [
					new Filter("TripNumber", FilterOperator.EQ, sTripNumber)
				],
				success: function (oData) {
					var aResults = (oData && Array.isArray(oData.results)) ? oData.results : [];
					this._setActivityData(aResults);
				}.bind(this),
				error: function () {
					// Keep existing UI if any; otherwise clear.
					var aExisting = this._oActivityModel?.getProperty("/events") || [];
					if (!aExisting || !aExisting.length) {
						this._setActivityData([]);
					}
				}.bind(this)
			});
		},

		_extractActivityHistoryResults: function (vData) {
			if (!vData) {
				return [];
			}
			if (Array.isArray(vData)) {
				return vData;
			}
			if (vData && typeof vData === "object") {
				if (Array.isArray(vData.results)) {
					return vData.results;
				}
				// Check if it's a deferred object (OData v2)
				if (vData.__deferred) {
					return [];
				}
			}
			return [];
		},

		_setActivityData: function (aEvents) {
			var that = this;
			// Sort by EventID instead of date
			var aSorted = (aEvents || []).slice().sort(function (a, b) {
				var sEventIDA = (a.EventID || "").toString().padStart(2, "0");
				var sEventIDB = (b.EventID || "").toString().padStart(2, "0");
				// If EventIDs are equal, sort by Seqno
				if (sEventIDA === sEventIDB) {
					var sSeqnoA = (a.Seqno || "").toString().padStart(3, "0");
					var sSeqnoB = (b.Seqno || "").toString().padStart(3, "0");
					return sSeqnoA.localeCompare(sSeqnoB);
				}
				return sEventIDA.localeCompare(sEventIDB);
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
				// Parse TurnAroundTime to milliseconds for calculation
				var iTatMs = that._parseTurnAroundTime(oItem.TurnAroundTime || "");
				// Determine Loading/Unloading based on Movement Type
				var sMovementTypeDesc = (oItem.MovementTypeDesc || "").toUpperCase();
				var sLoadingUnloading = sMovementTypeDesc.indexOf("INWARD") !== -1 ? "Unloading" : "Loading";
				return {
					_nodeId: "node" + index,
					eventKey: (oItem.EventID || "") + " / " + (oItem.Seqno || ""),
					eventDescription: oItem.EventDescription || "",
					movementTypeDesc: oItem.MovementTypeDesc || "",
					movementScenarioDesc: oItem.MovementScenarioDesc || "",
					movementScenario: (oItem.MovementTypeDesc || oItem.MovementType || "") + "-" + (oItem.MovementScenarioDesc || oItem.MovementScenario || ""),
					loadingUnloadingText: sLoadingUnloading,
					displayTimestamp: that._formatDateTime(oDate),
					createdBy: oItem.CreatedBy || "",
					changedBy: oItem.ChangedBy || "",
					changedTimestamp: sChangedTimestamp,
					turnAroundTime: oItem.TurnAroundTime || "",
					turnAroundTimeFormatted: that._formatTurnAroundTime(oItem.TurnAroundTime || ""),
					turnAroundTimeMs: iTatMs,
					remarks: oItem.Remarks || "",
					stageTitle: that._getStageTitle(sStage) || "",
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
			this._oActivityModel.setProperty("/timelineCards", this._buildTimelineCards(aEnriched));
			
			// Calculate total TAT from individual event TATs (force recalculation)
			var sTotalTat = this._calculateTat(aEnriched);
			this._oActivityModel.setProperty("/tatText", sTotalTat);
			this._oActivityModel.setProperty("/totalTatText", sTotalTat);
			
			this._oActivityModel.setProperty("/lastUpdatedText", this._getLastUpdatedText(aEnriched));
			this._oActivityModel.setProperty("/milestones", this._buildStageSummary(aEnriched));
			
			// Force UI refresh to ensure TAT is displayed correctly after updates
			this._oActivityModel.refresh(true);
		},

		_buildProcessFlowNodes: function (aEvents) {
			if (!aEvents.length) {
				return [];
			}
			var that = this;
			// Titles should reflect backend EventDescription (not derived stage names).
			
			return aEvents.map(function (oItem, index) {
				var sStageTitle = that._getStageTitle(oItem._stage) || "";
				var sDisplayTitle = oItem.eventDescription || sStageTitle || oItem.stageTitle || "";
				
				// Determine state based on position (last one is highlighted)
				var sState = index === aEvents.length - 1 ? "Positive" : "Positive";
				var bHighlighted = index === aEvents.length - 1;
				var bFocused = index === aEvents.length - 1;
				
				// Build full movement scenario text (don't truncate)
				var sFullMovementScenario = oItem.movementScenario || "";
				// Use EventDescription if available, otherwise use movementScenario
				var sDescription = oItem.eventDescription || sFullMovementScenario || "";
				
				// Build text1 with Event Description (consistent format)
				var sText1 = "";
				if (oItem.eventDescription) {
					sText1 = oItem.eventDescription;
				} else if (sDescription) {
					sText1 = sDescription;
				}
				
				// Build text2 with MovementTypeDesc - MovementScenarioDesc format (consistent with Stage Summary)
				var sText2 = "";
				if (oItem.movementTypeDesc && oItem.movementScenarioDesc) {
					sText2 = oItem.movementTypeDesc + " - " + oItem.movementScenarioDesc;
				} else if (oItem.movementTypeDesc) {
					sText2 = oItem.movementTypeDesc;
				} else if (oItem.movementScenarioDesc) {
					sText2 = oItem.movementScenarioDesc;
				}
				// Add TAT if available
				if (oItem.turnAroundTimeFormatted && oItem.turnAroundTimeFormatted !== "—") {
					sText2 += (sText2 ? " • TAT: " : "TAT: ") + oItem.turnAroundTimeFormatted;
				}
				
				// Build stateText with timestamp and created by (consistent format)
				var sStateText = "";
				if (oItem.displayTimestamp) {
					sStateText = oItem.displayTimestamp;
				}
				if (oItem.createdBy) {
					sStateText += (sStateText ? " • " : "") + oItem.createdBy;
				}
				// Add derived stage as context (keeps node title clean).
				if (sStageTitle) {
					sStateText += (sStateText ? " • " : "") + sStageTitle;
				}
				
				return {
					id: oItem._nodeId,
					laneId: "lane1",
					title: sDisplayTitle,
					text1: sText1,
					text2: sText2 || sDescription,
					state: sState,
					stateText: sStateText || sFullMovementScenario,
					icon: oItem._icon || "sap-icon://activities",
					iconShape: "Circle",
					children: index < aEvents.length - 1 ? [aEvents[index + 1]._nodeId] : [],
					highlighted: bHighlighted,
					focused: bFocused
				};
			});
		},

		_calculateTat: function (aEvents) {
			if (!aEvents || aEvents.length === 0) {
				return "—";
			}
			
			// Calculate total TAT by summing individual event TATs
			var iTotalTatMs = 0;
			var bHasTat = false;
			
			aEvents.forEach(function(oEvent) {
				if (oEvent.turnAroundTimeMs && !isNaN(oEvent.turnAroundTimeMs) && oEvent.turnAroundTimeMs > 0) {
					iTotalTatMs += oEvent.turnAroundTimeMs;
					bHasTat = true;
				}
			});
			
			// If we have individual TATs, use sum; otherwise calculate from dates
			if (bHasTat && iTotalTatMs > 0) {
				return this._formatDurationMs(iTotalTatMs);
			}
			
			// Fallback to date difference calculation
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
			// Display date only (no time) for cleaner KPI/timestamp cards.
			return oDate.toLocaleDateString(undefined, {
				year: "numeric",
				month: "short",
				day: "2-digit"
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

				// Calculate TAT from individual event TATs (consistent with total TAT calculation)
				var iTatMs = null;
				var iTotalTatMs = 0;
				var bHasIndividualTat = false;
				
				// Sum individual event TATs for this stage
				aStageEvents.forEach(function(oEvent) {
					if (oEvent.turnAroundTimeMs && !isNaN(oEvent.turnAroundTimeMs) && oEvent.turnAroundTimeMs > 0) {
						iTotalTatMs += oEvent.turnAroundTimeMs;
						bHasIndividualTat = true;
					}
				});
				
				// Use sum of individual TATs if available, otherwise calculate from dates
				if (bHasIndividualTat && iTotalTatMs > 0) {
					iTatMs = iTotalTatMs;
				} else if (oStart) {
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

				// Build consistent description with MovementTypeDesc - MovementScenarioDesc format
				var sDescription = sStatus + " · " + sTimelineText;
				if (aStageEvents.length > 0) {
					var oFirstEvent = aStageEvents[0];
					// Use consistent format: MovementTypeDesc - MovementScenarioDesc
					if (oFirstEvent.movementTypeDesc && oFirstEvent.movementScenarioDesc) {
						sDescription += " · " + oFirstEvent.movementTypeDesc + " - " + oFirstEvent.movementScenarioDesc;
					} else if (oFirstEvent.movementTypeDesc) {
						sDescription += " · " + oFirstEvent.movementTypeDesc;
					} else if (oFirstEvent.movementScenarioDesc) {
						sDescription += " · " + oFirstEvent.movementScenarioDesc;
					}
					sDescription += " · " + (aStageEvents.length + " " + (aStageEvents.length === 1 ? "event" : "events"));
				} else {
					sDescription += " · No events yet";
				}

				return {
					key: oStage.key,
					title: oStage.title,
					icon: oStage.icon,
					tatText: sTatText,
					description: sDescription,
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

		/**
		 * Parse backend TurnAroundTime string into milliseconds.
		 *
		 * Supported examples:
		 *  - "2Days 2Hours 22Minutes 53Sec"
		 *  - "2Day 2Hour 22Minute 53Sec"
		 *  - "0Hours0Minutes34Sec"
		 *  - "0Hours 0Minutes 34Sec"
		 */
		_parseTurnAroundTime: function (sTat) {
			if (!sTat || typeof sTat !== "string") {
				return 0;
			}

			// Normalise whitespace
			sTat = sTat.trim().replace(/\s+/g, " ");

			// Match optional Days, Hours, Minutes, Seconds (singular/plural, with/without spaces)
			var oMatch = sTat.match(/(?:(\d+)\s*Day[s]?)?\s*(?:(\d+)\s*Hour[s]?)?\s*(?:(\d+)\s*Minute[s]?)?\s*(?:(\d+)\s*Sec[s]?)?/i);
			if (!oMatch) {
				return 0;
			}

			var iDays = parseInt(oMatch[1], 10) || 0;
			var iHours = parseInt(oMatch[2], 10) || 0;
			var iMinutes = parseInt(oMatch[3], 10) || 0;
			var iSeconds = parseInt(oMatch[4], 10) || 0;

			var iTotalSeconds = (iDays * 24 * 3600) +
				(iHours * 3600) +
				(iMinutes * 60) +
				iSeconds;

			if (!iTotalSeconds || isNaN(iTotalSeconds) || iTotalSeconds < 0) {
				return 0;
			}

			return iTotalSeconds * 1000;
		},

		_formatTurnAroundTime: function (sTat) {
			if (!sTat || typeof sTat !== "string") {
				return "—";
			}

			var iMs = this._parseTurnAroundTime(sTat);
			if (!iMs) {
				// If parsing fails or results in 0, show dash instead of "0 min"
				return "—";
			}

			return this._formatDurationMs(iMs);
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
		},

		/**
		 * Build timeline cards for horizontal card-based timeline view
		 */
		_buildTimelineCards: function (aEvents) {
			if (!aEvents.length) {
				return [];
			}
			var that = this;
			return aEvents.map(function (oItem, index) {
				var sStageTitle = that._getStageTitle(oItem._stage) || "";
				var sDisplayTitle = oItem.eventDescription || sStageTitle || oItem.stageTitle || "Unknown";
				
				return {
					id: "card" + index,
					title: sDisplayTitle,
					timestamp: oItem.displayTimestamp || "",
					icon: oItem._icon || "sap-icon://activities",
					iconColor: "#107e3e",
					description: sStageTitle || "",
					movementType: oItem.movementTypeDesc || "",
					movementScenario: oItem.movementScenarioDesc || "",
					createdBy: oItem.createdBy || "",
					tat: oItem.turnAroundTimeFormatted || "",
					isCompleted: true,
					isLast: index === aEvents.length - 1
				};
			});
		},

		/**
		 * Toggle between ProcessFlow and Card timeline views
		 */
		onToggleTimelineView: function (oEvent) {
			var oButton = oEvent.getSource();
			var sCurrentMode = this._oActivityModel.getProperty("/timelineViewMode");
			var sNewMode = sCurrentMode === "processflow" ? "cards" : "processflow";
			
			this._oActivityModel.setProperty("/timelineViewMode", sNewMode);
			
			// Update button icon and tooltip
			if (sNewMode === "cards") {
				oButton.setIcon("sap-icon://process");
				oButton.setTooltip("Switch to Process Flow View");
			} else {
				oButton.setIcon("sap-icon://horizontal-grip");
				oButton.setTooltip("Switch to Card Timeline View");
			}
			
			// Toggle visibility of timeline containers
			var oProcessFlow = this.byId("activityProcessFlow");
			var oCardTimeline = this.byId("cardTimelineContainer");
			
			if (oProcessFlow) {
				oProcessFlow.setVisible(sNewMode === "processflow");
			}
			if (oCardTimeline) {
				oCardTimeline.setVisible(sNewMode === "cards");
			}
		}
	});
});

