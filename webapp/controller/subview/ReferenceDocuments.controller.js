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
	"sap/ui/model/odata/v2/ODataModel",
], function (Controller, JSONModel, Fragment, MessageToast, MessageBox, SelectDialog, StandardListItem, Filter, FilterOperator, ODataModel) {
	"use strict";

	return Controller.extend("com.incresolZ_INC_PLMS.controller.subview.ReferenceDocuments", {

	onInit: function () {
		this._ensureRefDocModel();
		this._getRefDocSuggestionModel();
		this._getMaterialSuggestionModel();
		this._getMaterialItemsModel();
		this._loadDocTypes();
		this._sSelectedDocType = "";
		this._sSelectedMaterialDocType = "";
		this._oSelectedRefDoc = null; // Track selected reference document
		this._oEditingMaterial = null; // Track material being edited
		this._bIsEditMode = false; // Track if dialog is in edit mode
		this._oEditingRefDoc = null; // Track reference document being edited
		this._bIsRefDocEditMode = false; // Track if reference doc dialog is in edit mode
		this._oEventBus = sap.ui.getCore().getEventBus();
		this._oEventBus.subscribe("TripData", "Updated", this._onTripDataUpdated, this);
		this._oEventBus.subscribe("Stage", "ClearAllTabs", this._clearAllData, this);
		// this._onTripDataUpdated(); // Initial load
		this._initializeColumnVisibility();
		// Apply any view-related initialization after render using delegates if needed
	},

		onExit: function () {
			this._oAddRefDocDialog?.destroy();
			this._oAddMaterialDialog?.destroy();
			this._oRefDocValueHelp?.destroy();
			this._oMaterialValueHelp?.destroy();
			this._oMaterialRefDocNoValueHelp?.destroy();
			this._oItemDetailsValueHelp?.destroy();
			this._oMaterialItemValueHelp?.destroy();
			this._oDocTypeValueHelp?.destroy();
			this._oMaterialDocTypeVH?.destroy();
			this._oRefDocColumnVisibilityDialog?.destroy();
			this._oMaterialColumnVisibilityDialog?.destroy();
			this._oSelectMaterialsDialog?.destroy();
			if (this._oEventBus) {
				this._oEventBus.unsubscribe("TripData", "Updated", this._onTripDataUpdated, this);
				this._oEventBus.unsubscribe("Stage", "ClearAllTabs", this._clearAllData, this);
			}
		},
		
		_clearAllData: function () {
			// Clear reference documents model
			var oRefDocModel = this._ensureRefDocModel();
			if (oRefDocModel) {
				oRefDocModel.setData({
					referenceDocuments: [],
					materialDetails: [],
					filteredMaterialDetails: []
				});
			}
			
			// Clear suggestion models
			var oRefDocSuggestionModel = this._getRefDocSuggestionModel();
			if (oRefDocSuggestionModel) {
				oRefDocSuggestionModel.setData({ items: [] });
			}
			
			var oMaterialSuggestionModel = this._getMaterialSuggestionModel();
			if (oMaterialSuggestionModel) {
				oMaterialSuggestionModel.setData({ items: [] });
			}
			
			var oMaterialItemsModel = this._getMaterialItemsModel();
			if (oMaterialItemsModel) {
				oMaterialItemsModel.setData({ items: [] });
			}
			
			// Reset selection and edit state
			this._oSelectedRefDoc = null;
			this._oEditingMaterial = null;
			this._bIsEditMode = false;
			this._oEditingRefDoc = null;
			this._bIsRefDocEditMode = false;
			this._sSelectedDocType = "";
			this._sSelectedMaterialDocType = "";
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
			// If scanning-based reporting is active, do not allow manual add
			var oGlobalModel = sap.ui.getCore().getModel("globalData");
			if (oGlobalModel && (oGlobalModel.getProperty("/IsScanningReporting") || oGlobalModel.getProperty("/DisableRefDocMaterialsActions"))) {
				MessageToast.show("Manual reference document creation is disabled for this movement scenario.");
				return;
			}

			this._resetRefDocDialog();
			this._openAddRefDocDialog();
		},


		onDocTypeChange: function (oEvent) {
			var sSelectedKey = oEvent.getParameter("selectedItem")?.getKey();
			if (sSelectedKey) {
				this._sSelectedDocType = sSelectedKey;
				this._loadRefDocSuggestions(sSelectedKey);
			} else {
				// Handle case when selection is cleared
				this._sSelectedDocType = "";
				this._loadRefDocSuggestions("");
			}
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
			var that = this;
			this._loadDocTypes()
				.then(function (aDocTypes) {
					if (!that._oDocTypeValueHelp) {
						return that._createDocTypeValueHelpDialog().then(function () {
							return aDocTypes;
						});
					}
					return aDocTypes;
				})
				.then(function (aDocTypes) {
					var oModel = that._oDocTypeValueHelp.getModel("docTypeVH");
					if (!oModel) {
						oModel = new JSONModel({ items: [] });
						that._oDocTypeValueHelp.setModel(oModel, "docTypeVH");
					}
					oModel.setProperty("/items", aDocTypes || []);
					that._resetDocTypeValueHelpFilters();
					that._oDocTypeValueHelp.open();
				})
				.catch(function () {
					MessageToast.show("Unable to load document types");
				});
		},

		onRefDocValueHelp: function () {
			var oSelect = this.byId("idRefDocType");
			var sDocType = this._sSelectedDocType || (oSelect?.getSelectedItem()?.getKey() || oSelect?.getValue()?.trim());
			if (!sDocType) {
				return MessageToast.show("Select a Doc Type first");
			}
			this._openRefDocValueHelpDialog(sDocType);
		},

		onSelectMaterials: function () {
			var oSelect = this.byId("idRefDocType");
			var sDocType = this._sSelectedDocType || (oSelect?.getSelectedItem()?.getKey() || oSelect?.getValue()?.trim());
			var sDocNumber = this.byId("idRefDocNumber")?.getValue()?.trim();
			
			if (!sDocType) {
				return MessageToast.show("Please select a Doc Type first");
			}
			if (!sDocNumber) {
				return MessageToast.show("Please enter a Document Number first");
			}
			
			this._openSelectMaterialsDialog(sDocType, sDocNumber);
		},

		onSelectMaterialsFromTable: function (oEvent) {
			// If scanning-based reporting is active, do not allow manual material selection
			var oGlobalModel = sap.ui.getCore().getModel("globalData");
			if (oGlobalModel && (oGlobalModel.getProperty("/IsScanningReporting") || oGlobalModel.getProperty("/DisableRefDocMaterialsActions"))) {
				MessageToast.show("Manual material selection is disabled for this movement scenario.");
				return;
			}

			var oSource = oEvent.getSource();
			var oBindingContext = oSource.getBindingContext("refDocModel");
			
			if (!oBindingContext) {
				return MessageToast.show("Unable to get document information");
			}
			
			var oDocument = oBindingContext.getObject();
			var sDocType = oDocument.docType || "";
			var sDocNumber = oDocument.documentNumber || "";
			
			if (!sDocType) {
				return MessageToast.show("Document Type is missing");
			}
			if (!sDocNumber) {
				return MessageToast.show("Document Number is missing");
			}
			
			this._openSelectMaterialsDialog(sDocType, sDocNumber);
		},

		onAddSelectedMaterials: function () {
			var oGlobalModel = sap.ui.getCore().getModel("globalData");
			if (oGlobalModel && oGlobalModel.getProperty("/DisableRefDocMaterialsActions")) {
				MessageToast.show("Adding materials is disabled for this movement scenario.");
				return;
			}
			var oTable = this.byId("idMaterialsSelectionTable");
			if (!oTable) {
				return;
			}
			
			var aSelectedItems = oTable.getSelectedItems();
			if (!aSelectedItems || aSelectedItems.length === 0) {
				return MessageToast.show("Please select at least one material");
			}
			
			var aSelectedMaterials = aSelectedItems.map(function(oItem) {
				return oItem.getBindingContext("materialsSelectionModel").getObject();
			});
			
			if (aSelectedMaterials.length === 0) {
				return MessageToast.show("No materials selected");
			}
			
			this._saveMaterialsOneByOne(aSelectedMaterials);
		},

		onCloseSelectMaterialsDialog: function () {
			if (this._oSelectMaterialsDialog) {
				this._oSelectMaterialsDialog.close();
			}
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

			if (this._bIsRefDocEditMode && this._oEditingRefDoc) {
				// Update existing reference document
				this._updateOrderDetail(oPayload, this._oEditingRefDoc)
					.then(function (oResponse) {
						this._updateLocalReferenceDoc(oResponse || oPayload, this._oEditingRefDoc);
						MessageToast.show("Reference document updated");
						this._loadRefDocSuggestions(this._sSelectedDocType || oPayload.DocType);
						this._loadMaterialDocTypesFromRefDocs();
						this._loadMaterialRefDocNumbersFromRefDocs();
						this._closeRefDocDialog();
						this._resetRefDocDialog();
					}.bind(this))
					.catch(function (oError) {
						var sMessage = this._extractErrorMessage(oError) || "Unable to update reference document";
						MessageToast.show(sMessage);
					}.bind(this));
			} else {
				// Create new reference document
				this._saveOrderDetail(oPayload)
					.then(function (oResponse) {
						var oSavedRefDoc = oResponse || oPayload;
						this._appendLocalReferenceDoc(oSavedRefDoc);
						MessageToast.show("Reference document added");
						
						// Automatically add all materials for this reference document
						var sDocType = oSavedRefDoc.DocType || oPayload.DocType || "";
						var sDocNumber = oSavedRefDoc.DocumentNumber || oPayload.DocumentNumber || "";
						if (sDocType && sDocNumber) {
							this._addAllMaterialsFromRefDoc(sDocType, sDocNumber);
						}
						
						this._loadRefDocSuggestions(this._sSelectedDocType || oPayload.DocType);
						this._loadMaterialDocTypesFromRefDocs();
						this._loadMaterialRefDocNumbersFromRefDocs();
						this._closeRefDocDialog();
						this._resetRefDocDialog();
					}.bind(this))
					.catch(function (oError) {
						var sMessage = this._extractErrorMessage(oError) || "Unable to save reference document";
						MessageToast.show(sMessage);
					}.bind(this));
			}
		},

		onCancelRefDocDialog: function () {
			this._closeRefDocDialog();
			this._resetRefDocDialog();
		},

		onEditRefDocRow: function (oEvent) {
			var oGlobalModel = sap.ui.getCore().getModel("globalData");
			if (oGlobalModel && oGlobalModel.getProperty("/DisableRefDocMaterialsActions")) {
				MessageToast.show("Editing reference documents is disabled for this movement scenario.");
				return;
			}
			var oButton = oEvent.getSource();
			// Get the table row - button -> cell -> row
			var oCell = oButton.getParent();
			var oRow = oCell ? oCell.getParent() : null;
			
			if (!oRow) {
				// Try alternative: get parent until we find a row
				var oCurrent = oButton.getParent();
				while (oCurrent && !oCurrent.getBindingContext) {
					oCurrent = oCurrent.getParent();
				}
				oRow = oCurrent;
			}
			
			if (!oRow) {
				return MessageToast.show("Unable to find reference document row");
			}
			
			var oCtx = oRow.getBindingContext("refDocModel");
			if (!oCtx) {
				return MessageToast.show("Unable to get reference document details");
			}
			
			var oRefDoc = oCtx.getObject();
			if (!oRefDoc) {
				return MessageToast.show("Reference document data not available");
			}
			
			this._oEditingRefDoc = oRefDoc;
			this._bIsRefDocEditMode = true;
			
			// Open dialog - it will populate itself
			this._openAddRefDocDialog()
				.catch(function (oError) {
					MessageToast.show("Failed to open edit dialog: " + (oError.message || "Unknown error"));
				});
		},

		onDeleteRefDocRow: function (oEvent) {
			var oGlobalModel = sap.ui.getCore().getModel("globalData");
			if (oGlobalModel && oGlobalModel.getProperty("/DisableRefDocMaterialsActions")) {
				MessageToast.show("Deleting reference documents is disabled for this movement scenario.");
				return;
			}
			var oItem = oEvent.getSource().getParent();
			var oCtx = oItem.getBindingContext("refDocModel");
			if (!oCtx) {
				return MessageToast.show("Unable to get reference document details");
			}
			
			var oRefDoc = oCtx.getObject();
			var sMessage = "Are you sure you want to delete this reference document?";
			
			MessageBox.confirm(sMessage, {
				actions: [MessageBox.Action.YES, MessageBox.Action.NO],
				onClose: function (sAction) {
					if (sAction === MessageBox.Action.YES) {
						this._deleteOrderDetail(oRefDoc);
					}
				}.bind(this)
			});
		},


		// ============================================================
		// Material Details Dialog Handlers
		// ============================================================
		onAddMaterialRow: function () {
			this._resetMaterialDialog();
			this._openAddMaterialDialog();
		},

		onAddMaterialsForRefDoc: function (oEvent) {
			// Get the Reference Document from the row
			var oButton = oEvent.getSource();
			var oCell = oButton.getParent();
			var oRow = oCell ? oCell.getParent() : null;
			
			if (!oRow) {
				// Try alternative: get parent until we find a row
				var oCurrent = oButton.getParent();
				while (oCurrent && !oCurrent.getBindingContext) {
					oCurrent = oCurrent.getParent();
				}
				oRow = oCurrent;
			}
			
			if (!oRow) {
				return MessageToast.show("Unable to find reference document row");
			}
			
			var oCtx = oRow.getBindingContext("refDocModel");
			if (!oCtx) {
				return MessageToast.show("Unable to get reference document details");
			}
			
			var oRefDoc = oCtx.getObject();
			if (!oRefDoc) {
				return MessageToast.show("Reference document data not available");
			}
			
			// Automatically add all materials for this reference document
			var sDocType = oRefDoc.docType || "";
			var sRefDocNo = oRefDoc.documentNumber || "";
			
			if (!sDocType || !sRefDocNo) {
				return MessageToast.show("Reference document is missing Doc Type or Document Number");
			}
			
			// Automatically add all materials for this reference document
			this._addAllMaterialsFromRefDoc(sDocType, sRefDocNo);
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
				return this._createMaterialDocTypeValueHelpDialog().then(function () {
					var oModel = this._oMaterialDocTypeVH.getModel("docTypeVHMaterial");
					if (!oModel) {
						oModel = new JSONModel({ items: [] });
						this._oMaterialDocTypeVH.setModel(oModel, "docTypeVHMaterial");
					}
					oModel.setProperty("/items", aDocTypes || []);
					this._resetMaterialDocTypeVHFilters();
					this._oMaterialDocTypeVH.open();
				}.bind(this));
			}
			var oModel = this._oMaterialDocTypeVH.getModel("docTypeVHMaterial");
			if (!oModel) {
				oModel = new JSONModel({ items: [] });
				this._oMaterialDocTypeVH.setModel(oModel, "docTypeVHMaterial");
			}
			oModel.setProperty("/items", aDocTypes || []);
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

			// Load available material items for the selected reference document
			if (sDocType && sRefDocNo) {
				this._loadMaterialItemsForRefDoc(sDocType, sRefDocNo);
				// Automatically add all materials from this reference document
				this._addAllMaterialsFromRefDoc(sDocType, sRefDocNo);
			} else {
				// Clear material items if no reference document is selected
				this._getMaterialItemsModel().setProperty("/items", []);
			}
		},

		onMaterialItemValueHelp: function () {
			var sDocType = this._sSelectedMaterialDocType || this.byId("idMaterialDocType")?.getValue().trim();
			var sRefDocNo = this.byId("idMaterialRefDocNo")?.getValue().trim();
			
			if (!sDocType) {
				return MessageToast.show("Select a Doc Type first");
			}
			if (!sRefDocNo) {
				return MessageToast.show("Select a Ref Doc Number first");
			}
			
			this._openMaterialItemValueHelpDialog(sDocType, sRefDocNo);
		},

		onMaterialItemSuggestionSelected: function (oEvent) {
			var oItem = oEvent.getParameter("selectedItem");
			var oCtx = oItem?.getBindingContext("materialItems");
			if (oCtx) {
				var oData = oCtx.getObject();
				this._applySelectedMaterialItem(oData);
			}
		},

		onMaterialRefDocItemChange: function (oEvent) {
			var sRefDocItemNo = oEvent.getParameter("value") || "";
			var sDocType = this._sSelectedMaterialDocType || this.byId("idMaterialDocType")?.getValue().trim() || "";
			var sRefDocNo = this.byId("idMaterialRefDocNo")?.getValue().trim() || "";

			// Find the selected item from the material items model
			if (sDocType && sRefDocNo && sRefDocItemNo) {
				var oMaterialItemsModel = this._getMaterialItemsModel();
				var aItems = oMaterialItemsModel.getProperty("/items") || [];
				
				var oSelectedItem = aItems.find(function(oItem) {
					return oItem.RefDocItemNo === sRefDocItemNo;
				});
				
				if (oSelectedItem) {
					this._applySelectedMaterialItem(oSelectedItem);
				}
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
			
			if (this._bIsEditMode && this._oEditingMaterial) {
				// Update existing material
				this._updateMaterialDetail(oPayload, this._oEditingMaterial)
					.then(function (oResponse) {
						this._updateLocalMaterialDetail(oResponse || oPayload, this._oEditingMaterial);
						MessageToast.show("Material row updated");
						this._closeMaterialDialog();
						this._resetMaterialDialog();
					}.bind(this))
					.catch(function (oError) {
						var sMessage = this._extractErrorMessage(oError) || "Unable to update material row";
						MessageToast.show(sMessage);
					}.bind(this));
			} else {
				// Create new material
				this._saveMaterialDetail(oPayload)
					.then(function (oResponse) {
						this._appendLocalMaterialDetail(oResponse || oPayload);
						MessageToast.show("Material row added");
						this._closeMaterialDialog();
						this._resetMaterialDialog();
					}.bind(this))
					.catch(function (oError) {
						var sMessage = this._extractErrorMessage(oError) || "Unable to save material row";
						MessageToast.show(sMessage);
					}.bind(this));
			}
		},

		onCancelMaterialDialog: function () {
			this._closeMaterialDialog();
			this._resetMaterialDialog();
		},

		onEditMaterialRow: function (oEvent) {
			var oGlobalModel = sap.ui.getCore().getModel("globalData");
			if (oGlobalModel && oGlobalModel.getProperty("/DisableRefDocMaterialsActions")) {
				MessageToast.show("Editing materials is disabled for this movement scenario.");
				return;
			}
			var oButton = oEvent.getSource();
			// Get the table row - button -> cell -> row
			var oCell = oButton.getParent();
			var oRow = oCell ? oCell.getParent() : null;
			
			if (!oRow) {
				// Try alternative: get parent until we find a row
				var oCurrent = oButton.getParent();
				while (oCurrent && !oCurrent.getBindingContext) {
					oCurrent = oCurrent.getParent();
				}
				oRow = oCurrent;
			}
			
			if (!oRow) {
				return MessageToast.show("Unable to find material row");
			}
			
			var oCtx = oRow.getBindingContext("refDocModel");
			if (!oCtx) {
				return MessageToast.show("Unable to get material details");
			}
			
			var oMaterial = oCtx.getObject();
			if (!oMaterial) {
				return MessageToast.show("Material data not available");
			}
			
			this._oEditingMaterial = oMaterial;
			this._bIsEditMode = true;
			
			// Open dialog - it will populate itself
			this._openAddMaterialDialog()
				.catch(function (oError) {
					MessageToast.show("Failed to open edit dialog: " + (oError.message || "Unknown error"));
				});
		},

		onDeleteMaterialRow: function (oEvent) {
			var oGlobalModel = sap.ui.getCore().getModel("globalData");
			if (oGlobalModel && oGlobalModel.getProperty("/DisableRefDocMaterialsActions")) {
				MessageToast.show("Deleting materials is disabled for this movement scenario.");
				return;
			}
			var oItem = oEvent.getSource().getParent();
			var oCtx = oItem.getBindingContext("refDocModel");
			if (!oCtx) {
				return MessageToast.show("Unable to get material details");
			}
			
			var oMaterial = oCtx.getObject();
			var sMessage = "Are you sure you want to delete this material row?";
			
			MessageBox.confirm(sMessage, {
				actions: [MessageBox.Action.YES, MessageBox.Action.NO],
				onClose: function (sAction) {
					if (sAction === MessageBox.Action.YES) {
						this._deleteMaterialDetail(oMaterial);
					}
				}.bind(this)
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
				// Also expose globally so other subviews (e.g. Loading) can reuse materials
				sap.ui.getCore().setModel(oModel, "refDocModel");
			} else {
				// Ensure global reference is always in sync
				sap.ui.getCore().setModel(oModel, "refDocModel");
			}

			return oModel;
		},

		_openAddRefDocDialog: function () {
			var that = this;
			return new Promise(function (resolve, reject) {
				// Ensure doc types are loaded before opening dialog
				that._loadDocTypes().then(function () {
					if (!that._oAddRefDocDialog) {
						Fragment.load({
							id: that.getView().getId(),
							name: "com.incresolZ_INC_PLMS.fragments.ReferenceDocumentsFrags.AddRefDocDialog",
							controller: that
						}).then(function (oDialog) {
							if (!oDialog) {
								reject(new Error("Fragment loaded but dialog is null"));
								return;
							}
							that._oAddRefDocDialog = oDialog;
							that.getView().addDependent(oDialog);
							// Ensure docTypeModel is set on the dialog - this is critical for the binding to work
							var oDocTypeModel = that._getDocTypeModel();
							oDialog.setModel(oDocTypeModel, "docTypeModel");
							// Set dialog mode after dialog is loaded (important for first time)
							that._setRefDocDialogMode(that._bIsRefDocEditMode ? "edit" : "add");
							// Populate dialog if in edit mode
							if (that._bIsRefDocEditMode && that._oEditingRefDoc) {
								that._populateRefDocDialog(that._oEditingRefDoc);
							}
							that._loadRefDocSuggestions(that._sSelectedDocType);
							oDialog.open();
							// Ensure Select binding is refreshed after dialog opens
							setTimeout(function() {
								var oSelect = that.byId("idRefDocType");
								if (oSelect) {
									var oBinding = oSelect.getBinding("items");
									if (oBinding) {
										oBinding.refresh();
									}
								}
							}, 100);
							resolve(oDialog);
						}.bind(that))
						.catch(function (oError) {
							reject(oError);
						});
					} else {
						// Ensure docTypeModel is set on the dialog when reopening
						var oDocTypeModel = that._getDocTypeModel();
						that._oAddRefDocDialog.setModel(oDocTypeModel, "docTypeModel");
						// Set dialog mode when reopening (in case mode changed)
						that._setRefDocDialogMode(that._bIsRefDocEditMode ? "edit" : "add");
						// Populate dialog if in edit mode
						if (that._bIsRefDocEditMode && that._oEditingRefDoc) {
							that._populateRefDocDialog(that._oEditingRefDoc);
						}
						that._loadRefDocSuggestions(that._sSelectedDocType);
						that._oAddRefDocDialog.open();
						resolve(that._oAddRefDocDialog);
					}
				}).catch(function (oError) {
					// Even if loading fails, still try to open dialog with existing model
					if (!that._oAddRefDocDialog) {
						Fragment.load({
							id: that.getView().getId(),
							name: "com.incresolZ_INC_PLMS.fragments.ReferenceDocumentsFrags.AddRefDocDialog",
							controller: that
						}).then(function (oDialog) {
							if (!oDialog) {
								reject(new Error("Fragment loaded but dialog is null"));
								return;
							}
							that._oAddRefDocDialog = oDialog;
							that.getView().addDependent(oDialog);
							var oDocTypeModel = that._getDocTypeModel();
							oDialog.setModel(oDocTypeModel, "docTypeModel");
							that._setRefDocDialogMode(that._bIsRefDocEditMode ? "edit" : "add");
							if (that._bIsRefDocEditMode && that._oEditingRefDoc) {
								that._populateRefDocDialog(that._oEditingRefDoc);
							}
							that._loadRefDocSuggestions(that._sSelectedDocType);
							oDialog.open();
							resolve(oDialog);
						}.bind(that));
					} else {
						var oDocTypeModel = that._getDocTypeModel();
						that._oAddRefDocDialog.setModel(oDocTypeModel, "docTypeModel");
						that._setRefDocDialogMode(that._bIsRefDocEditMode ? "edit" : "add");
						if (that._bIsRefDocEditMode && that._oEditingRefDoc) {
							that._populateRefDocDialog(that._oEditingRefDoc);
						}
						that._loadRefDocSuggestions(that._sSelectedDocType);
						that._oAddRefDocDialog.open();
						resolve(that._oAddRefDocDialog);
					}
				});
			}.bind(this));
		},

		_openAddMaterialDialog: function () {
			return new Promise(function (resolve, reject) {
				if (!this._oAddMaterialDialog) {
					Fragment.load({
						id: this.getView().getId(),
						name: "com.incresolZ_INC_PLMS.fragments.ReferenceDocumentsFrags.AddMaterialRowDialog",
						controller: this
					}).then(function (oDialog) {
						if (!oDialog) {
							reject(new Error("Fragment loaded but dialog is null"));
							return;
						}
						this._oAddMaterialDialog = oDialog;
						this.getView().addDependent(oDialog);
						// Set dialog mode after dialog is loaded (important for first time)
						this._setMaterialDialogMode(this._bIsEditMode ? "edit" : "add");
						// Populate dialog if in edit mode
						if (this._bIsEditMode && this._oEditingMaterial) {
							this._populateMaterialDialog(this._oEditingMaterial);
						}
						this._loadMaterialDocTypesFromRefDocs();
						this._loadMaterialRefDocNumbersFromRefDocs();
						this._loadMaterialSuggestions(this._sSelectedMaterialDocType);
						oDialog.open();
						resolve(oDialog);
					}.bind(this))
					.catch(function (oError) {
						reject(oError);
					});
				} else {
					// Set dialog mode when reopening (in case mode changed)
					this._setMaterialDialogMode(this._bIsEditMode ? "edit" : "add");
					// Populate dialog if in edit mode
					if (this._bIsEditMode && this._oEditingMaterial) {
						this._populateMaterialDialog(this._oEditingMaterial);
					}
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

		_openSelectMaterialsDialog: function (sDocType, sDocNumber) {
			var that = this;
			return new Promise(function (resolve, reject) {
				if (!this._oSelectMaterialsDialog) {
					Fragment.load({
						id: this.getView().getId(),
						name: "com.incresolZ_INC_PLMS.fragments.ReferenceDocumentsFrags.SelectMaterialsDialog",
						controller: this
					}).then(function (oDialog) {
						if (!oDialog) {
							reject(new Error("Fragment loaded but dialog is null"));
							return;
						}
						this._oSelectMaterialsDialog = oDialog;
						this.getView().addDependent(oDialog);
						// Load materials for this document
						this._loadMaterialsForDocument(sDocType, sDocNumber, oDialog);
						oDialog.open();
						resolve(oDialog);
					}.bind(this))
					.catch(function (oError) {
						reject(oError);
					});
				} else {
					// Reload materials when reopening
					this._loadMaterialsForDocument(sDocType, sDocNumber, this._oSelectMaterialsDialog);
					this._oSelectMaterialsDialog.open();
					resolve(this._oSelectMaterialsDialog);
				}
			}.bind(this));
		},

		_loadMaterialsForDocument: function (sDocType, sDocNumber, oDialog) {
			var that = this;
			// Fetch ItemDetails for this document
			// Force network call when selecting materials (bypass cache)
			this._fetchItemDetailsByRefDocNo(sDocType, sDocNumber, true)
				.then(function (aMaterials) {
					// Create or get model for materials selection
					var oModel = oDialog.getModel("materialsSelectionModel");
					if (!oModel) {
						oModel = new JSONModel({ items: [], selectedCount: 0 });
						oDialog.setModel(oModel, "materialsSelectionModel");
					}
					// Set materials data
					oModel.setProperty("/items", aMaterials || []);
					oModel.setProperty("/selectedCount", 0);
					
					// Clear selection
					var oTable = that.byId("idMaterialsSelectionTable");
					if (oTable) {
						oTable.removeSelections();
					}
					
					// Update selected count when selection changes
					if (oTable) {
						oTable.attachSelectionChange(function(oEvent) {
							var aSelectedItems = oTable.getSelectedItems();
							oModel.setProperty("/selectedCount", aSelectedItems.length);
						});
					}
				})
				.catch(function (oError) {
					var sErrorMsg = that._extractErrorMessage(oError) || "Unknown error";
					MessageToast.show("Unable to load materials: " + sErrorMsg);
					var oModel = oDialog.getModel("materialsSelectionModel");
					if (!oModel) {
						oModel = new JSONModel({ items: [], selectedCount: 0 });
						oDialog.setModel(oModel, "materialsSelectionModel");
					}
					oModel.setProperty("/items", []);
					oModel.setProperty("/selectedCount", 0);
				});
		},

		_saveMaterialsOneByOne: function (aMaterials) {
			var that = this;
			var oGlobalModel = sap.ui.getCore().getModel("globalData");
			var sTripNumber = oGlobalModel?.getProperty("/TripNumber") || "";
			
			if (!sTripNumber) {
				return MessageToast.show("Trip Number missing. Please open a trip first.");
			}
			
			var iTotal = aMaterials.length;
			var iSuccess = 0;
			var iFailed = 0;
			var aErrors = [];
			
			// Disable the button during processing
			var oAddButton = this.byId("idAddSelectedMaterialsBtn");
			if (oAddButton) {
				oAddButton.setEnabled(false);
				oAddButton.setText("Adding...");
			}
			
			// Process materials sequentially
			var iIndex = 0;
			var processNext = function() {
				if (iIndex >= aMaterials.length) {
					// All done
					if (oAddButton) {
						oAddButton.setEnabled(true);
						oAddButton.setText("Add Selected Materials");
					}
					
					var sMessage = "";
					if (iSuccess > 0 && iFailed === 0) {
						sMessage = "Successfully added " + iSuccess + " material(s)";
						MessageToast.show(sMessage);
						// Refresh material table
						that._refreshMaterialsTable();
						// Close dialog
						that.onCloseSelectMaterialsDialog();
					} else if (iSuccess > 0 && iFailed > 0) {
						sMessage = "Added " + iSuccess + " material(s), " + iFailed + " failed";
						MessageToast.show(sMessage);
						that._refreshMaterialsTable();
					} else {
						sMessage = "Failed to add materials: " + (aErrors.length > 0 ? aErrors[0] : "Unknown error");
						MessageToast.show(sMessage);
					}
					return;
				}
				
				var oMaterial = aMaterials[iIndex];
				var oPayload = {
					TripNumber: sTripNumber,
					DocType: oMaterial.DocType || "",
					RefDocNo: oMaterial.RefDocNo || "",
					RefDocItemNo: oMaterial.RefDocItemNo || "",
					MaterialCode: oMaterial.MaterialCode || "",
					MaterialDescription: oMaterial.MaterialDescription || oMaterial.MaterialCode || "",
					Quantity: oMaterial.Quantity !== null && oMaterial.Quantity !== undefined ? String(oMaterial.Quantity) : "0",
					UoM: oMaterial.UoM || "",
					IsDeleted: "",
					IsSplitActive: false
				};
				
				that._saveMaterialDetail(oPayload)
					.then(function (oResponse) {
						iSuccess++;
						iIndex++;
						processNext();
					})
					.catch(function (oError) {
						iFailed++;
						var sErrorMsg = that._extractErrorMessage(oError) || "Unknown error";
						aErrors.push(sErrorMsg);
						iIndex++;
						processNext();
					});
			};
			
			processNext();
		},

	_refreshMaterialsTable: function () {
		// Refresh the material details table by reloading ItemDetails for the current TripNumber
		var oGlobalModel = sap.ui.getCore().getModel("globalData");
		var sTripNumber = oGlobalModel?.getProperty("/TripNumber") || "";
		
		if (!sTripNumber) {
			return;
		}
		
		var that = this;
		// Always fetch fresh data from server after adding materials to ensure latest data
		// This ensures newly added materials are immediately visible in the table
		var oService = this._getItemDetailsService();
		oService.read("/ItemDetails", {
			filters: [
				new Filter("TripNumber", FilterOperator.EQ, sTripNumber),
				new Filter("IsDeleted", FilterOperator.NE, "X")
			],
			success: function (oData) {
				var aItemDetails = oData.results || [];
				// Update material table with all ItemDetails for this TripNumber
				that._setMaterialDetailsFromService(aItemDetails);
				// _setMaterialDetailsFromService already calls _filterMaterialDetails() 
				// to filter by selected reference document if any
			},
			error: function (oError) {
				// Silently fail - material table will show existing data
			}
		});
	},

		_resetRefDocDialog: function () {
			// Reset Select for Doc Type
			var oDocTypeSelect = this.byId("idRefDocType");
			if (oDocTypeSelect) {
				oDocTypeSelect.setSelectedKey(null);
			}
			// Reset other Input fields
			[
				"idRefDocNumber",
				"idRefDocPartyCode",
				"idRefDocPartyName",
				"idRefDocSalesDoc",
				"idRefDocSalesDoctype"
			].forEach(function (sId) {
				this.byId(sId)?.setValue("");
			}.bind(this));

			[
				"idRefDocDate"
			].forEach(function (sId) {
				var oControl = this.byId(sId);
				oControl?.setValue("");
			}.bind(this));

			this._oEditingRefDoc = null;
			this._bIsRefDocEditMode = false;
			this._setRefDocDialogMode("add");
		},


		_setRefDocDialogMode: function (sMode) {
			var oDialog = this.byId("idAddRefDocDialog");
			var oSaveButton = this.byId("idRefDocDialogSaveBtn");
			var bIsEdit = (sMode === "edit");

			oDialog?.setTitle(bIsEdit ? "Edit Reference Document" : "Add Reference Document");
			oSaveButton?.setText(bIsEdit ? "Update" : "Add");
		},

		_populateRefDocDialog: function (oRefDoc) {
			if (!oRefDoc) {
				return;
			}

			var oDocTypeSelect = this.byId("idRefDocType");
			if (oDocTypeSelect) {
				oDocTypeSelect.setSelectedKey(oRefDoc.docType || "");
			}
			this._sSelectedDocType = oRefDoc.docType || "";
			this.byId("idRefDocNumber")?.setValue(oRefDoc.documentNumber || "");
			this.byId("idRefDocDate")?.setValue(oRefDoc.documentDate || "");
			this.byId("idRefDocPartyCode")?.setValue(oRefDoc.partyCode || "");
			this.byId("idRefDocPartyName")?.setValue(oRefDoc.partyName || "");
			this.byId("idRefDocEwayBillNumber")?.setValue(oRefDoc.ewayBillNumber || "");
			this.byId("idRefDocEwayBillDate")?.setValue(oRefDoc.ewayBillDate || "");
			this.byId("idRefDocSalesDoc")?.setValue(oRefDoc.salesDoc || "");
			this.byId("idRefDocSalesDoctype")?.setValue(oRefDoc.salesDoctype || "");
			
			// Load suggestions for the selected doc type
			if (oRefDoc.docType) {
				this._loadRefDocSuggestions(oRefDoc.docType);
			}
		},

		_resetMaterialDialog: function () {
			[
				"idMaterialDocType",
				"idMaterialRefDocNo",
				"idMaterialRefDocItem",
				"idMaterialCode",
				"idMaterialDesc",
				"idMaterialQty",
				"idMaterialDispatchQty",
				"idMaterialRemainQty",
				"idMaterialUoM"
			].forEach(function (sId) {
				this.byId(sId)?.setValue("");
			}.bind(this));
			this.byId("idMaterialDispatchDate")?.setValue("");

			this._sSelectedMaterialDocType = "";
			this._oEditingMaterial = null;
			this._bIsEditMode = false;
			this._setMaterialDialogMode("add");
			// Clear material items when resetting
			this._getMaterialItemsModel().setProperty("/items", []);
		},


		_setMaterialDialogMode: function (sMode) {
			var oDialog = this.byId("idAddMaterialDialog");
			var oSaveButton = this.byId("idMaterialDialogSaveBtn");
			var bIsEdit = (sMode === "edit");

			oDialog?.setTitle(bIsEdit ? "Edit Material Row" : "Add Material Row");
			oSaveButton?.setText(bIsEdit ? "Update" : "Add");
			// Allow editing of all material fields in both add and edit modes
			this.byId("idMaterialCode")?.setEditable(true);
			this.byId("idMaterialDesc")?.setEditable(true);
			this.byId("idMaterialUoM")?.setEditable(true);
			this.byId("idMaterialQty")?.setEditable(true);
			this.byId("idMaterialDispatchQty")?.setEditable(true);
			this.byId("idMaterialRemainQty")?.setEditable(true);
			this.byId("idMaterialDispatchDate")?.setEditable(true);
		},

		_populateMaterialDialog: function (oMaterial) {
			if (!oMaterial) {
				return;
			}

			this.byId("idMaterialDocType")?.setValue(oMaterial.docType || "");
			this._sSelectedMaterialDocType = oMaterial.docType || "";
			this.byId("idMaterialRefDocNo")?.setValue(oMaterial.refDocNo || "");
			this.byId("idMaterialRefDocItem")?.setValue(oMaterial.refDocItemNo || "");
			this.byId("idMaterialCode")?.setValue(oMaterial.materialCode || "");
			this.byId("idMaterialDesc")?.setValue(oMaterial.materialDescription || "");
			this.byId("idMaterialQty")?.setValue(oMaterial.qty || "");
			this.byId("idMaterialDispatchQty")?.setValue(oMaterial.dispatchQty != null && oMaterial.dispatchQty !== "" ? String(oMaterial.dispatchQty) : "");
			this.byId("idMaterialRemainQty")?.setValue(oMaterial.remainQty != null && oMaterial.remainQty !== "" ? String(oMaterial.remainQty) : "");
			this.byId("idMaterialDispatchDate")?.setValue(oMaterial.dispatchDate || "");
			this.byId("idMaterialUoM")?.setValue(oMaterial.uom || "");
			
			// Load suggestions for the selected doc type
			if (oMaterial.docType) {
				this._loadMaterialRefDocNumbersFromRefDocs(oMaterial.docType);
				this._loadMaterialSuggestions(oMaterial.docType);
				
				// Load material items for the selected reference document
				if (oMaterial.refDocNo) {
					this._loadMaterialItemsForRefDoc(oMaterial.docType, oMaterial.refDocNo);
				}
			}
		},

		_openMaterialValueHelpDialog: function (sDocType) {
			var that = this;
			this._fetchItemDetails(sDocType)
				.then(function (aItems) {
					that._updateMaterialSuggestions(aItems);
					if (!that._oMaterialValueHelp) {
						return that._createMaterialValueHelpDialog().then(function () {
							return aItems;
						});
					}
					return aItems;
				})
				.then(function (aItems) {
					var oModel = that._oMaterialValueHelp.getModel("itemDetailsVH");
					if (!oModel) {
						oModel = new JSONModel({ items: [] });
						that._oMaterialValueHelp.setModel(oModel, "itemDetailsVH");
					}
					oModel.setProperty("/items", aItems || []);
					that._resetMaterialValueHelpFilters();
					that._oMaterialValueHelp.open();
				})
				.catch(function () {
					MessageToast.show("Unable to fetch material reference data");
				});
		},

		_createMaterialValueHelpDialog: function () {
			return Fragment.load({
				id: this.getView().getId(),
				name: "com.incresolZ_INC_PLMS.fragments.ReferenceDocumentsFrags.MaterialValueHelpDialog",
				controller: this
			}).then(function (oDialog) {
				this._oMaterialValueHelp = oDialog;
				this.getView().addDependent(oDialog);
				if (!oDialog.getModel("itemDetailsVH")) {
					oDialog.setModel(new JSONModel({ items: [] }), "itemDetailsVH");
				}
				return oDialog;
			}.bind(this));
		},

	_onMaterialValueHelpSearch: function (oEvent) {
		var sValue = oEvent.getParameter("value") || "";
		var oSearchField = oEvent.getSource();
		// Get the parent SelectDialog
		var oSelectDialog = oSearchField.getParent();
		// If parent is not a SelectDialog, traverse up
		while (oSelectDialog && !oSelectDialog.isA("sap.m.SelectDialog")) {
			oSelectDialog = oSelectDialog.getParent();
		}
		
		if (!oSelectDialog) {
			return;
		}
		
		var oBinding = oSelectDialog.getBinding("items");

		if (!oBinding) {
			return;
		}

			var aFilters = [];
			if (sValue) {
				var sLowerValue = sValue.toLowerCase();
				aFilters.push(new Filter({
					filters: [
						new Filter({
							path: "MaterialCode",
							operator: function(sMatCode) {
								return sMatCode && sMatCode.toString().toLowerCase().indexOf(sLowerValue) !== -1;
							}
						}),
						new Filter({
							path: "MaterialDescription",
							operator: function(sMatDesc) {
								return sMatDesc && sMatDesc.toString().toLowerCase().indexOf(sLowerValue) !== -1;
							}
						}),
						new Filter({
							path: "RefDocNo",
							operator: function(sRefDocNo) {
								return sRefDocNo && sRefDocNo.toString().toLowerCase().indexOf(sLowerValue) !== -1;
							}
						})
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
				return this._createMaterialRefDocNoValueHelpDialog().then(function () {
					var oModel = this._oMaterialRefDocNoValueHelp.getModel("orderDetailsVH");
					if (!oModel) {
						oModel = new JSONModel({ items: [] });
						this._oMaterialRefDocNoValueHelp.setModel(oModel, "orderDetailsVH");
					}
					oModel.setProperty("/items", aDocs || []);
					this._resetMaterialRefDocNoValueHelpFilters();
					this._oMaterialRefDocNoValueHelp.open();
				}.bind(this));
			}

			var oModel = this._oMaterialRefDocNoValueHelp.getModel("orderDetailsVH");
			if (!oModel) {
				oModel = new JSONModel({ items: [] });
				this._oMaterialRefDocNoValueHelp.setModel(oModel, "orderDetailsVH");
			}
			oModel.setProperty("/items", aDocs || []);
			this._resetMaterialRefDocNoValueHelpFilters();
			this._oMaterialRefDocNoValueHelp.open();
		},

		_createMaterialRefDocNoValueHelpDialog: function () {
			return Fragment.load({
				id: this.getView().getId(),
				name: "com.incresolZ_INC_PLMS.fragments.ReferenceDocumentsFrags.MaterialRefDocNoValueHelpDialog",
				controller: this
			}).then(function (oDialog) {
				this._oMaterialRefDocNoValueHelp = oDialog;
				this.getView().addDependent(oDialog);
				if (!oDialog.getModel("orderDetailsVH")) {
					oDialog.setModel(new JSONModel({ items: [] }), "orderDetailsVH");
				}
				return oDialog;
			}.bind(this));
		},

	_onMaterialRefDocNoValueHelpSearch: function (oEvent) {
		var sValue = oEvent.getParameter("value") || "";
		var oSearchField = oEvent.getSource();
		// Get the parent SelectDialog
		var oSelectDialog = oSearchField.getParent();
		// If parent is not a SelectDialog, traverse up
		while (oSelectDialog && !oSelectDialog.isA("sap.m.SelectDialog")) {
			oSelectDialog = oSelectDialog.getParent();
		}
		
		if (!oSelectDialog) {
			return;
		}
		
		var oBinding = oSelectDialog.getBinding("items");

		if (!oBinding) {
			return;
		}

			var aFilters = [];
			if (sValue) {
				var sLowerValue = sValue.toLowerCase();
				aFilters.push(new Filter({
					filters: [
						new Filter({
							path: "DocumentNumber",
							operator: function(sDocNum) {
								return sDocNum && sDocNum.toString().toLowerCase().indexOf(sLowerValue) !== -1;
							}
						}),
						new Filter({
							path: "DocType",
							operator: function(sDocType) {
								return sDocType && sDocType.toString().toLowerCase().indexOf(sLowerValue) !== -1;
							}
						}),
						new Filter({
							path: "Name",
							operator: function(sName) {
								return sName && sName.toString().toLowerCase().indexOf(sLowerValue) !== -1;
							}
						})
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

			// Automatically add all materials from this reference document
			if (sDocType && sRefDocNo) {
				this._addAllMaterialsFromRefDoc(sDocType, sRefDocNo);
			}
		},

	_fetchItemDetailsByRefDocNo: function (sDocType, sRefDocNo, bForceNetworkCall) {
		return new Promise(function (resolve, reject) {
			// Only check cache if bForceNetworkCall is false or undefined
			if (!bForceNetworkCall) {
				// FIRST: ALWAYS check if ItemDetails is already available from TripData $expand
				// If so, filter from that data instead of making a separate call
				// This prevents duplicate calls even if _loadAllMaterialsForAllRefDocs is called
				var oTripData = sap.ui.getCore().getModel("TripData");
				if (oTripData) {
					var vItemDetails = oTripData.getProperty("/ItemDetails");
					if (vItemDetails) {
						var aAllItemDetails = null; // Initialize as null, not empty array
						
						// Handle different data structures from OData $expand
						if (Array.isArray(vItemDetails)) {
							aAllItemDetails = vItemDetails;
						} else if (vItemDetails && typeof vItemDetails === "object" && vItemDetails.results) {
							if (Array.isArray(vItemDetails.results)) {
								aAllItemDetails = vItemDetails.results;
							}
						}
						
						// If we successfully extracted ItemDetails data from TripData, use it
						// This means data was loaded via $expand, so NO separate OData call needed
						if (aAllItemDetails !== null && Array.isArray(aAllItemDetails)) {
							// Filter by DocType and RefDocNo from the already-loaded data
							var aFiltered = aAllItemDetails.filter(function(oItem) {
								return oItem && 
									   typeof oItem === "object" &&
									   oItem.DocType === sDocType && 
									   oItem.RefDocNo === sRefDocNo && 
									   oItem.IsDeleted !== "X";
							});
							// Return filtered results - NO OData call needed
							// Even if filtered array is empty, return it because data was already loaded
							resolve(aFiltered);
							return; // CRITICAL: Exit early to prevent OData call
						}
					}
				}
			}

			// Always make network call when bForceNetworkCall is true
			// Fallback: Make separate call only if data is not available from TripData
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
				return this._createItemDetailsValueHelpDialog().then(function () {
					var oModel = this._oItemDetailsValueHelp.getModel("itemDetailsVH");
					if (!oModel) {
						oModel = new JSONModel({ items: [] });
						this._oItemDetailsValueHelp.setModel(oModel, "itemDetailsVH");
					}
					oModel.setProperty("/items", aItems || []);
					this._resetItemDetailsValueHelpFilters();
					this._oItemDetailsValueHelp.open();
				}.bind(this));
			}

			var oModel = this._oItemDetailsValueHelp.getModel("itemDetailsVH");
			if (!oModel) {
				oModel = new JSONModel({ items: [] });
				this._oItemDetailsValueHelp.setModel(oModel, "itemDetailsVH");
			}
			oModel.setProperty("/items", aItems || []);
			this._resetItemDetailsValueHelpFilters();
			this._oItemDetailsValueHelp.open();
		},

		_createItemDetailsValueHelpDialog: function () {
			return Fragment.load({
				id: this.getView().getId(),
				name: "com.incresolZ_INC_PLMS.fragments.ReferenceDocumentsFrags.ItemDetailsValueHelpDialog",
				controller: this
			}).then(function (oDialog) {
				this._oItemDetailsValueHelp = oDialog;
				this.getView().addDependent(oDialog);
				if (!oDialog.getModel("itemDetailsVH")) {
					oDialog.setModel(new JSONModel({ items: [] }), "itemDetailsVH");
				}
				return oDialog;
			}.bind(this));
		},

	_onItemDetailsValueHelpSearch: function (oEvent) {
		var sValue = oEvent.getParameter("value") || "";
		var oSearchField = oEvent.getSource();
		// Get the parent SelectDialog
		var oSelectDialog = oSearchField.getParent();
		// If parent is not a SelectDialog, traverse up
		while (oSelectDialog && !oSelectDialog.isA("sap.m.SelectDialog")) {
			oSelectDialog = oSelectDialog.getParent();
		}
		
		if (!oSelectDialog) {
			return;
		}
		
		var oBinding = oSelectDialog.getBinding("items");

		if (!oBinding) {
			return;
		}

			var aFilters = [];
			if (sValue) {
				var sLowerValue = sValue.toLowerCase();
				aFilters.push(new Filter({
					filters: [
						new Filter({
							path: "MaterialCode",
							operator: function(sMatCode) {
								return sMatCode && sMatCode.toString().toLowerCase().indexOf(sLowerValue) !== -1;
							}
						}),
						new Filter({
							path: "MaterialDescription",
							operator: function(sMatDesc) {
								return sMatDesc && sMatDesc.toString().toLowerCase().indexOf(sLowerValue) !== -1;
							}
						}),
						new Filter({
							path: "RefDocItemNo",
							operator: function(sRefDocItemNo) {
								return sRefDocItemNo && sRefDocItemNo.toString().toLowerCase().indexOf(sLowerValue) !== -1;
							}
						})
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
			var that = this;
			this._fetchOrderDetails(sDocType)
				.then(function (aDocs) {
					that._updateRefDocSuggestions(aDocs);
					if (!that._oRefDocValueHelp) {
						return that._createRefDocValueHelpDialog().then(function () {
							return aDocs;
						});
					}
					return aDocs;
				})
				.then(function (aDocs) {
					var oModel = that._oRefDocValueHelp.getModel("orderDetailsVH");
					if (!oModel) {
						oModel = new JSONModel({ items: [] });
						that._oRefDocValueHelp.setModel(oModel, "orderDetailsVH");
					}
					oModel.setProperty("/items", aDocs || []);
					that._resetRefDocValueHelpFilters();
					that._oRefDocValueHelp.open();
				})
				.catch(function () {
					MessageToast.show("Unable to fetch document reference data");
				});
		},

		_createRefDocValueHelpDialog: function () {
			return Fragment.load({
				id: this.getView().getId(),
				name: "com.incresolZ_INC_PLMS.fragments.ReferenceDocumentsFrags.RefDocValueHelpDialog",
				controller: this
			}).then(function (oDialog) {
				this._oRefDocValueHelp = oDialog;
				this.getView().addDependent(oDialog);
				if (!oDialog.getModel("orderDetailsVH")) {
					oDialog.setModel(new JSONModel({ items: [] }), "orderDetailsVH");
				}
				return oDialog;
			}.bind(this));
		},

	_onRefDocValueHelpSearch: function (oEvent) {
		var sQuery = (oEvent.getParameter("value") || "").trim().toLowerCase();
		var oSelectDialog = oEvent.getSource(); // SelectDialog itself
		var oBinding = oSelectDialog && oSelectDialog.getBinding("items");

		if (!oBinding) {
			return;
		}

		var aFilters = [];

		if (sQuery) {
			// Generic, case-insensitive filter across all properties in the row
			aFilters.push(new Filter(function (oContext) {
				var oObj = oContext.getObject();
				if (!oObj) {
					return false;
				}

				return Object.keys(oObj).some(function (sKey) {
					var vValue = oObj[sKey];
					if (vValue === null || vValue === undefined) {
						return false;
					}
					var sValue = String(vValue).toLowerCase();
					return sValue.indexOf(sQuery) !== -1;
				});
			}));
		}

		// Empty aFilters => no filter applied (all items)
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

			var oDocTypeSelect = this.byId("idRefDocType");
			if (oDocTypeSelect) {
				oDocTypeSelect.setSelectedKey(oDoc.DocType || "");
			}
			this._sSelectedDocType = oDoc.DocType || this._sSelectedDocType;
			this.byId("idRefDocNumber")?.setValue(oDoc.DocumentNumber || "");
			this.byId("idRefDocDate")?.setValue(this._formatODataDate(oDoc.DocumentDate));
			this.byId("idRefDocPartyCode")?.setValue(oDoc.Vendor || oDoc.Customer || "");
			this.byId("idRefDocPartyName")?.setValue(oDoc.Name || "");
			this.byId("idRefDocSalesDoc")?.setValue(oDoc.SalesDoc || "");
			this.byId("idRefDocSalesDoctype")?.setValue(oDoc.SalesDoctype || "");
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


		_escapeODataValue: function (sValue) {
			return (sValue || "").replace(/'/g, "''");
		},

		// ============================================================
		// Helper Functions for HTTP Operations
		// ============================================================
		_extractErrorMessage: function (oError) {
			if (!oError) {
				return "An unknown error occurred";
			}

			// Try to parse JSON error response
			if (oError.responseText) {
				try {
					var oResponse = JSON.parse(oError.responseText);
					if (oResponse.error) {
						if (oResponse.error.message) {
							return oResponse.error.message.value || oResponse.error.message;
						}
					}
				} catch (e) {
					// Not JSON, try XML or other formats
				}
			}

			// Fallback to error message property
			if (oError.message) {
				return oError.message.value || oError.message;
			}

			return oError.message || "Operation failed";
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

		_getMaterialItemsModel: function () {
			if (!this._oMaterialItemsModel) {
				this._oMaterialItemsModel = new JSONModel({ items: [] });
				this.getView().setModel(this._oMaterialItemsModel, "materialItems");
			}
			return this._oMaterialItemsModel;
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

		_loadMaterialItemsForRefDoc: function (sDocType, sRefDocNo) {
			if (!sDocType || !sRefDocNo) {
				this._getMaterialItemsModel().setProperty("/items", []);
				return;
			}

			this._fetchItemDetailsByRefDocNo(sDocType, sRefDocNo)
				.then(function (aItems) {
					this._getMaterialItemsModel().setProperty("/items", aItems || []);
				}.bind(this))
				.catch(function (oError) {
					this._getMaterialItemsModel().setProperty("/items", []);
				}.bind(this));
		},

		_addAllMaterialsFromRefDoc: function (sDocType, sRefDocNo) {
			var that = this;
			var oGlobalModel = sap.ui.getCore().getModel("globalData");
			var sTripNumber = oGlobalModel?.getProperty("/TripNumber") || "";

			if (!sTripNumber) {
				MessageToast.show("Trip Number missing. Please open a trip first.");
				return;
			}

			// Fetch all existing ItemDetails for this Ref Doc
			this._fetchItemDetailsByRefDocNo(sDocType, sRefDocNo)
				.then(function (aItems) {
					// Get existing materials from local model to avoid duplicates
					var oModel = that._ensureRefDocModel();
					var aExistingMaterials = oModel.getProperty("/materialDetails") || [];
					
					// Create a set of existing material keys for quick lookup
					var oExistingKeys = {};
					aExistingMaterials.forEach(function (oMat) {
						var sKey = (oMat.tripNumber || "") + "|" + 
								   (oMat.docType || "") + "|" + 
								   (oMat.refDocNo || "") + "|" + 
								   (oMat.refDocItemNo || "");
						oExistingKeys[sKey] = true;
					});

					// Filter out materials that already exist
					var aNewMaterials = aItems.filter(function (oItem) {
						var sKey = (oItem.TripNumber || "") + "|" + 
								   (oItem.DocType || "") + "|" + 
								   (oItem.RefDocNo || "") + "|" + 
								   (oItem.RefDocItemNo || "");
						return !oExistingKeys[sKey];
					});

					if (aNewMaterials.length === 0) {
						// Close the dialog since all materials are already added
						that._closeMaterialDialog();
						that._resetMaterialDialog();
						return;
					}

					// Add all new materials to local model
					var aMaterialsToAdd = aNewMaterials.map(function (oItem) {
						var vQty = oItem.Quantity;
						var sQtyDisplay = (vQty === null || vQty === undefined || vQty === "") ? "" : String(vQty);
						
						return {
							tripNumber: oItem.TripNumber || "",
							docType: oItem.DocType || "",
							refDocNo: oItem.RefDocNo || "",
							refDocItemNo: oItem.RefDocItemNo || "",
							materialCode: oItem.MaterialCode || "",
							materialDescription: oItem.MaterialDescription || "",
							qty: sQtyDisplay,
							uom: oItem.UoM || "",
							createdBy: oItem.CreatedBy || "",
							createdOnDate: that._formatODataDate(oItem.CreatedOn),
							createdOnTime: that._formatODataTime(oItem.CreatedTime),
							changedBy: oItem.ChangedBy || "",
							changedOnDate: that._formatODataDate(oItem.ChangedDate),
							changedOnTime: that._formatODataTime(oItem.ChangedTime)
						};
					});

					// Add all materials to the local model
					var aAllMaterials = aExistingMaterials.concat(aMaterialsToAdd);
					oModel.setProperty("/materialDetails", aAllMaterials);
					that._filterMaterialDetails();

					// Show success message and close dialog
					MessageToast.show(aNewMaterials.length + " material(s) added successfully");
					that._closeMaterialDialog();
					that._resetMaterialDialog();
				}.bind(this))
				.catch(function (oError) {
					var sMessage = that._extractErrorMessage(oError) || "Unable to fetch materials for the selected reference document";
					MessageToast.show(sMessage);
				});
		},

		_applySelectedMaterialItem: function (oItem) {
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

		_openMaterialItemValueHelpDialog: function (sDocType, sRefDocNo) {
			var that = this;
			this._fetchItemDetailsByRefDocNo(sDocType, sRefDocNo)
				.then(function (aItems) {
					if (!aItems || aItems.length === 0) {
						MessageToast.show("No material items found for the selected reference document");
						return;
					}
					
					that._getMaterialItemsModel().setProperty("/items", aItems);
					if (!that._oMaterialItemValueHelp) {
						return that._createMaterialItemValueHelpDialog().then(function () {
							return aItems;
						});
					}
					return aItems;
				})
				.then(function (aItems) {
					if (aItems && aItems.length > 0) {
						// Use the same model as the input field suggestions
						var oModel = that._oMaterialItemValueHelp.getModel("materialItems");
						if (!oModel) {
							oModel = that._getMaterialItemsModel();
							that._oMaterialItemValueHelp.setModel(oModel, "materialItems");
						}
						that._resetMaterialItemValueHelpFilters();
						that._oMaterialItemValueHelp.open();
					}
				})
				.catch(function () {
					MessageToast.show("Unable to fetch material items for the selected reference document");
				});
		},

		_createMaterialItemValueHelpDialog: function () {
			return Fragment.load({
				id: this.getView().getId(),
				name: "com.incresolZ_INC_PLMS.fragments.ReferenceDocumentsFrags.MaterialItemValueHelpDialog",
				controller: this
			}).then(function (oDialog) {
				this._oMaterialItemValueHelp = oDialog;
				this.getView().addDependent(oDialog);
				// Use the same model as the input field suggestions
				if (!oDialog.getModel("materialItems")) {
					oDialog.setModel(this._getMaterialItemsModel(), "materialItems");
				}
				return oDialog;
			}.bind(this));
		},

	onMaterialItemValueHelpSearch: function (oEvent) {
		var sValue = oEvent.getParameter("value") || "";
		var oSearchField = oEvent.getSource();
		// Get the parent SelectDialog
		var oSelectDialog = oSearchField.getParent();
		// If parent is not a SelectDialog, traverse up
		while (oSelectDialog && !oSelectDialog.isA("sap.m.SelectDialog")) {
			oSelectDialog = oSelectDialog.getParent();
		}
		
		if (!oSelectDialog) {
			return;
		}
		
		var oBinding = oSelectDialog.getBinding("items");

		if (!oBinding) {
			return;
		}

			var aFilters = [];
			if (sValue) {
				var sLowerValue = sValue.toLowerCase();
				aFilters.push(new Filter({
					filters: [
						new Filter({
							path: "MaterialCode",
							operator: function(sMatCode) {
								return sMatCode && sMatCode.toString().toLowerCase().indexOf(sLowerValue) !== -1;
							}
						}),
						new Filter({
							path: "MaterialDescription",
							operator: function(sMatDesc) {
								return sMatDesc && sMatDesc.toString().toLowerCase().indexOf(sLowerValue) !== -1;
							}
						}),
						new Filter({
							path: "RefDocItemNo",
							operator: function(sRefDocItemNo) {
								return sRefDocItemNo && sRefDocItemNo.toString().toLowerCase().indexOf(sLowerValue) !== -1;
							}
						})
					],
					and: false
				}));
			}

			oBinding.filter(aFilters);
		},

		onMaterialItemValueHelpConfirm: function (oEvent) {
			var aSelectedContexts = oEvent.getParameter("selectedContexts");
			var oCtx = aSelectedContexts?.[0];
			if (oCtx) {
				var oData = oCtx.getObject();
				this._applySelectedMaterialItem(oData);
			}
			this._resetMaterialItemValueHelpFilters();
		},

		onMaterialItemValueHelpCancel: function () {
			this._resetMaterialItemValueHelpFilters();
		},

		_resetMaterialItemValueHelpFilters: function () {
			if (this._oMaterialItemValueHelp) {
				var oBinding = this._oMaterialItemValueHelp.getBinding("items");
				oBinding?.filter([]);
			}
		},

		_buildOrderDetailPayload: function () {
			var oGlobalModel = sap.ui.getCore().getModel("globalData");
			var sTripNumber = oGlobalModel?.getProperty("/TripNumber") || "";

			var oDocTypeSelect = this.byId("idRefDocType");
			var sDocType = (oDocTypeSelect?.getSelectedItem()?.getKey() || oDocTypeSelect?.getValue() || "").trim();
			var sDocNumber = this.byId("idRefDocNumber")?.getValue().trim() || "";
			var sPartyCode = this.byId("idRefDocPartyCode")?.getValue().trim() || "";
			var sPartyName = this.byId("idRefDocPartyName")?.getValue().trim() || "";
			var sEwayBillNumber = this.byId("idRefDocEwayBillNumber")?.getValue().trim() || "";
			var sEwayBillDate = this.byId("idRefDocEwayBillDate")?.getValue();
			var sSalesDoc = this.byId("idRefDocSalesDoc")?.getValue().trim() || "";
			var sSalesDoctype = this.byId("idRefDocSalesDoctype")?.getValue().trim() || "";
			var sDate = this.byId("idRefDocDate")?.getValue();
			var oDate = sDate ? new Date(sDate) : null;
			if (oDate && isNaN(oDate.getTime())) {
				oDate = null;
			}

			// EwaybillDate is defined as Edm.String (length 10) in OrderDetails metadata.
			// Pass through as-is (e.g. 'yyyy-MM-dd') instead of converting to Date.

			var bIsEdit = false; // Edit mode removed

			var oPayload = {
				TripNumber: sTripNumber,
				DocType: sDocType,
				DocumentNumber: sDocNumber,
				DocumentDate: oDate,
				Vendor: sPartyCode,
				Customer: sPartyCode,
				Name: sPartyName,
				// Backend fields: EwayBill (string) and EwaybillDate (string)
				EwayBill: sEwayBillNumber,
				EwaybillDate: sEwayBillDate || "",
				SalesDoc: sSalesDoc,
				SalesDoctype: sSalesDoctype,
				Deleted: false
			};

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
			var sDispatchQty = (this.byId("idMaterialDispatchQty")?.getValue() || "").trim();
			var sRemainQty = (this.byId("idMaterialRemainQty")?.getValue() || "").trim();
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
			var fDispatchQty = 0;
			if (sDispatchQty) {
				var fD = parseFloat(sDispatchQty);
				if (!isNaN(fD) && isFinite(fD)) {
					fDispatchQty = fD;
				}
			}
			var fRemainQty = 0;
			if (sRemainQty) {
				var fR = parseFloat(sRemainQty);
				if (!isNaN(fR) && isFinite(fR)) {
					fRemainQty = fR;
				}
			}

			// MaterialDescription is required (Nullable="false"), use MaterialCode if empty
			if (!sMaterialDesc && sMaterialCode) {
				sMaterialDesc = sMaterialCode;
			}

			// Build payload - only include fields that are part of the key or user input
			// Note: All fields have sap:creatable="false" but we still need to send key fields
			// and user-provided values. The backend will handle the rest.

			// Quantity: Match Postman test format - send as string (e.g. "2" or "1.00")
			var sFormattedQty = "";
			if (fQty !== 0 || sQty) {
				if (fQty % 1 === 0) {
					sFormattedQty = String(Math.floor(fQty));
				} else {
					sFormattedQty = fQty.toFixed(2);
				}
			} else {
				sFormattedQty = "0";
			}
			var sFormattedDispatchQty = (fDispatchQty % 1 === 0) ? String(Math.floor(fDispatchQty)) : fDispatchQty.toFixed(2);
			var sFormattedRemainQty = (fRemainQty % 1 === 0) ? String(Math.floor(fRemainQty)) : fRemainQty.toFixed(2);

			var oPayload = {
				TripNumber: sTripNumber,
				DocType: sDocType,
				RefDocNo: sRefDocNo,
				RefDocItemNo: sRefDocItemNo,
				MaterialCode: sMaterialCode,
				MaterialDescription: sMaterialDesc || sMaterialCode, // Required, fallback to MaterialCode
				Quantity: sFormattedQty,
				DispatchQty: sFormattedDispatchQty,
				RemainQty: sFormattedRemainQty,
				UoM: sUoM || "", // Set to empty string if not provided
				IsDeleted: "", // Required MaxLength="1", use empty string for not deleted
				IsSplitActive: false
			};

			return oPayload;
		},

		_saveOrderDetail: function (oPayload) {
			var oService = this._getOrderDetailsService();
			return new Promise(function (resolve, reject) {
				oService.create("/OrderDetails", oPayload, {
					headers: {
						"X-Requested-With": "X",
						"Content-Type": "application/json"
					},
					success: resolve,
					error: reject
				});
			});
		},

		_updateOrderDetail: function (oPayload, oOriginalRefDoc) {
			// Validate required fields
			if (!oPayload.TripNumber || !oPayload.DocType || !oPayload.DocumentNumber) {
				return Promise.reject(new Error("Missing required fields"));
			}

			// Use original reference document values (lowercase property names from local model)
			// Fallback to payload values if original doesn't have them
			var sDocType = this._escapeODataValue(oOriginalRefDoc.docType || oPayload.DocType);
			var sTripNumber = this._escapeODataValue(oOriginalRefDoc.tripNumber || oPayload.TripNumber);
			var sDocumentNumber = this._escapeODataValue(oOriginalRefDoc.documentNumber || oPayload.DocumentNumber);

			// Build correct OData entity key path using original values
			var sEntityPath = "/OrderDetails(TripNumber='" + sTripNumber +
				"',DocType='" + sDocType +
				"',DocumentNumber='" + sDocumentNumber + "')";

			// Build update payload - include all fields (key fields + updatable fields)
			var oUpdatePayload = {
				TripNumber: oPayload.TripNumber,
				DocType: oPayload.DocType,
				DocumentNumber: oPayload.DocumentNumber,
				DocumentDate: oPayload.DocumentDate,
				Vendor: oPayload.Vendor || "",
				Customer: oPayload.Customer || "",
				Name: oPayload.Name || "",
				Deleted: oPayload.Deleted !== undefined ? oPayload.Deleted : false
			};

			var oService = this._getOrderDetailsService();
			return new Promise(function (resolve, reject) {
				oService.update(sEntityPath, oUpdatePayload, {
					merge: false,
					headers: {
						"X-Requested-With": "X"
					},
					success: function (oData) {
						var oResponse = Object.assign({}, oPayload, oData);
						resolve(oResponse);
					},
					error: function (oError) {
						reject(oError);
					}
				});
			});
		},

		_deleteOrderDetail: function (oRefDoc) {
			if (!oRefDoc) {
				return Promise.reject(new Error("Reference document data missing"));
			}

			// Build OData entity key path using the correct property names
			// Always use the current TripNumber from global model to ensure consistency
			var oGlobalModel = sap.ui.getCore().getModel("globalData");
			var sCurrentTripNumber = oGlobalModel?.getProperty("/TripNumber") || "";
			
			var sDocType = this._escapeODataValue(oRefDoc.DocType || oRefDoc.docType || "");
			var sTripNumber = this._escapeODataValue(sCurrentTripNumber || oRefDoc.TripNumber || oRefDoc.tripNumber || "");
			var sDocumentNumber = this._escapeODataValue(oRefDoc.DocumentNumber || oRefDoc.documentNumber || "");

			// Validate that we have all required key fields
			if (!sTripNumber || !sDocType || !sDocumentNumber) {
				return Promise.reject(new Error("Missing required key fields for deletion"));
			}

			var sEntityPath = "/OrderDetails(TripNumber='" + sTripNumber + 
				"',DocType='" + sDocType + 
				"',DocumentNumber='" + sDocumentNumber + "')";

			var oService = this._getOrderDetailsService();
			var that = this;
			
			return new Promise(function (resolve, reject) {
				oService.remove(sEntityPath, {
					headers: {
						"X-Requested-With": "X"
					},
					success: function (oData) {
						// Immediately update local model (don't wait for refresh)
						that._removeLocalReferenceDoc(oRefDoc);
						
						MessageToast.show("Reference document deleted");
						
						// Optionally refresh from backend to ensure sync (but UI already updated)
						// that._refreshBothTables();
						
						resolve(oData);
					}.bind(this),
					error: function (oError) {
						var sMessage = this._extractErrorMessage(oError) || "Unable to delete reference document";
						MessageToast.show(sMessage);
						reject(oError);
					}.bind(this)
				});
			}.bind(this));
		},

		_removeLocalReferenceDoc: function (oRefDoc) {
			var oModel = this._ensureRefDocModel();
			var aRefDocs = oModel.getProperty("/referenceDocs") || [];
			
			// Remove the reference document
			var aFiltered = aRefDocs.filter(function (oDoc) {
				return !(oDoc.tripNumber === oRefDoc.tripNumber &&
						 oDoc.docType === oRefDoc.docType &&
						 oDoc.documentNumber === oRefDoc.documentNumber);
			});
			
			oModel.setProperty("/referenceDocs", aFiltered, true);
			
			// Also remove related materials
			var aMaterials = oModel.getProperty("/materialDetails") || [];
			var aFilteredMaterials = aMaterials.filter(function (oMat) {
				return !(oMat.tripNumber === oRefDoc.tripNumber &&
						 oMat.docType === oRefDoc.docType &&
						 oMat.refDocNo === oRefDoc.documentNumber);
			});
			
			oModel.setProperty("/materialDetails", aFilteredMaterials, true);
			
			// Update filtered materials
			this._filterMaterialDetails();
			
			// Update dropdowns
			this._loadMaterialDocTypesFromRefDocs();
			this._loadMaterialRefDocNumbersFromRefDocs();
			
			// Clear selection if deleted ref doc was selected
			if (this._oSelectedRefDoc && 
				this._oSelectedRefDoc.tripNumber === oRefDoc.tripNumber &&
				this._oSelectedRefDoc.docType === oRefDoc.docType &&
				this._oSelectedRefDoc.documentNumber === oRefDoc.documentNumber) {
				this._oSelectedRefDoc = null;
			}
		},

		_updateLocalReferenceDoc: function (oPayload, oOriginalRefDoc) {
			var oModel = this._ensureRefDocModel();
			var aRefDocs = oModel.getProperty("/referenceDocs") || [];

			// Find and update the reference document in the array
			var iIndex = aRefDocs.findIndex(function (oDoc) {
				return oDoc.tripNumber === oOriginalRefDoc.tripNumber &&
					oDoc.docType === oOriginalRefDoc.docType &&
					oDoc.documentNumber === oOriginalRefDoc.documentNumber;
			});

			if (iIndex >= 0) {
				// Update the reference document with all fields from backend response
				aRefDocs[iIndex] = Object.assign({}, aRefDocs[iIndex], {
					// Keep uppercase versions for backend compatibility
					TripNumber: oPayload.TripNumber || aRefDocs[iIndex].TripNumber || aRefDocs[iIndex].tripNumber,
					DocType: oPayload.DocType || aRefDocs[iIndex].DocType || aRefDocs[iIndex].docType,
					DocumentNumber: oPayload.DocumentNumber || aRefDocs[iIndex].DocumentNumber || aRefDocs[iIndex].documentNumber,
					// Lowercase versions for UI binding
					tripNumber: oPayload.TripNumber || aRefDocs[iIndex].tripNumber,
					docType: oPayload.DocType || aRefDocs[iIndex].docType,
					documentNumber: oPayload.DocumentNumber || aRefDocs[iIndex].documentNumber,
					documentDate: this._formatODataDate(oPayload.DocumentDate) || aRefDocs[iIndex].documentDate,
					partyCode: oPayload.Vendor || oPayload.Customer || aRefDocs[iIndex].partyCode,
					partyName: oPayload.Name || aRefDocs[iIndex].partyName,
					salesDoc: oPayload.SalesDoc || aRefDocs[iIndex].salesDoc || "",
					salesDoctype: oPayload.SalesDoctype || aRefDocs[iIndex].salesDoctype || "",
					changedBy: oPayload.ChangedBy || aRefDocs[iIndex].changedBy || "",
					changedOnDate: this._formatODataDate(oPayload.ChangedOnDate || oPayload.ChangedOn) || aRefDocs[iIndex].changedOnDate,
					changedOnTime: this._formatODataTime(oPayload.ChangedTime) || aRefDocs[iIndex].changedOnTime
				});

				// Force model refresh by setting the entire array
				oModel.setProperty("/referenceDocs", aRefDocs, true); // true = force refresh
				
				// Update Material Doc Types and Document Numbers when Reference Documents are updated
				this._loadMaterialDocTypesFromRefDocs();
				this._loadMaterialRefDocNumbersFromRefDocs();
				
				// Refresh filtered materials if a ref doc is selected
				if (this._oSelectedRefDoc) {
					this._filterMaterialDetails();
				}
			}
		},

		_appendLocalReferenceDoc: function (oPayload) {
			var oModel = this._ensureRefDocModel();
			var aRefDocs = oModel.getProperty("/referenceDocs") || [];

			var oDocTypeSelect = this.byId("idRefDocType");
			var sDialogDocType = (oDocTypeSelect?.getSelectedItem()?.getKey() || oDocTypeSelect?.getValue() || "");
			var sDialogDocNumber = this.byId("idRefDocNumber")?.getValue() || "";
			var sDialogPartyCode = this.byId("idRefDocPartyCode")?.getValue() || "";
			var sDialogPartyName = this.byId("idRefDocPartyName")?.getValue() || "";
			var sDialogDate = this.byId("idRefDocDate")?.getValue() || "";
			var sDialogSalesDoc = this.byId("idRefDocSalesDoc")?.getValue() || "";
			var sDialogSalesDoctype = this.byId("idRefDocSalesDoctype")?.getValue() || "";

			aRefDocs.push({
				tripNumber: oPayload.TripNumber || "",
				docType: oPayload.DocType || sDialogDocType,
				documentNumber: oPayload.DocumentNumber || sDialogDocNumber,
				documentDate: this._formatODataDate(oPayload.DocumentDate) || sDialogDate,
				partyCode: oPayload.Vendor || oPayload.Customer || sDialogPartyCode,
				partyName: oPayload.Name || sDialogPartyName,
				salesDoc: oPayload.SalesDoc || sDialogSalesDoc || "",
				salesDoctype: oPayload.SalesDoctype || sDialogSalesDoctype || ""
			});
			// Force model refresh by setting the entire array
			oModel.setProperty("/referenceDocs", aRefDocs, true); // true = force refresh
		},


		_saveMaterialDetail: function (oPayload) {
			// Validate required fields
			if (!oPayload.TripNumber || !oPayload.DocType || !oPayload.RefDocNo || !oPayload.RefDocItemNo) {
				return Promise.reject(new Error("Missing required fields"));
			}

			var oService = this._getItemDetailsService();
			return new Promise(function (resolve, reject) {
				oService.create("/ItemDetails", oPayload, {
					headers: {
						"X-Requested-With": "X",
						"Content-Type": "application/json"
					},
					success: resolve,
					error: reject
				});
			});
		},

		_updateMaterialDetail: function (oPayload, oOriginalMaterial) {
			// Validate required fields
			if (!oPayload.TripNumber || !oPayload.DocType || !oPayload.RefDocNo || !oPayload.RefDocItemNo) {
				return Promise.reject(new Error("Missing required fields"));
			}

			// Use original material values (lowercase property names from local model)
			// Fallback to payload values if original material doesn't have them
			var sDocType = this._escapeODataValue(oOriginalMaterial.docType || oPayload.DocType);
			var sTripNumber = this._escapeODataValue(oOriginalMaterial.tripNumber || oPayload.TripNumber);
			var sRefDocNo = this._escapeODataValue(oOriginalMaterial.refDocNo || oPayload.RefDocNo);
			var sRefDocItemNo = this._escapeODataValue(oOriginalMaterial.refDocItemNo || oPayload.RefDocItemNo);

			// Build correct OData entity key path using original material values
			var sEntityPath = "/ItemDetails(DocType='" + sDocType +
				"',TripNumber='" + sTripNumber +
				"',RefDocNo='" + sRefDocNo +
				"',RefDocItemNo='" + sRefDocItemNo + "')";

			// Build update payload - include all fields (key fields + updatable fields)
			var oUpdatePayload = {
				TripNumber: oPayload.TripNumber,
				DocType: oPayload.DocType,
				RefDocNo: oPayload.RefDocNo,
				RefDocItemNo: oPayload.RefDocItemNo,
				MaterialCode: oPayload.MaterialCode,
				MaterialDescription: oPayload.MaterialDescription,
				Quantity: oPayload.Quantity,
				DispatchQty: oPayload.DispatchQty || "",
				RemainQty: oPayload.RemainQty || "",
				UoM: oPayload.UoM || "",
				IsDeleted: oPayload.IsDeleted || "",
				IsSplitActive: oPayload.IsSplitActive !== undefined ? oPayload.IsSplitActive : false
			};

			

			var oService = this._getItemDetailsService();
			return new Promise(function (resolve, reject) {
				oService.update(sEntityPath, oUpdatePayload, {
					merge:false,
					headers: {
						"X-Requested-With": "X"
					},
					success: function (oData) {
						// Merge response with original payload to include all fields
						var oResponse = Object.assign({}, oPayload, oData);
						resolve(oResponse);
					},
					error: function (oError) {
						reject(oError);
					}
				});
			});
		},

		_deleteMaterialDetail: function (oMaterial) {
			if (!oMaterial) {
				return Promise.reject(new Error("Material data missing"));
			}

			// Build OData entity key path using the correct property names
			// Always use the current TripNumber from global model to ensure consistency
			var oGlobalModel = sap.ui.getCore().getModel("globalData");
			var sCurrentTripNumber = oGlobalModel?.getProperty("/TripNumber") || "";
			
			var sDocType = this._escapeODataValue(oMaterial.DocType || oMaterial.docType || "");
			var sTripNumber = this._escapeODataValue(sCurrentTripNumber || oMaterial.TripNumber || oMaterial.tripNumber || "");
			var sRefDocNo = this._escapeODataValue(oMaterial.RefDocNo || oMaterial.refDocNo || "");
			var sRefDocItemNo = this._escapeODataValue(oMaterial.RefDocItemNo || oMaterial.refDocItemNo || "");

			// Validate that we have all required key fields
			if (!sTripNumber || !sDocType || !sRefDocNo || !sRefDocItemNo) {
				return Promise.reject(new Error("Missing required key fields for deletion"));
			}

			var sEntityPath = "/ItemDetails(DocType='" + sDocType + 
				"',TripNumber='" + sTripNumber + 
				"',RefDocNo='" + sRefDocNo + 
				"',RefDocItemNo='" + sRefDocItemNo + "')";

			var oService = this._getItemDetailsService();
			var that = this;
			
			return new Promise(function (resolve, reject) {
				oService.remove(sEntityPath, {
					headers: {
						"X-Requested-With": "X"
					},
					success: function (oData) {
						// Immediately update local model
						that._removeLocalMaterialDetail(oMaterial);
						
						MessageToast.show("Material row deleted");
						
						// Optionally refresh from backend (but UI already updated)
						// that._refreshBothTables();
						
						resolve(oData);
					}.bind(this),
					error: function (oError) {
						var sMessage = this._extractErrorMessage(oError) || "Unable to delete material row";
						MessageToast.show(sMessage);
						reject(oError);
					}.bind(this)
				});
			}.bind(this));
		},

		_removeLocalMaterialDetail: function (oMaterial) {
			var oModel = this._ensureRefDocModel();
			var aMaterials = oModel.getProperty("/materialDetails") || [];
			
			// Remove the material
			var aFiltered = aMaterials.filter(function (oMat) {
				return !(oMat.tripNumber === oMaterial.tripNumber &&
						 oMat.docType === oMaterial.docType &&
						 oMat.refDocNo === oMaterial.refDocNo &&
						 oMat.refDocItemNo === oMaterial.refDocItemNo);
			});
			
			oModel.setProperty("/materialDetails", aFiltered, true);
			
			// Update filtered materials
			this._filterMaterialDetails();
		},

		_updateLocalMaterialDetail: function (oPayload, oOriginalMaterial) {
			var oModel = this._ensureRefDocModel();
			var aMaterials = oModel.getProperty("/materialDetails") || [];

			// Find and update the material in the array
			var iIndex = aMaterials.findIndex(function (oMat) {
				return oMat.tripNumber === oOriginalMaterial.tripNumber &&
					oMat.docType === oOriginalMaterial.docType &&
					oMat.refDocNo === oOriginalMaterial.refDocNo &&
					oMat.refDocItemNo === oOriginalMaterial.refDocItemNo;
			});

			if (iIndex >= 0) {
				var vQty = oPayload.Quantity;
				var sQtyDisplay = (vQty === null || vQty === undefined || vQty === "") ? "" : String(vQty);

				// Update the material with all fields from backend response
				var sDispatchQtyDisplay = (oPayload.DispatchQty === null || oPayload.DispatchQty === undefined || oPayload.DispatchQty === "") ? "" : String(oPayload.DispatchQty);
				var sRemainQtyDisplay = (oPayload.RemainQty === null || oPayload.RemainQty === undefined || oPayload.RemainQty === "") ? "" : String(oPayload.RemainQty);
				aMaterials[iIndex] = Object.assign({}, aMaterials[iIndex], {
					// Keep uppercase versions for backend compatibility
					TripNumber: oPayload.TripNumber || aMaterials[iIndex].TripNumber || aMaterials[iIndex].tripNumber,
					DocType: oPayload.DocType || aMaterials[iIndex].DocType || aMaterials[iIndex].docType,
					RefDocNo: oPayload.RefDocNo || aMaterials[iIndex].RefDocNo || aMaterials[iIndex].refDocNo,
					RefDocItemNo: oPayload.RefDocItemNo || aMaterials[iIndex].RefDocItemNo || aMaterials[iIndex].refDocItemNo,
					// Lowercase versions for UI binding
					tripNumber: oPayload.TripNumber || aMaterials[iIndex].tripNumber,
					docType: oPayload.DocType || aMaterials[iIndex].docType,
					refDocNo: oPayload.RefDocNo || aMaterials[iIndex].refDocNo,
					refDocItemNo: oPayload.RefDocItemNo || aMaterials[iIndex].refDocItemNo,
					materialCode: oPayload.MaterialCode || aMaterials[iIndex].materialCode,
					materialDescription: oPayload.MaterialDescription || aMaterials[iIndex].materialDescription,
					qty: sQtyDisplay,
					dispatchQty: sDispatchQtyDisplay,
					remainQty: sRemainQtyDisplay,
					uom: oPayload.UoM || aMaterials[iIndex].uom,
					changedBy: oPayload.ChangedBy || aMaterials[iIndex].changedBy || "",
					changedOnDate: this._formatODataDate(oPayload.ChangedDate) || aMaterials[iIndex].changedOnDate,
					changedOnTime: this._formatODataTime(oPayload.ChangedTime) || aMaterials[iIndex].changedOnTime
				});

				// Force model refresh by setting the entire array
				oModel.setProperty("/materialDetails", aMaterials, true); // true = force refresh
				// Update filtered list after updating material
				this._filterMaterialDetails();
			}
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
			var sDispatchQtyDisplay = (oPayload.DispatchQty === null || oPayload.DispatchQty === undefined || oPayload.DispatchQty === "") ? "" : String(oPayload.DispatchQty);
			var sRemainQtyDisplay = (oPayload.RemainQty === null || oPayload.RemainQty === undefined || oPayload.RemainQty === "") ? "" : String(oPayload.RemainQty);

			aMaterials.push({
				tripNumber: oPayload.TripNumber || "",
				docType: oPayload.DocType || sDialogDocType,
				refDocNo: oPayload.RefDocNo || sDialogRefDocNo,
				refDocItemNo: oPayload.RefDocItemNo || sDialogRefDocItem,
				materialCode: oPayload.MaterialCode || sDialogMaterial,
				materialDescription: oPayload.MaterialDescription || sDialogDesc,
				qty: sQtyDisplay,
				dispatchQty: sDispatchQtyDisplay,
				remainQty: sRemainQtyDisplay,
				dispatchDate: this._formatODataDate(oPayload.DispatchDate) || "",
				uom: oPayload.UoM || sDialogUoM,
				createdBy: oPayload.CreatedBy || "",
				createdOnDate: this._formatODataDate(oPayload.CreatedOn),
				createdOnTime: this._formatODataTime(oPayload.CreatedTime),
				changedBy: oPayload.ChangedBy || "",
				changedOnDate: this._formatODataDate(oPayload.ChangedDate),
				changedOnTime: this._formatODataTime(oPayload.ChangedTime)
			});

			// Force model refresh by setting the entire array
			oModel.setProperty("/materialDetails", aMaterials, true); // true = force refresh
			// Update filtered list after adding new material
			this._filterMaterialDetails();
		},


		_onTripDataUpdated: function () {
			var oTripData = sap.ui.getCore().getModel("TripData");
			var oModel = this._ensureRefDocModel();

			// Ensure global model exists for cross-view flags
			var oGlobalModel = sap.ui.getCore().getModel("globalData");
			if (!oGlobalModel) {
				oGlobalModel = new JSONModel({});
				sap.ui.getCore().setModel(oGlobalModel, "globalData");
			}

			// Determine if ref doc / material actions must be disabled
			var sMovementScenarioDesc = oTripData ? (oTripData.getProperty("/MovementScenarioDesc") || "") : "";
			var bDisableActions = false;
			if (sMovementScenarioDesc) {
				var sUpper = sMovementScenarioDesc.toUpperCase();
				bDisableActions =
					sUpper.indexOf("DIRECT PURCHASE ORDER ASN") >= 0 ||
					sUpper.indexOf("SCHEDULING AGREEMENT ASN") >= 0 ||
					sUpper.indexOf("SUPPLIER PORTAL VENDOR") >= 0;
			}
			oGlobalModel.setProperty("/DisableRefDocMaterialsActions", !!bDisableActions);

			// Set TripData model on view if not already set (for binding)
			if (oTripData && !this.getView().getModel("TripData")) {
				this.getView().setModel(oTripData, "TripData");
			}

			if (!oTripData) {
				oModel.setProperty("/referenceDocs", []);
				oModel.setProperty("/materialDetails", []);
				oModel.setProperty("/filteredMaterialDetails", []);
				return;
			}
			
			var vOrderDetails = oTripData.getProperty("/OrderDetails");
			var vItemDetails = oTripData.getProperty("/ItemDetails");

			// Check if ItemDetails is already loaded from $expand
			// When $expand is used successfully, ItemDetails will have a "results" property
			// Only make separate call if ItemDetails is truly deferred (has __deferred but no results)
			var bHasResults = false;
			if (vItemDetails) {
				// Check if it's an array (direct results)
				if (Array.isArray(vItemDetails)) {
					bHasResults = true;
				}
				// Check if it has results property (OData format)
				else if (vItemDetails.results && Array.isArray(vItemDetails.results)) {
					bHasResults = true;
				}
				// Check if it's deferred (needs separate call)
				else if (vItemDetails.__deferred && !vItemDetails.results) {
					// Data is deferred, need to load separately (should not happen with $expand)
					var sTripNumber = oTripData.getProperty("/TripNumber") || "";
					if (sTripNumber) {
						this._loadItemDetailsSeparately(sTripNumber);
					} else {
						this._setMaterialDetailsFromService([]);
					}
					return; // Exit early
				}
			}
			
			if (bHasResults || vItemDetails) {
				// Data is already available from $expand (has results property), use it directly
				// DO NOT make separate ItemDetails calls - use the expanded data
				var aOrderDetails = this._extractResults(vOrderDetails);
				var aItemDetails = this._extractResults(vItemDetails);

				// Pass flag=true to indicate ItemDetails is already loaded from expand
				// This prevents _loadAllMaterialsForAllRefDocs from making separate calls
				this._setReferenceDocsFromService(aOrderDetails, true);
				this._setMaterialDetailsFromService(aItemDetails);
			} else {
				// No ItemDetails data available
				this._setReferenceDocsFromService(this._extractResults(vOrderDetails), true);
				this._setMaterialDetailsFromService([]);
			}
		},

		_setReferenceDocsFromService: function (aDocs, bItemDetailsAlreadyLoaded) {
			// Default to false if parameter not provided (backward compatibility)
			if (bItemDetailsAlreadyLoaded === undefined) {
				bItemDetailsAlreadyLoaded = false;
			}
			// Filter out deleted records (Deleted === true)
			var aRefDocs = (aDocs || [])
				.filter(function (oDoc) {
					return !oDoc.Deleted;
				})
				.map(function (oDoc) {
					return {
						// Store both original service values (uppercase) and local model values (lowercase)
						// This ensures we can use the correct values for OData operations
						TripNumber: oDoc.TripNumber || "",
						DocType: oDoc.DocType || "",
						DocumentNumber: oDoc.DocumentNumber || "",
						tripNumber: oDoc.TripNumber || "",
						docType: oDoc.DocType || "",
						documentNumber: oDoc.DocumentNumber || "",
						documentDate: this._formatODataDate(oDoc.DocumentDate),
						partyCode: oDoc.Vendor || oDoc.Customer || "",
						partyName: oDoc.Name || "",
						salesDoc: oDoc.SalesDoc || "",
						salesDoctype: oDoc.SalesDoctype || "",
						// New E-way bill fields (populated only when backend provides them)
						// Backend fields (metadata): EwayBill (string), EwaybillDate (string)
						ewayBillNumber: oDoc.EwayBill || "",
						ewayBillDate: oDoc.EwaybillDate || "",
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
			// Only load materials separately if ItemDetails was NOT already loaded from expand
			// When ItemDetails is already available from $expand, materials are already set via _setMaterialDetailsFromService
			// IMPORTANT: If bItemDetailsAlreadyLoaded is true, DO NOT call _loadAllMaterialsForAllRefDocs
			// This prevents duplicate ItemDetails filter calls when data is already available from $expand
			if (bItemDetailsAlreadyLoaded !== true) {
				// Only load if flag is explicitly false or undefined (backward compatibility)
				// But first check if ItemDetails is already in TripData to be safe
				var oTripData = sap.ui.getCore().getModel("TripData");
				var bItemDetailsInTripData = false;
				if (oTripData) {
					var vItemDetails = oTripData.getProperty("/ItemDetails");
					if (vItemDetails && (vItemDetails.results || Array.isArray(vItemDetails))) {
						bItemDetailsInTripData = true;
					}
				}
				
				// Only call if ItemDetails is NOT in TripData
				if (!bItemDetailsInTripData) {
					// Automatically load all materials for all reference documents
					this._loadAllMaterialsForAllRefDocs(aRefDocs);
				}
			}
		},

		_loadAllMaterialsForAllRefDocs: function (aRefDocs) {
			if (!aRefDocs || aRefDocs.length === 0) {
				return;
			}

			// IMPORTANT: Check if ItemDetails is already available from TripData $expand
			// If so, DO NOT make separate calls - data is already loaded
			var oTripData = sap.ui.getCore().getModel("TripData");
			if (oTripData) {
				var vItemDetails = oTripData.getProperty("/ItemDetails");
				// Check multiple ways the data might be structured
				var bHasResults = false;
				if (vItemDetails) {
					if (Array.isArray(vItemDetails)) {
						bHasResults = true;
					} else if (vItemDetails.results && Array.isArray(vItemDetails.results)) {
						bHasResults = true;
					} else if (vItemDetails.results && vItemDetails.results.length > 0) {
						bHasResults = true;
					}
				}
				if (bHasResults) {
					// ItemDetails is already loaded from $expand, skip separate calls
					// Materials are already set via _setMaterialDetailsFromService
					return;
				}
			}

			var that = this;
			var oGlobalModel = sap.ui.getCore().getModel("globalData");
			var sTripNumber = oGlobalModel?.getProperty("/TripNumber") || "";

			if (!sTripNumber) {
				return;
			}

			// Get existing materials from local model
			var oModel = that._ensureRefDocModel();
			var aExistingMaterials = oModel.getProperty("/materialDetails") || [];
			
			// Create a set of existing material keys for quick lookup
			var oExistingKeys = {};
			aExistingMaterials.forEach(function (oMat) {
				var sKey = (oMat.tripNumber || "") + "|" + 
						   (oMat.docType || "") + "|" + 
						   (oMat.refDocNo || "") + "|" + 
						   (oMat.refDocItemNo || "");
				oExistingKeys[sKey] = true;
			});

			// Collect all promises for fetching materials
			var aPromises = [];
			aRefDocs.forEach(function (oRefDoc) {
				var sDocType = oRefDoc.docType || "";
				var sRefDocNo = oRefDoc.documentNumber || "";
				
				if (sDocType && sRefDocNo) {
					var oPromise = that._fetchItemDetailsByRefDocNo(sDocType, sRefDocNo)
						.then(function (aItems) {
							if (aItems && aItems.length > 0) {
								// Filter out materials that already exist
								var aNewMaterials = aItems.filter(function (oItem) {
									var sKey = (oItem.TripNumber || "") + "|" + 
											   (oItem.DocType || "") + "|" + 
											   (oItem.RefDocNo || "") + "|" + 
											   (oItem.RefDocItemNo || "");
									return !oExistingKeys[sKey];
								});

								// Add new materials to existing keys set
								aNewMaterials.forEach(function (oItem) {
									var sKey = (oItem.TripNumber || "") + "|" + 
											   (oItem.DocType || "") + "|" + 
											   (oItem.RefDocNo || "") + "|" + 
											   (oItem.RefDocItemNo || "");
									oExistingKeys[sKey] = true;
								});

								return aNewMaterials;
							}
							return [];
						})
						.catch(function (oError) {
							// Silently fail for individual ref docs, continue with others
							return [];
						});
					
					aPromises.push(oPromise);
				}
			});

			// Wait for all promises to complete
			Promise.all(aPromises).then(function (aResults) {
				// Flatten all new materials
				var aAllNewMaterials = [];
				aResults.forEach(function (aMaterials) {
					if (aMaterials && aMaterials.length > 0) {
						aAllNewMaterials = aAllNewMaterials.concat(aMaterials);
					}
				});

				if (aAllNewMaterials.length > 0) {
					// Convert to local model format
					var aMaterialsToAdd = aAllNewMaterials.map(function (oItem) {
						var vQty = oItem.Quantity;
						var sQtyDisplay = (vQty === null || vQty === undefined || vQty === "") ? "" : String(vQty);
						
						return {
							tripNumber: oItem.TripNumber || "",
							docType: oItem.DocType || "",
							refDocNo: oItem.RefDocNo || "",
							refDocItemNo: oItem.RefDocItemNo || "",
							materialCode: oItem.MaterialCode || "",
							materialDescription: oItem.MaterialDescription || "",
							qty: sQtyDisplay,
							uom: oItem.UoM || "",
							createdBy: oItem.CreatedBy || "",
							createdOnDate: that._formatODataDate(oItem.CreatedOn),
							createdOnTime: that._formatODataTime(oItem.CreatedTime),
							changedBy: oItem.ChangedBy || "",
							changedOnDate: that._formatODataDate(oItem.ChangedDate),
							changedOnTime: that._formatODataTime(oItem.ChangedTime)
						};
					});

					// Add all new materials to the local model
					var aAllMaterials = aExistingMaterials.concat(aMaterialsToAdd);
					oModel.setProperty("/materialDetails", aAllMaterials);
					that._filterMaterialDetails();
				}
			});
		},

		_setMaterialDetailsFromService: function (aItems) {
			// Filter out deleted records (IsDeleted === "X")
			var aMaterials = (aItems || [])
				.filter(function (oItem) {
					return oItem.IsDeleted !== "X";
				})
				.map(function (oItem) {
					return {
						// Store both original service values (uppercase) and local model values (lowercase)
						// This ensures we can use the correct values for OData operations
						TripNumber: oItem.TripNumber || "",
						DocType: oItem.DocType || "",
						RefDocNo: oItem.RefDocNo || "",
						RefDocItemNo: oItem.RefDocItemNo || "",
						tripNumber: oItem.TripNumber || "",
						docType: oItem.DocType || "",
						refDocNo: oItem.RefDocNo || "",
						refDocItemNo: oItem.RefDocItemNo || "",
						materialCode: oItem.MaterialCode || "",
						materialDescription: oItem.MaterialDescription || "",
						qty: (oItem.Quantity === null || oItem.Quantity === undefined) ? "" : String(oItem.Quantity),
						uom: oItem.UoM || "",
						// New dispatch-related fields (populated only when backend provides them)
						dispatchQty: (oItem.DispatchQty === null || oItem.DispatchQty === undefined) ? "" : String(oItem.DispatchQty),
						remainQty: (oItem.RemainQty === null || oItem.RemainQty === undefined) ? "" : String(oItem.RemainQty),
						dispatchDate: this._formatODataDate(oItem.DispatchDate),
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

		_loadItemDetailsSeparately: function (sTripNumber) {
			// IMPORTANT: Check if ItemDetails is already available from TripData $expand
			// If so, DO NOT make separate call - use the expanded data instead
			var oTripData = sap.ui.getCore().getModel("TripData");
			if (oTripData) {
				var vItemDetails = oTripData.getProperty("/ItemDetails");
				if (vItemDetails && (vItemDetails.results || Array.isArray(vItemDetails))) {
					// ItemDetails is already loaded from $expand, use it directly
					var aItemDetails = this._extractResults(vItemDetails);
					this._setMaterialDetailsFromService(aItemDetails);
					return; // Exit early - no need to make separate call
				}
			}

			// Only make separate call if data is truly not available
			var oService = this._getItemDetailsService();
			var that = this;

			oService.read("/ItemDetails", {
				filters: [
					new Filter("TripNumber", FilterOperator.EQ, sTripNumber),
					new Filter("IsDeleted", FilterOperator.NE, "X")
				],
				success: function (oData) {
					var aItemDetails = oData.results || [];
					that._setMaterialDetailsFromService(aItemDetails);
				},
				error: function (oError) {
					that._setMaterialDetailsFromService([]);
				}
			});
		},

		_refreshBothTables: function () {
			// Try to use TripData first (from $expand) to avoid separate calls
			var oTripData = sap.ui.getCore().getModel("TripData");
			if (oTripData) {
				var vOrderDetails = oTripData.getProperty("/OrderDetails");
				var vItemDetails = oTripData.getProperty("/ItemDetails");
				
				// Check if data is already available from $expand (has results property)
				var bHasResults = vItemDetails && (vItemDetails.results || Array.isArray(vItemDetails));
				if (bHasResults) {
					var aOrderDetails = this._extractResults(vOrderDetails);
					var aItemDetails = this._extractResults(vItemDetails);
					
					// Use data from TripData (already loaded from expand)
					this._setReferenceDocsFromService(aOrderDetails, true);
					this._setMaterialDetailsFromService(aItemDetails);
					return; // Exit early - no separate calls needed
				}
			}
			
			// Fallback: Load separately if TripData is not available or data is deferred
			var oGlobalModel = sap.ui.getCore().getModel("globalData");
			var sTripNumber = oGlobalModel?.getProperty("/TripNumber") || "";

			if (!sTripNumber) {
				return;
			}

			var that = this;
			var oOrderService = this._getOrderDetailsService();
			var oItemService = this._getItemDetailsService();

			// Load OrderDetails
			oOrderService.read("/OrderDetails", {
				filters: [
					new Filter("TripNumber", FilterOperator.EQ, sTripNumber),
					new Filter("Deleted", FilterOperator.NE, true)
				],
				success: function (oData) {
					var aOrderDetails = oData.results || [];
					that._setReferenceDocsFromService(aOrderDetails, false);
				},
				error: function (oError) {
					that._setReferenceDocsFromService([], false);
				}
			});

			// Load ItemDetails
			oItemService.read("/ItemDetails", {
				filters: [
					new Filter("TripNumber", FilterOperator.EQ, sTripNumber),
					new Filter("IsDeleted", FilterOperator.NE, "X")
				],
				success: function (oData) {
					var aItemDetails = oData.results || [];
					that._setMaterialDetailsFromService(aItemDetails);
				},
				error: function (oError) {
					that._setMaterialDetailsFromService([]);
				}
			});
		},

		_extractResults: function (vData) {
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

	_loadDocTypes: function () {
		return new Promise(function (resolve, reject) {
			var oService = this._getConfigValuesService();
			var sTripNumber = "";
			var oGlobalModel = sap.ui.getCore().getModel("globalData");
			if (oGlobalModel) {
				sTripNumber = oGlobalModel.getProperty("/TripNumber") || "";
			}

			var aFilters = [
				new Filter("ConfigGroup", FilterOperator.EQ, "DocType")
			];

			// Add TripNumber filter if available
			if (sTripNumber) {
				aFilters.push(
					new Filter("TripNumber", FilterOperator.EQ, sTripNumber)
				);
			}

			oService.read("/ConfigValues", {
				filters: aFilters,
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
			return Fragment.load({
				id: this.getView().getId(),
				name: "com.incresolZ_INC_PLMS.fragments.ReferenceDocumentsFrags.DocTypeValueHelpDialog",
				controller: this
			}).then(function (oDialog) {
				this._oDocTypeValueHelp = oDialog;
				this.getView().addDependent(oDialog);
				if (!oDialog.getModel("docTypeVH")) {
					oDialog.setModel(new JSONModel({ items: [] }), "docTypeVH");
				}
				return oDialog;
			}.bind(this));
		},

		_createMaterialDocTypeValueHelpDialog: function () {
			return Fragment.load({
				id: this.getView().getId(),
				name: "com.incresolZ_INC_PLMS.fragments.ReferenceDocumentsFrags.MaterialDocTypeValueHelpDialog",
				controller: this
			}).then(function (oDialog) {
				this._oMaterialDocTypeVH = oDialog;
				this.getView().addDependent(oDialog);
				if (!oDialog.getModel("docTypeVHMaterial")) {
					oDialog.setModel(new JSONModel({ items: [] }), "docTypeVHMaterial");
				}
				return oDialog;
			}.bind(this));
		},

	_onMaterialDocTypeValueHelpSearch: function (oEvent) {
		var sValue = oEvent.getParameter("value") || "";
		var oSearchField = oEvent.getSource();
		// Get the parent SelectDialog
		var oSelectDialog = oSearchField.getParent();
		// If parent is not a SelectDialog, traverse up
		while (oSelectDialog && !oSelectDialog.isA("sap.m.SelectDialog")) {
			oSelectDialog = oSelectDialog.getParent();
		}
		
		if (!oSelectDialog) {
			return;
		}
		
		var oBinding = oSelectDialog.getBinding("items");

		if (!oBinding) {
			return;
		}

			var aFilters = [];
			if (sValue) {
				var sLowerValue = sValue.toLowerCase();
				aFilters.push(new Filter({
					path: "docType",
					operator: function(sDocType) {
						return sDocType && sDocType.toString().toLowerCase().indexOf(sLowerValue) !== -1;
					}
				}));
			}

			oBinding.filter(aFilters);
		},

	_onDocTypeValueHelpSearch: function (oEvent) {
		var sValue = oEvent.getParameter("value") || "";
		var oSearchField = oEvent.getSource();
		// Get the parent SelectDialog
		var oSelectDialog = oSearchField.getParent();
		// If parent is not a SelectDialog, traverse up
		while (oSelectDialog && !oSelectDialog.isA("sap.m.SelectDialog")) {
			oSelectDialog = oSelectDialog.getParent();
		}
		
		if (!oSelectDialog) {
			return;
		}
		
		var oBinding = oSelectDialog.getBinding("items");

		if (!oBinding) {
			return;
		}

			var aFilters = [];
			if (sValue) {
				var sLowerValue = sValue.toLowerCase();
				aFilters.push(new Filter({
					filters: [
						new Filter({
							path: "ConfigID",
							operator: function(sConfigID) {
								return sConfigID && sConfigID.toString().toLowerCase().indexOf(sLowerValue) !== -1;
							}
						}),
						new Filter({
							path: "Description",
							operator: function(sDescription) {
								return sDescription && sDescription.toString().toLowerCase().indexOf(sLowerValue) !== -1;
							}
						})
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
				var oDocTypeSelect = this.byId("idRefDocType");
				if (oDocTypeSelect) {
					oDocTypeSelect.setSelectedKey(sDocType);
				}
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

		onMaterialDocTypeValueHelpCancel: function () {
			this._resetMaterialDocTypeVHFilters();
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
		},

		// ============================================================
		// Column Visibility Functions
		// ============================================================
		_initializeColumnVisibility: function () {
			// Initialize Reference Documents column settings
			var aRefDocColumns = [
				{ id: "colRefDocType", label: "Doc Type", visible: true },
				{ id: "colRefDocNumber", label: "Document Number", visible: true },
				{ id: "colRefDocDate", label: "Document Date", visible: true },
				{ id: "colEwayBillNumber", label: "EwayBill Number", visible: true },
				{ id: "colEwayBillDate", label: "EwayBill Date", visible: true },
				{ id: "colRefDocPartyCode", label: "Sending / Receiving Party Code", visible: true },
				{ id: "colRefDocPartyName", label: "Sending / Receiving Party Name", visible: true },
				{ id: "colRefDocCreatedBy", label: "Created By", visible: false },
				{ id: "colRefDocCreatedOnDate", label: "Created On Date", visible: false },
				{ id: "colRefDocCreatedOnTime", label: "Created On Time", visible: false },
				{ id: "colRefDocChangedBy", label: "Changed By", visible: false },
				{ id: "colRefDocChangedOnDate", label: "Changed On Date", visible: false },
				{ id: "colRefDocChangedOnTime", label: "Changed On Time", visible: false },
				{ id: "colRefDocAction", label: "Action", visible: true }
			];

			// Initialize Material Details column settings
			var aMaterialColumns = [
				{ id: "colMaterialCode", label: "Material Code", visible: true },
				{ id: "colMaterialRefDocNo", label: "Ref Doc No", visible: true },
				{ id: "colMaterialRefDocItemNo", label: "Ref Doc Item No", visible: true },
				{ id: "colMaterialDescription", label: "Material Description", visible: true },
				{ id: "colMaterialQuantity", label: "Quantity", visible: true },
				{ id: "colDispatchQty", label: "Dispatch Qty", visible: true },
				{ id: "colRemainQty", label: "Remain Qty", visible: true },
				{ id: "colDispatchDate", label: "Dispatch Date", visible: true },
				{ id: "colMaterialUoM", label: "UoM", visible: true },
				{ id: "colMaterialCreatedBy", label: "Created By", visible: false },
				{ id: "colMaterialCreatedOnDate", label: "Created On Date", visible: false },
				{ id: "colMaterialCreatedOnTime", label: "Created On Time", visible: false },
				{ id: "colMaterialChangedBy", label: "Changed By", visible: false },
				{ id: "colMaterialChangedOnDate", label: "Changed On Date", visible: false },
				{ id: "colMaterialChangedOnTime", label: "Changed On Time", visible: false },
				{ id: "colMaterialAction", label: "Action", visible: true }
			];

			// Create models for column settings
			this._oRefDocColumnSettingsModel = new JSONModel({
				columns: aRefDocColumns
			});
			this.getView().setModel(this._oRefDocColumnSettingsModel, "refDocColumnSettings");

			this._oMaterialColumnSettingsModel = new JSONModel({
				columns: aMaterialColumns
			});
			this.getView().setModel(this._oMaterialColumnSettingsModel, "materialColumnSettings");

			// Apply initial column visibility
			this._applyRefDocColumnVisibility();
			this._applyMaterialColumnVisibility();
		},

		_applyRefDocColumnVisibility: function () {
			var oTable = this.byId("idReferenceDocsTable");
			if (!oTable) {
				return;
			}

			var aColumns = this._oRefDocColumnSettingsModel.getProperty("/columns");
			aColumns.forEach(function (oColumn) {
				var oCol = this.byId(oColumn.id);
				if (oCol) {
					oCol.setVisible(oColumn.visible);
				}
			}.bind(this));
		},

		_applyMaterialColumnVisibility: function () {
			var oTable = this.byId("idMaterialDetailsTable");
			if (!oTable) {
				return;
			}

			var aColumns = this._oMaterialColumnSettingsModel.getProperty("/columns");
			aColumns.forEach(function (oColumn) {
				var oCol = this.byId(oColumn.id);
				if (oCol) {
					oCol.setVisible(oColumn.visible);
				}
			}.bind(this));
		},

		onRefDocColumnSettings: function () {
			if (!this._oRefDocColumnVisibilityDialog) {
				this._oRefDocColumnVisibilityDialog = Fragment.load({
					id: this.getView().getId(),
					name: "com.incresolZ_INC_PLMS.fragments.ReferenceDocumentsFrags.RefDocColumnVisibilityDialog",
					controller: this
				}).then(function (oDialog) {
					this.getView().addDependent(oDialog);
					return oDialog;
				}.bind(this));
			}

			this._oRefDocColumnVisibilityDialog.then(function (oDialog) {
				oDialog.open();
			});
		},

		onMaterialColumnSettings: function () {
			if (!this._oMaterialColumnVisibilityDialog) {
				this._oMaterialColumnVisibilityDialog = Fragment.load({
					id: this.getView().getId(),
					name: "com.incresolZ_INC_PLMS.fragments.ReferenceDocumentsFrags.MaterialColumnVisibilityDialog",
					controller: this
				}).then(function (oDialog) {
					this.getView().addDependent(oDialog);
					return oDialog;
				}.bind(this));
			}

			this._oMaterialColumnVisibilityDialog.then(function (oDialog) {
				oDialog.open();
			});
		},

		onRefDocColumnSwitchChanged: function (oEvent) {
			var oSwitch = oEvent.getSource();
			var oBindingContext = oSwitch.getBindingContext("refDocColumnSettings");
			if (oBindingContext) {
				var oColumn = oBindingContext.getObject();
				oColumn.visible = oSwitch.getState();
				this._applyRefDocColumnVisibility();
			}
		},

		onMaterialColumnSwitchChanged: function (oEvent) {
			var oSwitch = oEvent.getSource();
			var oBindingContext = oSwitch.getBindingContext("materialColumnSettings");
			if (oBindingContext) {
				var oColumn = oBindingContext.getObject();
				oColumn.visible = oSwitch.getState();
				this._applyMaterialColumnVisibility();
			}
		},

		onResetRefDocColumnVisibility: function () {
			var aDefaultColumns = [
				{ id: "colRefDocType", label: "Doc Type", visible: true },
				{ id: "colRefDocNumber", label: "Document Number", visible: true },
				{ id: "colRefDocDate", label: "Document Date", visible: true },
				{ id: "colEwayBillNumber", label: "EwayBill Number", visible: true },
				{ id: "colEwayBillDate", label: "EwayBill Date", visible: true },
				{ id: "colRefDocPartyCode", label: "Sending / Receiving Party Code", visible: true },
				{ id: "colRefDocPartyName", label: "Sending / Receiving Party Name", visible: true },
				{ id: "colRefDocCreatedBy", label: "Created By", visible: false },
				{ id: "colRefDocCreatedOnDate", label: "Created On Date", visible: false },
				{ id: "colRefDocCreatedOnTime", label: "Created On Time", visible: false },
				{ id: "colRefDocChangedBy", label: "Changed By", visible: false },
				{ id: "colRefDocChangedOnDate", label: "Changed On Date", visible: false },
				{ id: "colRefDocChangedOnTime", label: "Changed On Time", visible: false },
				{ id: "colRefDocAction", label: "Action", visible: true }
			];

			this._oRefDocColumnSettingsModel.setProperty("/columns", aDefaultColumns);
			this._applyRefDocColumnVisibility();
		},

		onResetMaterialColumnVisibility: function () {
			var aDefaultColumns = [
				{ id: "colMaterialRefDocNo", label: "Ref Doc No", visible: true },
				{ id: "colMaterialRefDocItemNo", label: "Ref Doc Item No", visible: true },
				{ id: "colMaterialCode", label: "Material Code", visible: true },
				{ id: "colMaterialDescription", label: "Material Description", visible: true },
				{ id: "colMaterialQuantity", label: "Quantity", visible: true },
				{ id: "colDispatchQty", label: "Dispatch Qty", visible: true },
				{ id: "colRemainQty", label: "Remain Qty", visible: true },
				{ id: "colDispatchDate", label: "Dispatch Date", visible: true },
				{ id: "colMaterialUoM", label: "UoM", visible: true },
				{ id: "colMaterialCreatedBy", label: "Created By", visible: false },
				{ id: "colMaterialCreatedOnDate", label: "Created On Date", visible: false },
				{ id: "colMaterialCreatedOnTime", label: "Created On Time", visible: false },
				{ id: "colMaterialChangedBy", label: "Changed By", visible: false },
				{ id: "colMaterialChangedOnDate", label: "Changed On Date", visible: false },
				{ id: "colMaterialChangedOnTime", label: "Changed On Time", visible: false },
				{ id: "colMaterialAction", label: "Action", visible: true }
			];

			this._oMaterialColumnSettingsModel.setProperty("/columns", aDefaultColumns);
			this._applyMaterialColumnVisibility();
		},

		onCloseRefDocColumnVisibilityDialog: function () {
			if (this._oRefDocColumnVisibilityDialog) {
				this._oRefDocColumnVisibilityDialog.then(function (oDialog) {
					oDialog.close();
				});
			}
		},

		onCloseMaterialColumnVisibilityDialog: function () {
			if (this._oMaterialColumnVisibilityDialog) {
				this._oMaterialColumnVisibilityDialog.then(function (oDialog) {
					oDialog.close();
				});
			}
		}

	});
});

