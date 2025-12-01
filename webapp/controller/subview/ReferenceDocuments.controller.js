sap.ui.define([
	"sap/ui/core/mvc/Controller",
	"sap/ui/model/json/JSONModel",
	"sap/ui/core/Fragment",
	"sap/m/MessageToast",
	"sap/m/MessageBox",
	"sap/m/SelectDialog",
	"sap/m/StandardListItem",
	"sap/ui/model/Filter",
	"sap/ui/model/FilterOperator",
	"sap/ui/model/odata/v2/ODataModel"
], function (Controller, JSONModel, Fragment, MessageToast, MessageBox, SelectDialog, StandardListItem, Filter, FilterOperator, ODataModel) {
	"use strict";

	return Controller.extend("com.incresolZ_INC_PLMS.controller.subview.ReferenceDocuments", {

	onInit: function () {
		this._ensureRefDocModel();
		this._getRefDocSuggestionModel();
		this._getMaterialSuggestionModel();
		this._loadDocTypes();
		this._sSelectedDocType = "";
		this._sSelectedMaterialDocType = "";
		this._iEditingRefDocIndex = -1;
		this._oEditingRefDoc = null;
		this._iEditingMaterialIndex = -1;
		this._oEditingMaterial = null;
		this._oSelectedRefDoc = null; // Track selected reference document
		this._oEventBus = sap.ui.getCore().getEventBus();
		this._oEventBus.subscribe("TripData", "Updated", this._onTripDataUpdated, this);
		this._onTripDataUpdated(); // Initial load
	},

	onExit: function () {
		this._oAddRefDocDialog?.destroy();
		this._oAddMaterialDialog?.destroy();
		this._oRefDocValueHelp?.destroy();
		this._oMaterialValueHelp?.destroy();
		if (this._oEventBus) {
			this._oEventBus.unsubscribe("TripData", "Updated", this._onTripDataUpdated, this);
		}
	},

		// ============================================================
		// Reference Documents Selection Handler
		// ============================================================
		onRefDocSelectionChange: function (oEvent) {
			var oSelectedItem = oEvent.getParameter("selectedItem");
			if (oSelectedItem) {
				var oCtx = oSelectedItem.getBindingContext("refDocModel");
				if (oCtx) {
					this._oSelectedRefDoc = oCtx.getObject();
					this._filterMaterialDetails();
				}
			} else {
				// No selection - show all materials
				this._oSelectedRefDoc = null;
				this._filterMaterialDetails();
			}
		},

		_filterMaterialDetails: function () {
			var oModel = this._ensureRefDocModel();
			var aAllMaterials = oModel.getProperty("/materialDetails") || [];
			var aFilteredMaterials = [];

			if (this._oSelectedRefDoc) {
				var sSelectedDocType = this._oSelectedRefDoc.docType || "";
				var sSelectedDocNumber = this._oSelectedRefDoc.documentNumber || "";

				// Filter materials that match the selected Reference Document
				aFilteredMaterials = aAllMaterials.filter(function (oMaterial) {
					var sMaterialDocType = oMaterial.docType || "";
					var sMaterialRefDocNo = oMaterial.refDocNo || "";
					return sMaterialDocType === sSelectedDocType && sMaterialRefDocNo === sSelectedDocNumber;
				});
			} else {
				// No selection - show all materials
				aFilteredMaterials = aAllMaterials;
			}

			oModel.setProperty("/filteredMaterialDetails", aFilteredMaterials);
		},

		// ============================================================
		// Reference Documents Dialog Handlers
		// ============================================================
		onAddRefDocRow: function () {
			this._resetRefDocDialog();
			this._openAddRefDocDialog();
		},

		onEditRefDocRow: function (oEvent) {
			var oCtx = oEvent.getSource().getBindingContext("refDocModel");
			if (!oCtx) {
				return;
			}

			var oData = oCtx.getObject() || {};
			var sPath = oCtx.getPath();
			var iIndex = parseInt(sPath.substring(sPath.lastIndexOf("/") + 1), 10);

			if (isNaN(iIndex)) {
				return;
			}

			this._iEditingRefDocIndex = iIndex;
			this._oEditingRefDoc = Object.assign({}, oData);

			this._openAddRefDocDialog().then(function () {
				this._populateRefDocDialog(oData);
				this._setRefDocDialogMode("edit");
			}.bind(this));
		},

		onDocTypeSuggestionSelected: function (oEvent) {
			var oItem = oEvent.getParameter("selectedItem");
			if (oItem) {
				var sDocType = oItem.getKey();
				oEvent.getSource().setValue(sDocType);
				this._sSelectedDocType = sDocType;
				this._loadRefDocSuggestions(sDocType);
			}
		},

		onRefDocSuggestionSelected: function (oEvent) {
			var oItem = oEvent.getParameter("selectedItem");
			var oCtx = oItem?.getBindingContext("refDocSuggestions");
			if (oCtx) {
				this._applySelectedReferenceDoc(oCtx.getObject());
			}
		},

		onDocTypeValueHelp: function () {
			this._loadDocTypes()
				.then(function (aDocTypes) {
					if (!this._oDocTypeValueHelp) {
						this._createDocTypeValueHelpDialog();
					}
					this._oDocTypeValueHelp
						.getModel("docTypeVH")
						.setProperty("/items", aDocTypes || []);
					this._resetDocTypeValueHelpFilters();
					this._oDocTypeValueHelp.open();
				}.bind(this))
				.catch(function () {
					MessageToast.show("Unable to load document types");
				});
		},

		onRefDocValueHelp: function () {
			var sDocType = this._sSelectedDocType || this.byId("idRefDocType")?.getValue().trim();
			if (!sDocType) {
				return MessageToast.show("Select a Doc Type first");
			}
			this._openRefDocValueHelpDialog(sDocType);
		},

		onSaveRefDocDialog: function () {
			var oPayload = this._buildOrderDetailPayload();
			if (!oPayload.TripNumber) {
				return MessageToast.show("Trip Number missing. Please open a trip first.");
			}
			if (!oPayload.DocType) {
				return MessageToast.show("Doc Type is mandatory");
			}
			if (!oPayload.DocumentNumber) {
				return MessageToast.show("Document Number is mandatory");
			}

			var bIsEdit = this._iEditingRefDocIndex > -1;
			var oSavePromise = bIsEdit ? this._updateOrderDetail(oPayload) : this._saveOrderDetail(oPayload);

			oSavePromise
				.then(function (oResponse) {
					if (bIsEdit) {
						this._updateLocalReferenceDoc(oResponse || oPayload);
						MessageToast.show("Reference document updated");
					} else {
					this._appendLocalReferenceDoc(oResponse || oPayload);
					MessageToast.show("Reference document added");
					this._loadRefDocSuggestions(this._sSelectedDocType || oPayload.DocType);
					// Update Material Doc Types and Document Numbers when new Reference Document is added
					this._loadMaterialDocTypesFromRefDocs();
					this._loadMaterialRefDocNumbersFromRefDocs();
				}
				this._closeRefDocDialog();
				this._resetRefDocDialog();
			}.bind(this))
				.catch(function () {
					MessageToast.show(bIsEdit ? "Unable to update reference document" : "Unable to save reference document");
				});
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

			if (iIndex < 0 || !aRefDocs[iIndex]) {
				return;
			}

			var oRefDoc = aRefDocs[iIndex];
			var sTripNumber = oRefDoc.tripNumber || "";
			var sDocType = oRefDoc.docType || "";
			var sDocumentNumber = oRefDoc.documentNumber || "";

			if (!sTripNumber || !sDocType || !sDocumentNumber) {
				MessageToast.show("Cannot delete: Missing required information");
				return;
			}

			MessageBox.confirm(
				"Are you sure you want to delete this reference document?",
				{
					title: "Confirm Delete",
					onClose: function (sAction) {
						if (sAction === MessageBox.Action.OK) {
							this._deleteOrderDetail(sTripNumber, sDocType, sDocumentNumber, iIndex);
						}
					}.bind(this)
				}
			);
		},

	_deleteOrderDetail: function (sTripNumber, sDocType, sDocumentNumber, iIndex) {
		var oService = this._getOrderDetailsService();
		var sPath = this._buildOrderDetailKeyPath(sTripNumber, sDocType, sDocumentNumber);
		var oModel = this._ensureRefDocModel();
		var aRefDocs = oModel.getProperty("/referenceDocs") || [];

		// Use soft delete by updating Deleted flag to true
		var oPayload = {
			Deleted: true
		};

		oService.update(sPath, oPayload, {
			headers: {
				"X-Requested-With": "X"
			},
			success: function () {
				aRefDocs.splice(iIndex, 1);
				oModel.setProperty("/referenceDocs", aRefDocs);
				// Update Material Doc Types and Document Numbers when Reference Document is deleted
				this._loadMaterialDocTypesFromRefDocs();
				this._loadMaterialRefDocNumbersFromRefDocs();
				MessageToast.show("Reference document deleted successfully");
			}.bind(this),
			error: function (oError) {
				var sMessage = "Failed to delete reference document";
				try {
					var oResponse = JSON.parse(oError.responseText);
					if (oResponse.error && oResponse.error.message && oResponse.error.message.value) {
						sMessage = oResponse.error.message.value;
					}
				} catch (e) {
					if (oError.message && oError.message.value) {
						sMessage = oError.message.value;
					}
				}
				MessageToast.show(sMessage);
			}
		});
	},

		// ============================================================
		// Material Details Dialog Handlers
		// ============================================================
		onAddMaterialRow: function () {
			this._resetMaterialDialog();
			this._openAddMaterialDialog();
		},

		onEditMaterialRow: function (oEvent) {
			var oCtx = oEvent.getSource().getBindingContext("refDocModel");
			if (!oCtx) {
				return;
			}

			var oData = oCtx.getObject() || {};
			var sPath = oCtx.getPath();
			var iIndex = parseInt(sPath.substring(sPath.lastIndexOf("/") + 1), 10);

			if (isNaN(iIndex)) {
				return;
			}

			this._iEditingMaterialIndex = iIndex;
			this._oEditingMaterial = Object.assign({}, oData);

			this._openAddMaterialDialog().then(function () {
				this._populateMaterialDialog(oData);
				this._setMaterialDialogMode("edit");
			}.bind(this));
		},

		onMaterialDocTypeSuggestionSelected: function (oEvent) {
			var oItem = oEvent.getParameter("selectedItem");
			if (oItem) {
				var sDocType = oItem.getKey();
				oEvent.getSource().setValue(sDocType);
				this._sSelectedMaterialDocType = sDocType;
				this._loadMaterialSuggestions(sDocType);
			}
		},

		onMaterialDocTypeChange: function (oEvent) {
			var sValue = oEvent.getSource().getValue().trim();
			this._sSelectedMaterialDocType = sValue;
			// Update Document Number suggestions based on selected Doc Type
			this._loadMaterialRefDocNumbersFromRefDocs(sValue);
			if (sValue) {
				this._loadMaterialSuggestions(sValue);
			} else {
				this._loadMaterialSuggestions("");
			}
		},

		onMaterialDocTypeValueHelp: function () {
			var aDocTypes = this._getMaterialDocTypesFromRefDocs();
			if (!aDocTypes || aDocTypes.length === 0) {
				return MessageToast.show("No reference documents found. Please add a reference document first.");
			}
			if (!this._oMaterialDocTypeVH) {
				this._createMaterialDocTypeValueHelpDialog();
			}
			this._oMaterialDocTypeVH
				.getModel("docTypeVHMaterial")
				.setProperty("/items", aDocTypes || []);
			this._resetMaterialDocTypeVHFilters();
			this._oMaterialDocTypeVH.open();
		},

		onMaterialSuggestionSelected: function (oEvent) {
			var oItem = oEvent.getParameter("selectedItem");
			var oCtx = oItem?.getBindingContext("materialSuggestions");
			if (oCtx) {
				this._applySelectedItemDetails(oCtx.getObject());
			}
		},

	onMaterialValueHelp: function () {
		var sDocType = this._sSelectedMaterialDocType || this.byId("idMaterialDocType")?.getValue().trim();
		if (!sDocType) {
			return MessageToast.show("Select a Doc Type first");
		}
		this._openMaterialValueHelpDialog(sDocType);
	},

	onMaterialRefDocNoValueHelp: function () {
		var sDocType = this._sSelectedMaterialDocType || this.byId("idMaterialDocType")?.getValue().trim();
		if (!sDocType) {
			return MessageToast.show("Select a Doc Type first");
		}
		var aRefDocs = this._getMaterialRefDocNumbersFromRefDocs(sDocType);
		if (!aRefDocs || aRefDocs.length === 0) {
			return MessageToast.show("No document numbers found for the selected Doc Type.");
		}
		this._openMaterialRefDocNoValueHelpDialog(sDocType);
	},

	onMaterialRefDocNoSuggestionSelected: function (oEvent) {
		var oItem = oEvent.getParameter("selectedItem");
		var oCtx = oItem?.getBindingContext("refDocSuggestions");
		if (oCtx) {
			this._applySelectedRefDocForMaterial(oCtx.getObject());
		}
	},

	onMaterialRefDocNoChange: function (oEvent) {
		var sRefDocNo = oEvent.getParameter("value") || "";
		var sDocType = this._sSelectedMaterialDocType || this.byId("idMaterialDocType")?.getValue().trim() || "";

		// Only fetch if both DocType and RefDocNo are provided
		if (sDocType && sRefDocNo) {
			this._fetchItemDetailsByRefDocNo(sDocType, sRefDocNo)
				.then(function (aItems) {
					if (aItems && aItems.length > 0) {
						// If multiple items, show value help dialog to select one
						// If single item, auto-populate
						if (aItems.length === 1) {
							this._populateMaterialFromItemDetail(aItems[0]);
						} else {
							// Show value help dialog to select item
							this._showItemDetailsValueHelp(aItems);
						}
					}
				}.bind(this))
				.catch(function (oError) {
					// Silently fail if no items found or error occurs
				});
		}
	},

		onSaveMaterialDialog: function () {
			var oPayload = this._buildMaterialDetailPayload();
			if (!oPayload.TripNumber) {
				return MessageToast.show("Trip Number missing. Please open a trip first.");
			}
			if (!oPayload.DocType) {
				return MessageToast.show("Material Doc Type is mandatory");
			}
			if (!oPayload.RefDocNo) {
				return MessageToast.show("Ref Doc Number is mandatory");
			}
			if (!oPayload.RefDocItemNo) {
				return MessageToast.show("Ref Doc Item Number is mandatory");
			}
			if (!oPayload.MaterialCode) {
				return MessageToast.show("Material Code is mandatory");
			}
			if (!oPayload.MaterialDescription) {
				return MessageToast.show("Material Description is mandatory");
			}
			if (oPayload.Quantity === null || oPayload.Quantity === undefined || isNaN(oPayload.Quantity)) {
				return MessageToast.show("Quantity must be a valid number");
			}
			

			var bIsEdit = this._iEditingMaterialIndex > -1;
			var oSavePromise = bIsEdit ? this._updateMaterialDetail(oPayload) : this._saveMaterialDetail(oPayload);

			oSavePromise
				.then(function (oResponse) {
					if (bIsEdit) {
						this._updateLocalMaterialDetail(oResponse || oPayload);
						MessageToast.show("Material row updated");
					} else {
						this._appendLocalMaterialDetail(oResponse || oPayload);
						MessageToast.show("Material row added");
					}
					this._closeMaterialDialog();
					this._resetMaterialDialog();
				}.bind(this))
				.catch(function () {
					MessageToast.show(bIsEdit ? "Unable to update material row" : "Unable to save material row");
				});
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

		if (iIndex < 0 || !aMaterials[iIndex]) {
			return;
		}

		var oMaterial = aMaterials[iIndex];
		var sDocType = oMaterial.docType || "";
		var sTripNumber = oMaterial.tripNumber || "";
		var sRefDocNo = oMaterial.refDocNo || "";
		var sRefDocItemNo = oMaterial.refDocItemNo || "";

		if (!sDocType || !sTripNumber || !sRefDocNo || !sRefDocItemNo) {
			MessageToast.show("Cannot delete: Missing required information");
			return;
		}

		MessageBox.confirm(
			"Are you sure you want to delete this material detail?",
			{
				title: "Confirm Delete",
				onClose: function (sAction) {
					if (sAction === MessageBox.Action.OK) {
						this._deleteItemDetail(sDocType, sTripNumber, sRefDocNo, sRefDocItemNo, iIndex);
					}
				}.bind(this)
			}
		);
	},

	_deleteItemDetail: function (sDocType, sTripNumber, sRefDocNo, sRefDocItemNo, iIndex) {
		var oService = this._getItemDetailsService();
		var sPath = this._buildMaterialDetailKeyPath(sDocType, sTripNumber, sRefDocNo, sRefDocItemNo);
		var oModel = this._ensureRefDocModel();
		var aMaterials = oModel.getProperty("/materialDetails") || [];

		// Use soft delete by updating IsDeleted flag to "X"
		var oPayload = {
			IsDeleted: "X"
		};

		oService.update(sPath, oPayload, {
			headers: {
				"X-Requested-With": "X"
			},
			success: function () {
				aMaterials.splice(iIndex, 1);
				oModel.setProperty("/materialDetails", aMaterials);
				// Update filtered list after deleting material
				this._filterMaterialDetails();
				MessageToast.show("Material detail deleted successfully");
			}.bind(this),
			error: function (oError) {
				var sMessage = "Failed to delete material detail";
				try {
					var oResponse = JSON.parse(oError.responseText);
					if (oResponse.error && oResponse.error.message && oResponse.error.message.value) {
						sMessage = oResponse.error.message.value;
					}
				} catch (e) {
					if (oError.message && oError.message.value) {
						sMessage = oError.message.value;
					}
				}
				MessageToast.show(sMessage);
			}
		});
	},

		// ============================================================
		// Private Helpers
		// ============================================================
	_ensureRefDocModel: function () {
		var oModel = this.getView().getModel("refDocModel");

		if (!oModel) {
			oModel = new JSONModel({
				referenceDocs: [],
				materialDetails: [],
				filteredMaterialDetails: [],
				materialDocTypes: [],
				materialRefDocNumbers: []
			});
			this.getView().setModel(oModel, "refDocModel");
		}

		return oModel;
	},

		_openAddRefDocDialog: function () {
			return new Promise(function (resolve) {
				if (!this._oAddRefDocDialog) {
					Fragment.load({
						id: this.getView().getId(),
						name: "com.incresolZ_INC_PLMS.fragments.ReferenceDocumentsFrags.AddRefDocDialog",
						controller: this
					}).then(function (oDialog) {
						this._oAddRefDocDialog = oDialog;
						this.getView().addDependent(oDialog);
						oDialog.open();
						this.onDocTypeValueHelp();
						resolve(oDialog);
					}.bind(this));
				} else {
					this._oAddRefDocDialog.open();
					this.onDocTypeValueHelp();
					resolve(this._oAddRefDocDialog);
				}
			}.bind(this));
		},

		_openAddMaterialDialog: function () {
			return new Promise(function (resolve) {
				if (!this._oAddMaterialDialog) {
					Fragment.load({
						id: this.getView().getId(),
						name: "com.incresolZ_INC_PLMS.fragments.ReferenceDocumentsFrags.AddMaterialRowDialog",
						controller: this
					}).then(function (oDialog) {
						this._oAddMaterialDialog = oDialog;
						this.getView().addDependent(oDialog);
						this._loadMaterialDocTypesFromRefDocs();
						this._loadMaterialRefDocNumbersFromRefDocs();
						this._loadMaterialSuggestions(this._sSelectedMaterialDocType);
						oDialog.open();
						resolve(oDialog);
					}.bind(this));
				} else {
					this._loadMaterialDocTypesFromRefDocs();
					this._loadMaterialRefDocNumbersFromRefDocs();
					this._loadMaterialSuggestions(this._sSelectedMaterialDocType);
					this._oAddMaterialDialog.open();
					resolve(this._oAddMaterialDialog);
				}
			}.bind(this));
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
				"idRefDocPartyName"
			].forEach(function (sId) {
				this.byId(sId)?.setValue("");
			}.bind(this));

			[
				"idRefDocDate"
			].forEach(function (sId) {
				var oControl = this.byId(sId);
				oControl?.setValue("");
			}.bind(this));

			this._iEditingRefDocIndex = -1;
			this._oEditingRefDoc = null;
			this._setRefDocDialogMode("add");
		},

		_populateRefDocDialog: function (oData) {
			if (!oData) {
				return;
			}

			this.byId("idRefDocType")?.setValue(oData.docType || "");
			this.byId("idRefDocNumber")?.setValue(oData.documentNumber || "");
			this.byId("idRefDocPartyCode")?.setValue(oData.partyCode || "");
			this.byId("idRefDocPartyName")?.setValue(oData.partyName || "");
			this.byId("idRefDocDate")?.setValue(oData.documentDate || "");
			this._sSelectedDocType = oData.docType || this._sSelectedDocType;
		},

		_setRefDocDialogMode: function (sMode) {
			var oDialog = this.byId("idAddRefDocDialog");
			var oSaveButton = this.byId("idRefDocDialogSaveBtn");
			var bIsEdit = sMode === "edit";

			oDialog?.setTitle(bIsEdit ? "Edit Reference Document" : "Add Reference Document");
			oSaveButton?.setText(bIsEdit ? "Update" : "Add");
		},

		_resetMaterialDialog: function () {
			[
				"idMaterialDocType",
				"idMaterialRefDocNo",
				"idMaterialRefDocItem",
				"idMaterialCode",
				"idMaterialDesc",
				"idMaterialQty",
				"idMaterialUoM"
			].forEach(function (sId) {
				this.byId(sId)?.setValue("");
			}.bind(this));

			this._sSelectedMaterialDocType = "";
			this._iEditingMaterialIndex = -1;
			this._oEditingMaterial = null;
			this._setMaterialDialogMode("add");
		},

		_populateMaterialDialog: function (oData) {
			if (!oData) {
				return;
			}

			this.byId("idMaterialDocType")?.setValue(oData.docType || "");
			this.byId("idMaterialRefDocNo")?.setValue(oData.refDocNo || "");
			this.byId("idMaterialRefDocItem")?.setValue(oData.refDocItemNo || "");
			this.byId("idMaterialCode")?.setValue(oData.materialCode || "");
			this.byId("idMaterialDesc")?.setValue(oData.materialDescription || "");
			this.byId("idMaterialQty")?.setValue(oData.qty || "");
			this.byId("idMaterialUoM")?.setValue(oData.uom || "");
			this._sSelectedMaterialDocType = oData.docType || this._sSelectedMaterialDocType;
		},

		_setMaterialDialogMode: function (sMode) {
			var oDialog = this.byId("idAddMaterialDialog");
			var oSaveButton = this.byId("idMaterialDialogSaveBtn");
			var bIsEdit = sMode === "edit";

			oDialog?.setTitle(bIsEdit ? "Edit Material Row" : "Add Material Row");
			oSaveButton?.setText(bIsEdit ? "Update" : "Add");
		},
		
		_openMaterialValueHelpDialog: function (sDocType) {
			this._fetchItemDetails(sDocType)
				.then(function (aItems) {
					this._updateMaterialSuggestions(aItems);
					if (!this._oMaterialValueHelp) {
						this._createMaterialValueHelpDialog();
					}

					var oModel = this._oMaterialValueHelp.getModel("itemDetailsVH");
					oModel.setProperty("/items", aItems || []);
					this._resetMaterialValueHelpFilters();
					this._oMaterialValueHelp.open();
				}.bind(this))
				.catch(function () {
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

		_openMaterialRefDocNoValueHelpDialog: function (sDocType) {
			var aDocs = this._getMaterialRefDocNumbersFromRefDocs(sDocType);
			this._updateRefDocSuggestions(aDocs);
			if (!this._oMaterialRefDocNoValueHelp) {
				this._createMaterialRefDocNoValueHelpDialog();
			}

			var oModel = this._oMaterialRefDocNoValueHelp.getModel("orderDetailsVH");
			oModel.setProperty("/items", aDocs || []);
			this._resetMaterialRefDocNoValueHelpFilters();
			this._oMaterialRefDocNoValueHelp.open();
		},

		_createMaterialRefDocNoValueHelpDialog: function () {
			this._oMaterialRefDocNoValueHelp = new SelectDialog({
				title: "Select Reference Document",
				search: this._onMaterialRefDocNoValueHelpSearch.bind(this),
				liveChange: this._onMaterialRefDocNoValueHelpSearch.bind(this),
				confirm: this._onMaterialRefDocNoValueHelpConfirm.bind(this),
				cancel: this._onMaterialRefDocNoValueHelpCancel.bind(this)
			});

			this._oMaterialRefDocNoValueHelp.setModel(new JSONModel({ items: [] }), "orderDetailsVH");
			this._oMaterialRefDocNoValueHelp.bindAggregation("items", {
				path: "orderDetailsVH>/items",
				template: new StandardListItem({
					title: "{orderDetailsVH>DocumentNumber}",
					description: "{orderDetailsVH>Name}",
					info: "{orderDetailsVH>DocType}"
				})
			});

			this.getView().addDependent(this._oMaterialRefDocNoValueHelp);
		},

		_onMaterialRefDocNoValueHelpSearch: function (oEvent) {
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

		_onMaterialRefDocNoValueHelpConfirm: function (oEvent) {
			var oCtx = oEvent.getParameter("selectedContexts")?.[0];
			if (oCtx) {
				this._applySelectedRefDocForMaterial(oCtx.getObject());
			}
			this._resetMaterialRefDocNoValueHelpFilters();
		},

		_onMaterialRefDocNoValueHelpCancel: function () {
			this._resetMaterialRefDocNoValueHelpFilters();
		},

		_resetMaterialRefDocNoValueHelpFilters: function () {
			if (this._oMaterialRefDocNoValueHelp) {
				var oBinding = this._oMaterialRefDocNoValueHelp.getBinding("items");
				oBinding?.filter([]);
			}
		},

	_applySelectedRefDocForMaterial: function (oDoc) {
		if (!oDoc) {
			return;
		}

		var sDocType = oDoc.DocType || "";
		var sRefDocNo = oDoc.DocumentNumber || "";

		// Set Doc Type and Ref Doc Number
		this.byId("idMaterialDocType")?.setValue(sDocType);
		this._sSelectedMaterialDocType = sDocType || this._sSelectedMaterialDocType;
		this.byId("idMaterialRefDocNo")?.setValue(sRefDocNo);

		// Fetch ItemDetails for the selected reference document
		if (sDocType && sRefDocNo) {
			this._fetchItemDetailsByRefDocNo(sDocType, sRefDocNo)
				.then(function (aItems) {
					if (aItems && aItems.length > 0) {
						// If multiple items, show value help dialog to select one
						// If single item, auto-populate
						if (aItems.length === 1) {
							this._populateMaterialFromItemDetail(aItems[0]);
						} else {
							// Show value help dialog to select item
							this._showItemDetailsValueHelp(aItems);
						}
					} else {
						MessageToast.show("No material details found for the selected reference document");
					}
				}.bind(this))
				.catch(function (oError) {
					MessageToast.show("Unable to fetch material details for the selected reference document");
				});
		}
	},

	_fetchItemDetailsByRefDocNo: function (sDocType, sRefDocNo) {
		return new Promise(function (resolve, reject) {
			var oService = this._getItemDetailsService();
			var oGlobalModel = sap.ui.getCore().getModel("globalData");
			var sTripNumber = oGlobalModel?.getProperty("/TripNumber") || "";

			if (!sTripNumber) {
				reject(new Error("Trip Number missing"));
				return;
			}

			var aFilters = [
				new Filter("TripNumber", FilterOperator.EQ, sTripNumber),
				new Filter("DocType", FilterOperator.EQ, sDocType),
				new Filter("RefDocNo", FilterOperator.EQ, sRefDocNo),
				new Filter("IsDeleted", FilterOperator.NE, "X") // Exclude deleted items
			];

			oService.read("/ItemDetails", {
				filters: aFilters,
				success: function (oData) {
					var aResults = oData.results || [];
					resolve(aResults);
				},
				error: function (oError) {
					reject(oError);
				}
			});
		}.bind(this));
	},

	_populateMaterialFromItemDetail: function (oItem) {
		if (!oItem) {
			return;
		}

		this.byId("idMaterialRefDocItem")?.setValue(oItem.RefDocItemNo || "");
		this.byId("idMaterialCode")?.setValue(oItem.MaterialCode || "");
		this.byId("idMaterialDesc")?.setValue(oItem.MaterialDescription || "");
		var vQty = oItem.Quantity;
		var sQty = (vQty === null || vQty === undefined) ? "" : String(vQty);
		this.byId("idMaterialQty")?.setValue(sQty);
		this.byId("idMaterialUoM")?.setValue(oItem.UoM || "");
	},

	_showItemDetailsValueHelp: function (aItems) {
		if (!this._oItemDetailsValueHelp) {
			this._createItemDetailsValueHelpDialog();
		}

		var oModel = this._oItemDetailsValueHelp.getModel("itemDetailsVH");
		oModel.setProperty("/items", aItems || []);
		this._resetItemDetailsValueHelpFilters();
		this._oItemDetailsValueHelp.open();
	},

	_createItemDetailsValueHelpDialog: function () {
		this._oItemDetailsValueHelp = new SelectDialog({
			title: "Select Material Item",
			search: this._onItemDetailsValueHelpSearch.bind(this),
			liveChange: this._onItemDetailsValueHelpSearch.bind(this),
			confirm: this._onItemDetailsValueHelpConfirm.bind(this),
			cancel: this._onItemDetailsValueHelpCancel.bind(this)
		});

		this._oItemDetailsValueHelp.setModel(new JSONModel({ items: [] }), "itemDetailsVH");
		this._oItemDetailsValueHelp.bindAggregation("items", {
			path: "itemDetailsVH>/items",
			template: new StandardListItem({
				title: "{itemDetailsVH>MaterialCode}",
				description: "{itemDetailsVH>MaterialDescription}",
				info: "{itemDetailsVH>RefDocItemNo}"
			})
		});

		this.getView().addDependent(this._oItemDetailsValueHelp);
	},

	_onItemDetailsValueHelpSearch: function (oEvent) {
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
					new Filter("RefDocItemNo", FilterOperator.Contains, sValue)
				],
				and: false
			}));
		}

		oBinding.filter(aFilters);
	},

	_onItemDetailsValueHelpConfirm: function (oEvent) {
		var oCtx = oEvent.getParameter("selectedContexts")?.[0];
		if (oCtx) {
			this._populateMaterialFromItemDetail(oCtx.getObject());
		}
		this._resetItemDetailsValueHelpFilters();
	},

	_onItemDetailsValueHelpCancel: function () {
		this._resetItemDetailsValueHelpFilters();
	},

	_resetItemDetailsValueHelpFilters: function () {
		if (this._oItemDetailsValueHelp) {
			var oBinding = this._oItemDetailsValueHelp.getBinding("items");
			oBinding?.filter([]);
		}
	},

		_applySelectedItemDetails: function (oItem) {
			if (!oItem) {
				return;
			}

			this.byId("idMaterialDocType")?.setValue(oItem.DocType || this._sSelectedMaterialDocType || "");
			this.byId("idMaterialRefDocNo")?.setValue(oItem.RefDocNo || "");
			this.byId("idMaterialRefDocItem")?.setValue(oItem.RefDocItemNo || "");
			this.byId("idMaterialCode")?.setValue(oItem.MaterialCode || "");
			this.byId("idMaterialDesc")?.setValue(oItem.MaterialDescription || "");
			this.byId("idMaterialQty")?.setValue(oItem.Quantity || "");
			this.byId("idMaterialUoM")?.setValue(oItem.UoM || "");
			this._sSelectedMaterialDocType = this.byId("idMaterialDocType")?.getValue() || this._sSelectedMaterialDocType;
		},

		_fetchItemDetails: function (sDocType) {
			return new Promise(function (resolve, reject) {
				var oService = this._getItemDetailsService();
				var oGlobalModel = sap.ui.getCore().getModel("globalData");
				var sTripNumber = oGlobalModel?.getProperty("/TripNumber") || "";

				var aFilters = [];
				if (sTripNumber) {
					aFilters.push(new Filter("TripNumber", FilterOperator.EQ, sTripNumber));
				}
				if (sDocType) {
					aFilters.push(new Filter("DocType", FilterOperator.EQ, sDocType));
				}

				oService.read("/ItemDetails", {
					filters: aFilters,
					success: function (oData) {
						var aResults = oData.results || [];
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
				useBatch: false,
				defaultBindingMode: "TwoWay",
				json: true // Ensure JSON format is used
			});
		}
		return this._oItemDetailsService;
	},

		_openRefDocValueHelpDialog: function (sDocType) {
			this._fetchOrderDetails(sDocType)
				.then(function (aDocs) {
					this._updateRefDocSuggestions(aDocs);
					if (!this._oRefDocValueHelp) {
						this._createRefDocValueHelpDialog();
					}

					var oModel = this._oRefDocValueHelp.getModel("orderDetailsVH");
					oModel.setProperty("/items", aDocs || []);
					this._resetRefDocValueHelpFilters();
					this._oRefDocValueHelp.open();
				}.bind(this))
				.catch(function () {
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
			this._sSelectedDocType = oDoc.DocType || this._sSelectedDocType;
			this.byId("idRefDocNumber")?.setValue(oDoc.DocumentNumber || "");
			this.byId("idRefDocDate")?.setValue(this._formatODataDate(oDoc.DocumentDate));
			this.byId("idRefDocPartyCode")?.setValue(oDoc.Vendor || oDoc.Customer || "");
			this.byId("idRefDocPartyName")?.setValue(oDoc.Name || "");
		},

		_fetchOrderDetails: function (sDocType) {
			return new Promise(function (resolve, reject) {
				var oService = this._getOrderDetailsService();
				var oGlobalModel = sap.ui.getCore().getModel("globalData");
				var sTripNumber = oGlobalModel?.getProperty("/TripNumber") || "";

				var aFilters = [];
				if (sTripNumber) {
					aFilters.push(new Filter("TripNumber", FilterOperator.EQ, sTripNumber));
				}
				if (sDocType) {
					aFilters.push(new Filter("DocType", FilterOperator.EQ, sDocType));
				}

				oService.read("/OrderDetails", {
					filters: aFilters,
					success: function (oData) {
						var aResults = oData.results || [];
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

		_buildOrderDetailKeyPath: function (sTripNumber, sDocType, sDocumentNumber) {
			return "/OrderDetails(TripNumber='" + this._escapeODataValue(sTripNumber) +
				"',DocType='" + this._escapeODataValue(sDocType) +
				"',DocumentNumber='" + this._escapeODataValue(sDocumentNumber) + "')";
		},

		_buildMaterialDetailKeyPath: function (sDocType, sTripNumber, sRefDocNo, sRefDocItemNo) {
			return "/ItemDetails(DocType='" + this._escapeODataValue(sDocType) +
				"',TripNumber='" + this._escapeODataValue(sTripNumber) +
				"',RefDocNo='" + this._escapeODataValue(sRefDocNo) +
				"',RefDocItemNo='" + this._escapeODataValue(sRefDocItemNo) + "')";
		},

		_escapeODataValue: function (sValue) {
			return (sValue || "").replace(/'/g, "''");
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

		_getDocTypeModel: function () {
			if (!this._oDocTypeModel) {
				this._oDocTypeModel = new JSONModel({ items: [] });
				this.getView().setModel(this._oDocTypeModel, "docTypeModel");
			}
			return this._oDocTypeModel;
		},

		_loadRefDocSuggestions: function (sDocType) {
			if (!sDocType) {
				this._updateRefDocSuggestions([]);
				return;
			}
			this._sSelectedDocType = sDocType;
			this._fetchOrderDetails(sDocType)
				.then(function (aDocs) {
					this._updateRefDocSuggestions(aDocs);
				}.bind(this))
				.catch(function () {
					MessageToast.show("Unable to fetch documents for selected Doc Type");
					this._updateRefDocSuggestions([]);
				}.bind(this));
		},

		_loadMaterialSuggestions: function (sDocType) {
			if (!sDocType) {
				this._sSelectedMaterialDocType = "";
				this._updateMaterialSuggestions([]);
				return;
			}
			this._sSelectedMaterialDocType = sDocType;
			this._fetchItemDetails(sDocType)
				.then(function (aItems) {
					this._updateMaterialSuggestions(aItems);
				}.bind(this))
				.catch(function () {
					this._updateMaterialSuggestions([]);
				}.bind(this));
		},

		_updateRefDocSuggestions: function (aDocs) {
			this._getRefDocSuggestionModel().setProperty("/items", aDocs || []);
		},

		_updateMaterialSuggestions: function (aItems) {
			this._getMaterialSuggestionModel().setProperty("/items", aItems || []);
		},

		_buildOrderDetailPayload: function () {
			var oGlobalModel = sap.ui.getCore().getModel("globalData");
			var sTripNumber = oGlobalModel?.getProperty("/TripNumber") || "";

			var sDocType = this.byId("idRefDocType")?.getValue().trim() || "";
			var sDocNumber = this.byId("idRefDocNumber")?.getValue().trim() || "";
			var sPartyCode = this.byId("idRefDocPartyCode")?.getValue().trim() || "";
			var sPartyName = this.byId("idRefDocPartyName")?.getValue().trim() || "";
			var sDate = this.byId("idRefDocDate")?.getValue();
			var oDate = sDate ? new Date(sDate) : null;
			if (oDate && isNaN(oDate.getTime())) {
				oDate = null;
			}

			// For updates, preserve the existing Deleted value; for new records, default to false
			var bIsEdit = this._iEditingRefDocIndex > -1;
			var bDeleted = false;
			if (bIsEdit && this._oEditingRefDoc) {
				// Preserve existing Deleted status during update
				bDeleted = this._oEditingRefDoc.deleted || false;
			}

			var oPayload = {
				TripNumber: sTripNumber,
				DocType: sDocType,
				DocumentNumber: sDocNumber,
				DocumentDate: oDate,
				Vendor: sPartyCode,
				Customer: sPartyCode,
				Name: sPartyName,
				Deleted: bDeleted
			};

			// Log payload for debugging
			console.log("=== OrderDetail Payload ===");
			console.log("Is Edit Mode:", bIsEdit);
			console.log("Payload:", JSON.stringify(oPayload, null, 2));

			return oPayload;
		},

	_buildMaterialDetailPayload: function () {
		var oGlobalModel = sap.ui.getCore().getModel("globalData");
		var sTripNumber = (oGlobalModel?.getProperty("/TripNumber") || "").trim();

		var sDocType = (this.byId("idMaterialDocType")?.getValue() || "").trim();
		var sRefDocNo = (this.byId("idMaterialRefDocNo")?.getValue() || "").trim();
		var sRefDocItemNo = (this.byId("idMaterialRefDocItem")?.getValue() || "").trim();
		var sMaterialCode = (this.byId("idMaterialCode")?.getValue() || "").trim();
		var sMaterialDesc = (this.byId("idMaterialDesc")?.getValue() || "").trim();
		var sQty = (this.byId("idMaterialQty")?.getValue() || "").trim();
		var sUoM = (this.byId("idMaterialUoM")?.getValue() || "").trim();

		// Quantity is required (Nullable="false")
		// Parse and validate quantity
		var fQty = 0;
		if (sQty) {
			var fParsed = parseFloat(sQty);
			if (!isNaN(fParsed) && isFinite(fParsed)) {
				fQty = fParsed;
			}
		}

		// MaterialDescription is required (Nullable="false"), use MaterialCode if empty
		if (!sMaterialDesc && sMaterialCode) {
			sMaterialDesc = sMaterialCode;
		}

		// Build payload - only include fields that are part of the key or user input
		// Note: All fields have sap:creatable="false" but we still need to send key fields
		// and user-provided values. The backend will handle the rest.
		
		// Quantity: align with tested payload (send as string with 2 decimals, e.g. "1.00")
		var sFormattedQty = fQty ? fQty.toFixed(2) : "0.00";
		
		var oPayload = {
			TripNumber: sTripNumber,
			DocType: sDocType,
			RefDocNo: sRefDocNo,
			RefDocItemNo: sRefDocItemNo,
			MaterialCode: sMaterialCode,
			MaterialDescription: sMaterialDesc || sMaterialCode, // Required, fallback to MaterialCode
			Quantity: sFormattedQty,
			UoM: sUoM || "", // Set to empty string if not provided
			IsDeleted: "", // Required MaxLength="1", use empty string for not deleted
			IsSplitActive: false
		};

		// Log payload before sending for debugging
		console.log("=== Material Detail Payload ===");
		console.log("Payload JSON:", JSON.stringify(oPayload, null, 2));
		console.log("TripNumber:", sTripNumber);
		console.log("DocType:", sDocType);
		console.log("RefDocNo:", sRefDocNo);
		console.log("RefDocItemNo:", sRefDocItemNo);
		console.log("MaterialCode:", sMaterialCode);
		console.log("Quantity:", sFormattedQty, "(type:", typeof sFormattedQty + ")");

		return oPayload;
	},

		_saveOrderDetail: function (oPayload) {
			return new Promise(function (resolve, reject) {
				var oService = this._getOrderDetailsService();
				oService.create("/OrderDetails", oPayload, {
					headers: {
						"X-Requested-With": "X"
					},
					success: function (oData) {
						resolve(oData);
					},
					error: reject
				});
			}.bind(this));
		},

		_updateOrderDetail: function (oPayload) {
			return new Promise(function (resolve, reject) {
				var oService = this._getOrderDetailsService();
				var oOriginal = this._oEditingRefDoc || {};

				var sTripNumber = oPayload.TripNumber || oOriginal.tripNumber || "";
				var sDocType = oOriginal.docType || oPayload.DocType || "";
				var sDocNumber = oOriginal.documentNumber || oPayload.DocumentNumber || "";

				var sPath = this._buildOrderDetailKeyPath(sTripNumber, sDocType, sDocNumber);

				// Log update request details
				console.log("=== OrderDetail Update Request ===");
				console.log("Update Path:", sPath);
				console.log("Payload:", JSON.stringify(oPayload, null, 2));
				console.log("Original Document:", oOriginal);

				oService.update(sPath, oPayload, {
					headers: {
						"X-Requested-With": "X",
						"Content-Type": "application/json"
					},
					success: function (oData, oResponse) {
						console.log("=== OrderDetail Update Success ===");
						console.log("Response Data:", oData);
						console.log("Response Object:", oResponse);
						resolve(oData);
					},
					error: function (oError) {
						console.error("=== OrderDetail Update Error ===");
						console.error("Error Object:", oError);
						console.error("Error Response Text:", oError.responseText);
						console.error("Error Status Code:", oError.statusCode);
						
						// Try to parse error details
						if (oError.responseText) {
							try {
								var oErrorResponse = JSON.parse(oError.responseText);
								console.error("Parsed Error Response:", JSON.stringify(oErrorResponse, null, 2));
								if (oErrorResponse.error && oErrorResponse.error.message) {
									var sErrorMsg = oErrorResponse.error.message.value || oErrorResponse.error.message;
									console.error("Backend Error Message:", sErrorMsg);
								}
							} catch (e) {
								console.error("Could not parse error response:", e);
							}
						}
						
						reject(oError);
					}
				});
			}.bind(this));
		},

		_appendLocalReferenceDoc: function (oPayload) {
			var oModel = this._ensureRefDocModel();
			var aRefDocs = oModel.getProperty("/referenceDocs") || [];

			var sDialogDocType = this.byId("idRefDocType")?.getValue() || "";
			var sDialogDocNumber = this.byId("idRefDocNumber")?.getValue() || "";
			var sDialogPartyCode = this.byId("idRefDocPartyCode")?.getValue() || "";
			var sDialogPartyName = this.byId("idRefDocPartyName")?.getValue() || "";
			var sDialogDate = this.byId("idRefDocDate")?.getValue() || "";

			aRefDocs.push({
				tripNumber: oPayload.TripNumber || "",
				docType: oPayload.DocType || sDialogDocType,
				documentNumber: oPayload.DocumentNumber || sDialogDocNumber,
				documentDate: this._formatODataDate(oPayload.DocumentDate) || sDialogDate,
				partyCode: oPayload.Vendor || oPayload.Customer || sDialogPartyCode,
				partyName: oPayload.Name || sDialogPartyName
			});
			oModel.setProperty("/referenceDocs", aRefDocs);
		},

		_updateLocalReferenceDoc: function (oPayload) {
			var oModel = this._ensureRefDocModel();
			var aRefDocs = oModel.getProperty("/referenceDocs") || [];
			var iIndex = this._iEditingRefDocIndex;

			if (iIndex < 0 || !aRefDocs[iIndex]) {
				return;
			}

			var sDialogDocType = this.byId("idRefDocType")?.getValue() || "";
			var sDialogDocNumber = this.byId("idRefDocNumber")?.getValue() || "";
			var sDialogPartyCode = this.byId("idRefDocPartyCode")?.getValue() || "";
			var sDialogPartyName = this.byId("idRefDocPartyName")?.getValue() || "";
			var sDialogDate = this.byId("idRefDocDate")?.getValue() || "";

			var oExisting = aRefDocs[iIndex];
			aRefDocs[iIndex] = Object.assign({}, oExisting, {
				tripNumber: oPayload.TripNumber || oExisting.tripNumber || "",
				docType: oPayload.DocType || sDialogDocType || oExisting.docType || "",
				documentNumber: oPayload.DocumentNumber || sDialogDocNumber || oExisting.documentNumber || "",
				documentDate: this._formatODataDate(oPayload.DocumentDate) || sDialogDate || oExisting.documentDate || "",
				partyCode: oPayload.Vendor || oPayload.Customer || sDialogPartyCode || oExisting.partyCode || "",
				partyName: oPayload.Name || sDialogPartyName || oExisting.partyName || ""
			});

			oModel.setProperty("/referenceDocs", aRefDocs);
			// Update Material Doc Types and Document Numbers when Reference Document is updated
			this._loadMaterialDocTypesFromRefDocs();
			this._loadMaterialRefDocNumbersFromRefDocs();
		},

	_saveMaterialDetail: function (oPayload) {
		return new Promise(function (resolve, reject) {
			var oService = this._getItemDetailsService();
			
			// Log payload for debugging
			console.log("=== ItemDetails Create Request ===");
			console.log("Payload (JSON):", JSON.stringify(oPayload, null, 2));
			console.log("Payload (raw):", oPayload);
			console.log("Service URL:", oService.sServiceUrl);
			console.log("Full Path: /ItemDetails");
			
			// Validate required fields before sending
			if (!oPayload.TripNumber) {
				console.error("Validation Error: TripNumber is missing");
				reject(new Error("TripNumber is required"));
				return;
			}
			if (!oPayload.DocType) {
				console.error("Validation Error: DocType is missing");
				reject(new Error("DocType is required"));
				return;
			}
			if (!oPayload.RefDocNo) {
				console.error("Validation Error: RefDocNo is missing");
				reject(new Error("RefDocNo is required"));
				return;
			}
			if (!oPayload.RefDocItemNo) {
				console.error("Validation Error: RefDocItemNo is missing");
				reject(new Error("RefDocItemNo is required"));
				return;
			}
			
			oService.create("/ItemDetails", oPayload, {
				headers: {
					"X-Requested-With": "X",
					"Content-Type": "application/json"
				},
				success: function (oData, oResponse) {
					console.log("=== ItemDetails Create Success ===");
					console.log("Response Data:", oData);
					console.log("Response Object:", oResponse);
					resolve(oData);
				},
				error: function (oError) {
					console.error("=== ItemDetails Create Error ===");
					console.error("Error Object:", oError);
					console.error("Error Response Text:", oError.responseText);
					console.error("Error Status Code:", oError.statusCode);
					console.error("Error Status:", oError.status);
					console.error("Error Message:", oError.message);
					console.error("Error Headers:", oError.headers);
					
					// Try to parse error details
					if (oError.responseText) {
						try {
							var oErrorResponse = JSON.parse(oError.responseText);
							console.error("Parsed Error Response:", JSON.stringify(oErrorResponse, null, 2));
							if (oErrorResponse.error) {
								if (oErrorResponse.error.message) {
									var sErrorMsg = oErrorResponse.error.message.value || oErrorResponse.error.message;
									console.error("Backend Error Message:", sErrorMsg);
								}
								if (oErrorResponse.error.code) {
									console.error("Error Code:", oErrorResponse.error.code);
								}
								if (oErrorResponse.error.innererror) {
									console.error("Inner Error:", JSON.stringify(oErrorResponse.error.innererror, null, 2));
								}
							}
						} catch (e) {
							console.error("Could not parse error response as JSON:", e);
							console.error("Raw response text:", oError.responseText);
						}
					}
					
					reject(oError);
				}
			});
		}.bind(this));
	},

		_updateMaterialDetail: function (oPayload) {
			return new Promise(function (resolve, reject) {
				var oService = this._getItemDetailsService();
				var oOriginal = this._oEditingMaterial || {};

				var sTripNumber = oPayload.TripNumber || oOriginal.tripNumber || "";
				var sDocType = oOriginal.docType || oPayload.DocType || "";
				var sRefDocNo = oOriginal.refDocNo || oPayload.RefDocNo || "";
				var sRefDocItemNo = oOriginal.refDocItemNo || oPayload.RefDocItemNo || "";

				var sPath = this._buildMaterialDetailKeyPath(sDocType, sTripNumber, sRefDocNo, sRefDocItemNo);

				oService.update(sPath, oPayload, {
					headers: {
						"X-Requested-With": "X"
					},
					success: function (oData) {
						resolve(oData);
					},
					error: reject
				});
			}.bind(this));
		},

		_appendLocalMaterialDetail: function (oPayload) {
			var oModel = this._ensureRefDocModel();
			var aMaterials = oModel.getProperty("/materialDetails") || [];

			var sDialogDocType = this.byId("idMaterialDocType")?.getValue() || "";
			var sDialogRefDocNo = this.byId("idMaterialRefDocNo")?.getValue() || "";
			var sDialogRefDocItem = this.byId("idMaterialRefDocItem")?.getValue() || "";
			var sDialogMaterial = this.byId("idMaterialCode")?.getValue() || "";
			var sDialogDesc = this.byId("idMaterialDesc")?.getValue() || "";
			var sDialogQty = this.byId("idMaterialQty")?.getValue() || "";
			var sDialogUoM = this.byId("idMaterialUoM")?.getValue() || "";

			var vQty = oPayload.Quantity;
			var sQtyDisplay = (vQty === null || vQty === undefined || vQty === "") ? sDialogQty : String(vQty);

			aMaterials.push({
				tripNumber: oPayload.TripNumber || "",
				docType: oPayload.DocType || sDialogDocType,
				refDocNo: oPayload.RefDocNo || sDialogRefDocNo,
				refDocItemNo: oPayload.RefDocItemNo || sDialogRefDocItem,
				materialCode: oPayload.MaterialCode || sDialogMaterial,
				materialDescription: oPayload.MaterialDescription || sDialogDesc,
				qty: sQtyDisplay,
				uom: oPayload.UoM || sDialogUoM,
				createdBy: oPayload.CreatedBy || "",
				createdOnDate: this._formatODataDate(oPayload.CreatedOn),
				createdOnTime: this._formatODataTime(oPayload.CreatedTime),
				changedBy: oPayload.ChangedBy || "",
				changedOnDate: this._formatODataDate(oPayload.ChangedDate),
				changedOnTime: this._formatODataTime(oPayload.ChangedTime)
			});

			oModel.setProperty("/materialDetails", aMaterials);
			// Update filtered list after adding new material
			this._filterMaterialDetails();
		},

		_updateLocalMaterialDetail: function (oPayload) {
			var oModel = this._ensureRefDocModel();
			var aMaterials = oModel.getProperty("/materialDetails") || [];
			var iIndex = this._iEditingMaterialIndex;

			if (iIndex < 0 || !aMaterials[iIndex]) {
				return;
			}

			var sDialogDocType = this.byId("idMaterialDocType")?.getValue() || "";
			var sDialogRefDocNo = this.byId("idMaterialRefDocNo")?.getValue() || "";
			var sDialogRefDocItem = this.byId("idMaterialRefDocItem")?.getValue() || "";
			var sDialogMaterial = this.byId("idMaterialCode")?.getValue() || "";
			var sDialogDesc = this.byId("idMaterialDesc")?.getValue() || "";
			var sDialogQty = this.byId("idMaterialQty")?.getValue() || "";
			var sDialogUoM = this.byId("idMaterialUoM")?.getValue() || "";

			var oExisting = aMaterials[iIndex];
			var vQty = oPayload.Quantity;
			var sQtyDisplay = (vQty === null || vQty === undefined || vQty === "") ? (sDialogQty || oExisting.qty || "") : String(vQty);

			aMaterials[iIndex] = Object.assign({}, oExisting, {
				tripNumber: oPayload.TripNumber || oExisting.tripNumber || "",
				docType: oPayload.DocType || sDialogDocType || oExisting.docType || "",
				refDocNo: oPayload.RefDocNo || sDialogRefDocNo || oExisting.refDocNo || "",
				refDocItemNo: oPayload.RefDocItemNo || sDialogRefDocItem || oExisting.refDocItemNo || "",
				materialCode: oPayload.MaterialCode || sDialogMaterial || oExisting.materialCode || "",
				materialDescription: oPayload.MaterialDescription || sDialogDesc || oExisting.materialDescription || "",
				qty: sQtyDisplay,
				uom: oPayload.UoM || sDialogUoM || oExisting.uom || "",
				changedBy: oPayload.ChangedBy || oExisting.changedBy || "",
				changedOnDate: this._formatODataDate(oPayload.ChangedDate) || oExisting.changedOnDate || "",
				changedOnTime: this._formatODataTime(oPayload.ChangedTime) || oExisting.changedOnTime || ""
			});

			oModel.setProperty("/materialDetails", aMaterials);
			// Update filtered list after updating material
			this._filterMaterialDetails();
		},

	_onTripDataUpdated: function () {
		var oTripData = sap.ui.getCore().getModel("TripData");
		var oModel = this._ensureRefDocModel();

		if (!oTripData) {
			oModel.setProperty("/referenceDocs", []);
			oModel.setProperty("/materialDetails", []);
			oModel.setProperty("/filteredMaterialDetails", []);
			return;
		}

		var aOrderDetails = this._extractResults(oTripData.getProperty("/OrderDetails"));
		var aItemDetails = this._extractResults(oTripData.getProperty("/ItemDetails"));
		this._setReferenceDocsFromService(aOrderDetails);
		this._setMaterialDetailsFromService(aItemDetails);
	},

	_setReferenceDocsFromService: function (aDocs) {
		// Filter out deleted records (Deleted === true)
		var aRefDocs = (aDocs || [])
			.filter(function (oDoc) {
				return !oDoc.Deleted;
			})
			.map(function (oDoc) {
				return {
					tripNumber: oDoc.TripNumber || "",
					docType: oDoc.DocType || "",
					documentNumber: oDoc.DocumentNumber || "",
					documentDate: this._formatODataDate(oDoc.DocumentDate),
					partyCode: oDoc.Vendor || oDoc.Customer || "",
					partyName: oDoc.Name || "",
					createdBy: oDoc.CreatedBy || "",
					createdOnDate: this._formatODataDate(oDoc.CreatedOnDate),
					createdOnTime: this._formatODataTime(oDoc.CreatedOnTime),
					changedBy: oDoc.ChangedBy || "",
					changedOnDate: this._formatODataDate(oDoc.ChangedOnDate),
					changedOnTime: this._formatODataTime(oDoc.ChangedOnTime)
				};
			}.bind(this));
		this._ensureRefDocModel().setProperty("/referenceDocs", aRefDocs);
		// Update Material Doc Types and Document Numbers when Reference Documents are loaded
		this._loadMaterialDocTypesFromRefDocs();
		this._loadMaterialRefDocNumbersFromRefDocs();
	},

	_setMaterialDetailsFromService: function (aItems) {
		// Filter out deleted records (IsDeleted === "X")
		var aMaterials = (aItems || [])
			.filter(function (oItem) {
				return oItem.IsDeleted !== "X";
			})
			.map(function (oItem) {
				return {
					tripNumber: oItem.TripNumber || "",
					docType: oItem.DocType || "",
					refDocNo: oItem.RefDocNo || "",
					refDocItemNo: oItem.RefDocItemNo || "",
					materialCode: oItem.MaterialCode || "",
					materialDescription: oItem.MaterialDescription || "",
					qty: (oItem.Quantity === null || oItem.Quantity === undefined) ? "" : String(oItem.Quantity),
					uom: oItem.UoM || "",
					createdBy: oItem.CreatedBy || "",
					createdOnDate: this._formatODataDate(oItem.CreatedOn),
					createdOnTime: this._formatODataTime(oItem.CreatedTime),
					changedBy: oItem.ChangedBy || "",
					changedOnDate: this._formatODataDate(oItem.ChangedDate),
					changedOnTime: this._formatODataTime(oItem.ChangedTime)
				};
			}.bind(this));
		this._ensureRefDocModel().setProperty("/materialDetails", aMaterials);
		// Update filtered list after setting all materials
		this._filterMaterialDetails();
	},

		_fetchTripDetails: function (sTripNumber) {
			return new Promise(function (resolve, reject) {
				var oService = this._getOrderDetailsService();
				var sPath = "/TripDetails('" + this._escapeODataValue(sTripNumber) + "')";

				oService.read(sPath, {
					urlParameters: {
						"$expand": "OrderDetails,ItemDetails"
					},
					success: function (oData) {
						resolve(oData);
					},
					error: reject
				});
			}.bind(this));
		},

		_extractResults: function (vData) {
			if (!vData) {
				return [];
			}
			if (Array.isArray(vData)) {
				return vData;
			}
			if (Array.isArray(vData.results)) {
				return vData.results;
			}
			return [];
		},

		_loadDocTypes: function () {
			return new Promise(function (resolve, reject) {
				var oService = this._getConfigValuesService();
				oService.read("/ConfigValues", {
					filters: [
						new Filter("ConfigGroup", FilterOperator.EQ, "DocType")
					],
					success: function (oData) {
						var aResults = oData.results || [];
						this._getDocTypeModel().setProperty("/items", aResults);
						resolve(aResults);
					}.bind(this),
					error: function (oError) {
						reject(oError);
					}
				});
			}.bind(this));
		},

		_getConfigValuesService: function () {
			if (!this._oConfigValuesService) {
				this._oConfigValuesService = new ODataModel("/sap/opu/odata/sap/YIGP_PLMS_SRV/", {
					useBatch: false
				});
			}
			return this._oConfigValuesService;
		},

		_createDocTypeValueHelpDialog: function () {
			this._oDocTypeValueHelp = new SelectDialog({
				title: "Select Document Type",
				search: this._onDocTypeValueHelpSearch.bind(this),
				liveChange: this._onDocTypeValueHelpSearch.bind(this),
				confirm: this._onDocTypeValueHelpConfirm.bind(this),
				cancel: this._onDocTypeValueHelpCancel.bind(this)
			});

			this._oDocTypeValueHelp.setModel(new JSONModel({ items: [] }), "docTypeVH");
			this._oDocTypeValueHelp.bindAggregation("items", {
				path: "docTypeVH>/items",
				template: new StandardListItem({
					title: "{docTypeVH>ConfigID}",
					description: "{docTypeVH>Description}"
				})
			});

			this.getView().addDependent(this._oDocTypeValueHelp);
		},

		_createMaterialDocTypeValueHelpDialog: function () {
			this._oMaterialDocTypeVH = new SelectDialog({
				title: "Select Doc Type",
				search: this._onMaterialDocTypeValueHelpSearch.bind(this),
				liveChange: this._onMaterialDocTypeValueHelpSearch.bind(this),
				confirm: this._onMaterialDocTypeVHConfirm.bind(this),
				cancel: this._resetMaterialDocTypeVHFilters.bind(this)
			});

			this._oMaterialDocTypeVH.setModel(new JSONModel({ items: [] }), "docTypeVHMaterial");
			this._oMaterialDocTypeVH.bindAggregation("items", {
				path: "docTypeVHMaterial>/items",
				template: new StandardListItem({
					title: "{docTypeVHMaterial>docType}"
				})
			});

			this.getView().addDependent(this._oMaterialDocTypeVH);
		},

		_onMaterialDocTypeValueHelpSearch: function (oEvent) {
			var sValue = oEvent.getParameter("value") || "";
			var oBinding = oEvent.getSource().getBinding("items");

			if (!oBinding) {
				return;
			}

			var aFilters = [];
			if (sValue) {
				aFilters.push(new Filter({
					path: "docType",
					operator: FilterOperator.Contains,
					value1: sValue
				}));
			}

			oBinding.filter(aFilters);
		},

		_onDocTypeValueHelpSearch: function (oEvent) {
			var sValue = oEvent.getParameter("value") || "";
			var oBinding = oEvent.getSource().getBinding("items");

			if (!oBinding) {
				return;
			}

			var aFilters = [];
			if (sValue) {
				aFilters.push(new Filter({
					filters: [
						new Filter("ConfigID", FilterOperator.Contains, sValue),
						new Filter("Description", FilterOperator.Contains, sValue)
					],
					and: false
				}));
			}

			oBinding.filter(aFilters);
		},

		_onDocTypeValueHelpConfirm: function (oEvent) {
			var oCtx = oEvent.getParameter("selectedContexts")?.[0];
			if (oCtx) {
				var oDocType = oCtx.getObject();
				var sDocType = oDocType.ConfigID || "";
				this.byId("idRefDocType")?.setValue(sDocType);
				this._sSelectedDocType = sDocType;
				this._loadRefDocSuggestions(sDocType);
			}
			this._resetDocTypeValueHelpFilters();
		},

		_onMaterialDocTypeVHConfirm: function (oEvent) {
			var oCtx = oEvent.getParameter("selectedContexts")?.[0];
			if (oCtx) {
				var sDocType = oCtx.getObject().docType || "";
				this.byId("idMaterialDocType")?.setValue(sDocType);
				this._sSelectedMaterialDocType = sDocType;
				this._loadMaterialRefDocNumbersFromRefDocs(sDocType);
				this._loadMaterialSuggestions(sDocType);
			}
			this._resetMaterialDocTypeVHFilters();
		},

		_onDocTypeValueHelpCancel: function () {
			this._resetDocTypeValueHelpFilters();
		},

		_resetDocTypeValueHelpFilters: function () {
			if (this._oDocTypeValueHelp) {
				var oBinding = this._oDocTypeValueHelp.getBinding("items");
				oBinding?.filter([]);
			}
		},

		_resetMaterialDocTypeVHFilters: function () {
			if (this._oMaterialDocTypeVH) {
				var oBinding = this._oMaterialDocTypeVH.getBinding("items");
				oBinding?.filter([]);
			}
		},

		_loadMaterialDocTypesFromRefDocs: function () {
			var aDocTypes = this._getMaterialDocTypesFromRefDocs();
			var oModel = this._ensureRefDocModel();
			oModel.setProperty("/materialDocTypes", aDocTypes);
		},

		_getMaterialDocTypesFromRefDocs: function () {
			var oModel = this._ensureRefDocModel();
			var aRefDocs = oModel.getProperty("/referenceDocs") || [];
			var aUniqueDocTypes = [];
			var oDocTypeMap = {};

			// Extract unique Doc Types from Reference Documents
			aRefDocs.forEach(function (oRefDoc) {
				var sDocType = oRefDoc.docType || "";
				if (sDocType && !oDocTypeMap[sDocType]) {
					oDocTypeMap[sDocType] = true;
					aUniqueDocTypes.push({
						docType: sDocType
					});
				}
			});

			return aUniqueDocTypes;
		},

		_loadMaterialRefDocNumbersFromRefDocs: function (sDocType) {
			var aRefDocs = this._getMaterialRefDocNumbersFromRefDocs(sDocType);
			var oModel = this._ensureRefDocModel();
			oModel.setProperty("/materialRefDocNumbers", aRefDocs);
			// Also update the refDocSuggestions model for the input field
			this._updateRefDocSuggestions(aRefDocs);
		},

		_getMaterialRefDocNumbersFromRefDocs: function (sDocType) {
			var oModel = this._ensureRefDocModel();
			var aRefDocs = oModel.getProperty("/referenceDocs") || [];
			var aFilteredRefDocs = [];

			// Filter Reference Documents by Doc Type if provided
			if (sDocType) {
				aFilteredRefDocs = aRefDocs.filter(function (oRefDoc) {
					return oRefDoc.docType === sDocType;
				});
			} else {
				aFilteredRefDocs = aRefDocs;
			}

			// Convert to format expected by value help and suggestions
			return aFilteredRefDocs.map(function (oRefDoc) {
				return {
					DocType: oRefDoc.docType || "",
					DocumentNumber: oRefDoc.documentNumber || "",
					Name: oRefDoc.partyName || "",
					DocumentDate: oRefDoc.documentDate || ""
				};
			});
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

