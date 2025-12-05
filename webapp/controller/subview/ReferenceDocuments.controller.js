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
		this._oSelectedRefDoc = null; // Track selected reference document
		this._oEditingMaterial = null; // Track material being edited
		this._bIsEditMode = false; // Track if dialog is in edit mode
		this._oEditingRefDoc = null; // Track reference document being edited
		this._bIsRefDocEditMode = false; // Track if reference doc dialog is in edit mode
		this._oEventBus = sap.ui.getCore().getEventBus();
		this._oEventBus.subscribe("TripData", "Updated", this._onTripDataUpdated, this);
		this._onTripDataUpdated(); // Initial load
		this._initializeColumnVisibility();
	},

		onExit: function () {
			this._oAddRefDocDialog?.destroy();
			this._oAddMaterialDialog?.destroy();
			this._oRefDocValueHelp?.destroy();
			this._oMaterialValueHelp?.destroy();
			this._oMaterialRefDocNoValueHelp?.destroy();
			this._oItemDetailsValueHelp?.destroy();
			this._oDocTypeValueHelp?.destroy();
			this._oMaterialDocTypeVH?.destroy();
			this._oRefDocColumnVisibilityDialog?.destroy();
			this._oMaterialColumnVisibilityDialog?.destroy();
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
						this._appendLocalReferenceDoc(oResponse || oPayload);
						MessageToast.show("Reference document added");
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
				console.error("Could not find table row for edit button");
				return MessageToast.show("Unable to find reference document row");
			}
			
			var oCtx = oRow.getBindingContext("refDocModel");
			if (!oCtx) {
				console.error("Could not get binding context for reference document row");
				return MessageToast.show("Unable to get reference document details");
			}
			
			var oRefDoc = oCtx.getObject();
			if (!oRefDoc) {
				console.error("Reference document object is null");
				return MessageToast.show("Reference document data not available");
			}
			
			console.log("Editing reference document:", oRefDoc);
			this._oEditingRefDoc = oRefDoc;
			this._bIsRefDocEditMode = true;
			
			// Open dialog - it will populate itself
			this._openAddRefDocDialog()
				.catch(function (oError) {
					console.error("Failed to open reference document dialog:", oError);
					MessageToast.show("Failed to open edit dialog: " + (oError.message || "Unknown error"));
				});
		},

		onDeleteRefDocRow: function (oEvent) {
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
				console.error("Could not find table row for edit button");
				return MessageToast.show("Unable to find material row");
			}
			
			var oCtx = oRow.getBindingContext("refDocModel");
			if (!oCtx) {
				console.error("Could not get binding context for material row");
				return MessageToast.show("Unable to get material details");
			}
			
			var oMaterial = oCtx.getObject();
			if (!oMaterial) {
				console.error("Material object is null");
				return MessageToast.show("Material data not available");
			}
			
			console.log("Editing material:", oMaterial);
			this._oEditingMaterial = oMaterial;
			this._bIsEditMode = true;
			
			// Open dialog - it will populate itself
			this._openAddMaterialDialog()
				.catch(function (oError) {
					console.error("Failed to open material dialog:", oError);
					MessageToast.show("Failed to open edit dialog: " + (oError.message || "Unknown error"));
				});
		},

		onDeleteMaterialRow: function (oEvent) {
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
			return new Promise(function (resolve, reject) {
				if (!this._oAddRefDocDialog) {
					Fragment.load({
						id: this.getView().getId(),
						name: "com.incresolZ_INC_PLMS.fragments.ReferenceDocumentsFrags.AddRefDocDialog",
						controller: this
					}).then(function (oDialog) {
						if (!oDialog) {
							reject(new Error("Fragment loaded but dialog is null"));
							return;
						}
						this._oAddRefDocDialog = oDialog;
						this.getView().addDependent(oDialog);
						// Set dialog mode after dialog is loaded (important for first time)
						this._setRefDocDialogMode(this._bIsRefDocEditMode ? "edit" : "add");
						// Populate dialog if in edit mode
						if (this._bIsRefDocEditMode && this._oEditingRefDoc) {
							this._populateRefDocDialog(this._oEditingRefDoc);
						}
						this._loadRefDocSuggestions(this._sSelectedDocType);
						oDialog.open();
						resolve(oDialog);
					}.bind(this))
					.catch(function (oError) {
						console.error("Failed to load reference document dialog fragment:", oError);
						reject(oError);
					});
				} else {
					// Set dialog mode when reopening (in case mode changed)
					this._setRefDocDialogMode(this._bIsRefDocEditMode ? "edit" : "add");
					// Populate dialog if in edit mode
					if (this._bIsRefDocEditMode && this._oEditingRefDoc) {
						this._populateRefDocDialog(this._oEditingRefDoc);
					}
					this._loadRefDocSuggestions(this._sSelectedDocType);
					this._oAddRefDocDialog.open();
					resolve(this._oAddRefDocDialog);
				}
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
						console.error("Failed to load material dialog fragment:", oError);
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

			this.byId("idRefDocType")?.setValue(oRefDoc.docType || "");
			this._sSelectedDocType = oRefDoc.docType || "";
			this.byId("idRefDocNumber")?.setValue(oRefDoc.documentNumber || "");
			this.byId("idRefDocDate")?.setValue(oRefDoc.documentDate || "");
			this.byId("idRefDocPartyCode")?.setValue(oRefDoc.partyCode || "");
			this.byId("idRefDocPartyName")?.setValue(oRefDoc.partyName || "");
			
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
				"idMaterialUoM"
			].forEach(function (sId) {
				this.byId(sId)?.setValue("");
			}.bind(this));

			this._sSelectedMaterialDocType = "";
			this._oEditingMaterial = null;
			this._bIsEditMode = false;
			this._setMaterialDialogMode("add");
		},


		_setMaterialDialogMode: function (sMode) {
			var oDialog = this.byId("idAddMaterialDialog");
			var oSaveButton = this.byId("idMaterialDialogSaveBtn");
			var bIsEdit = (sMode === "edit");

			oDialog?.setTitle(bIsEdit ? "Edit Material Row" : "Add Material Row");
			oSaveButton?.setText(bIsEdit ? "Update" : "Add");
			
			// Keep all fields enabled in both add and edit mode
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
			this.byId("idMaterialUoM")?.setValue(oMaterial.uom || "");
			
			// Load suggestions for the selected doc type
			if (oMaterial.docType) {
				this._loadMaterialRefDocNumbersFromRefDocs(oMaterial.docType);
				this._loadMaterialSuggestions(oMaterial.docType);
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

			var bIsEdit = false; // Edit mode removed

			var oPayload = {
				TripNumber: sTripNumber,
				DocType: sDocType,
				DocumentNumber: sDocNumber,
				DocumentDate: oDate,
				Vendor: sPartyCode,
				Customer: sPartyCode,
				Name: sPartyName,
				Deleted: false
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

			// Quantity: Match Postman test format - send as string (e.g. "2" or "1.00")
			// For whole numbers, send without decimals; for decimals, preserve them
			var sFormattedQty = "";
			if (fQty !== 0 || sQty) {
				// If it's a whole number, send as integer string; otherwise preserve decimals
				if (fQty % 1 === 0) {
					sFormattedQty = String(Math.floor(fQty));
				} else {
					sFormattedQty = fQty.toFixed(2);
				}
			} else {
				sFormattedQty = "0";
			}

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

			console.log("=== Update Order Detail ===");
			console.log("Original Reference Doc:", JSON.stringify(oOriginalRefDoc, null, 2));
			console.log("Entity Path:", sEntityPath);
			console.log("Update Payload:", JSON.stringify(oUpdatePayload, null, 2));

			var oService = this._getOrderDetailsService();
			return new Promise(function (resolve, reject) {
				oService.update(sEntityPath, oUpdatePayload, {
					merge: false,
					headers: {
						"X-Requested-With": "X"
					},
					success: function (oData) {
						console.log("Update successful:", oData);
						var oResponse = Object.assign({}, oPayload, oData);
						resolve(oResponse);
					},
					error: function (oError) {
						console.error("Update failed for path:", sEntityPath, "Payload:", JSON.stringify(oUpdatePayload, null, 2), "Error:", oError);
						reject(oError);
					}
				});
			});
		},

		_deleteOrderDetail: function (oRefDoc) {
			if (!oRefDoc) {
				return Promise.reject(new Error("Reference document data missing"));
			}

			// Build OData entity key path
			var sDocType = this._escapeODataValue(oRefDoc.docType);
			var sTripNumber = this._escapeODataValue(oRefDoc.tripNumber);
			var sDocumentNumber = this._escapeODataValue(oRefDoc.documentNumber);

			var sEntityPath = "/OrderDetails(TripNumber='" + sTripNumber + 
				"',DocType='" + sDocType + 
				"',DocumentNumber='" + sDocumentNumber + "')";

			// Build delete payload - set Deleted flag
			var oDeletePayload = {
				Deleted: true
			};

			console.log("=== Delete Order Detail ===");
			console.log("Entity Path:", sEntityPath);

			var oService = this._getOrderDetailsService();
			return new Promise(function (resolve, reject) {
				oService.update(sEntityPath, oDeletePayload, {
					headers: {
						"X-Requested-With": "X",
						"Content-Type": "application/json"
					},
					success: function (oData) {
						MessageToast.show("Reference document deleted");
						// Refresh reference documents from service
						this._onTripDataUpdated();
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
				// Update the reference document
				aRefDocs[iIndex] = Object.assign({}, aRefDocs[iIndex], {
					docType: oPayload.DocType || aRefDocs[iIndex].docType,
					documentNumber: oPayload.DocumentNumber || aRefDocs[iIndex].documentNumber,
					documentDate: this._formatODataDate(oPayload.DocumentDate) || aRefDocs[iIndex].documentDate,
					partyCode: oPayload.Vendor || oPayload.Customer || aRefDocs[iIndex].partyCode,
					partyName: oPayload.Name || aRefDocs[iIndex].partyName,
					changedBy: oPayload.ChangedBy || "",
					changedOnDate: this._formatODataDate(oPayload.ChangedOn),
					changedOnTime: this._formatODataTime(oPayload.ChangedTime)
				});

				oModel.setProperty("/referenceDocs", aRefDocs);
				// Update Material Doc Types and Document Numbers when Reference Documents are updated
				this._loadMaterialDocTypesFromRefDocs();
				this._loadMaterialRefDocNumbersFromRefDocs();
			}
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
						console.log("Update successful:", oData);
						// Merge response with original payload to include all fields
						var oResponse = Object.assign({}, oPayload, oData);
						resolve(oResponse);
					},
					error: function (oError) {
						console.error("Update failed for path:", sEntityPath, "Payload:", JSON.stringify(oUpdatePayload, null, 2), "Error:", oError);
						reject(oError);
					}
				});
			});
		},

		_deleteMaterialDetail: function (oMaterial) {
			if (!oMaterial) {
				return Promise.reject(new Error("Material data missing"));
			}

			// Build OData entity key path
			var sDocType = this._escapeODataValue(oMaterial.docType);
			var sTripNumber = this._escapeODataValue(oMaterial.tripNumber);
			var sRefDocNo = this._escapeODataValue(oMaterial.refDocNo);
			var sRefDocItemNo = this._escapeODataValue(oMaterial.refDocItemNo);

			var sEntityPath = "/ItemDetails(DocType='" + sDocType + 
				"',TripNumber='" + sTripNumber + 
				"',RefDocNo='" + sRefDocNo + 
				"',RefDocItemNo='" + sRefDocItemNo + "')";

			// Build delete payload - set IsDeleted flag
			var oDeletePayload = {
				IsDeleted: "X"
			};

			console.log("=== Delete Material Detail ===");
			console.log("Entity Path:", sEntityPath);

			var oService = this._getItemDetailsService();
			return new Promise(function (resolve, reject) {
				oService.update(sEntityPath, oDeletePayload, {
					headers: {
						"X-Requested-With": "X",
						"Content-Type": "application/json"
					},
					success: function (oData) {
						MessageToast.show("Material row deleted");
						// Refresh material details from service
						this._onTripDataUpdated();
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

				// Update the material
				aMaterials[iIndex] = Object.assign({}, aMaterials[iIndex], {
					materialCode: oPayload.MaterialCode || aMaterials[iIndex].materialCode,
					materialDescription: oPayload.MaterialDescription || aMaterials[iIndex].materialDescription,
					qty: sQtyDisplay,
					uom: oPayload.UoM || aMaterials[iIndex].uom,
					changedBy: oPayload.ChangedBy || "",
					changedOnDate: this._formatODataDate(oPayload.ChangedDate),
					changedOnTime: this._formatODataTime(oPayload.ChangedTime)
				});

				oModel.setProperty("/materialDetails", aMaterials);
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


		_onTripDataUpdated: function () {
			var oTripData = sap.ui.getCore().getModel("TripData");
			var oModel = this._ensureRefDocModel();

			console.log("=== TripData Updated ===");
			console.log("TripData Model:", oTripData);

			if (!oTripData) {
				console.log("No TripData model found, clearing all data");
				oModel.setProperty("/referenceDocs", []);
				oModel.setProperty("/materialDetails", []);
				oModel.setProperty("/filteredMaterialDetails", []);
				return;
			}

			var vOrderDetails = oTripData.getProperty("/OrderDetails");
			var vItemDetails = oTripData.getProperty("/ItemDetails");

			console.log("OrderDetails (raw):", vOrderDetails);
			console.log("ItemDetails (raw):", vItemDetails);

			// Check if ItemDetails is a deferred object (OData v2 $expand)
			if (vItemDetails && vItemDetails.__deferred) {
				console.log("ItemDetails is deferred, attempting to read separately");
				var sTripNumber = oTripData.getProperty("/TripNumber") || "";
				if (sTripNumber) {
					this._loadItemDetailsSeparately(sTripNumber);
				} else {
					console.warn("Cannot load ItemDetails separately: TripNumber missing");
					this._setMaterialDetailsFromService([]);
				}
			} else {
				var aOrderDetails = this._extractResults(vOrderDetails);
				var aItemDetails = this._extractResults(vItemDetails);

				console.log("OrderDetails (extracted):", aOrderDetails);
				console.log("ItemDetails (extracted):", aItemDetails);
				console.log("ItemDetails count:", aItemDetails.length);

				this._setReferenceDocsFromService(aOrderDetails);
				this._setMaterialDetailsFromService(aItemDetails);
			}
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
			console.log("=== Setting Material Details ===");
			console.log("Input Items:", aItems);
			console.log("Input Items count:", aItems ? aItems.length : 0);

			// Filter out deleted records (IsDeleted === "X")
			var aMaterials = (aItems || [])
				.filter(function (oItem) {
					var bNotDeleted = oItem.IsDeleted !== "X";
					if (!bNotDeleted) {
						console.log("Filtered out deleted item:", oItem);
					}
					return bNotDeleted;
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

			console.log("Mapped Materials:", aMaterials);
			console.log("Mapped Materials count:", aMaterials.length);

			this._ensureRefDocModel().setProperty("/materialDetails", aMaterials);
			// Update filtered list after setting all materials
			this._filterMaterialDetails();

			console.log("Filtered Materials count:", this._ensureRefDocModel().getProperty("/filteredMaterialDetails").length);
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
			var oService = this._getItemDetailsService();
			var that = this;

			console.log("Loading ItemDetails separately for TripNumber:", sTripNumber);

			oService.read("/ItemDetails", {
				filters: [
					new Filter("TripNumber", FilterOperator.EQ, sTripNumber),
					new Filter("IsDeleted", FilterOperator.NE, "X")
				],
				success: function (oData) {
					var aItemDetails = oData.results || [];
					console.log("ItemDetails loaded separately. Count:", aItemDetails.length);
					that._setMaterialDetailsFromService(aItemDetails);
				},
				error: function (oError) {
					console.error("Failed to load ItemDetails separately:", oError);
					that._setMaterialDetailsFromService([]);
				}
			});
		},

		_extractResults: function (vData) {
			console.log("=== Extracting Results ===");
			console.log("Input Data:", vData);
			console.log("Input Data Type:", typeof vData);
			console.log("Is Array:", Array.isArray(vData));

			if (!vData) {
				console.log("No data provided, returning empty array");
				return [];
			}
			if (Array.isArray(vData)) {
				console.log("Data is array, returning as-is. Count:", vData.length);
				return vData;
			}
			if (vData && typeof vData === "object") {
				if (Array.isArray(vData.results)) {
					console.log("Data has results array, returning results. Count:", vData.results.length);
					return vData.results;
				}
				// Check if it's a deferred object (OData v2)
				if (vData.__deferred) {
					console.log("Data is deferred object, returning empty array");
					return [];
				}
			}
			console.log("Data format not recognized, returning empty array");
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
				{ id: "colMaterialRefDocNo", label: "Ref Doc No", visible: true },
				{ id: "colMaterialRefDocItemNo", label: "Ref Doc Item No", visible: true },
				{ id: "colMaterialCode", label: "Material Code", visible: true },
				{ id: "colMaterialDescription", label: "Material Description", visible: true },
				{ id: "colMaterialQuantity", label: "Quantity", visible: true },
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

