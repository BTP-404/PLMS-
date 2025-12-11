sap.ui.define([
	"sap/ui/core/mvc/Controller",
	"sap/ui/model/json/JSONModel",
	"sap/ui/model/odata/v2/ODataModel",
	"sap/m/MessageBox",
	"sap/m/MessageToast",
	"sap/m/ButtonType"
], function(Controller, JSONModel, ODataModel, MessageBox, MessageToast, ButtonType) {
	"use strict";
	return Controller.extend("com.incresolZ_INC_PLMS.controller.Stage", {
		onInit: function() {
			var oRouter = this.getOwnerComponent().getRouter();
			oRouter.getRoute("Stage").attachPatternMatched(this._onRouteMatched, this);//new Vehicle Reporting Case
			oRouter.getRoute("StagewithParam").attachPatternMatched(this._onRouteMatched, this); // existing vehicle

			// Ensure global trip model exists upfront
			if (!sap.ui.getCore().getModel("globalData")) {
				sap.ui.getCore().setModel(new JSONModel({ TripNumber: "" }), "globalData");
			}
			this._initPageTitleModel();

			this._oEventBus = sap.ui.getCore().getEventBus();
			this._oEventBus.subscribe("TripData", "Updated", this._refreshPageTitleModel, this);
			this._oEventBus.subscribe("TripData", "Updated", this._updateLoadingUnloadingTabs, this);
			this._oEventBus.subscribe("Stage", "TripCreated", this._onTripCreated, this);
		},
		onAfterRendering: function() {
			this._updateLoadingUnloadingTabs();
		},

		onExit: function () {
			this._oEventBus?.unsubscribe("TripData", "Updated", this._refreshPageTitleModel, this);
			this._oEventBus?.unsubscribe("TripData", "Updated", this._updateLoadingUnloadingTabs, this);
			this._oEventBus?.unsubscribe("Stage", "TripCreated", this._onTripCreated, this);
		},

	_onRouteMatched: function (oEvent) {

		var oArgs = oEvent.getParameter("arguments") || {};
		var sTripNumber = oArgs.tripNo || "";
	
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
			console.warn("Could not get route name from event, using fallback:", sRouteName);
		}
	
		console.log("Matched route:", sRouteName);
	
		// ============================
		//   CASE 1 — CREATE MODE
		// ============================
		if (sRouteName === "Stage") {
	
			this._bCreateMode = true;
			this._sCurrentTripNumber = "";
	
			sap.ui.getCore().getModel("globalData")?.setProperty("/TripNumber", "");
			sap.ui.getCore().setModel(null, "TripData");
	
			this.resetPageTitleModel();   // ← finally clears
			this._setIconTabSelection("vehicleReporting");
			this._updateLoadingUnloadingTabs();
	
			console.log("Stage (Create): pageTitleModel cleared");
			return;
		}
	
		// ============================
		//   CASE 2 — UPDATE MODE
		// ============================
		if (sRouteName === "StagewithParam") {
	
			this._bCreateMode = false;
			this._sCurrentTripNumber = sTripNumber;
	
			sap.ui.getCore().getModel("globalData")?.setProperty("/TripNumber", sTripNumber);
	
			this._refreshPageTitleModel();
			this._updateLoadingUnloadingTabs();
	
			console.log("StagewithParam (Update): refreshed pageTitleModel");
		}
	}
		
		,
		_setIconTabSelection: function (sKey) {
			var oIconTabBar = this.byId("iconTabBar");
			if (oIconTabBar) {
				oIconTabBar.setSelectedKey(sKey || "vehicleReporting");
			}
		}
		,

		_syncTripNumberFromRoute: function (sTripNumber, bReset) {
			var oGlobalModel = sap.ui.getCore().getModel("globalData");
			if (!oGlobalModel) {
				oGlobalModel = new JSONModel({ TripNumber: "" });
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
		
			console.log("pageTitleModel reset complete");
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
				this._sCurrentTripNumber = oData.tripNumber;
				this._refreshPageTitleModel();
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
			this._setIconTabSelection("vehicleReporting");
			this.getOwnerComponent().getRouter().navTo("HomePage");
		},

		_loadTripHeaderDetails: function (sTripNumber) {
			if (!sTripNumber) {
				return;
			}

			var oService = this._getTripService();

			oService.read("/TripDetails('" + sTripNumber + "')", {
				success: function (oData) {
					var sFormattedTripNo = this.formatTripNumber(oData.TripNumber || sTripNumber);
					this._oPageTitleModel.setProperty("/tripNumber", sFormattedTripNo);
					this._oPageTitleModel.setProperty("/vehicleNumber", oData.VehicleNumber || "");
					this._oPageTitleModel.setProperty("/tripStatus", oData.TripStatus || "");
				}.bind(this),
				error: function () {
					var sFormattedTripNo = this.formatTripNumber(sTripNumber);
					this._oPageTitleModel.setProperty("/tripNumber", sFormattedTripNo);
				}.bind(this)
			});
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

		_updateLoadingUnloadingTabs: function () {
			var oTripDataModel = sap.ui.getCore().getModel("TripData");
			var oLoadingTab = this.byId("idLoadingMaterial");
			var oUnloadingTab = this.byId("idUnloadingMaterial");

			if (!oLoadingTab || !oUnloadingTab) {
				return;
			}

			if (oTripDataModel) {
				var sMovementTypeDesc = (oTripDataModel.getProperty("/MovementTypeDesc") || "").toUpperCase();
				var bIsInward = sMovementTypeDesc.indexOf("INWARD") !== -1;

				// If Inward, show Unloading and hide Loading
				// Otherwise, show Loading and hide Unloading
				if (bIsInward) {
					oUnloadingTab.setVisible(true);
					oLoadingTab.setVisible(false);
				} else {
					oLoadingTab.setVisible(true);
					oUnloadingTab.setVisible(false);
				}
			} else {
				// Default: show both tabs when no TripData (create mode)
				oLoadingTab.setVisible(true);
				oUnloadingTab.setVisible(true);
			}
		}

	});
});