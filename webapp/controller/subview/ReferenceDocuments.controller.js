sap.ui.define([
	"sap/ui/core/mvc/Controller",
	"sap/ui/model/json/JSONModel",
	"sap/ui/core/Fragment",
	"sap/m/MessageToast",
	"sap/m/MessageBox",
	"sap/m/SelectDialog",
	"sap/m/StandardListItem",
	"sap/m/SuggestionItem",
	"sap/ui/comp/valuehelpdialog/ValueHelpDialog",
	"sap/ui/comp/filterbar/FilterBar",
	"sap/ui/model/Filter",
	"sap/ui/model/FilterOperator",
	"sap/ui/model/odata/v2/ODataModel",
	"sap/m/Table",
	"sap/m/Column",
	"sap/m/ColumnListItem",
	"sap/m/Text",
	"sap/m/Label",
	"sap/m/SearchField",
	"com/incresolZ_INC_PLMS/util/MovementScenarioIcons",
], function (
	Controller,
	JSONModel,
	Fragment,
	MessageToast,
	MessageBox,
	SelectDialog,
	StandardListItem,
	SuggestionItem,
	ValueHelpDialog,
	FilterBar,
	Filter,
	FilterOperator,
	ODataModel,
	Table,
	Column,
	ColumnListItem,
	Text,
	Label,
	SearchField,
	MovementScenarioIcons
) {
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
		this._initDocNoPagingState();
		this._iReqId = 0; // latest request wins for doc resolution
		this._sLastDocNo = "";
		this._sLastDocType = "";
		this._bUserSelected = false;
		this._iDebounceTimer = null;
		this._oSelectedOrderDetail = null;
		// Apply any view-related initialization after render using delegates if needed
	},

		_initDocNoPagingState: function () {
			// Pagination state for "Document Number" ComboBox dropdown list (arrow open + scroll).
			// Typeahead suggestions remain handled by `onRefDocNumberSuggest`.
			if (!this._mDocNoPaging) {
				this._mDocNoPaging = {
					pageSize: 50,
					loading: false,
					done: false,
					docType: "",
					searchTerm: ""
				};
			}
		},

		_getComboBoxPickerList: function (oCombo) {
			// Best-effort access to the underlying List used in the ComboBox picker.
			// Different UI5 versions render either a Popover with a List/SelectList inside.
			if (!oCombo) return null;
			var oPicker = null;
			try {
				oPicker = oCombo.getPicker && oCombo.getPicker();
			} catch (e) {
				oPicker = null;
			}
			if (!oPicker) return null;

			var aContent = [];
			try {
				aContent = (typeof oPicker.getContent === "function" && oPicker.getContent()) || [];
			} catch (e2) {
				aContent = [];
			}
			var oList = aContent && aContent[0];
			if (oList && typeof oList.setGrowing === "function") {
				return oList;
			}

			// Fallback: some versions wrap the list deeper.
			try {
				if (oPicker.getSubHeader && oPicker.getSubHeader() && oPicker.getSubHeader().getContent) {
					var a = oPicker.getSubHeader().getContent() || [];
					if (a[0] && typeof a[0].setGrowing === "function") return a[0];
				}
			} catch (e3) {
				// ignore
			}
			return null;
		},

		_attachDocNoComboPaging: function () {
			var oCombo = this.byId("idRefDocNumber");
			if (!oCombo || oCombo._plmsDocNoPagingAttached) {
				return;
			}
			oCombo._plmsDocNoPagingAttached = true;

			var oList = this._getComboBoxPickerList(oCombo);
			if (!oList) {
				return;
			}

			// Enable list growing and load-on-scroll (no UI changes unless list supports it).
			try {
				oList.setGrowing(true);
				oList.setGrowingScrollToLoad(true);
				oList.setGrowingThreshold(this._mDocNoPaging?.pageSize || 50);
			} catch (e) {
				// ignore
			}

			var that = this;
			if (typeof oList.attachGrowingStarted === "function") {
				oList.attachGrowingStarted(function () {
					that._loadMoreDocNoDropdownPage();
				});
			}
		},

		_resetDocNoPaging: function (sDocType, sSearchTerm) {
			this._initDocNoPagingState();
			this._mDocNoPaging.docType = (sDocType || "").toString().trim();
			this._mDocNoPaging.searchTerm = (sSearchTerm || "").toString().trim();
			this._mDocNoPaging.loading = false;
			this._mDocNoPaging.done = false;
		},

		_loadMoreDocNoDropdownPage: function () {
			this._initDocNoPagingState();
			var mState = this._mDocNoPaging;

			var sDocType = (mState.docType || "").toString().trim();
			if (!sDocType) {
				// Determine current doc type if state wasn't initialized yet
				var oDocTypeSelect = this.byId("idRefDocType");
				sDocType = this._sSelectedDocType ||
					(oDocTypeSelect?.getSelectedItem?.()?.getKey?.() || oDocTypeSelect?.getSelectedKey?.() || "");
				sDocType = (sDocType || "").toString().trim();
				mState.docType = sDocType;
			}
			if (!sDocType) return;

			if (mState.loading || mState.done) return;
			mState.loading = true;

			var oModel = this._getRefDocSuggestionModel();
			var aExisting = (oModel?.getProperty("/items") || []).slice();
			var iSkip = aExisting.length;
			var iTop = Number(mState.pageSize || 50);

			// Busy indicator on the field itself (dialog/view busy is handled separately below)
			var oCombo = this.byId("idRefDocNumber");
			this._iDocNoFieldBusyCount = (this._iDocNoFieldBusyCount || 0) + 1;
			if (oCombo && oCombo.setBusy) {
				oCombo.setBusy(true);
				oCombo.setBusyIndicatorDelay?.(0);
			}

			this._beginDocNoBusy();
			this._fetchOrderDetails(sDocType, { top: iTop, skip: iSkip })
				.then(function (aPage) {
					var a = aPage || [];
					if (a.length === 0) {
						mState.done = true;
						return;
					}
					// Append unique DocumentNumber entries (avoid duplicates when backend ignores $skip)
					var mSeen = new Set(aExisting.map(function (o) { return (o && o.DocumentNumber) ? String(o.DocumentNumber) : ""; }));
					var aAppend = a.filter(function (o) {
						var k = (o && o.DocumentNumber) ? String(o.DocumentNumber) : "";
						if (!k) return false;
						if (mSeen.has(k)) return false;
						mSeen.add(k);
						return true;
					});
					oModel?.setProperty("/items", aExisting.concat(aAppend));

					// If server returned less than requested, mark as done.
					if (a.length < iTop || aAppend.length === 0) {
						mState.done = true;
					}
				}.bind(this))
				.catch(function () {
					// ignore; keep existing items
				})
				.finally(function () {
					mState.loading = false;
					this._iDocNoFieldBusyCount = Math.max((this._iDocNoFieldBusyCount || 1) - 1, 0);
					if (this._iDocNoFieldBusyCount === 0) {
						var oC = this.byId("idRefDocNumber");
						if (oC && oC.setBusy) {
							oC.setBusy(false);
						}
					}
					this._endDocNoBusy();
				}.bind(this));
		},

		// ============================================================
		// ValueHelpDialog for "Document Number" (ComboBox replacement)
		// ============================================================
		onRefDocNumberValueHelpRequest: function () {
			var oDocTypeSelect = this.byId("idRefDocType");
			var sDocType =
				this._sSelectedDocType ||
				(oDocTypeSelect?.getSelectedItem?.()?.getKey?.() ||
					oDocTypeSelect?.getSelectedKey?.() ||
					"");
			sDocType = (sDocType || "").toString().trim();

			if (!sDocType) {
				return MessageToast.show("Select a Doc Type first");
			}

			if (!this._oRefDocNumberValueHelp) {
				this._oRefDocNumberValueHelp = this._createRefDocNumberValueHelpDialog();
			}

			// Reset filters for the new DocType context
			this._applyRefDocNumberVhFilters({ docType: sDocType, searchTerm: "" });
			this._oRefDocNumberValueHelp.open();
		},

		_createRefDocNumberValueHelpDialog: function () {
			var that = this;

			var oVHD = new ValueHelpDialog({
				title: "Select Document",
				supportMultiselect: false,
				key: "DocumentNumber",
				descriptionKey: "Name",
				ok: function (oEvent) {
					that._onRefDocNumberValueHelpOk(oEvent);
				},
				cancel: function () {
					oVHD.close();
				},
			});

			// FilterBar with basic search (server-side contains on DocumentNumber/Name)
			var oBasicSearch = new SearchField({
				width: "100%",
				search: function (oEvent) {
					var sTerm = (oEvent.getParameter("query") || "").toString().trim();
					that._applyRefDocNumberVhFilters({ searchTerm: sTerm });
				},
				liveChange: function (oEvent) {
					// keep it responsive without hammering too hard (simple debounce)
					if (that._iRefDocVhSearchDebounce) {
						clearTimeout(that._iRefDocVhSearchDebounce);
					}
					var sVal = (oEvent.getParameter("newValue") || "").toString();
					that._iRefDocVhSearchDebounce = setTimeout(function () {
						that._iRefDocVhSearchDebounce = null;
						that._applyRefDocNumberVhFilters({ searchTerm: sVal.trim() });
					}, 250);
				},
			});

			var oFilterBar = new FilterBar({
				advancedMode: false,
				filterBarExpanded: false,
				showGoOnFB: false,
				showFilterConfiguration: false,
				useToolbar: true,
				basicSearch: oBasicSearch,
			});

			oVHD.setFilterBar(oFilterBar);

			var oTable = new Table({
				mode: "SingleSelectMaster",
				growing: true,
				growingThreshold: 20,
				growingScrollToLoad: true,
				columns: [
					new Column({
						header: new Label({ text: "Document Number" }),
					}),
					new Column({
						header: new Label({ text: "Name" }),
					}),
				],
			});

			// Bind directly to OData so growing triggers server paging automatically
			oTable.setModel(this._getOrderDetailsService());
			oTable.bindItems({
				path: "/OrderDetails",
				template: new ColumnListItem({
					cells: [
						new Text({ text: "{DocumentNumber}" }),
						new Text({ text: "{Name}" }),
					],
				}),
			});

			oVHD.setTable(oTable);
			this.getView().addDependent(oVHD);

			return oVHD;
		},

		_applyRefDocNumberVhFilters: function (mOpts) {
			var oVHD = this._oRefDocNumberValueHelp;
			if (!oVHD) return;

			var m = mOpts || {};
			var sDocType = (m.docType !== undefined) ? m.docType : null;
			var sSearch = (m.searchTerm !== undefined) ? m.searchTerm : null;

			if (sDocType !== null) {
				this._sSelectedDocType = (sDocType || "").toString().trim();
			}

			var oTable = oVHD.getTable && oVHD.getTable();
			if (!oTable) return;

			var oBinding = oTable.getBinding && oTable.getBinding("items");
			if (!oBinding) return;

			var oGlobalModel = sap.ui.getCore().getModel("globalData");
			var sTripNumber = (oGlobalModel?.getProperty("/TripNumber") || "").toString().trim();
			var sDT = (this._sSelectedDocType || "").toString().trim();

			var aFilters = [];
			if (sTripNumber) {
				aFilters.push(new Filter("TripNumber", FilterOperator.EQ, sTripNumber));
			}
			if (sDT) {
				aFilters.push(new Filter("DocType", FilterOperator.EQ, sDT));
			}

			if (sSearch !== null) {
				this._sRefDocVhSearchTerm = (sSearch || "").toString().trim();
			}
			var sTerm = (this._sRefDocVhSearchTerm || "").toString().trim();
			if (sTerm) {
				aFilters.push(
					new Filter(
						[
							new Filter("DocumentNumber", FilterOperator.Contains, sTerm),
							new Filter("Name", FilterOperator.Contains, sTerm),
						],
						false
					)
				);
			}

			oBinding.filter(aFilters);
		},

		_onRefDocNumberValueHelpOk: function (oEvent) {
			var oVHD = oEvent.getSource && oEvent.getSource();
			var oTable = oVHD && oVHD.getTable && oVHD.getTable();

			// Prefer selected row object from the table binding context (contains full backend fields)
			var oSelectedItem = oTable && oTable.getSelectedItem && oTable.getSelectedItem();
			var oCtx = oSelectedItem && oSelectedItem.getBindingContext && oSelectedItem.getBindingContext();
			var oObj = oCtx && oCtx.getObject && oCtx.getObject();

			if (oObj) {
				this._applySelectedReferenceDoc(oObj);
				oVHD?.close?.();
				return;
			}

			// Fallback to token key if selection wasn't accessible
			var aTokens = oEvent.getParameter("tokens") || [];
			var sDocNo = aTokens[0]?.getKey?.() || "";
			sDocNo = (sDocNo || "").toString();
			if (sDocNo) {
				this.byId("idRefDocNumber")?.setValue?.(sDocNo);
			}
			oVHD?.close?.();
		},

		onExit: function () {
			if (this._iRefDocSuggestDebounceTimer) {
				clearTimeout(this._iRefDocSuggestDebounceTimer);
				this._iRefDocSuggestDebounceTimer = null;
			}
			if (this._iDebounceTimer) {
				clearTimeout(this._iDebounceTimer);
				this._iDebounceTimer = null;
			}
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
			this._oSelectedOrderDetail = null;
			
			var oGlobalModel = sap.ui.getCore().getModel("globalData");
			if (oGlobalModel) {
				oGlobalModel.setProperty("/DisableRefDocMaterialsActions", false);
			}
		},

		_setFragmentI18nModel: function (oDialog) {
			var oComp = this.getOwnerComponent();
			if (oComp) {
				var oI18n = oComp.getModel("i18n");
				if (oI18n) {
					oDialog.setModel(oI18n, "i18n");
				}
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
			this._oSelectedOrderDetail = null;
			var sSelectedKey = oEvent.getParameter("selectedItem")?.getKey();
			if (sSelectedKey) {
				this._sSelectedDocType = sSelectedKey;
				this._loadRefDocSuggestions(sSelectedKey);
				this._resetDocNoPaging(sSelectedKey, "");
			} else {
				// Handle case when selection is cleared
				this._sSelectedDocType = "";
				this._loadRefDocSuggestions("");
				this._resetDocNoPaging("", "");
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
			var oItem = oEvent?.getParameter?.("selectedItem");
			var oSource = oEvent?.getSource?.();

			var sDocNumber = "";
			if (oItem) {
				if (typeof oItem.getKey === "function") {
					sDocNumber = oItem.getKey() || "";
				}
				if (!sDocNumber && typeof oItem.getText === "function") {
					sDocNumber = oItem.getText() || "";
				}
			}

			if (!sDocNumber && oSource) {
				if (typeof oSource.getSelectedKey === "function") {
					sDocNumber = oSource.getSelectedKey() || "";
				} else if (typeof oSource.getValue === "function") {
					sDocNumber = oSource.getValue() || "";
				}
			}

			sDocNumber = (sDocNumber || "").toString();
			if (!sDocNumber) {
				return;
			}

			var oDocTypeSelect = this.byId("idRefDocType");
			var sDocType = this._sSelectedDocType || (oDocTypeSelect?.getSelectedItem?.()?.getKey?.() || oDocTypeSelect?.getSelectedKey?.() || "");
			sDocType = (sDocType || "").toString().trim();
			if (!sDocType) {
				return;
			}

			// Prevent change event from issuing a duplicate backend call for the same selection.
			this._bUserSelected = true;
			this._handleDocSelection(sDocType, sDocNumber);
		},

		onRefDocNumberChange: function () {
			this._oSelectedOrderDetail = null;
			if (this._bUserSelected) {
				this._bUserSelected = false;
				return;
			}
			if (this._iDebounceTimer) {
				clearTimeout(this._iDebounceTimer);
				this._iDebounceTimer = null;
			}

			var that = this;

			this._iDebounceTimer = setTimeout(function () {
				that._iDebounceTimer = null;
				var oDocNumberCtrl = that.byId("idRefDocNumber");
				var oDocTypeSelect = that.byId("idRefDocType");
				var sDocType = String(
					that._sSelectedDocType ||
						oDocTypeSelect?.getSelectedItem?.()?.getKey?.() ||
						oDocTypeSelect?.getSelectedKey?.() ||
						""
				).trim();
				var sDocNo = String(oDocNumberCtrl?.getValue?.() || "").trim();
				if (!sDocType || !sDocNo) {
					return;
				}
				that._handleDocSelection(sDocType, sDocNo)
					.catch(function () {
						// non-blocking
					});
			}, 500);
		},

		_handleDocSelection: function (sDocType, sDocNumber) {
			var sType = String(sDocType || "").trim();
			var sDocNo = String(sDocNumber || "").trim();
			if (!sType || !sDocNo) {
				return Promise.resolve(null);
			}
			var sDocNorm = this._normalizeDocNumberForMatch(sDocNo);
			var sLastNorm = this._normalizeDocNumberForMatch(this._sLastDocNo);
			if (this._sLastDocType === sType && sLastNorm && sDocNorm && sLastNorm === sDocNorm) {
				return Promise.resolve(null);
			}
			this._sLastDocType = sType;
			this._sLastDocNo = sDocNo;
			this._iReqId = (this._iReqId || 0) + 1;
			var iCurrentReq = this._iReqId;

			return this._findMatchingOrderDetail(sType, sDocNo, true)
				.then(function (oResolved) {
					if (iCurrentReq !== this._iReqId) {
						return null;
					}
					if (oResolved) {
						this._oSelectedOrderDetail = oResolved;
						this._applySelectedReferenceDoc(oResolved);
						// Clear top-context typed values after successful selection to avoid stale auto-prefill.
						this._clearTopContextRefDocInputs();
						return oResolved;
					}
					this._oSelectedOrderDetail = null;
					this._clearSelectedReferenceDocFields();
					MessageToast.show("No matching document found");
					return null;
				}.bind(this))
				.catch(function (oError) {
					if (iCurrentReq !== this._iReqId) {
						return null;
					}
					this._oSelectedOrderDetail = null;
					MessageBox.error(this._extractErrorMessage(oError));
					return null;
				}.bind(this));
		},

		_clearSelectedReferenceDocFields: function () {
			this.byId("idRefDocDate")?.setValue("");
			this.byId("idRefDocPartyCode")?.setValue("");
			this.byId("idRefDocPartyName")?.setValue("");
			this.byId("idRefDocSalesDoc")?.setValue("");
			this.byId("idRefDocSalesDoctype")?.setValue("");
			this.byId("idRefDocEwayBillNumber")?.setValue("");
			this.byId("idRefDocEwayBillDate")?.setValue("");
		},

		_clearTopContextRefDocInputs: function () {
			var sViewId = this.getView()?.getId?.() || "";
			try {
				var oIncoming = Fragment.byId(sViewId, "idIncomingDialogPoInput");
				if (oIncoming && typeof oIncoming.setValue === "function") {
					oIncoming.setValue("");
				}
			} catch (e) {
				// ignore
			}
			try {
				var oGateOut = Fragment.byId(sViewId, "idGateOutRefDocSearchInput");
				if (oGateOut && typeof oGateOut.setValue === "function") {
					oGateOut.setValue("");
				}
			} catch (e2) {
				// ignore
			}
			var oGateOutUi = this.getView()?.getModel("gateOutUi");
			if (oGateOutUi) {
				oGateOutUi.setProperty("/refDocSearchValue", "");
			}
		},

		_hasPrefilledRefDocNumber: function () {
			return !!String(this._getTopContextRefDocNumber() || "").trim();
		},

		_getLatestReferenceByKey: function () {
			var sFromViewModel = String(this.getView()?.getModel("gateOutUi")?.getProperty("/referenceByKey") || "").trim().toUpperCase();
			if (sFromViewModel === "PO" || sFromViewModel === "INVOICE" || sFromViewModel === "CHALLAN") {
				return sFromViewModel;
			}
			var sFromGlobal = String(sap.ui.getCore().getModel("globalData")?.getProperty("/OutgoingReferenceByKey") || "").trim().toUpperCase();
			if (sFromGlobal === "PO" || sFromGlobal === "INVOICE" || sFromGlobal === "CHALLAN") {
				return sFromGlobal;
			}
			return "";
		},

		_getTopContextRefDocNumber: function () {
			var sViewId = this.getView()?.getId?.() || "";
			var sIncoming = "";
			var sGateOut = "";
			var oGlobalModel = sap.ui.getCore().getModel("globalData");
			try {
				sIncoming = String(Fragment.byId(sViewId, "idIncomingDialogPoInput")?.getValue?.() || "").trim();
			} catch (e) {
				sIncoming = "";
			}
			try {
				sGateOut = String(Fragment.byId(sViewId, "idGateOutRefDocSearchInput")?.getValue?.() || "").trim();
			} catch (e2) {
				sGateOut = "";
			}
			if (!sGateOut) {
				sGateOut = String(this.getView()?.getModel("gateOutUi")?.getProperty("/refDocSearchValue") || "").trim();
			}
			// Strong fallback: values persisted in globalData from Report Vehicle/GateOut flows.
			var sIncomingPo = String(oGlobalModel?.getProperty("/IncomingPoNumber") || "").trim();
			var sOutgoingPo = String(oGlobalModel?.getProperty("/OutgoingPoNumber") || "").trim();
			var sOutgoingBilling = String(oGlobalModel?.getProperty("/OutgoingBillingDocument") || "").trim();
			return sIncoming || sGateOut || sIncomingPo || sOutgoingPo || sOutgoingBilling || "";
		},

		_getRefDocSuggestionSource: function () {
			var sOutgoingRefKey = this._getLatestReferenceByKey();
			var oPoPrefill = this._getPoRefDocPrefill();
			var sPrefillSource = String(oPoPrefill?.source || "").trim();

			if (sPrefillSource === "incoming" || sPrefillSource === "outgoing") {
				return "PO";
			}
			if (sPrefillSource === "outgoingBilling") {
				return "INVOICE";
			}
			if (sPrefillSource === "outgoingChallan") {
				return "CHALLAN";
			}

			if (sOutgoingRefKey === "PO" || sOutgoingRefKey === "INVOICE" || sOutgoingRefKey === "CHALLAN") {
				return sOutgoingRefKey;
			}

			var oDocTypeSelect = this.byId("idRefDocType");
			var sHint = String(
				oDocTypeSelect?.getSelectedItem?.()?.getText?.() ||
				oDocTypeSelect?.getSelectedItem?.()?.getAdditionalText?.() ||
				""
			).toUpperCase();
			if (sHint.indexOf("CHALLAN") !== -1) return "CHALLAN";
			if (sHint.indexOf("INVOICE") !== -1) return "INVOICE";
			if (sHint.indexOf("PO") !== -1 || sHint.indexOf("PURCHASE") !== -1) return "PO";

			return "";
		},

		_mapDocTypeToSearchHelpMode: function (sDocType) {
			var s = String(sDocType || "").toUpperCase().trim();
			if (s.indexOf("CHALLAN") !== -1) {
				return "CHALLAN";
			}
			if (s.indexOf("PO") !== -1 || s.indexOf("PURCHASE") !== -1) {
				return "PO";
			}
			if (s.indexOf("INVOICE") !== -1 || s.indexOf("BILLING") !== -1) {
				return "INVOICE";
			}
			return "";
		},

		_fetchRefDocSuggestionsFromSearchHelp: function (sSource, sSearchTerm) {
			return new Promise(function (resolve) {
				var oService = this._getOrderDetailsService();
				var sMode = String(sSource || "").toUpperCase();
				var sPath = "";
				var aFilters = [];
				var sTerm = String(sSearchTerm || "").trim();
				var bNumeric = /^\d+$/.test(sTerm);
				var oUrlParameters = {
					$top: "20",
					$skip: "0"
				};

				if (sMode === "PO") {
					sPath = "/PoNumberSH";
					if (sTerm) {
						aFilters.push(new Filter(bNumeric ? "PoNumber" : "VendorName", FilterOperator.StartsWith, sTerm));
					}
				} else if (sMode === "INVOICE") {
					sPath = "/BillingDocSH";
					if (sTerm) {
						// Backend may expose PayerName (preferred) or Payer (fallback id/text).
						aFilters.push(new Filter(bNumeric ? "BillingDoc" : "PayerName", FilterOperator.StartsWith, sTerm));
					}
				} else if (sMode === "CHALLAN") {
					sPath = "/ChallanSh";
					if (sTerm) {
						aFilters.push(new Filter(bNumeric ? "MaterialDoc" : "SupplierName", FilterOperator.StartsWith, sTerm));
					}
				} else {
					resolve([]);
					return;
				}

				oService.read(sPath, {
					filters: aFilters,
					urlParameters: oUrlParameters,
					success: function (oData) {
						var aRows = oData?.results || [];
						var aMapped = aRows.map(function (oRow) {
							var sDocNo = "";
							if (sMode === "PO") sDocNo = String(oRow?.PoNumber || "").trim();
							if (sMode === "INVOICE") sDocNo = String(oRow?.BillingDoc || "").trim();
							if (sMode === "CHALLAN") sDocNo = String(oRow?.MaterialDoc || "").trim();
							return {
								DocType: this._sSelectedDocType || "",
								DocumentNumber: sDocNo,
								Name: String(
									oRow?.Name ||
									oRow?.PayerName ||
									oRow?.Payer ||
									oRow?.VendorName ||
									oRow?.CustomerName ||
									oRow?.SupplierName ||
									oRow?.Description ||
									""
								).trim()
							};
						}.bind(this)).filter(function (oDoc) {
							return !!oDoc.DocumentNumber;
						});
						resolve(aMapped);
					}.bind(this),
					error: function (oError) {
						// For invoice text search, fallback to Payer if PayerName is unsupported.
						if (sMode === "INVOICE" && sTerm && !bNumeric && aFilters.length) {
							oService.read(sPath, {
								filters: [new Filter("Payer", FilterOperator.StartsWith, sTerm)],
								urlParameters: oUrlParameters,
								success: function (oData2) {
									var aRows2 = oData2?.results || [];
									var aMapped2 = aRows2.map(function (oRow) {
										return {
											DocType: this._sSelectedDocType || "",
											DocumentNumber: String(oRow?.BillingDoc || "").trim(),
											Name: String(oRow?.PayerName || oRow?.Payer || "").trim()
										};
									}.bind(this)).filter(function (oDoc) {
										return !!oDoc.DocumentNumber;
									});
									resolve(aMapped2);
								}.bind(this),
								error: function () {
									resolve([]);
								}
							});
							return;
						}
						resolve([]);
					}
				});
			}.bind(this));
		},

		onRefDocNumberSuggest: function (oEvent) {
			var oInput = oEvent.getSource();
			var sValue = (oEvent.getParameter("suggestValue") || "").trim();

			// Always clear and re-fill suggestion items
			oInput.destroySuggestionItems();

			// Read current Doc Type; server-side suggestion depends on it
			var oDocTypeSelect = this.byId("idRefDocType");
			var sDocType = this._sSelectedDocType || (oDocTypeSelect?.getSelectedItem?.()?.getKey?.() || oDocTypeSelect?.getSelectedKey?.() || "");
			sDocType = (sDocType || "").toString().trim();
			if (!sDocType) {
				return;
			}

			// Ensure dropdown paging is wired (for arrow-open scrolling list)
			this._resetDocNoPaging(sDocType, sValue);
			this._attachDocNoComboPaging();

			// If nothing typed, just show a small "recent" set from whatever is already loaded in the model
			if (!sValue) {
				var aCached = this.getView().getModel("refDocSuggestions")?.getProperty("/items") || [];
				(aCached || []).slice(0, 15).forEach(function (oDoc) {
					var sDocNo = oDoc?.DocumentNumber || "";
					if (!sDocNo) return;
					oInput.addSuggestionItem(
						new SuggestionItem({
							key: sDocNo,
							text: sDocNo,
							description: oDoc?.Name || ""
						})
					);
				});
				return;
			}

			// Debounced server-side search from Search Help or OrderDetails.
			this._iRefDocSuggestReqId = (this._iRefDocSuggestReqId || 0) + 1;
			var iReqId = this._iRefDocSuggestReqId;
			var that = this;
			// Keep selected Doc Type as the primary source for SH endpoint mapping.
			var sSuggestionSource = this._mapDocTypeToSearchHelpMode(sDocType) || this._getRefDocSuggestionSource();
			var bUseSearchHelp = !!sSuggestionSource;
			if (this._iRefDocSuggestDebounceTimer) {
				clearTimeout(this._iRefDocSuggestDebounceTimer);
				this._iRefDocSuggestDebounceTimer = null;
			}

			this._iRefDocSuggestDebounceTimer = setTimeout(function () {
				var pSuggestions = bUseSearchHelp
					? that._fetchRefDocSuggestionsFromSearchHelp(sSuggestionSource, sValue)
					: that._fetchOrderDetails(sDocType, { searchTerm: sValue, top: 50 });

				pSuggestions
					.then(function (aDocs) {
						// Ignore stale responses if user typed again
						if (iReqId !== that._iRefDocSuggestReqId) {
							return;
						}
						// Some backends may ignore/relax the search filter and return broad/default rows.
						// Keep only records that actually match what user typed.
						var sTerm = String(sValue || "").toLowerCase();
						var aMatchedDocs = (aDocs || []).filter(function (oDoc) {
							var sDocNo = String(oDoc?.DocumentNumber || "").toLowerCase();
							var sName = String(oDoc?.Name || "").toLowerCase();
							return sDocNo.indexOf(sTerm) !== -1 || sName.indexOf(sTerm) !== -1;
						});

						// Keep dropdown list reasonably sized (arrow button) with latest search results
						that._updateRefDocSuggestions(aMatchedDocs);

						// Populate suggest list (max 20)
						(aMatchedDocs || []).slice(0, 20).forEach(function (oDoc) {
							var sDocNo = oDoc?.DocumentNumber || "";
							if (!sDocNo) return;
							oInput.addSuggestionItem(
								new SuggestionItem({
									key: sDocNo,
									text: sDocNo,
									description: oDoc?.Name || ""
								})
							);
						});
					})
					.catch(function () {
						// Non-blocking: just leave suggestions empty
					});
			}, 300);
		},

		/**
		 * ComboBox `loadItems` handler for Document Number dropdown list.
		 * Loads the first page if the list is empty; additional pages are loaded via list growing on scroll.
		 */
		_onRefDocNumberLoadItems: function () {
			this._initDocNoPagingState();
			this._attachDocNoComboPaging();

			var oModel = this._getRefDocSuggestionModel();
			var aExisting = oModel?.getProperty("/items") || [];
			if (aExisting.length > 0) {
				return;
			}
			// Load first page for the currently selected doc type
			this._loadMoreDocNoDropdownPage();
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
			var oDocNumberCtrl = this.byId("idRefDocNumber");
			var sDocNumber = (oDocNumberCtrl && oDocNumberCtrl.isA && oDocNumberCtrl.isA("sap.m.ComboBox"))
				? ((oDocNumberCtrl.getSelectedKey() || oDocNumberCtrl.getValue() || "").trim())
				: (oDocNumberCtrl?.getValue()?.trim() || "");
			
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

			// Ensure the main material table is filtered for the same reference document
			// (button click inside the row may not trigger row selectionChange).
			this._oSelectedRefDoc = oDocument;
			this._filterMaterialDetails();
			
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

		onSearchSelectMaterials: function (oEvent) {
			var sQuery = (
				oEvent.getParameter("query") ??
				oEvent.getParameter("newValue") ??
				""
			).trim();

			var oTable = this.byId("idMaterialsSelectionTable");
			var oBinding = oTable && oTable.getBinding("items");
			if (!oBinding) {
				return;
			}

			if (!sQuery) {
				oBinding.filter([]);
				return;
			}

			var oSearchFilter = new Filter([
				new Filter("RefDocNo", FilterOperator.Contains, sQuery),
				new Filter("RefDocItemNo", FilterOperator.Contains, sQuery),
				new Filter("MaterialCode", FilterOperator.Contains, sQuery),
				new Filter("MaterialDescription", FilterOperator.Contains, sQuery),
				new Filter("Quantity", FilterOperator.Contains, sQuery),
				new Filter("UoM", FilterOperator.Contains, sQuery)
			], false);

			oBinding.filter([oSearchFilter]);
		},

		onCloseSelectMaterialsDialog: function () {
			if (this._oSelectMaterialsDialog) {
				this._oSelectMaterialsDialog.close();
			}
		},

		onSaveRefDocDialog: function () {
			var oGlobalModel = sap.ui.getCore().getModel("globalData");
			var sTripNumber = String(oGlobalModel?.getProperty("/TripNumber") || "").trim();
			if (!sTripNumber) {
				return MessageToast.show("Trip Number missing. Please open a trip first.");
			}

			var oDocTypeSelect = this.byId("idRefDocType");
			var sDocTypeUi = String(
				this._sSelectedDocType ||
				oDocTypeSelect?.getSelectedItem?.()?.getKey?.() ||
				oDocTypeSelect?.getSelectedKey?.() ||
				""
			).trim();
			if (!sDocTypeUi) {
				return MessageToast.show("Doc Type is mandatory");
			}

			var oDocNumberCtrl = this.byId("idRefDocNumber");
			var sDocNoUi = String(
				(oDocNumberCtrl && oDocNumberCtrl.isA && oDocNumberCtrl.isA("sap.m.ComboBox"))
					? (oDocNumberCtrl.getSelectedKey() || oDocNumberCtrl.getValue() || "")
					: (oDocNumberCtrl?.getValue?.() || "")
			).trim();
			if (!sDocNoUi) {
				return MessageToast.show("Document Number is mandatory");
			}

			var oPayload = this._buildOrderDetailPayload();
			if (!oPayload) {
				return MessageBox.error("Unable to build reference document payload.");
			}

			if (this._bIsRefDocEditMode && this._oEditingRefDoc) {
				// Update existing reference document
				return this._updateOrderDetail(oPayload, this._oEditingRefDoc)
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
						var sMessage = this._extractErrorMessage(oError) || "Unable to save reference document";
						MessageBox.error(sMessage);
					}.bind(this));
			}

			// Create new reference document
			return this._saveOrderDetail(oPayload)
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
					MessageBox.error(sMessage);
				}.bind(this));
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
			// Ensure newly added rows are immediately visible in the main material table.
			this._oSelectedRefDoc = oRefDoc;
			this._filterMaterialDetails();
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

			// New: ValueHelpDialog bound to OData /OrderDetails with growing + server-side search
			if (!this._oMaterialRefDocNoVHD) {
				this._oMaterialRefDocNoVHD = this._createMaterialRefDocNoVHD();
			}
			this._applyMaterialRefDocNoVhFilters({ docType: sDocType, searchTerm: "" });
			this._oMaterialRefDocNoVHD.open();
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
			
			// New: ValueHelpDialog bound to OData /ItemDetails with growing + server-side search
			if (!this._oMaterialItemVHD) {
				this._oMaterialItemVHD = this._createMaterialItemVHD();
			}
			this._applyMaterialItemVhFilters({ docType: sDocType, refDocNo: sRefDocNo, searchTerm: "" });
			this._oMaterialItemVHD.open();
		},

		_createMaterialRefDocNoVHD: function () {
			var that = this;
			var oVHD = new ValueHelpDialog({
				title: "Select Reference Document",
				supportMultiselect: false,
				key: "DocumentNumber",
				descriptionKey: "Name",
				ok: function (oEvent) {
					var oDlg = oEvent.getSource && oEvent.getSource();
					var oTable = oDlg && oDlg.getTable && oDlg.getTable();
					var oSel = oTable && oTable.getSelectedItem && oTable.getSelectedItem();
					var oCtx = oSel && oSel.getBindingContext && oSel.getBindingContext();
					var oObj = oCtx && oCtx.getObject && oCtx.getObject();
					if (oObj) {
						that._applySelectedRefDocForMaterial(oObj);
					}
					oDlg?.close?.();
				},
				cancel: function () {
					oVHD.close();
				},
			});

			var oBasicSearch = new SearchField({
				width: "100%",
				search: function (oEvent) {
					that._applyMaterialRefDocNoVhFilters({ searchTerm: (oEvent.getParameter("query") || "").trim() });
				},
				liveChange: function (oEvent) {
					if (that._iMatRefDocVhDebounce) clearTimeout(that._iMatRefDocVhDebounce);
					var sVal = (oEvent.getParameter("newValue") || "").toString();
					that._iMatRefDocVhDebounce = setTimeout(function () {
						that._iMatRefDocVhDebounce = null;
						that._applyMaterialRefDocNoVhFilters({ searchTerm: sVal.trim() });
					}, 250);
				},
			});
			var oFB = new sap.ui.comp.filterbar.FilterBar({
				advancedMode: false,
				filterBarExpanded: false,
				showGoOnFB: false,
				showFilterConfiguration: false,
				useToolbar: true,
				basicSearch: oBasicSearch,
			});
			oVHD.setFilterBar(oFB);

			var oTable = new Table({
				mode: "SingleSelectMaster",
				growing: true,
				growingThreshold: 20,
				growingScrollToLoad: true,
				columns: [
					new Column({ header: new Label({ text: "Document Number" }) }),
					new Column({ header: new Label({ text: "Name" }) }),
				],
			});
			oTable.setModel(this._getOrderDetailsService());
			oTable.bindItems({
				path: "/OrderDetails",
				template: new ColumnListItem({
					cells: [new Text({ text: "{DocumentNumber}" }), new Text({ text: "{Name}" })],
				}),
			});

			oVHD.setTable(oTable);
			this.getView().addDependent(oVHD);
			return oVHD;
		},

		_applyMaterialRefDocNoVhFilters: function (mOpts) {
			var oVHD = this._oMaterialRefDocNoVHD;
			if (!oVHD) return;
			var oTable = oVHD.getTable && oVHD.getTable();
			var oBinding = oTable && oTable.getBinding && oTable.getBinding("items");
			if (!oBinding) return;

			var m = mOpts || {};
			if (m.docType !== undefined) {
				this._sSelectedMaterialDocType = (m.docType || "").toString().trim();
			}
			if (m.searchTerm !== undefined) {
				this._sMatRefDocSearch = (m.searchTerm || "").toString().trim();
			}

			var oGlobalModel = sap.ui.getCore().getModel("globalData");
			var sTripNumber = (oGlobalModel?.getProperty("/TripNumber") || "").toString().trim();
			var sDocType = (this._sSelectedMaterialDocType || "").toString().trim();
			var sTerm = (this._sMatRefDocSearch || "").toString().trim();

			var aFilters = [];
			if (sTripNumber) aFilters.push(new Filter("TripNumber", FilterOperator.EQ, sTripNumber));
			if (sDocType) aFilters.push(new Filter("DocType", FilterOperator.EQ, sDocType));
			if (sTerm) {
				aFilters.push(new Filter([new Filter("DocumentNumber", FilterOperator.Contains, sTerm), new Filter("Name", FilterOperator.Contains, sTerm)], false));
			}
			oBinding.filter(aFilters);
		},

		_createMaterialItemVHD: function () {
			var that = this;
			var oVHD = new ValueHelpDialog({
				title: "Select Material Item",
				supportMultiselect: false,
				key: "RefDocItemNo",
				descriptionKey: "MaterialCode",
				ok: function (oEvent) {
					var oDlg = oEvent.getSource && oEvent.getSource();
					var oTable = oDlg && oDlg.getTable && oDlg.getTable();
					var oSel = oTable && oTable.getSelectedItem && oTable.getSelectedItem();
					var oCtx = oSel && oSel.getBindingContext && oSel.getBindingContext();
					var oObj = oCtx && oCtx.getObject && oCtx.getObject();
					if (oObj) {
						that._applySelectedMaterialItem(oObj);
					}
					oDlg?.close?.();
				},
				cancel: function () {
					oVHD.close();
				},
			});

			var oBasicSearch = new SearchField({
				width: "100%",
				search: function (oEvent) {
					that._applyMaterialItemVhFilters({ searchTerm: (oEvent.getParameter("query") || "").trim() });
				},
				liveChange: function (oEvent) {
					if (that._iMatItemVhDebounce) clearTimeout(that._iMatItemVhDebounce);
					var sVal = (oEvent.getParameter("newValue") || "").toString();
					that._iMatItemVhDebounce = setTimeout(function () {
						that._iMatItemVhDebounce = null;
						that._applyMaterialItemVhFilters({ searchTerm: sVal.trim() });
					}, 250);
				},
			});
			var oFB = new sap.ui.comp.filterbar.FilterBar({
				advancedMode: false,
				filterBarExpanded: false,
				showGoOnFB: false,
				showFilterConfiguration: false,
				useToolbar: true,
				basicSearch: oBasicSearch,
			});
			oVHD.setFilterBar(oFB);

			var oTable = new Table({
				mode: "SingleSelectMaster",
				growing: true,
				growingThreshold: 20,
				growingScrollToLoad: true,
				columns: [
					new Column({ header: new Label({ text: "Ref Doc Item No" }) }),
					new Column({ header: new Label({ text: "Material" }) }),
					new Column({ header: new Label({ text: "Description" }) }),
				],
			});

			oTable.setModel(this._getItemDetailsService());
			oTable.bindItems({
				path: "/ItemDetails",
				template: new ColumnListItem({
					cells: [
						new Text({ text: "{RefDocItemNo}" }),
						new Text({ text: "{MaterialCode}" }),
						new Text({ text: "{MaterialDescription}" }),
					],
				}),
			});

			oVHD.setTable(oTable);
			this.getView().addDependent(oVHD);
			return oVHD;
		},

		_applyMaterialItemVhFilters: function (mOpts) {
			var oVHD = this._oMaterialItemVHD;
			if (!oVHD) return;
			var oTable = oVHD.getTable && oVHD.getTable();
			var oBinding = oTable && oTable.getBinding && oTable.getBinding("items");
			if (!oBinding) return;

			var m = mOpts || {};
			if (m.docType !== undefined) this._sMatItemDocType = (m.docType || "").toString().trim();
			if (m.refDocNo !== undefined) this._sMatItemRefDocNo = (m.refDocNo || "").toString().trim();
			if (m.searchTerm !== undefined) this._sMatItemSearch = (m.searchTerm || "").toString().trim();

			var oGlobalModel = sap.ui.getCore().getModel("globalData");
			var sTripNumber = (oGlobalModel?.getProperty("/TripNumber") || "").toString().trim();
			var sDocType = (this._sMatItemDocType || "").toString().trim();
			var sRefDocNo = (this._sMatItemRefDocNo || "").toString().trim();
			var sTerm = (this._sMatItemSearch || "").toString().trim();

			var aFilters = [];
			if (sTripNumber) aFilters.push(new Filter("TripNumber", FilterOperator.EQ, sTripNumber));
			if (sDocType) aFilters.push(new Filter("DocType", FilterOperator.EQ, sDocType));
			if (sRefDocNo) aFilters.push(new Filter("RefDocNo", FilterOperator.EQ, sRefDocNo));
			aFilters.push(new Filter("IsDeleted", FilterOperator.NE, "X"));

			if (sTerm) {
				aFilters.push(new Filter([
					new Filter("RefDocItemNo", FilterOperator.Contains, sTerm),
					new Filter("MaterialCode", FilterOperator.Contains, sTerm),
					new Filter("MaterialDescription", FilterOperator.Contains, sTerm)
				], false));
			}

			oBinding.filter(aFilters);
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
						this._oEventBus?.publish("RefDoc", "MaterialsUpdated");
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
						this._oEventBus?.publish("RefDoc", "MaterialsUpdated");
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

		_getPoRefDocPrefill: function () {
			// Incoming flow: prefill in create mode (TripNumber not set yet).
			// Gate Out flow: this shared view is opened in trip context, so allow outgoing prefill
			// even when TripNumber exists.
			var oGlobalModel = sap.ui.getCore().getModel("globalData");
			var sTripNumber = oGlobalModel?.getProperty("/TripNumber") || "";
			var bHasTrip = !!String(sTripNumber).trim();
			var sOutgoingRefKey = (oGlobalModel?.getProperty("/OutgoingReferenceByKey") || "").toString().trim().toUpperCase();
			var sLatestRefKey = this._getLatestReferenceByKey();
			var sTopDocNo = this._getTopContextRefDocNumber();
			var sSelectedDocType = String(this._sSelectedDocType || this.byId("idRefDocType")?.getSelectedKey?.() || "").trim();
			var sIncomingDocTypeCtx = (oGlobalModel?.getProperty("/IncomingRefDocDocType") || "").toString().trim();
			var sOutgoingDocTypeCtx = (oGlobalModel?.getProperty("/OutgoingRefDocDocType") || "").toString().trim();
			var sOutgoingBillingDocTypeCtx = (oGlobalModel?.getProperty("/OutgoingBillingDocType") || "").toString().trim();

			// Highest priority: typed values in Incoming/GateOut top-context controls.
			if (sTopDocNo) {
				// Keep automatic Doc Type behavior by deriving a context docType when dialog selection is still empty.
				var sResolvedDocType = sSelectedDocType;
				if (!sResolvedDocType) {
					if (sLatestRefKey === "PO") {
						sResolvedDocType = bHasTrip ? sOutgoingDocTypeCtx : sIncomingDocTypeCtx;
					} else if (sLatestRefKey === "INVOICE") {
						sResolvedDocType = sOutgoingBillingDocTypeCtx || sOutgoingDocTypeCtx;
					} else if (sLatestRefKey === "CHALLAN") {
						sResolvedDocType = sOutgoingBillingDocTypeCtx || sOutgoingDocTypeCtx;
					}
				}

				if (sLatestRefKey === "PO") {
					return { poNumber: sTopDocNo, docType: sResolvedDocType, source: bHasTrip ? "outgoing" : "incoming" };
				}
				if (sLatestRefKey === "INVOICE") {
					return { poNumber: sTopDocNo, docType: sResolvedDocType, source: "outgoingBilling" };
				}
				if (sLatestRefKey === "CHALLAN") {
					return { poNumber: sTopDocNo, docType: sResolvedDocType, source: "outgoingChallan" };
				}
			}

			var sIncomingPo = (oGlobalModel?.getProperty("/IncomingPoNumber") || "").toString().trim();
			var sIncomingSkip = (oGlobalModel?.getProperty("/IncomingRefDocSkip") || " ").toString().trim();
			var sIncomingDocType = (oGlobalModel?.getProperty("/IncomingRefDocDocType") || "").toString().trim();

			// Keep incoming prefill restricted to create mode.
			if (sIncomingPo && sIncomingSkip !== "X") {
				// Allow incoming PO prefill even when TripNumber exists,
				// so Add Reference Document behaves consistently with invoice/challan.
				return { poNumber: sIncomingPo, docType: sIncomingDocType, source: "incoming" };
			}

			var sOutgoingPo = (oGlobalModel?.getProperty("/OutgoingPoNumber") || "").toString().trim();
			var sOutgoingSkip = (oGlobalModel?.getProperty("/OutgoingRefDocSkip") || " ").toString().trim();
			var sOutgoingDocType = (oGlobalModel?.getProperty("/OutgoingRefDocDocType") || "").toString().trim();

			if (sOutgoingPo && sOutgoingSkip !== "X") {
				return { poNumber: sOutgoingPo, docType: sOutgoingDocType, source: "outgoing" };
			}

			var sOutgoingBilling = (oGlobalModel?.getProperty("/OutgoingBillingDocument") || "").toString().trim();
			if (sOutgoingBilling && sOutgoingSkip !== "X") {
				if (!sOutgoingDocType) {
					sOutgoingDocType = (oGlobalModel?.getProperty("/OutgoingBillingDocType") || "").toString().trim();
				}
				return {
					poNumber: sOutgoingBilling,
					docType: sOutgoingDocType,
					source: (sOutgoingRefKey === "CHALLAN") ? "outgoingChallan" : "outgoingBilling"
				};
			}

			return null;
		},

		_normalizeDocNumberForMatch: function (vDocNo) {
			var s = String(vDocNo || "").trim();
			if (!s) {
				return "";
			}
			var sNoZeros = s.replace(/^0+/, "");
			return sNoZeros || "0";
		},

		_findMatchingOrderDetail: function (sDocType, sDocNumber, bForceServer) {
			var sType = String(sDocType || "").trim();
			var sDoc = String(sDocNumber || "").trim();
			if (!sType || !sDoc) {
				return Promise.resolve(null);
			}

			if (!bForceServer) {
				var sDocNorm = this._normalizeDocNumberForMatch(sDoc);
				var aCached = this._getRefDocSuggestionModel()?.getProperty("/items") || [];
				var oCachedMatch = (aCached || []).find(function (o) {
					var s = String(o?.DocumentNumber || "").trim();
					return s && (s === sDoc || this._normalizeDocNumberForMatch(s) === sDocNorm);
				}.bind(this));
				if (oCachedMatch) {
					return Promise.resolve(oCachedMatch);
				}
			}

			var oGlobalModel = sap.ui.getCore().getModel("globalData");
			var sTripNumber = String(oGlobalModel?.getProperty("/TripNumber") || "").trim();
			var oService = this._getOrderDetailsService();

			// Strict mode: exact server-side match only (DocType + DocumentNumber [+TripNumber]).
			// Do not perform secondary fallback reads.
			return new Promise(function (resolve, reject) {
				var aFilters = [
					new Filter("DocType", FilterOperator.EQ, sType),
					new Filter("DocumentNumber", FilterOperator.EQ, sDoc)
				];
				if (sTripNumber) {
					aFilters.push(new Filter("TripNumber", FilterOperator.EQ, sTripNumber));
				}

				oService.read("/OrderDetails", {
					filters: aFilters,
					urlParameters: {
						$top: "1",
						$skip: "0"
					},
					success: function (oData) {
						var a = oData?.results || [];
						resolve(a[0] || null);
					},
					error: function (oError) {
						reject(oError);
					}
				});
			}.bind(this));
		},

		_applyPoPrefillToAddRefDocDialog: function () {
			if (this._bIsRefDocEditMode) {
				return;
			}

			var oPoPrefill = this._getPoRefDocPrefill();
			if (!oPoPrefill || !oPoPrefill.poNumber) {
				return;
			}

			var that = this;
			var oDocTypeSelect = this.byId("idRefDocType");
			var oDocNumberCtrl = this.byId("idRefDocNumber");

			// Prefill Document Number from PO; keep editable so user can enter a different doc or add more reference docs.
			if (oDocNumberCtrl) {
				oDocNumberCtrl.setValue(oPoPrefill.poNumber);
				oDocNumberCtrl.setEnabled(true);
				if (typeof oDocNumberCtrl.setEditable === "function") {
					oDocNumberCtrl.setEditable(true);
				}
				if (typeof oDocNumberCtrl.setShowValueHelp === "function") {
					oDocNumberCtrl.setShowValueHelp(false);
				}
				if (typeof oDocNumberCtrl.setShowSuggestion === "function") {
					oDocNumberCtrl.setShowSuggestion(true);
				}
			}

			// If DocType is known from the PO lookup, preselect it now.
			if (oDocTypeSelect && oPoPrefill.docType) {
				oDocTypeSelect.setSelectedKey(oPoPrefill.docType);
				this._sSelectedDocType = oPoPrefill.docType;
			}

			// Fetch related reference document details and fill the dialog.
			var sDocTypeToFetch = oPoPrefill.docType || "";
			var sPrefillDocNo = String(oPoPrefill.poNumber || "").trim();
			this._findMatchingOrderDetail(sDocTypeToFetch, sPrefillDocNo, true)
				.then(function (oMatch) {

					if (!oMatch) {
						// Prefill lookup did not return anything; restore interactivity so user can pick manually.
						if (oDocTypeSelect) {
							oDocTypeSelect.setEnabled(true);
						}
						if (oDocNumberCtrl) {
							oDocNumberCtrl.setEnabled(true);
							if (typeof oDocNumberCtrl.setEditable === "function") {
								oDocNumberCtrl.setEditable(true);
							}
							if (typeof oDocNumberCtrl.setShowValueHelp === "function") {
								oDocNumberCtrl.setShowValueHelp(false);
							}
							if (typeof oDocNumberCtrl.setShowSuggestion === "function") {
								oDocNumberCtrl.setShowSuggestion(true);
							}
						}
						return;
					}

					var sInferredDocType = String(oMatch?.DocType || "").trim();
					if (oDocTypeSelect && !oPoPrefill.docType && sInferredDocType) {
						oDocTypeSelect.setSelectedKey(sInferredDocType);
						that._sSelectedDocType = sInferredDocType;
						that._loadRefDocSuggestions(sInferredDocType);
					}

					that._applySelectedReferenceDoc(oMatch);

					// Lock validated prefilled values coming from top selection context.
					if (oDocTypeSelect) {
						oDocTypeSelect.setEnabled(false);
					}
					if (oDocNumberCtrl) {
						oDocNumberCtrl.setEnabled(false);
						if (typeof oDocNumberCtrl.setEditable === "function") {
							oDocNumberCtrl.setEditable(false);
						}
						if (typeof oDocNumberCtrl.setShowSuggestion === "function") {
							oDocNumberCtrl.setShowSuggestion(false);
						}
					}
				})
				.catch(function () {
					// Non-blocking: allow dialog open even if prefill lookup fails.
					// Restore interactivity so the user can still select values manually.
					if (oDocTypeSelect) {
						oDocTypeSelect.setEnabled(true);
					}
					if (oDocNumberCtrl) {
						oDocNumberCtrl.setEnabled(true);
						if (typeof oDocNumberCtrl.setEditable === "function") {
							oDocNumberCtrl.setEditable(true);
						}
						if (typeof oDocNumberCtrl.setShowValueHelp === "function") {
							oDocNumberCtrl.setShowValueHelp(false);
						}
						if (typeof oDocNumberCtrl.setShowSuggestion === "function") {
							oDocNumberCtrl.setShowSuggestion(true);
						}
					}
				});
		},

		_openAddRefDocDialog: function () {
			var that = this;
			return new Promise(function (resolve, reject) {
				// Ensure doc types are loaded before opening dialog
				that._loadDocTypes().then(function (aDocTypes) {
					var oPoPrefill = that._getPoRefDocPrefill();
					that._bSkipDefaultRefDocType = !that._bIsRefDocEditMode && !!(oPoPrefill && oPoPrefill.poNumber && oPoPrefill.docType);
					if (that._bSkipDefaultRefDocType && oPoPrefill && oPoPrefill.docType) {
						that._sSelectedDocType = oPoPrefill.docType;
					}
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
							that._setFragmentI18nModel(oDialog);
							// Ensure docTypeModel is set on the dialog - this is critical for the binding to work
							var oDocTypeModel = that._getDocTypeModel();
							oDialog.setModel(oDocTypeModel, "docTypeModel");
							// Set dialog mode after dialog is loaded (important for first time)
							that._setRefDocDialogMode(that._bIsRefDocEditMode ? "edit" : "add");
							// Populate dialog if in edit mode
							if (that._bIsRefDocEditMode && that._oEditingRefDoc) {
								that._populateRefDocDialog(that._oEditingRefDoc);
							}
							that._loadRefDocSuggestions(that._sSelectedDocType)
								.finally(function () {
									oDialog.open();
									that._applyPoPrefillToAddRefDocDialog();
								});
							// Ensure Select binding is refreshed after dialog opens
							setTimeout(function() {
								var oSelect = that.byId("idRefDocType");
								if (oSelect) {
									var oBinding = oSelect.getBinding("items");
									if (oBinding) {
										oBinding.refresh();
									}
								}
								that._setDefaultRefDocTypeIfEmpty(aDocTypes);
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
						that._loadRefDocSuggestions(that._sSelectedDocType)
							.finally(function () {
								that._oAddRefDocDialog.open();
								that._applyPoPrefillToAddRefDocDialog();
							});
						setTimeout(function () {
							that._setDefaultRefDocTypeIfEmpty(aDocTypes);
						}, 0);
						resolve(that._oAddRefDocDialog);
					}
				}).catch(function (oError) {
					// Even if loading fails, still try to open dialog with existing model
					var oPoPrefill = that._getPoRefDocPrefill();
					that._bSkipDefaultRefDocType = !that._bIsRefDocEditMode && !!(oPoPrefill && oPoPrefill.poNumber && oPoPrefill.docType);
					if (that._bSkipDefaultRefDocType && oPoPrefill && oPoPrefill.docType) {
						that._sSelectedDocType = oPoPrefill.docType;
					}
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
							that._setFragmentI18nModel(oDialog);
							var oDocTypeModel = that._getDocTypeModel();
							oDialog.setModel(oDocTypeModel, "docTypeModel");
							that._setRefDocDialogMode(that._bIsRefDocEditMode ? "edit" : "add");
							if (that._bIsRefDocEditMode && that._oEditingRefDoc) {
								that._populateRefDocDialog(that._oEditingRefDoc);
							}
							that._loadRefDocSuggestions(that._sSelectedDocType)
								.finally(function () {
									oDialog.open();
									that._applyPoPrefillToAddRefDocDialog();
								});
							setTimeout(function () {
								that._setDefaultRefDocTypeIfEmpty();
							}, 0);
							resolve(oDialog);
						}.bind(that));
					} else {
						var oDocTypeModel = that._getDocTypeModel();
						that._oAddRefDocDialog.setModel(oDocTypeModel, "docTypeModel");
						that._setRefDocDialogMode(that._bIsRefDocEditMode ? "edit" : "add");
						if (that._bIsRefDocEditMode && that._oEditingRefDoc) {
							that._populateRefDocDialog(that._oEditingRefDoc);
						}
						that._loadRefDocSuggestions(that._sSelectedDocType)
							.finally(function () {
								that._oAddRefDocDialog.open();
								that._applyPoPrefillToAddRefDocDialog();
							});
						setTimeout(function () {
							that._setDefaultRefDocTypeIfEmpty();
						}, 0);
						resolve(that._oAddRefDocDialog);
					}
				});
			}.bind(this));
		},

		_setDefaultRefDocTypeIfEmpty: function (aDocTypes) {
			// Only apply a default in "Add" mode, and only if user hasn't chosen anything yet.
			if (this._bIsRefDocEditMode) {
				return;
			}
			if (this._bSkipDefaultRefDocType) {
				return;
			}

			var oSelect = this.byId("idRefDocType");
			if (!oSelect) {
				return;
			}

			var sExistingKey = (oSelect.getSelectedKey && oSelect.getSelectedKey()) || "";
			if (sExistingKey) {
				return;
			}

			// Prefer the freshly loaded list; fallback to model data if not provided.
			var aItems = Array.isArray(aDocTypes) ? aDocTypes : (this._getDocTypeModel()?.getProperty("/items") || []);
			if (!Array.isArray(aItems) || aItems.length === 0) {
				return;
			}

			var sFirstKey = aItems[0]?.ConfigID || "";
			if (!sFirstKey) {
				return;
			}

			oSelect.setSelectedKey(sFirstKey);
			this._sSelectedDocType = sFirstKey;
			this._loadRefDocSuggestions(sFirstKey);
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
						this._setFragmentI18nModel(oDialog);
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
			var oDlg = this._oAddMaterialDialog || this.byId("idAddMaterialDialog");
			if (oDlg && oDlg.close) {
				oDlg.close();
				// Some UI5 versions re-render dialog content during model updates;
				// schedule a second close to ensure it is really dismissed.
				setTimeout(function () {
					try {
						if (oDlg && oDlg.isOpen && oDlg.isOpen()) {
							oDlg.close();
						}
					} catch (e) {
						// ignore
					}
				}, 0);
			}
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
			this._beginMaterialsBusy();
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
				})
				.finally(function () {
					that._endMaterialsBusy();
				});
		},

		_saveMaterialsOneByOne: function (aMaterials) {
			var that = this;
			var oGlobalModel = sap.ui.getCore().getModel("globalData");
			var sTripNumber = oGlobalModel?.getProperty("/TripNumber") || "";
			
			if (!sTripNumber) {
				return MessageToast.show("Trip Number missing. Please open a trip first.");
			}

			// Prevent concurrent "Add Selected Materials" runs.
			if (this._bIsAddingSelectedMaterials) {
				return;
			}
			this._bIsAddingSelectedMaterials = true;
			
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

					that._bIsAddingSelectedMaterials = false;
					
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

						// Show the row immediately (no need to wait for final refresh).
						// Avoid duplicates if user triggers the action multiple times.
						var oModel = that._ensureRefDocModel();
						var aExisting = oModel.getProperty("/materialDetails") || [];
						var bExists = aExisting.some(function (oMat) {
							return oMat.tripNumber === oPayload.TripNumber &&
								oMat.docType === oPayload.DocType &&
								oMat.refDocNo === oPayload.RefDocNo &&
								oMat.refDocItemNo === oPayload.RefDocItemNo;
						});
						if (!bExists) {
							that._appendLocalMaterialDetail(oPayload);
						}

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

	_refreshMaterialsTable: function (mOptions) {
		// Refresh the material details table by reloading ItemDetails for the current TripNumber.
		// Returns a Promise so callers (for example Gate Out search flow) can chain follow-up actions.
		var oGlobalModel = sap.ui.getCore().getModel("globalData");
		var sTripNumber = oGlobalModel?.getProperty("/TripNumber") || "";
		var sDocNumber = (mOptions && mOptions.documentNumber ? String(mOptions.documentNumber) : "").trim();

		if (!sTripNumber) {
			return Promise.resolve([]);
		}

		var that = this;
		// Always fetch fresh data from server after adding materials to ensure latest data
		// This ensures newly added materials are immediately visible in the table
		var oService = this._getItemDetailsService();
		return new Promise(function (resolve) {
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
					if (sDocNumber) {
						var oModel = that._ensureRefDocModel();
						var aRefDocs = oModel.getProperty("/referenceDocs") || [];
						var oSelected = aRefDocs.find(function (oDoc) {
							return String(oDoc?.documentNumber || "").trim() === sDocNumber;
						});
						if (oSelected) {
							that._oSelectedRefDoc = oSelected;
							that._filterMaterialDetails();
						}
					}
					resolve(aItemDetails);
				},
				error: function () {
					// Silently fail - material table will show existing data
					resolve([]);
				}
			});
		});
	},

		_resetRefDocDialog: function () {
			if (this._iDebounceTimer) {
				clearTimeout(this._iDebounceTimer);
				this._iDebounceTimer = null;
			}
			if (this._iRefDocSuggestDebounceTimer) {
				clearTimeout(this._iRefDocSuggestDebounceTimer);
				this._iRefDocSuggestDebounceTimer = null;
			}
			this._iRefDocSuggestReqId = 0;
			this._iReqId = 0;
			this._sLastDocNo = "";
			this._sLastDocType = "";
			this._prefillDocNo = "";
			this._bUserSelected = false;
			this._oSelectedOrderDetail = null;
			// Keep Doc Type selection for "add another" flow; clear document no + derived fields only.
			var oDocTypeSelect = this.byId("idRefDocType");
			if (oDocTypeSelect) {
				oDocTypeSelect.setEnabled(true);
				oDocTypeSelect.setSelectedKey("");
			}
			this._sSelectedDocType = "";
			this._bSkipDefaultRefDocType = false;
			// Reset other Input fields (not Doc Type)
			[
				"idRefDocNumber",
				"idRefDocPartyCode",
				"idRefDocPartyName",
				"idRefDocSalesDoc",
				"idRefDocSalesDoctype",
				"idRefDocEwayBillNumber",
				"idRefDocEwayBillDate"
			].forEach(function (sId) {
				this.byId(sId)?.setValue("");
			}.bind(this));

			// Restore input interactivity defaults (we may lock these later for PO-prefill).
			var oDocNumberCtrl = this.byId("idRefDocNumber");
			if (oDocNumberCtrl) {
				oDocNumberCtrl.setEnabled(true);
				if (typeof oDocNumberCtrl.setEditable === "function") {
					oDocNumberCtrl.setEditable(true);
				}
				if (typeof oDocNumberCtrl.setShowValueHelp === "function") {
					oDocNumberCtrl.setShowValueHelp(false);
				}
				if (typeof oDocNumberCtrl.setShowSuggestion === "function") {
					oDocNumberCtrl.setShowSuggestion(true);
				}
			}

			[
				"idRefDocDate"
			].forEach(function (sId) {
				var oControl = this.byId(sId);
				oControl?.setValue("");
			}.bind(this));

			var oSugg = this._getRefDocSuggestionModel();
			if (oSugg) {
				oSugg.setProperty("/items", []);
			}

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
			var oDocNumberCtrl = this.byId("idRefDocNumber");
			if (oDocNumberCtrl && oDocNumberCtrl.isA && oDocNumberCtrl.isA("sap.m.ComboBox")) {
				oDocNumberCtrl.setSelectedKey(oRefDoc.documentNumber || "");
			} else {
				oDocNumberCtrl?.setValue?.(oRefDoc.documentNumber || "");
			}
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
			this._beginDocNoBusy();
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
					that._updateRefDocSuggestions([]);
				})
				.finally(function () {
					that._endDocNoBusy();
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

			var sResolvedDocType = String(oDoc.DocType || oDoc.docType || this._sSelectedDocType || "").trim();
			var oDocTypeModel = this._getDocTypeModel();
			var aDocTypeItems = oDocTypeModel?.getProperty("/items") || [];
			var bHasDocType = (aDocTypeItems || []).some(function (oItem) {
				return String(oItem?.ConfigID || "").trim() === sResolvedDocType;
			});
			// If backend returns a DocType not present in filtered ConfigValues, add it so Select can bind it.
			if (sResolvedDocType && !bHasDocType) {
				aDocTypeItems = (aDocTypeItems || []).slice();
				aDocTypeItems.push({
					ConfigID: sResolvedDocType,
					Description: sResolvedDocType
				});
				oDocTypeModel.setProperty("/items", aDocTypeItems);
			}
			var oDocTypeSelect = this.byId("idRefDocType");
			if (oDocTypeSelect) {
				oDocTypeSelect.setSelectedKey(sResolvedDocType || "");
			}
			this._sSelectedDocType = sResolvedDocType || this._sSelectedDocType;
			var oDocNumberCtrl = this.byId("idRefDocNumber");
			if (oDocNumberCtrl && oDocNumberCtrl.isA && oDocNumberCtrl.isA("sap.m.ComboBox")) {
				oDocNumberCtrl.setSelectedKey(oDoc.DocumentNumber || oDoc.documentNumber || "");
			} else {
				oDocNumberCtrl?.setValue?.(oDoc.DocumentNumber || oDoc.documentNumber || "");
			}
			this.byId("idRefDocDate")?.setValue(this._formatODataDate(oDoc.DocumentDate));
			this.byId("idRefDocPartyCode")?.setValue(oDoc.Vendor || oDoc.Customer || "");
			this.byId("idRefDocPartyName")?.setValue(oDoc.Name || "");
			this.byId("idRefDocSalesDoc")?.setValue(oDoc.SalesDoc || "");
			this.byId("idRefDocSalesDoctype")?.setValue(oDoc.SalesDoctype || "");
		},

		_fetchOrderDetails: function (sDocType, mOpts) {
			return new Promise(function (resolve, reject) {
				var oService = this._getOrderDetailsService();
				var oGlobalModel = sap.ui.getCore().getModel("globalData");
				var sTripNumber = oGlobalModel?.getProperty("/TripNumber") || "";
				var bIncomingSkip = String(oGlobalModel?.getProperty("/IncomingRefDocSkip") || " ").trim() === "X";
				var bOutgoingSkip = String(oGlobalModel?.getProperty("/OutgoingRefDocSkip") || " ").trim() === "X";
				var sIncomingPo = (oGlobalModel?.getProperty("/IncomingPoNumber") || "").toString().trim();
				// Gate Out create-mode uses /OutgoingPoNumber, but the same ReferenceDocuments view/controller is reused.
				// So we fall back to OutgoingPoNumber if IncomingPoNumber is missing.
				if (!sIncomingPo) {
					sIncomingPo = (oGlobalModel?.getProperty("/OutgoingPoNumber") || "").toString().trim();
				}
				// For Invoice/Challan create-mode, scope by selected billing document as well.
				if (!sIncomingPo) {
					sIncomingPo = (oGlobalModel?.getProperty("/OutgoingBillingDocument") || "").toString().trim();
				}

				var m = mOpts || {};
				var sSearchTerm = (m.searchTerm || "").toString().trim();
				var iTop = Number(m.top);
				var iSkip = Number(m.skip);

				var aFilters = [];
				if (sTripNumber) {
					aFilters.push(new Filter("TripNumber", FilterOperator.EQ, sTripNumber));
				}
				if (sDocType) {
					aFilters.push(new Filter("DocType", FilterOperator.EQ, sDocType));
				}
				if (sSearchTerm) {
					// Backend-side filtering for typed searches (Document Number only).
					// UI5 Contains maps to OData substringof('<term>', DocumentNumber).
					aFilters.push(new Filter("DocumentNumber", FilterOperator.Contains, sSearchTerm));
				}

				// Gate entry / create mode: TripNumber isn't available yet.
				// Scope by preselected document only for initial load.
				// While user types in Document Number search, do NOT force PO filter,
				// so they can search/select another document.
				if (!sTripNumber && sIncomingPo && !bIncomingSkip && !bOutgoingSkip && !sSearchTerm) {
					// Create-mode PO prefill: use Contains to tolerate backend formatting
					// differences (e.g. leading zeros in stored document number).
					aFilters.push(new Filter("DocumentNumber", FilterOperator.Contains, sIncomingPo));
				}

				var mReadParams = {
					filters: aFilters,
					success: function (oData) {
						resolve(oData.results || []);
					},
					error: function (oError) {
						reject(oError);
					}
				};
				var oUrlParams = {};
				if (!Number.isNaN(iTop) && iTop > 0) {
					oUrlParams.$top = String(iTop);
				}
				if (!Number.isNaN(iSkip) && iSkip >= 0) {
					oUrlParams.$skip = String(iSkip);
				}
				if (Object.keys(oUrlParams).length) {
					mReadParams.urlParameters = oUrlParams;
				}
				oService.read("/OrderDetails", mReadParams);
			}.bind(this));
		},

		_fetchOrderDetailsPaged: function (sDocType, mOpts) {
			var m = mOpts || {};
			var iPageSize = Number(m.pageSize || 500);
			var iMax =
				m.max === undefined || m.max === null || String(m.max).trim() === ""
					? Infinity
					: Number(m.max);
			var sSearchTerm = (m.searchTerm || "").toString().trim();

			// For typed suggestions we intentionally keep results small (handled elsewhere).
			if (sSearchTerm) {
				return this._fetchOrderDetails(sDocType, { searchTerm: sSearchTerm, top: m.top || 50, skip: 0 });
			}

			var that = this;
			var aAll = [];
			var iSkip = 0;
			var iPageGuard = 0;
			var sPrevSig = null;

			function pageSignature(aPage) {
				if (!aPage || aPage.length === 0) {
					return "empty";
				}
				var oFirst = aPage[0] || {};
				var oLast = aPage[aPage.length - 1] || {};

				// Prefer stable business keys if present
				var k1 = (oFirst.DocumentNumber ?? oFirst.DocNo ?? oFirst.BillingDoc ?? oFirst.Vbeln ?? oFirst.Id ?? "") + "";
				var k2 = (oLast.DocumentNumber ?? oLast.DocNo ?? oLast.BillingDoc ?? oLast.Vbeln ?? oLast.Id ?? "") + "";

				// Fallback to a small JSON sample (avoid huge stringify)
				if (!k1 && !k2) {
					try {
						k1 = JSON.stringify(oFirst).slice(0, 200);
						k2 = JSON.stringify(oLast).slice(0, 200);
					} catch (e) {
						k1 = String(aPage.length);
						k2 = String(aPage.length);
					}
				}
				return k1 + "…" + k2 + "@" + String(aPage.length);
			}

			function next() {
				iPageGuard += 1;
				if (iPageGuard > 10000) {
					return Promise.resolve(aAll);
				}

				var iRemaining = iMax - aAll.length;
				if (iRemaining <= 0) {
					return Promise.resolve(aAll);
				}

				var iTop = iMax === Infinity ? iPageSize : Math.min(iPageSize, iRemaining);
				return that._fetchOrderDetails(sDocType, { top: iTop, skip: iSkip })
					.then(function (aPage) {
						var a = aPage || [];
						var sSig = pageSignature(a);
						if (sPrevSig !== null && sSig === sPrevSig) {
							// Backend likely ignored $skip and repeated same page
							return aAll;
						}
						sPrevSig = sSig;

						aAll = aAll.concat(a);
						var iPrevSkip = iSkip;
						iSkip += a.length;

						// Safety: avoid infinite loops if service keeps returning same page
						if (a.length === 0 || iSkip === iPrevSkip) {
							return aAll;
						}

						// Stop if server returned less than requested (no more pages)
						if (a.length < iTop) {
							return aAll;
						}
						return next();
					});
			}

			return next();
		},

		_getOrderDetailsService: function () {
			if (!this._oOrderDetailsService) {
				this._oOrderDetailsService = new ODataModel("/sap/opu/odata/sap/YIGP_PLMS_SRV/", {
					useBatch: false
				});
			}
			return this._oOrderDetailsService;
		},

		_getDocNoBusyTarget: function () {
			// Prefer the active dialog; fallback to view
			return this.byId("idAddRefDocDialog") || this._oRefDocValueHelp || this.getView();
		},

		_beginDocNoBusy: function () {
			this._iDocNoBusyCount = (this._iDocNoBusyCount || 0) + 1;
			var oTarget = this._getDocNoBusyTarget();
			if (oTarget && oTarget.setBusy) {
				oTarget.setBusy(true);
				oTarget.setBusyIndicatorDelay?.(0);
			}
		},

		_endDocNoBusy: function () {
			this._iDocNoBusyCount = Math.max((this._iDocNoBusyCount || 1) - 1, 0);
			if (this._iDocNoBusyCount > 0) {
				return;
			}
			var oTarget = this._getDocNoBusyTarget();
			if (oTarget && oTarget.setBusy) {
				oTarget.setBusy(false);
			}
		},

		_getMaterialsBusyTarget: function () {
			// Prefer materials selection dialog; fallback to the materials table
			return this.byId("idSelectMaterialsDialog") || this.byId("idMaterialsSelectionTable") || this.getView();
		},

		_beginMaterialsBusy: function () {
			this._iMaterialsBusyCount = (this._iMaterialsBusyCount || 0) + 1;
			var oTarget = this._getMaterialsBusyTarget();
			if (oTarget && oTarget.setBusy) {
				oTarget.setBusy(true);
				oTarget.setBusyIndicatorDelay?.(0);
			}
		},

		_endMaterialsBusy: function () {
			this._iMaterialsBusyCount = Math.max((this._iMaterialsBusyCount || 1) - 1, 0);
			if (this._iMaterialsBusyCount > 0) {
				return;
			}
			var oTarget = this._getMaterialsBusyTarget();
			if (oTarget && oTarget.setBusy) {
				oTarget.setBusy(false);
			}
		},


		_escapeODataValue: function (vValue) {
			if (vValue === null || vValue === undefined) {
				return "";
			}
			return String(vValue).replace(/'/g, "''");
		},

		// ============================================================
		// Helper Functions for HTTP Operations
		// ============================================================
		_extractErrorMessage: function (oError) {
			if (!oError) return "Something went wrong";

			var fnPickFromPayload = function (oPayload) {
				var sDetail = oPayload?.error?.innererror?.errordetails?.[0]?.message;
				if (sDetail) return sDetail;

				var sMsgValue = oPayload?.error?.message?.value;
				if (sMsgValue) return sMsgValue;

				var sMsg = oPayload?.error?.message;
				if (typeof sMsg === "string" && sMsg) return sMsg;

				return "";
			};

			if (oError.responseText) {
				try {
					var oParsed = JSON.parse(oError.responseText);
					var sParsedMsg = fnPickFromPayload(oParsed);
					if (sParsedMsg) return sParsedMsg;
				} catch (e) {
					// ignore parse errors
				}
			}

			if (oError.responseJSON) {
				var sJsonMsg = fnPickFromPayload(oError.responseJSON);
				if (sJsonMsg) return sJsonMsg;
			}

			if (typeof oError.message === "string" && oError.message) {
				return oError.message;
			}
			if (oError.message?.value) {
				return oError.message.value;
			}

			return "Something went wrong";
		},


		_getRefDocSuggestionModel: function () {
			if (!this._oRefDocSuggestionsModel) {
				this._oRefDocSuggestionsModel = new JSONModel({ items: [] });
				// Allow large dropdown lists (UI5 JSONModel default is small)
				this._oRefDocSuggestionsModel.setSizeLimit(1000000);
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
				return Promise.resolve([]);
			}
			this._sSelectedDocType = sDocType;
			this._resetDocNoPaging(sDocType, "");
			this._beginDocNoBusy();
			// Load first page for dropdown list; remaining pages load on scroll via ComboBox list growing.
			// Note: live suggestions while typing stay limited via onRefDocNumberSuggest (top 50).
			var iTop = Number(this._mDocNoPaging?.pageSize || 50);
			return this._fetchOrderDetails(sDocType, { top: iTop, skip: 0 })
				.then(function (aDocs) {
					this._updateRefDocSuggestions(aDocs);
					// If backend returns less than page size, there are no more pages.
					if (!aDocs || aDocs.length < iTop) {
						this._mDocNoPaging.done = true;
					}
				}.bind(this))
				.catch(function () {
					this._updateRefDocSuggestions([]);
					return [];
				}.bind(this))
				.finally(function () {
					this._endDocNoBusy();
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
			var oM = this._getRefDocSuggestionModel();
			// Ensure binding is not truncated by sizeLimit
			try {
				oM.setSizeLimit(Math.max(oM.getSizeLimit?.() || 0, (aDocs || []).length, 1000));
			} catch (e) {
				// ignore
			}
			oM.setProperty("/items", aDocs || []);
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
						that._oEventBus?.publish("RefDoc", "MaterialsUpdated");
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
					that._oEventBus?.publish("RefDoc", "MaterialsUpdated");
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
			var oSelected = this._oSelectedOrderDetail;

			var oGlobalModel = sap.ui.getCore().getModel("globalData");
			var sTripNumber = String(oGlobalModel?.getProperty("/TripNumber") || "").trim();
			if (!sTripNumber) {
				return null;
			}

			var oDocTypeSelect = this.byId("idRefDocType");
			var oDocNumberCtrl = this.byId("idRefDocNumber");
			var sDocTypeUi = String(
				this._sSelectedDocType ||
				oDocTypeSelect?.getSelectedItem?.()?.getKey?.() ||
				oDocTypeSelect?.getSelectedKey?.() ||
				oDocTypeSelect?.getValue?.() ||
				""
			).trim();
			var sDocNoUi = String(
				(oDocNumberCtrl && oDocNumberCtrl.isA && oDocNumberCtrl.isA("sap.m.ComboBox"))
					? (oDocNumberCtrl.getSelectedKey() || oDocNumberCtrl.getValue() || "")
					: (oDocNumberCtrl?.getValue?.() || "")
			).trim();
			if (!sDocTypeUi || !sDocNoUi) {
				return null;
			}

			var sEwayBillNumber = this.byId("idRefDocEwayBillNumber")?.getValue().trim() || "";
			var sEwayBillDate = this.byId("idRefDocEwayBillDate")?.getValue();
			var oDocDatePicker = this.byId("idRefDocDate");
			var sDocDate = oDocDatePicker?.getValue?.() || "";
			var oDocDate = this._toEdmDateTime(oDocDatePicker?.getDateValue?.() || sDocDate || null);
			var sPartyCode = this.byId("idRefDocPartyCode")?.getValue?.() || "";
			var sPartyName = this.byId("idRefDocPartyName")?.getValue?.() || "";
			var sSalesDoc = this.byId("idRefDocSalesDoc")?.getValue?.() || "";
			var sSalesDoctype = this.byId("idRefDocSalesDoctype")?.getValue?.() || "";

			var oPayload = {
				TripNumber: sTripNumber,
				DocType: String(oSelected?.DocType || sDocTypeUi || "").trim(),
				DocumentNumber: String(oSelected?.DocumentNumber || sDocNoUi || "").trim(),
				DocumentDate: this._toEdmDateTime(oSelected?.DocumentDate || oDocDate || null),
				Vendor: String(oSelected?.Vendor || sPartyCode || "").trim(),
				Customer: String(oSelected?.Customer || "").trim(),
				Name: String(oSelected?.Name || sPartyName || "").trim(),
				// Backend fields: EwayBill (string) and EwaybillDate (string)
				EwayBill: sEwayBillNumber,
				EwaybillDate: sEwayBillDate || "",
				SalesDoc: String(oSelected?.SalesDoc || sSalesDoc || "").trim(),
				SalesDoctype: String(oSelected?.SalesDoctype || sSalesDoctype || "").trim(),
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
						// Keep suggestions fresh from backend (source of truth).
						var sDocTypeRaw = String(oRefDoc?.DocType || oRefDoc?.docType || that._sSelectedDocType || "").trim();
						if (sDocTypeRaw) {
							that._loadRefDocSuggestions(sDocTypeRaw);
						} else {
							that._getRefDocSuggestionModel()?.setProperty("/items", []);
						}
						
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
			var oDocNumberCtrl = this.byId("idRefDocNumber");
			var sDialogDocNumber = (oDocNumberCtrl && oDocNumberCtrl.isA && oDocNumberCtrl.isA("sap.m.ComboBox"))
				? (oDocNumberCtrl.getSelectedKey() || "")
				: (oDocNumberCtrl?.getValue?.() || "");
			var sDialogPartyCode = this.byId("idRefDocPartyCode")?.getValue() || "";
			var sDialogPartyName = this.byId("idRefDocPartyName")?.getValue() || "";
			var sDialogDate = this.byId("idRefDocDate")?.getValue() || "";
			var sDialogSalesDoc = this.byId("idRefDocSalesDoc")?.getValue() || "";
			var sDialogSalesDoctype = this.byId("idRefDocSalesDoctype")?.getValue() || "";
			var sDocType = String(oPayload.DocType || sDialogDocType || "").trim();
			var sDocumentNumber = String(oPayload.DocumentNumber || sDialogDocNumber || "").trim();

			var bExists = aRefDocs.some(function (oDoc) {
				return String(oDoc.docType || oDoc.DocType || "").trim() === sDocType &&
					String(oDoc.documentNumber || oDoc.DocumentNumber || "").trim() === sDocumentNumber;
			});

			if (bExists) {
				return;
			}

			aRefDocs.push({
				tripNumber: oPayload.TripNumber || "",
				docType: sDocType,
				documentNumber: sDocumentNumber,
				documentDate: this._formatODataDate(oPayload.DocumentDate) || sDialogDate,
				partyCode: oPayload.Vendor || oPayload.Customer || sDialogPartyCode,
				partyName: oPayload.Name || sDialogPartyName,
				salesDoc: oPayload.SalesDoc || sDialogSalesDoc || "",
				salesDoctype: oPayload.SalesDoctype || sDialogSalesDoctype || "",
				_isLocal: true
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

			// Build OData key the same way as _updateMaterialDetail: row keys first, then fallbacks.
			// Preferring global TripNumber here caused key mismatches and "Invalid Key Predicate".
			var oGlobalModel = sap.ui.getCore().getModel("globalData");
			var sCurrentTripNumber = oGlobalModel?.getProperty("/TripNumber") || "";

			var sDocType = this._escapeODataValue(oMaterial.docType || oMaterial.DocType || "");
			var sTripNumber = this._escapeODataValue(
				oMaterial.tripNumber || oMaterial.TripNumber || sCurrentTripNumber || ""
			);
			var sRefDocNo = this._escapeODataValue(oMaterial.refDocNo || oMaterial.RefDocNo || "");
			var sRefDocItemNo = this._escapeODataValue(oMaterial.refDocItemNo || oMaterial.RefDocItemNo || "");

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
						// Notify dependent tabs (Gate In / Gate Out) to reload Bin/Trolley data.
						that._oEventBus?.publish("RefDoc", "MaterialsUpdated");
						
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

			// Set TripData model on view if not already set (for binding)
			if (oTripData && !this.getView().getModel("TripData")) {
				this.getView().setModel(oTripData, "TripData");
			}

			if (!oTripData) {
				oGlobalModel.setProperty("/DisableRefDocMaterialsActions", false);
				oModel.setProperty("/referenceDocs", []);
				oModel.setProperty("/materialDetails", []);
				oModel.setProperty("/filteredMaterialDetails", []);
				return;
			}

			// Scanner-first ASN scenarios: keep Add/Edit/Delete ref docs and manual material actions hidden after reporting
			var sItemKey = oTripData.getProperty("/MovementScenarioItemKey") || "";
			if (!sItemKey) {
				sItemKey = MovementScenarioIcons.getMovementScenarioItemKey(
					oTripData.getProperty("/MovementType") || "",
					oTripData.getProperty("/MovementScenario")
				);
			}
			var bScannerScenario = MovementScenarioIcons.isScannerMovementScenarioItemKey(sItemKey);
			oGlobalModel.setProperty("/DisableRefDocMaterialsActions", !!bScannerScenario);
			
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
					return oDoc.Deleted !== true && oDoc.Deleted !== "X";
				})
				.map(function (oDoc) {
					return {
						// Store both original service values (uppercase) and local model values (lowercase)
						// This ensures we can use the correct values for OData operations
						TripNumber: oDoc.TripNumber || "",
						DocType: oDoc.DocType || "",
						DocumentNumber: oDoc.DocumentNumber || "",
						InvRefNo: oDoc.InvRefNo || "",
						InvRefDate: oDoc.InvRefDate || "",
						MovementType: oDoc.MovementType || "",
						tripNumber: oDoc.TripNumber || "",
						docType: oDoc.DocType || "",
						documentNumber: oDoc.DocumentNumber || "",
						invRefNo: oDoc.InvRefNo || "",
						invRefDate: this._formatODataDate(oDoc.InvRefDate),
						movementType: oDoc.MovementType || "",
						documentDate: this._formatODataDate(oDoc.DocumentDate),
						partyCode: oDoc.Vendor || oDoc.Customer || "",
						partyName: oDoc.Name || "",
						salesDoc: oDoc.SalesDoc || "",
						salesDoctype: oDoc.SalesDoctype || "",
						// New E-way bill fields (populated only when backend provides them)
						// Backend fields (metadata): EwayBill (string), EwaybillDate (string)
						ewayBillNumber: oDoc.EwayBill || "",
						ewayBillDate: this._blankIfInvalidDate(this._formatODataDate(oDoc.EwaybillDate)),
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
						var vCases = oItem.Cases;
						var sCasesDisplay = (vCases === null || vCases === undefined || vCases === "") ? "" : String(vCases);
						
						return {
							tripNumber: oItem.TripNumber || "",
							docType: oItem.DocType || "",
							refDocNo: oItem.RefDocNo || "",
							refDocItemNo: oItem.RefDocItemNo || "",
							movementType: oItem.MovementType || "",
							materialCode: oItem.MaterialCode || "",
							materialDescription: oItem.MaterialDescription || "",
							qty: sQtyDisplay,
							// Backend ItemDetails "Cases" shown as "Bins (Trolleys)" in UI
							binsTrolleys: sCasesDisplay,
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
					var vCases = oItem.Cases;
					var sCasesDisplay = (vCases === null || vCases === undefined || vCases === "") ? "" : String(vCases);
					return {
						// Store both original service values (uppercase) and local model values (lowercase)
						// This ensures we can use the correct values for OData operations
						TripNumber: oItem.TripNumber || "",
						DocType: oItem.DocType || "",
						RefDocNo: oItem.RefDocNo || "",
						RefDocItemNo: oItem.RefDocItemNo || "",
						MovementType: oItem.MovementType || "",
						Cases: sCasesDisplay,
						tripNumber: oItem.TripNumber || "",
						docType: oItem.DocType || "",
						refDocNo: oItem.RefDocNo || "",
						refDocItemNo: oItem.RefDocItemNo || "",
						movementType: oItem.MovementType || "",
						materialCode: oItem.MaterialCode || "",
						materialDescription: oItem.MaterialDescription || "",
						qty: (oItem.Quantity === null || oItem.Quantity === undefined) ? "" : String(oItem.Quantity),
						// Backend ItemDetails "Cases" shown as "Bins (Trolleys)" in UI
						binsTrolleys: sCasesDisplay,
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

		_refreshBothTables: function (mOptions) {
			var bForceBackend = !!(mOptions && mOptions.forceBackend);
			// Try to use TripData first (from $expand) to avoid separate calls
			var oTripData = sap.ui.getCore().getModel("TripData");
			if (!bForceBackend && oTripData) {
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

		_toEdmDateTime: function (vDate) {
			if (!vDate) {
				return null;
			}

			if (vDate instanceof Date) {
				return isNaN(vDate.getTime()) ? null : vDate;
			}

			if (typeof vDate === "string") {
				var sDate = vDate.trim();
				if (!sDate) {
					return null;
				}

				// Support OData v2 JSON date literal, e.g. /Date(1622399400000)/
				var aODataTicks = sDate.match(/\/Date\((-?\d+)(?:[+-]\d+)?\)\//);
				if (aODataTicks && aODataTicks[1]) {
					var iTicks = parseInt(aODataTicks[1], 10);
					if (!isNaN(iTicks)) {
						var oFromTicks = new Date(iTicks);
						return isNaN(oFromTicks.getTime()) ? null : oFromTicks;
					}
				}

				if (/^\d{4}-\d{2}-\d{2}$/.test(sDate)) {
					var oParsedDate = new Date(sDate + "T00:00:00");
					return isNaN(oParsedDate.getTime()) ? null : oParsedDate;
				}

				var oDate = new Date(sDate);
				return isNaN(oDate.getTime()) ? null : oDate;
			}

			return null;
		},

		_blankIfInvalidDate: function (vDate) {
			if (vDate === null || vDate === undefined) {
				return "";
			}

			var s = String(vDate).trim();
			if (!s) {
				return "";
			}

			// Common backend "empty date" placeholders
			if (s === "0000-00-00" || s === "00000000" || s.indexOf("0000-00-00") === 0) {
				return "";
			}

			return s;
		},

		// Formatter for XML bindings
		formatEwayBillDate: function (vDate) {
			return this._blankIfInvalidDate(this._formatODataDate(vDate));
		},

		/**
		 * Invoice reference fields apply to Inward flows only (MovementType = "I").
		 * @param {string} sMovementType TripData MovementType (I/O per OData)
		 * @returns {boolean}
		 */
		formatInvRefColumnsVisible: function (sMovementType) {
			if (sMovementType === undefined || sMovementType === null || sMovementType === "") {
				return false;
			}
			return String(sMovementType).trim().toUpperCase() === "I";
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

			// Create models for column settings
			this._oRefDocColumnSettingsModel = new JSONModel({
				columns: aRefDocColumns
			});
			this.getView().setModel(this._oRefDocColumnSettingsModel, "refDocColumnSettings");

			// Apply initial column visibility
			this._applyRefDocColumnVisibility();
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

		onRefDocColumnSwitchChanged: function (oEvent) {
			var oSwitch = oEvent.getSource();
			var oBindingContext = oSwitch.getBindingContext("refDocColumnSettings");
			if (oBindingContext) {
				var oColumn = oBindingContext.getObject();
				oColumn.visible = oSwitch.getState();
				this._applyRefDocColumnVisibility();
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

		onCloseRefDocColumnVisibilityDialog: function () {
			if (this._oRefDocColumnVisibilityDialog) {
				this._oRefDocColumnVisibilityDialog.then(function (oDialog) {
					oDialog.close();
				});
			}
		}

	});
});

