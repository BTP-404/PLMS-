sap.ui.define([
	"sap/ui/core/mvc/Controller",
	"sap/ui/model/json/JSONModel",
	"sap/ui/core/Fragment",
	"sap/m/MessageToast",
	"sap/m/SelectDialog",
	"sap/m/StandardListItem",
	"sap/ui/model/Filter",
	"sap/ui/model/FilterOperator",
	"sap/ui/model/odata/v2/ODataModel"
], function (Controller, JSONModel, Fragment, MessageToast, SelectDialog, StandardListItem, Filter, FilterOperator, ODataModel) {
	"use strict";

	return Controller.extend("com.incresolZ_INC_PLMS.controller.subview.ReferenceDocuments", {

		onInit: function () {
			this._ensureRefDocModel();
			this._getRefDocSuggestionModel();
			this._getMaterialSuggestionModel();
		},

		onExit: function () {
			this._oAddRefDocDialog?.destroy();
			this._oAddMaterialDialog?.destroy();
			this._oRefDocValueHelp?.destroy();
			this._oMaterialValueHelp?.destroy();
		},

		// ============================================================
		// Reference Documents Dialog Handlers
		// ============================================================
		onAddRefDocRow: function () {
			this._openAddRefDocDialog();
		},

		onRefDocSuggestionSelected: function (oEvent) {
			var oItem = oEvent.getParameter("selectedItem");
			var oCtx = oItem?.getBindingContext("refDocSuggestions");
			if (oCtx) {
				this._applySelectedReferenceDoc(oCtx.getObject());
			}
		},

		onRefDocValueHelp: function () {
			this._openRefDocValueHelpDialog();
		},

		onSaveRefDocDialog: function () {
			var oModel = this._ensureRefDocModel();
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

		onDeleteRefDocRow: function (oEvent) {
			var oTable = this.byId("idReferenceDocsTable");
			var oModel = this._ensureRefDocModel();
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

		onMaterialSuggestionSelected: function (oEvent) {
			var oItem = oEvent.getParameter("selectedItem");
			var oCtx = oItem?.getBindingContext("materialSuggestions");
			if (oCtx) {
				this._applySelectedItemDetails(oCtx.getObject());
			}
		},

		onMaterialValueHelp: function () {
			this._openMaterialValueHelpDialog();
		},

		onSaveMaterialDialog: function () {
			var oModel = this._ensureRefDocModel();
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

		onDeleteMaterialRow: function (oEvent) {
			var oTable = this.byId("idMaterialDetailsTable");
			var oModel = this._ensureRefDocModel();
			var aMaterials = oModel.getProperty("/materialDetails") || [];
			var iIndex = oTable.indexOfItem(oEvent.getSource().getParent());

			if (iIndex > -1) {
				aMaterials.splice(iIndex, 1);
				oModel.setProperty("/materialDetails", aMaterials);
				MessageToast.show("Material row removed");
			}
		},

		// ============================================================
		// Private Helpers
		// ============================================================
		_ensureRefDocModel: function () {
			var oModel = this.getView().getModel("refDocModel");

			if (!oModel) {
				oModel = new JSONModel({
					referenceDocs: [],
					materialDetails: []
				});
				this.getView().setModel(oModel, "refDocModel");
			}

			return oModel;
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
					this._loadRefDocSuggestions();
					oDialog.open();
				}.bind(this));
			} else {
				this._loadRefDocSuggestions();
				this._oAddRefDocDialog.open();
			}
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
					this._loadMaterialSuggestions();
					oDialog.open();
				}.bind(this));
			} else {
				this._loadMaterialSuggestions();
				this._oAddMaterialDialog.open();
			}
		},

		_closeRefDocDialog: function () {
			this._oAddRefDocDialog?.close();
		},

		_closeMaterialDialog: function () {
			this._oAddMaterialDialog?.close();
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
				oControl?.setValue("");
			}.bind(this));

			[
				"idRefDocCreatedOnTime",
				"idRefDocChangedOnTime"
			].forEach(function (sId) {
				var oControl = this.byId(sId);
				oControl?.setValue("");
			}.bind(this));
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
		}

		,

		_openMaterialValueHelpDialog: function () {
			this._fetchItemDetails().then(function (aItems) {
				this._updateMaterialSuggestions(aItems);
				if (!this._oMaterialValueHelp) {
					this._createMaterialValueHelpDialog();
				}

				var oModel = this._oMaterialValueHelp.getModel("itemDetailsVH");
				oModel.setProperty("/items", aItems || []);
				this._resetMaterialValueHelpFilters();
				this._oMaterialValueHelp.open();
			}.bind(this)).catch(function () {
				MessageToast.show("Unable to fetch material reference data");
			});
		},

		_createMaterialValueHelpDialog: function () {
			this._oMaterialValueHelp = new SelectDialog({
				title: "Select Material",
				search: this._onMaterialValueHelpSearch.bind(this),
				liveChange: this._onMaterialValueHelpSearch.bind(this),
				confirm: this._onMaterialValueHelpConfirm.bind(this),
				cancel: this._onMaterialValueHelpCancel.bind(this)
			});

			this._oMaterialValueHelp.setModel(new JSONModel({ items: [] }), "itemDetailsVH");
			this._oMaterialValueHelp.bindAggregation("items", {
				path: "itemDetailsVH>/items",
				template: new StandardListItem({
					title: "{itemDetailsVH>MaterialCode}",
					description: "{itemDetailsVH>MaterialDescription}",
					info: "{itemDetailsVH>RefDocNo}"
				})
			});

			this.getView().addDependent(this._oMaterialValueHelp);
		},

		_onMaterialValueHelpSearch: function (oEvent) {
			var sValue = oEvent.getParameter("value") || "";
			var oBinding = oEvent.getSource().getBinding("items");

			if (!oBinding) {
				return;
			}

			var aFilters = [];
			if (sValue) {
				aFilters.push(new Filter({
					filters: [
						new Filter("MaterialCode", FilterOperator.Contains, sValue),
						new Filter("MaterialDescription", FilterOperator.Contains, sValue),
						new Filter("RefDocNo", FilterOperator.Contains, sValue)
					],
					and: false
				}));
			}

			oBinding.filter(aFilters);
		},

		_onMaterialValueHelpConfirm: function (oEvent) {
			var oCtx = oEvent.getParameter("selectedContexts")?.[0];
			if (oCtx) {
				this._applySelectedItemDetails(oCtx.getObject());
			}
			this._resetMaterialValueHelpFilters();
		},

		_onMaterialValueHelpCancel: function () {
			this._resetMaterialValueHelpFilters();
		},

		_resetMaterialValueHelpFilters: function () {
			if (this._oMaterialValueHelp) {
				var oBinding = this._oMaterialValueHelp.getBinding("items");
				oBinding?.filter([]);
			}
		},

		_applySelectedItemDetails: function (oItem) {
			if (!oItem) {
				return;
			}

			this.byId("idMaterialRefDocNo")?.setValue(oItem.RefDocNo || "");
			this.byId("idMaterialRefDocItem")?.setValue(oItem.RefDocItemNo || "");
			this.byId("idMaterialCode")?.setValue(oItem.MaterialCode || "");
			this.byId("idMaterialDesc")?.setValue(oItem.MaterialDescription || "");
			this.byId("idMaterialQty")?.setValue(oItem.Quantity || "");
			this.byId("idMaterialUoM")?.setValue(oItem.UoM || "");
			this.byId("idMaterialCreatedBy")?.setValue(oItem.CreatedBy || "");
			this.byId("idMaterialCreatedOnDate")?.setValue(this._formatODataDate(oItem.CreatedOn));
			this.byId("idMaterialCreatedOnTime")?.setValue(this._formatODataTime(oItem.CreatedTime));
			this.byId("idMaterialChangedBy")?.setValue(oItem.ChangedBy || "");
			this.byId("idMaterialChangedOnDate")?.setValue(this._formatODataDate(oItem.ChangedDate || oItem.ChangedOn));
			this.byId("idMaterialChangedOnTime")?.setValue(this._formatODataTime(oItem.ChangedTime));
		},

		_fetchItemDetails: function () {
			if (this._aItemDetailsCache) {
				return Promise.resolve(this._aItemDetailsCache);
			}

			return new Promise(function (resolve, reject) {
				var oService = this._getItemDetailsService();
				var oGlobalModel = sap.ui.getCore().getModel("globalData");
				var sTripNumber = oGlobalModel?.getProperty("/TripNumber") || "";

				var aFilters = [];
				if (sTripNumber) {
					aFilters.push(new Filter("TripNumber", FilterOperator.EQ, sTripNumber));
				}

				oService.read("/ItemDetails", {
					filters: aFilters,
					success: function (oData) {
						var aResults = oData.results || [];
						this._aItemDetailsCache = aResults;
						resolve(aResults);
					},
					error: function (oError) {
						reject(oError);
					}
				});
			}.bind(this));
		},

		_getItemDetailsService: function () {
			if (!this._oItemDetailsService) {
				this._oItemDetailsService = new ODataModel("/sap/opu/odata/sap/YIGP_PLMS_SRV/", {
					useBatch: false
				});
			}
			return this._oItemDetailsService;
		},

		_openRefDocValueHelpDialog: function () {
			this._fetchOrderDetails().then(function (aDocs) {
				this._updateRefDocSuggestions(aDocs);
				if (!this._oRefDocValueHelp) {
					this._createRefDocValueHelpDialog();
				}

				var oModel = this._oRefDocValueHelp.getModel("orderDetailsVH");
				oModel.setProperty("/items", aDocs || []);
				this._resetRefDocValueHelpFilters();
				this._oRefDocValueHelp.open();
			}.bind(this)).catch(function () {
				MessageToast.show("Unable to fetch document reference data");
			});
		},

		_createRefDocValueHelpDialog: function () {
			this._oRefDocValueHelp = new SelectDialog({
				title: "Select Reference Document",
				search: this._onRefDocValueHelpSearch.bind(this),
				liveChange: this._onRefDocValueHelpSearch.bind(this),
				confirm: this._onRefDocValueHelpConfirm.bind(this),
				cancel: this._onRefDocValueHelpCancel.bind(this)
			});

			this._oRefDocValueHelp.setModel(new JSONModel({ items: [] }), "orderDetailsVH");
			this._oRefDocValueHelp.bindAggregation("items", {
				path: "orderDetailsVH>/items",
				template: new StandardListItem({
					title: "{orderDetailsVH>DocumentNumber}",
					description: "{orderDetailsVH>Name}",
					info: "{orderDetailsVH>DocType}"
				})
			});

			this.getView().addDependent(this._oRefDocValueHelp);
		},

		_onRefDocValueHelpSearch: function (oEvent) {
			var sValue = oEvent.getParameter("value") || "";
			var oBinding = oEvent.getSource().getBinding("items");

			if (!oBinding) {
				return;
			}

			var aFilters = [];
			if (sValue) {
				aFilters.push(new Filter({
					filters: [
						new Filter("DocumentNumber", FilterOperator.Contains, sValue),
						new Filter("DocType", FilterOperator.Contains, sValue),
						new Filter("Name", FilterOperator.Contains, sValue)
					],
					and: false
				}));
			}

			oBinding.filter(aFilters);
		},

		_onRefDocValueHelpConfirm: function (oEvent) {
			var oCtx = oEvent.getParameter("selectedContexts")?.[0];
			if (oCtx) {
				this._applySelectedReferenceDoc(oCtx.getObject());
			}
			this._resetRefDocValueHelpFilters();
		},

		_onRefDocValueHelpCancel: function () {
			this._resetRefDocValueHelpFilters();
		},

		_resetRefDocValueHelpFilters: function () {
			if (this._oRefDocValueHelp) {
				var oBinding = this._oRefDocValueHelp.getBinding("items");
				oBinding?.filter([]);
			}
		},

		_applySelectedReferenceDoc: function (oDoc) {
			if (!oDoc) {
				return;
			}

			this.byId("idRefDocType")?.setValue(oDoc.DocType || "");
			this.byId("idRefDocNumber")?.setValue(oDoc.DocumentNumber || "");
			this.byId("idRefDocDate")?.setValue(this._formatODataDate(oDoc.DocumentDate));
			this.byId("idRefDocPartyCode")?.setValue(oDoc.Vendor || oDoc.Customer || "");
			this.byId("idRefDocPartyName")?.setValue(oDoc.Name || "");
			this.byId("idRefDocCreatedBy")?.setValue(oDoc.CreatedBy || "");
			this.byId("idRefDocCreatedOnDate")?.setValue(this._formatODataDate(oDoc.CreatedOn));
			this.byId("idRefDocCreatedOnTime")?.setValue(this._formatODataTime(oDoc.CreatedTime));
			this.byId("idRefDocChangedBy")?.setValue(oDoc.ChangedBy || "");
			this.byId("idRefDocChangedOnDate")?.setValue(this._formatODataDate(oDoc.ChangedOn));
			this.byId("idRefDocChangedOnTime")?.setValue(this._formatODataTime(oDoc.ChangedTime));
		},

		_fetchOrderDetails: function () {
			if (this._aOrderDetailsCache) {
				return Promise.resolve(this._aOrderDetailsCache);
			}

			return new Promise(function (resolve, reject) {
				var oService = this._getOrderDetailsService();
				var oGlobalModel = sap.ui.getCore().getModel("globalData");
				var sTripNumber = oGlobalModel?.getProperty("/TripNumber") || "";

				var aFilters = [];
				if (sTripNumber) {
					aFilters.push(new Filter("TripNumber", FilterOperator.EQ, sTripNumber));
				}

				oService.read("/OrderDetails", {
					filters: aFilters,
					success: function (oData) {
						var aResults = oData.results || [];
						this._aOrderDetailsCache = aResults;
						resolve(aResults);
					},
					error: function (oError) {
						reject(oError);
					}
				});
			}.bind(this));
		},

		_getOrderDetailsService: function () {
			if (!this._oOrderDetailsService) {
				this._oOrderDetailsService = new ODataModel("/sap/opu/odata/sap/YIGP_PLMS_SRV/", {
					useBatch: false
				});
			}
			return this._oOrderDetailsService;
		},

		_getRefDocSuggestionModel: function () {
			if (!this._oRefDocSuggestionsModel) {
				this._oRefDocSuggestionsModel = new JSONModel({ items: [] });
				this.getView().setModel(this._oRefDocSuggestionsModel, "refDocSuggestions");
			}
			return this._oRefDocSuggestionsModel;
		},

		_getMaterialSuggestionModel: function () {
			if (!this._oMaterialSuggestionsModel) {
				this._oMaterialSuggestionsModel = new JSONModel({ items: [] });
				this.getView().setModel(this._oMaterialSuggestionsModel, "materialSuggestions");
			}
			return this._oMaterialSuggestionsModel;
		},

		_loadRefDocSuggestions: function () {
			this._fetchOrderDetails().then(function (aDocs) {
				this._updateRefDocSuggestions(aDocs);
			}.bind(this)).catch(function () {});
		},

		_loadMaterialSuggestions: function () {
			this._fetchItemDetails().then(function (aItems) {
				this._updateMaterialSuggestions(aItems);
			}.bind(this)).catch(function () {});
		},

		_updateRefDocSuggestions: function (aDocs) {
			this._getRefDocSuggestionModel().setProperty("/items", aDocs || []);
		},

		_updateMaterialSuggestions: function (aItems) {
			this._getMaterialSuggestionModel().setProperty("/items", aItems || []);
		},

		_formatODataDate: function (vDate) {
			if (!vDate) {
				return "";
			}
			if (vDate instanceof Date) {
				return vDate.toISOString().slice(0, 10);
			}
			if (typeof vDate === "string" && vDate.indexOf("/Date") === 0) {
				var iTimestamp = parseInt(vDate.replace(/\D/g, ""), 10);
				if (!isNaN(iTimestamp)) {
					return new Date(iTimestamp).toISOString().slice(0, 10);
				}
			}
			return vDate;
		},

		_formatODataTime: function (vTime) {
			var iMs = NaN;

			if (!vTime && vTime !== 0) {
				return "";
			}

			if (typeof vTime === "object" && typeof vTime.ms === "number") {
				iMs = vTime.ms;
			} else if (typeof vTime === "number") {
				iMs = vTime;
			} else if (typeof vTime === "string") {
				var oMatch = vTime.match(/PT(\d+)H(\d+)M(\d+)S/);
				if (oMatch) {
					iMs = ((parseInt(oMatch[1], 10) || 0) * 3600 +
						(parseInt(oMatch[2], 10) || 0) * 60 +
						(parseInt(oMatch[3], 10) || 0)) * 1000;
				}
			}

			if (isNaN(iMs)) {
				return "";
			}

			var iHours = Math.floor(iMs / 3600000);
			var iMinutes = Math.floor((iMs % 3600000) / 60000);
			var iSeconds = Math.floor((iMs % 60000) / 1000);

			return this._padTime(iHours) + ":" + this._padTime(iMinutes) + ":" + this._padTime(iSeconds);
		},

		_padTime: function (iValue) {
			return String(iValue).padStart(2, "0");
		}
	});
});

