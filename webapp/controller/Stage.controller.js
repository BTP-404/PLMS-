sap.ui.define([
	"sap/ui/core/mvc/Controller",
	"sap/ui/model/json/JSONModel",
	"sap/ui/core/Fragment",
	"sap/m/MessageToast",
	"sap/ui/model/odata/v2/ODataModel"
], function(Controller, JSONModel, Fragment, MessageToast, ODataModel) {
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
			this._initializeReferenceModels();
			this._initPageTitleModel();

			this._oEventBus = sap.ui.getCore().getEventBus();
			this._oEventBus.subscribe("TripData", "Updated", this._refreshPageTitleModel, this);
		},
		onAfterRendering: function() {},

		onExit: function () {
			this._oEventBus?.unsubscribe("TripData", "Updated", this._refreshPageTitleModel, this);
		},

		_onRouteMatched: function(oEvent) {
			var oArgs = oEvent.getParameter("arguments") || {};
			var sTripNumber = oArgs.tripNo || "";
			this._syncTripNumberFromRoute(sTripNumber);
			console.log("Navigated with Trip:", this._sCurrentTripNumber || sTripNumber);

			// You can now filter data for this trip or bind it to the view
		},

		_syncTripNumberFromRoute: function (sTripNumber) {
			var oGlobalModel = sap.ui.getCore().getModel("globalData");
			if (!oGlobalModel) {
				oGlobalModel = new JSONModel({ TripNumber: "" });
				sap.ui.getCore().setModel(oGlobalModel, "globalData");
			}

			if (sTripNumber) {
				oGlobalModel.setProperty("/TripNumber", sTripNumber);
				this._sCurrentTripNumber = sTripNumber;
			} else {
				this._sCurrentTripNumber = oGlobalModel.getProperty("/TripNumber") || "";
			}

			this._refreshPageTitleModel();
		},

		_initPageTitleModel: function () {
			this._oPageTitleModel = new JSONModel({
				tripNumber: "",
				vehicleNumber: "",
				tripStatus: ""
			});
			this.getView().setModel(this._oPageTitleModel, "pageTitleModel");
			this._refreshPageTitleModel();
		},

		_refreshPageTitleModel: function () {
			if (!this._oPageTitleModel) {
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

		_initializeReferenceModels: function () {
			var oModel = new JSONModel({
				referenceDocs: [],
				materialDetails: []
			});
			this.getView().setModel(oModel, "refDocModel");
		},

		// ============================================================
		// Reference Documents Dialog Handlers
		// ============================================================
		onAddRefDocRow: function () {
			this._openAddRefDocDialog();
		},

		_openAddRefDocDialog: function () {
			if (!this._oAddRefDocDialog) {
				Fragment.load({
					id: this.getView().getId(),
					name: "com.incresolZ_INC_PLMS.fragments.ReferenceDocumentsFrags.AddRefDocDialog",
					controller: this
				}).then(function (oDialog) {
					this._oAddRefDocDialog = oDialog;
					this.getView().addDependent(oDialog);
					oDialog.open();
				}.bind(this));
			} else {
				this._oAddRefDocDialog.open();
			}
		},

		onSaveRefDocDialog: function () {
			var oModel = this.getView().getModel("refDocModel");
			var aRefDocs = oModel.getProperty("/referenceDocs") || [];

			var oNewEntry = {
				docType: this.byId("idRefDocType")?.getValue() || "",
				documentNumber: this.byId("idRefDocNumber")?.getValue() || "",
				documentDate: this.byId("idRefDocDate")?.getValue() || "",
				partyCode: this.byId("idRefDocPartyCode")?.getValue() || "",
				partyName: this.byId("idRefDocPartyName")?.getValue() || "",
				createdBy: this.byId("idRefDocCreatedBy")?.getValue() || "",
				createdOnDate: this.byId("idRefDocCreatedOnDate")?.getValue() || "",
				createdOnTime: this.byId("idRefDocCreatedOnTime")?.getValue() || "",
				changedBy: this.byId("idRefDocChangedBy")?.getValue() || "",
				changedOnDate: this.byId("idRefDocChangedOnDate")?.getValue() || "",
				changedOnTime: this.byId("idRefDocChangedOnTime")?.getValue() || ""
			};

			aRefDocs.push(oNewEntry);
			oModel.setProperty("/referenceDocs", aRefDocs);

			MessageToast.show("Reference document added");
			this._closeRefDocDialog();
			this._resetRefDocDialog();
		},

		onCancelRefDocDialog: function () {
			this._closeRefDocDialog();
			this._resetRefDocDialog();
		},

		_closeRefDocDialog: function () {
			this._oAddRefDocDialog?.close();
		},

		_resetRefDocDialog: function () {
			[
				"idRefDocType",
				"idRefDocNumber",
				"idRefDocPartyCode",
				"idRefDocPartyName",
				"idRefDocCreatedBy",
				"idRefDocChangedBy"
			].forEach(function (sId) {
				this.byId(sId)?.setValue("");
			}.bind(this));

			[
				"idRefDocDate",
				"idRefDocCreatedOnDate",
				"idRefDocChangedOnDate"
			].forEach(function (sId) {
				var oControl = this.byId(sId);
				if (oControl && oControl.setValue) {
					oControl.setValue("");
				}
			}.bind(this));

			[
				"idRefDocCreatedOnTime",
				"idRefDocChangedOnTime"
			].forEach(function (sId) {
				var oControl = this.byId(sId);
				if (oControl && oControl.setValue) {
					oControl.setValue("");
				}
			}.bind(this));
		},

		onDeleteRefDocRow: function (oEvent) {
			var oTable = this.byId("idReferenceDocsTable");
			var oModel = this.getView().getModel("refDocModel");
			var aRefDocs = oModel.getProperty("/referenceDocs") || [];
			var iIndex = oTable.indexOfItem(oEvent.getSource().getParent());
			if (iIndex > -1) {
				aRefDocs.splice(iIndex, 1);
				oModel.setProperty("/referenceDocs", aRefDocs);
				MessageToast.show("Reference document removed");
			}
		},

		// ============================================================
		// Material Details Dialog Handlers
		// ============================================================
		onAddMaterialRow: function () {
			this._openAddMaterialDialog();
		},

		_openAddMaterialDialog: function () {
			if (!this._oAddMaterialDialog) {
				Fragment.load({
					id: this.getView().getId(),
					name: "com.incresolZ_INC_PLMS.fragments.ReferenceDocumentsFrags.AddMaterialRowDialog",
					controller: this
				}).then(function (oDialog) {
					this._oAddMaterialDialog = oDialog;
					this.getView().addDependent(oDialog);
					oDialog.open();
				}.bind(this));
			} else {
				this._oAddMaterialDialog.open();
			}
		},

		onSaveMaterialDialog: function () {
			var oModel = this.getView().getModel("refDocModel");
			var aMaterials = oModel.getProperty("/materialDetails") || [];

			var oNewMaterial = {
				refDocNo: this.byId("idMaterialRefDocNo")?.getValue() || "",
				refDocItemNo: this.byId("idMaterialRefDocItem")?.getValue() || "",
				materialCode: this.byId("idMaterialCode")?.getValue() || "",
				materialDescription: this.byId("idMaterialDesc")?.getValue() || "",
				qty: this.byId("idMaterialQty")?.getValue() || "",
				uom: this.byId("idMaterialUoM")?.getValue() || "",
				createdBy: this.byId("idMaterialCreatedBy")?.getValue() || "",
				createdOnDate: this.byId("idMaterialCreatedOnDate")?.getValue() || "",
				createdOnTime: this.byId("idMaterialCreatedOnTime")?.getValue() || "",
				changedBy: this.byId("idMaterialChangedBy")?.getValue() || "",
				changedOnDate: this.byId("idMaterialChangedOnDate")?.getValue() || "",
				changedOnTime: this.byId("idMaterialChangedOnTime")?.getValue() || ""
			};

			aMaterials.push(oNewMaterial);
			oModel.setProperty("/materialDetails", aMaterials);

			MessageToast.show("Material row added");
			this._closeMaterialDialog();
			this._resetMaterialDialog();
		},

		onCancelMaterialDialog: function () {
			this._closeMaterialDialog();
			this._resetMaterialDialog();
		},

		_closeMaterialDialog: function () {
			this._oAddMaterialDialog?.close();
		},

		_resetMaterialDialog: function () {
			[
				"idMaterialRefDocNo",
				"idMaterialRefDocItem",
				"idMaterialCode",
				"idMaterialDesc",
				"idMaterialQty",
				"idMaterialUoM",
				"idMaterialCreatedBy",
				"idMaterialChangedBy"
			].forEach(function (sId) {
				this.byId(sId)?.setValue("");
			}.bind(this));

			[
				"idMaterialCreatedOnDate",
				"idMaterialChangedOnDate"
			].forEach(function (sId) {
				this.byId(sId)?.setValue("");
			}.bind(this));

			[
				"idMaterialCreatedOnTime",
				"idMaterialChangedOnTime"
			].forEach(function (sId) {
				this.byId(sId)?.setValue("");
			}.bind(this));
		},

		onDeleteMaterialRow: function (oEvent) {
			var oTable = this.byId("idMaterialDetailsTable");
			var oModel = this.getView().getModel("refDocModel");
			var aMaterials = oModel.getProperty("/materialDetails") || [];
			var iIndex = oTable.indexOfItem(oEvent.getSource().getParent());
			if (iIndex > -1) {
				aMaterials.splice(iIndex, 1);
				oModel.setProperty("/materialDetails", aMaterials);
				MessageToast.show("Material row removed");
			}
		}
	
	});
});