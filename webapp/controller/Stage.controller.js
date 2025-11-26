sap.ui.define([
	"sap/ui/core/mvc/Controller",
	"sap/ui/model/json/JSONModel",
	"sap/ui/model/odata/v2/ODataModel"
], function(Controller, JSONModel, ODataModel) {
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
		},
		onAfterRendering: function() {},

		onExit: function () {
			this._oEventBus?.unsubscribe("TripData", "Updated", this._refreshPageTitleModel, this);
		},

		_onRouteMatched: function (oEvent) {

			var oArgs = oEvent.getParameter("arguments") || {};
			var sTripNumber = oArgs.tripNo || "";
		
			// Get matched route object correctly
			var oRoute = oEvent.getSource();
			var sRouteName = oRoute.getName();         // ← CORRECT WAY
		
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
		
				console.log("StagewithParam (Update): refreshed pageTitleModel");
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
			this._oPageTitleModel.setProperty("/tripNumber", sTripNo || "");

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

		_loadTripHeaderDetails: function (sTripNumber) {
			if (!sTripNumber) {
				return;
			}

			if (!this._oTripService) {
				this._oTripService = new ODataModel("/sap/opu/odata/sap/YIGP_PLMS_SRV/", {
					useBatch: false,
					defaultBindingMode: "TwoWay"
				});
			}

			this._oTripService.read("/TripDetails('" + sTripNumber + "')", {
				success: function (oData) {
					this._oPageTitleModel.setProperty("/tripNumber", oData.TripNumber || sTripNumber);
					this._oPageTitleModel.setProperty("/vehicleNumber", oData.VehicleNumber || "");
					this._oPageTitleModel.setProperty("/tripStatus", oData.TripStatus || "");
				}.bind(this),
				error: function () {
					this._oPageTitleModel.setProperty("/tripNumber", sTripNumber);
				}.bind(this)
			});
		},

	});
});