sap.ui.define([
	"sap/ui/core/mvc/Controller",
	"sap/ui/model/json/JSONModel",
	"sap/ui/model/odata/v2/ODataModel",
	"sap/m/MessageBox",
	"sap/m/MessageToast",
	"sap/m/ButtonType",
	"sap/ui/model/Filter",
	"sap/ui/model/FilterOperator",
	"com/incresolZ_INC_PLMS/util/MovementScenarioIcons",
	"com/incresolZ_INC_PLMS/util/O02GateException"
], function(Controller, JSONModel, ODataModel, MessageBox, MessageToast, ButtonType, Filter, FilterOperator, MovementScenarioIcons, O02GateException) {
	"use strict";
	return Controller.extend("com.incresolZ_INC_PLMS.controller.Stage", {
		onInit: function() {
			var oRouter = this.getOwnerComponent().getRouter();
			oRouter.getRoute("Stage").attachPatternMatched(this._onRouteMatched, this);//new Vehicle Reporting Case
			oRouter.getRoute("StagewithParam").attachPatternMatched(this._onRouteMatched, this); // existing vehicle

			// Ensure global trip model exists upfront
			if (!sap.ui.getCore().getModel("globalData")) {
				sap.ui.getCore().setModel(new JSONModel({
					TripNumber: ""
				}), "globalData");
			}
			this._initPageTitleModel();

			this._oEventBus = sap.ui.getCore().getEventBus();
			this._oEventBus.subscribe("TripData", "Updated", this._refreshPageTitleModel, this);
			this._oEventBus.subscribe("TripData", "Updated", this._updateLoadingUnloadingTabs, this);
			this._oEventBus.subscribe("TripData", "Updated", this._applyVehicleTypeTabRule, this);
			this._oEventBus.subscribe("TripData", "MovementTypeChanged", this._updateLoadingUnloadingTabs, this);
			this._oEventBus.subscribe("TripData", "Updated", this._updateCancelButtonVisibility, this);
			this._oEventBus.subscribe("Stage", "TripCreated", this._onTripCreated, this);
			this._oEventBus.subscribe("Notes", "UnreadCountChanged", this._updateNotesTabIndicator, this);
			this._oEventBus.subscribe("Stage", "ClearAllTabs", this._onClearAllTabs, this);
			this._bPendingVehicleTypeTabAutoSelect = false;
			this._sLastSelectedStageTabKey = "gateIn";
			this._ensureStageUiModel();
			this._updateReportingPlacementByVehicleType();
			
		},
	onAfterRendering: function() {
		this._updateCancelButtonVisibility();
		this._updateTabVisibilityForCreateMode();
		this._updateLoadingUnloadingTabs(); // Call after _updateTabVisibilityForCreateMode to ensure movement type logic takes precedence
		this._updateHeaderVisibilityForCreateMode();
	},

		onExit: function () {
			this._oEventBus?.unsubscribe("TripData", "Updated", this._refreshPageTitleModel, this);
			this._oEventBus?.unsubscribe("TripData", "Updated", this._updateLoadingUnloadingTabs, this);
			this._oEventBus?.unsubscribe("TripData", "Updated", this._applyVehicleTypeTabRule, this);
			this._oEventBus?.unsubscribe("TripData", "MovementTypeChanged", this._updateLoadingUnloadingTabs, this);
			this._oEventBus?.unsubscribe("TripData", "Updated", this._updateCancelButtonVisibility, this);
			this._oEventBus?.unsubscribe("Stage", "TripCreated", this._onTripCreated, this);
			this._oEventBus?.unsubscribe("Notes", "UnreadCountChanged", this._updateNotesTabIndicator, this);
			this._oEventBus?.unsubscribe("Stage", "ClearAllTabs", this._onClearAllTabs, this);
		},
		
	_onClearAllTabs: function () {
		// Clear page title header (Gate Pass No, Vehicle No, Trip status)
		this.resetPageTitleModel();
		// Set create mode to ensure header stays clear
		this._bCreateMode = true;
		this._sCurrentTripNumber = "";
		this._updateTabVisibilityForCreateMode();
		this._updateHeaderVisibilityForCreateMode();
	},

	_onRouteMatched: function (oEvent) {

		var oArgs = oEvent.getParameter("arguments") || {};
		var sTripNumber = oArgs.tripNo || "";
		var oQuery = oArgs["?query"] || {};
		var sRequestedTabKey = (oQuery && oQuery.tab) ? String(oQuery.tab).trim() : "";
	
		// Safely get matched route name
		var sRouteName = "";
		try {
			var oRoute = oEvent.getSource();
			// Check if route object exists and has getName method
			if (oRoute && typeof oRoute.getName === "function") {
				sRouteName = oRoute.getName();
			} else {
				// Fallback: determine route based on arguments
				// If tripNo parameter exists, it's StagewithParam route
				sRouteName = sTripNumber ? "StagewithParam" : "Stage";
			}
		} catch (oError) {
			// Error handling: determine route based on arguments as fallback
			sRouteName = sTripNumber ? "StagewithParam" : "Stage";
		}
	
		// ============================
		//   CASE 1 — CREATE MODE
		// ============================
		if (sRouteName === "Stage") {
			this._bCreateMode = true;
			this._sCurrentTripNumber = "";
			this._updateReportingPlacementByVehicleType();
	
			sap.ui.getCore().getModel("globalData")?.setProperty("/TripNumber", "");
			// Create mode normally clears TripData; however, for Incoming-materials gate entry
			// we may want to prefill Reporting/Gate-In fields (e.g. MovementScenarioDesc, Skip Document).
			var oGlobal = sap.ui.getCore().getModel("globalData");
			var sIncomingDesc = (oGlobal?.getProperty("/IncomingMovementScenarioDesc") || "").toString();
			var sIncomingSkip = (oGlobal?.getProperty("/IncomingRefDocSkip") || " ").toString();
			var sIncomingPo = (oGlobal?.getProperty("/IncomingPoNumber") || "").toString().trim();
			var sIncomingMt = (oGlobal?.getProperty("/IncomingMovementType") || "").toString().trim();
			var sIncomingMs = (oGlobal?.getProperty("/IncomingMovementScenario") || "").toString().trim();

			if (sIncomingPo || sIncomingDesc || sIncomingMt || sIncomingMs || (sIncomingSkip && sIncomingSkip.trim() === "X")) {
				var sMtDesc = "";
				if (sIncomingMt && sIncomingMt.toUpperCase() === "I") {
					sMtDesc = "Inward";
				} else if (sIncomingMt && sIncomingMt.toUpperCase() === "O") {
					sMtDesc = "Outward";
				}
				var sScenarioItemKey =
					MovementScenarioIcons.getMovementScenarioItemKey(sIncomingMt, sIncomingMs) || "";
				sap.ui.getCore().setModel(
					new JSONModel({
						MovementScenarioDesc: sIncomingDesc || "",
						RefDocSkip: (sIncomingSkip && sIncomingSkip.trim() === "X") ? "X" : " ",
						MovementType: sIncomingMt || "",
						MovementScenario: sIncomingMs || "",
						MovementScenarioItemKey: sScenarioItemKey,
						MovementTypeDesc: sMtDesc || "",
					}),
					"TripData"
				);
				sap.ui.getCore().getEventBus().publish("TripData", "Updated");
			} else if (oGlobal && oGlobal.getProperty("/OutgoingReportPrefill")) {
				var sOgDesc = (oGlobal.getProperty("/OutgoingMovementScenarioDesc") || "").toString();
				var sOgSkip = (oGlobal.getProperty("/OutgoingRefDocSkip") || " ").toString();
				var sOgMs = (oGlobal.getProperty("/OutgoingMovementScenario") || "").toString().trim();
				var sOgItemKey = (oGlobal.getProperty("/OutgoingMovementScenarioItemKey") || "").toString().trim();
				var sOgBd = (oGlobal.getProperty("/OutgoingBillingDocument") || "").toString().trim();
				var sOgVt = (oGlobal.getProperty("/OutgoingVehicleType") || "").toString().trim();
				var sOgVtDesc = (oGlobal.getProperty("/OutgoingVehicleTypeDesc") || "").toString().trim();
				oGlobal.setProperty("/OutgoingReportPrefill", false);
				var sOgKeySync = sOgItemKey || MovementScenarioIcons.getMovementScenarioItemKey("O", sOgMs) || "";
				sap.ui.getCore().setModel(
					new JSONModel({
						MovementScenarioDesc: sOgDesc || "",
						RefDocSkip: (sOgSkip && sOgSkip.trim() === "X") ? "X" : " ",
						MovementType: "O",
						MovementScenario: sOgMs || "",
						MovementScenarioItemKey: sOgKeySync,
						MovementTypeDesc: "Outward",
						BillingDocument: sOgBd || "",
						VehicleType: sOgVt || "",
						VehicleTypeDesc: sOgVtDesc || ""
					}),
					"TripData"
				);
				sap.ui.getCore().getEventBus().publish("TripData", "Updated");
			} else {
				sap.ui.getCore().setModel(null, "TripData");
			}
	
		this.resetPageTitleModel();   // ← finally clears
		this._bPendingVehicleTypeTabAutoSelect = true;
		this._applyVehicleTypeTabRule();
		this._updateCancelButtonVisibility();
		this._updateTabVisibilityForCreateMode();
		this._updateLoadingUnloadingTabs(); // Call after _updateTabVisibilityForCreateMode to ensure movement type logic takes precedence
		this._updateHeaderVisibilityForCreateMode();
	
		return;
		}
	
		// ============================
		//   CASE 2 — UPDATE MODE
		// ============================
		if (sRouteName === "StagewithParam") {
			var sTripKey = /^\d+$/.test(String(sTripNumber || "").trim())
				? String(sTripNumber).trim().padStart(10, "0")
				: String(sTripNumber || "").trim();
			var fnApplyUpdateModeUi = function () {
				this._bCreateMode = false;
				this._sCurrentTripNumber = sTripKey || sTripNumber;
				this._updateReportingPlacementByVehicleType();

				sap.ui.getCore().getModel("globalData")?.setProperty("/TripNumber", sTripKey || sTripNumber);

				if (sRequestedTabKey) {
					// If caller requested a specific tab (e.g. Gate In), honor it.
					this._setIconTabSelection(sRequestedTabKey);
					this._bPendingVehicleTypeTabAutoSelect = false;
				} else {
					// Preserve the current active tab in update mode when route does not
					// explicitly request one (e.g. post-save refresh from Gate In/Gate Out).
					var oIconTabBar = this.byId("iconTabBar");
					var sCurrentSelectedKey = oIconTabBar ? String(oIconTabBar.getSelectedKey() || "").trim() : "";
					var sTabToKeep = sCurrentSelectedKey || this._sLastSelectedStageTabKey || "gateIn";
					this._setIconTabSelection(sTabToKeep);
					this._bPendingVehicleTypeTabAutoSelect = false;
				}

				this._refreshPageTitleModel();
				this._updateCancelButtonVisibility();
				this._updateTabVisibilityForCreateMode();
				this._updateLoadingUnloadingTabs(); // Call after _updateTabVisibilityForCreateMode to ensure movement type logic takes precedence
				this._updateHeaderVisibilityForCreateMode();
			}.bind(this);

			// Always refresh TripData from backend for existing trips.
			// This prevents stale row-snapshot data from controlling panel visibility.
			this._loadTripDataForStageRoute(sTripKey || sTripNumber, fnApplyUpdateModeUi);
	}
	}
		
		,
		_setIconTabSelection: function (sKey) {
			var oIconTabBar = this.byId("iconTabBar");
			var sEffectiveKey = sKey || "gateIn";
			if (String(sEffectiveKey).trim().toLowerCase() === "gateout") {
				sEffectiveKey = "gateout";
			}
			this._sLastSelectedStageTabKey = sEffectiveKey;
			if (oIconTabBar) {
				oIconTabBar.setSelectedKey(sEffectiveKey);
			}
		}
		,

		/**
		 * O02 + Internal (01) only: create mode defaults to Gate Out (not Gate In).
		 */
		_isGateOutFirstScenario: function () {
			return (
				this._bCreateMode &&
				O02GateException.isO02InternalException(sap.ui.getCore().getModel("TripData"))
			);
		},

		_ensureStageUiModel: function () {
			var oStageUi = sap.ui.getCore().getModel("stageUi");
			if (!oStageUi) {
				oStageUi = new JSONModel({
					showReportingInGateOut: false
				});
				sap.ui.getCore().setModel(oStageUi, "stageUi");
			}
			return oStageUi;
		},

		_updateReportingPlacementByVehicleType: function () {
			var oStageUi = this._ensureStageUiModel();
			// Exception flow (O02 + Internal vehicle type 01): reporting is shown in Gate Out.
			oStageUi.setProperty("/showReportingInGateOut", !!this._isGateOutFirstScenario());
		},

		_applyVehicleTypeTabRule: function () {
			if (!this._bCreateMode && !this._bPendingVehicleTypeTabAutoSelect) {
				return;
			}
			var oTripData = sap.ui.getCore().getModel("TripData");
			if (!oTripData && !this._bCreateMode) {
				return;
			}
			if (!oTripData && this._bCreateMode) {
				this._setIconTabSelection("gateIn");
				this._updateReportingPlacementByVehicleType();
				this._updateTabVisibilityForCreateMode();
				return;
			}
			var bGateOutFirst = this._isGateOutFirstScenario();
			this._updateReportingPlacementByVehicleType();
			this._setIconTabSelection(bGateOutFirst ? "gateout" : "gateIn");
			if (this._bCreateMode) {
				this._updateTabVisibilityForCreateMode();
			}
			this._bPendingVehicleTypeTabAutoSelect = false;
		},

		_syncTripNumberFromRoute: function (sTripNumber, bReset) {
			var oGlobalModel = sap.ui.getCore().getModel("globalData");
			if (!oGlobalModel) {
				oGlobalModel = new JSONModel({
					TripNumber: ""
				});
				sap.ui.getCore().setModel(oGlobalModel, "globalData");
			}

			if (bReset) {
				this._sCurrentTripNumber = "";
				this._bCreateMode = true;
				oGlobalModel.setProperty("/TripNumber", "");
				sap.ui.getCore().setModel(null, "TripData");
			} else if (sTripNumber) {
				this._bCreateMode = false;
				oGlobalModel.setProperty("/TripNumber", sTripNumber);
				this._sCurrentTripNumber = sTripNumber;
			} else {
				this._bCreateMode = false;
				this._sCurrentTripNumber = oGlobalModel.getProperty("/TripNumber") || "";
			}

			this._refreshPageTitleModel();
		},resetPageTitleModel: function () {
			var oModel = this.getView().getModel("pageTitleModel");
		
			if (!oModel) {
				oModel = new JSONModel({
					tripNumber: "",
					vehicleNumber: "",
					tripStatus: ""
				});
				this.getView().setModel(oModel, "pageTitleModel");
				return;
			}
		
			oModel.setData({
				tripNumber: "",
				vehicleNumber: "",
				tripStatus: ""
			}, true);
		}
,		

		_initPageTitleModel: function () {
			var oCoreModel = sap.ui.getCore().getModel("pageTitleModel");
			if (!oCoreModel) {
				oCoreModel = new JSONModel({
					tripNumber: "",
					vehicleNumber: "",
					tripStatus: ""
				});
				sap.ui.getCore().setModel(oCoreModel, "pageTitleModel");
			}
			this._oPageTitleModel = oCoreModel;
			this.getView().setModel(this._oPageTitleModel, "pageTitleModel");
			this._refreshPageTitleModel();
		},

	_onTripCreated: function (sChannel, sEvent, oData) {
		// Trip was just created, update mode and refresh header
		if (oData && oData.tripNumber) {
			this._bCreateMode = false;
			this._bPendingVehicleTypeTabAutoSelect = false;
			this._sCurrentTripNumber = oData.tripNumber;
			this._updateReportingPlacementByVehicleType();

			// Ensure global TripNumber is synced so dependent views (e.g. Activity Analysis tab)
			// can reliably load data based on the current trip
			var oGlobalModel = sap.ui.getCore().getModel("globalData");
			if (!oGlobalModel) {
				oGlobalModel = new JSONModel({
					TripNumber: ""
				});
				sap.ui.getCore().setModel(oGlobalModel, "globalData");
			}
			oGlobalModel.setProperty("/TripNumber", oData.tripNumber);

			this._refreshPageTitleModel();
			this._updateHeaderVisibilityForCreateMode();
			this._updateTabVisibilityForCreateMode();
			if (oData.preferredTabKey) {
				this._setIconTabSelection(oData.preferredTabKey);
			}
		}
	},

		_refreshPageTitleModel: function () {
			if (!this._oPageTitleModel) {
				return;
			}

			if (this._bCreateMode) {
				this._oPageTitleModel.setProperty("/tripNumber", "");
				this._oPageTitleModel.setProperty("/vehicleNumber", "");
				this._oPageTitleModel.setProperty("/tripStatus", "");
				return;
			}

			var oGlobal = sap.ui.getCore().getModel("globalData");
			var sTripNo = this._sCurrentTripNumber || (oGlobal ? oGlobal.getProperty("/TripNumber") : "") || "";
			var sFormattedTripNo = this.formatTripNumber(sTripNo);
			this._oPageTitleModel.setProperty("/tripNumber", sFormattedTripNo);

			var oTripDataModel = sap.ui.getCore().getModel("TripData");
			if (oTripDataModel) {
				var sVehicle = oTripDataModel.getProperty("/VehicleNumber") || "";
				var sStatus = oTripDataModel.getProperty("/TripStatus") || "";
				this._oPageTitleModel.setProperty("/vehicleNumber", sVehicle);
				this._oPageTitleModel.setProperty("/tripStatus", sStatus);
			} else {
				this._oPageTitleModel.setProperty("/vehicleNumber", "");
				this._oPageTitleModel.setProperty("/tripStatus", "");
				if (sTripNo) {
					this._loadTripHeaderDetails(sTripNo);
				}
			}
		},

		_clearPageTitleModel: function () {
			var oModel = this._oPageTitleModel || sap.ui.getCore().getModel("pageTitleModel");
			if (!oModel) {
				return;
			}
			this._oPageTitleModel = oModel;
			this._bCreateMode = true;
			oModel.setProperty("/tripNumber", "");
			oModel.setProperty("/vehicleNumber", "");
			oModel.setProperty("/tripStatus", "");
		},

		onCancelTrip: function () {
			var sTripNumber = this._sCurrentTripNumber || sap.ui.getCore().getModel("globalData")?.getProperty("/TripNumber");
			if (!sTripNumber) {
				MessageToast.show("No trip selected to cancel");
				return;
			}

			var oWarningDialog = MessageBox.warning("Do you want to cancel the trip?", {
				actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
				onClose: function (oAction) {
					if (oAction === MessageBox.Action.OK) {
						this._deleteTrip(sTripNumber);
					}
				}.bind(this)
			});

			if (oWarningDialog) {
				oWarningDialog.attachAfterOpen(function () {
					var oOkButton = oWarningDialog.getButtons().find(function (oButton) {
						return oButton.getText() === MessageBox.Action.OK;
					});
					oOkButton?.setType(ButtonType.Reject);
				});
			}
		},

		_deleteTrip: function (sTripNumber) {
			var oService = this._getTripService();
			var sPath = "/TripDetails('" + sTripNumber + "')";

			oService.remove(sPath, {
				headers: {
					"X-Requested-With": "X"
				},
				success: function () {
					MessageToast.show("Trip cancelled successfully");
					this._handleTripCancelled();
				}.bind(this),
				error: function () {
					MessageBox.error("Failed to cancel trip. Please try again.");
				}
			});
		},

		_handleTripCancelled: function () {
			sap.ui.getCore().getEventBus().publish("HomePage", "RefreshTripTable");
			sap.ui.getCore().getModel("globalData")?.setProperty("/TripNumber", "");
			sap.ui.getCore().setModel(null, "TripData");
			this._bCreateMode = true;
			this._sCurrentTripNumber = "";
			this.resetPageTitleModel();
			this._setIconTabSelection("gateIn");
			this.getOwnerComponent().getRouter().navTo("HomePage");
		},

		_loadTripHeaderDetails: function (sTripNumber) {
			if (!sTripNumber) {
				return;
			}

			var oTripData = sap.ui.getCore().getModel("TripData");
			if (oTripData) {
				var sFormattedTripNo = this.formatTripNumber(oTripData.getProperty("/TripNumber") || sTripNumber);
				this._oPageTitleModel.setProperty("/tripNumber", sFormattedTripNo);
				this._oPageTitleModel.setProperty("/vehicleNumber", oTripData.getProperty("/VehicleNumber") || "");
				this._oPageTitleModel.setProperty("/tripStatus", oTripData.getProperty("/TripStatus") || "");
			} else {
				var sFormattedTripNo = this.formatTripNumber(sTripNumber);
				this._oPageTitleModel.setProperty("/tripNumber", sFormattedTripNo);
			}
		},

		formatTripNumber: function (sTripNumber) {
			if (!sTripNumber) {
				return "";
			}
			// Convert to string and remove leading zeros
			var sStr = String(sTripNumber);
			// Remove leading zeros but keep at least one digit (e.g., "0000000014" -> "14", "0" -> "0")
			return sStr.replace(/^0+/, "") || "0";
		},

		_getTripService: function () {
			if (!this._oTripService) {
				this._oTripService = new ODataModel("/sap/opu/odata/sap/YIGP_PLMS_SRV/", {
					useBatch: false,
					defaultBindingMode: "TwoWay"
				});
			}
			return this._oTripService;
		},
		_normalizeDelayReasonFields: function (oData) {
			if (!oData) {
				return;
			}
			var sDelayCode =
				oData.DelayReason ||
				oData.DelayReasons ||
				oData.Delay_Reason ||
				oData.DelayedReason ||
				oData.DelayReasonCode ||
				oData.Delay_Code ||
				"";
			var sDelayDesc =
				oData.DelayReasonDesc ||
				oData.DelayReasonsDesc ||
				oData.Delay_Reason_Desc ||
				oData.DelayedReasonDesc ||
				oData.DelayReasonText ||
				"";
			if (sDelayCode) {
				oData.DelayReason = sDelayCode;
				oData.DelayReasons = sDelayCode;
			}
			if (sDelayDesc) {
				oData.DelayReasonDesc = sDelayDesc;
			}
		},
		_loadTripDataForStageRoute: function (sTripNumber, fnDone) {
			var sTrip = String(sTripNumber || "").trim();
			var oService = this._getTripService();
			if (!sTrip || !oService) {
				if (typeof fnDone === "function") {
					fnDone();
				}
				return;
			}
			oService.read("/TripDetails('" + sTrip + "')", {
				urlParameters: {
					$expand: "OrderDetails,ItemDetails,Feeds,ActivityHistory",
				},
				success: function (oData) {
					this._normalizeDelayReasonFields(oData);
					if (oData && oData.Weighment_Req !== undefined) {
						oData.WeighmentRequired =
							oData.Weighment_Req === true || oData.Weighment_Req === "X"
								? "Y"
								: "N";
					}
					sap.ui.getCore().setModel(new JSONModel(oData || {}), "TripData");
					this._oEventBus.publish("TripData", "Updated");
					this._oEventBus.publish("Stage", "TripCreated", {
						tripNumber: sTrip
					});
					if (typeof fnDone === "function") {
						fnDone();
					}
				}.bind(this),
				error: function () {
					if (typeof fnDone === "function") {
						fnDone();
					}
				}
			});
		},

	_updateLoadingUnloadingTabs: function () {
		var oLoadingTab = this.byId("idLoadingMaterial");
		var oUnloadingTab = this.byId("idUnloadingMaterial");

		if (!oLoadingTab || !oUnloadingTab) {
			return;
		}

		// Loading and Unloading tabs are hidden for now (not required to show as of now).
		oLoadingTab.setVisible(false);
		oUnloadingTab.setVisible(false);
	},

		/**
		 * Update Cancel Button Visibility
		 * Hide the cancel button in CREATE mode, or if TripStatus is "Gate Out"/"Gate-Out", or "Trip Completed"/"Completed"
		 */
		_updateCancelButtonVisibility: function () {
			var oCancelButton = this.byId("btnCancelTrip");
			
			if (!oCancelButton) {
				return;
			}

			// Hide button in CREATE mode (new vehicle reporting)
			if (this._bCreateMode) {
				oCancelButton.setVisible(false);
				return;
			}

			var oTripDataModel = sap.ui.getCore().getModel("TripData");
			
			// If no trip data, hide button
			if (!oTripDataModel) {
				oCancelButton.setVisible(false);
				return;
			}

			// Check TripStatus (case-insensitive)
			var sTripStatus = (oTripDataModel.getProperty("/TripStatus") || "").trim();
			var sLowerStatus = sTripStatus.toLowerCase();
			// Gate Out: "gate out" or "gate-out"
			var bIsGateOut = sLowerStatus === "gate out" || sLowerStatus === "gate-out";
			// Trip Completed: "completed", "trip completed", "done"
			var bIsCompleted = sLowerStatus === "completed" || sLowerStatus === "trip completed" || sLowerStatus === "done";

			// Hide button if Gate Out or Trip Completed
			oCancelButton.setVisible(!bIsGateOut && !bIsCompleted);
		},

		/**
		 * Update Tab Visibility for Create Mode
		 * Normal: only Gate In (Reporting, Ref. Docs, Gate In). O02+Internal exception: only Gate Out (reporting embedded there).
		 */
		_updateTabVisibilityForCreateMode: function () {
			var oIconTabBar = this.byId("iconTabBar");
			if (!oIconTabBar) {
				return;
			}
			var bGateOutFirst = this._isGateOutFirstScenario();

			var aTabs = oIconTabBar.getItems();
			aTabs.forEach(function(oTab) {
				var sKey = oTab.getKey();
				var sId = oTab.getId();

				if (sKey === "gateIn") {
					oTab.setVisible(!this._bCreateMode || !bGateOutFirst);
					return;
				}

				if (sKey === "gateout") {
					oTab.setVisible(!this._bCreateMode || bGateOutFirst);
					return;
				}
				
				// Skip Loading and Unloading tabs - they are handled by _updateLoadingUnloadingTabs()
				if (sId && (sId.indexOf("idLoadingMaterial") !== -1 || sId.indexOf("idUnloadingMaterial") !== -1)) {
					return; // Don't change visibility - let _updateLoadingUnloadingTabs() handle it
				}
				
				// For existing trips, show all tabs except Loading/Unloading.
				// In create mode, keep non-gate tabs hidden.
				oTab.setVisible(!this._bCreateMode);
			}.bind(this));

			if (this._bCreateMode) {
				this._setIconTabSelection(bGateOutFirst ? "gateout" : "gateIn");
			}
		},

		/**
		 * Update Header Visibility for Create Mode
		 * Hide the header (Gate Pass No, Vehicle No, Trip status) when creating a new vehicle
		 */
		_updateHeaderVisibilityForCreateMode: function () {
			var oStagePage = this.byId("stagePage");
			var oHeaderBar = this.byId("headerBar");
			if (!oHeaderBar) {
				return;
			}

			// Hide header in CREATE mode, show in DISPLAY mode
			if (oStagePage) {
				oStagePage.setShowHeader(!this._bCreateMode);
			}
			oHeaderBar.setVisible(!this._bCreateMode);
		},

		/** --------------------------------------------
		 * UPDATE NOTES TAB BELL INDICATOR
		 * --------------------------------------------*/
		_updateNotesTabIndicator: function (sChannel, sEvent, oData) {
			var iUnreadCount = (oData && oData.unreadCount) ? oData.unreadCount : 0;
			var oNotesTab = this.byId("idNotesTab");
			
			if (!oNotesTab) {
				// Control might not be rendered yet, try again after a short delay
				setTimeout(function() {
					this._updateNotesTabIndicator(sChannel, sEvent, oData);
				}.bind(this), 100);
				return;
			}
			
			// Use $() to get the DOM element and manipulate classes directly
			var oDomRef = oNotesTab.$();
			if (oDomRef && oDomRef.length > 0) {
				if (iUnreadCount > 0) {
					oDomRef.addClass("notesTabWithBell");
				} else {
					oDomRef.removeClass("notesTabWithBell");
				}
			}
		},

		onIconTabSelect: function (oEvent) {
			var sSelectedKey = oEvent.getParameter("key");
			this._sLastSelectedStageTabKey = sSelectedKey || this._sLastSelectedStageTabKey || "gateIn";

			// If ReferenceDocuments tab is selected, focus on scanner input
			if (sSelectedKey === "referenceDocuments") {
				// Use setTimeout to ensure the view is rendered
				setTimeout(function() {
					// Get the ReferenceDocuments view and focus on scanner input
					var oIconTabBar = this.byId("iconTabBar");
					if (oIconTabBar) {
						var oRefDocTab = oIconTabBar.getItems().find(function(oItem) {
							return oItem.getKey() === "referenceDocuments";
						});
						
						if (oRefDocTab && oRefDocTab.getContent && oRefDocTab.getContent().length > 0) {
							var oRefDocView = oRefDocTab.getContent()[0];
							if (oRefDocView && oRefDocView.byId) {
							}
						}
					}
				}.bind(this), 100);
			}
		},

		// User-role-based authorization logic has been removed from Stage controller.

	});
});