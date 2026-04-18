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
		this._bRefDocInitialPrefillDone = false;
		this._mRefDocUiGuard = {};
		this._mMaterialUiGuard = {};
		// Apply any view-related initialization after render using delegates if needed
	},

		_setUiGuard: function (mGuard, sKey, sType, iDurationMs) {
			if (!mGuard || !sKey) {
				return;
			}
			mGuard[sKey] = {
				type: sType || "upsert",
				until: Date.now() + (iDurationMs || 5000)
			};
		},

		_getUiGuard: function (mGuard, sKey) {
			if (!mGuard || !sKey) {
				return null;
			}
			var oGuard = mGuard[sKey];
			if (!oGuard) {
				return null;
			}
			if (Date.now() > oGuard.until) {
				delete mGuard[sKey];
				return null;
			}
			return oGuard;
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

		_isScannerScenarioActive: function () {
			var oTripData = this.getView().getModel("TripData") || sap.ui.getCore().getModel("TripData");
			if (!oTripData) {
				return false;
			}
			var sItemKey = oTripData.getProperty("/MovementScenarioItemKey") || "";
			if (!sItemKey) {
				sItemKey = MovementScenarioIcons.getMovementScenarioItemKey(
					oTripData.getProperty("/MovementType") || "",
					oTripData.getProperty("/MovementScenario")
				);
			}
			return MovementScenarioIcons.isScannerMovementScenarioItemKey(sItemKey);
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
					// Keep both keys reset for compatibility, while the table binds to `referenceDocs`.
					referenceDocs: [],
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
			this._bRefDocInitialPrefillDone = false;
			
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
				}
			} else {
				this._oSelectedRefDoc = null;
			}
			this._filterMaterialDetails();
		},

		_filterMaterialDetails: function () {
			var oModel = this._ensureRefDocModel();
			var aAllMaterials = oModel.getProperty("/materialDetails") || [];
			// Use a fresh array reference so table bindings fully re-render rows.
			oModel.setProperty("/filteredMaterialDetails", aAllMaterials.slice());
		},

		_normalizeKey: function (vValue) {
			return String(vValue || "").trim().toUpperCase();
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
			this.byId("idRefDocInvRefDate")?.setValue("");
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
				new Filter("MaterialCode", FilterOperator.Contains, sQuery),
				new Filter("MaterialDescription", FilterOperator.Contains, sQuery),
				new Filter("Quantity", FilterOperator.Contains, sQuery),
				new Filter("BalanceQty", FilterOperator.Contains, sQuery),
				new Filter("ShippingQty", FilterOperator.Contains, sQuery),
				new Filter("RemainQty", FilterOperator.Contains, sQuery),
				new Filter("UoM", FilterOperator.Contains, sQuery)
			], false);

			oBinding.filter([oSearchFilter]);
		},
		onSelectMaterialShippingQtyLiveChange: function (oEvent) {
			var oInput = oEvent.getSource();
			var oCtx = oInput && oInput.getBindingContext("materialsSelectionModel");
			var oModel = oCtx && oCtx.getModel();
			if (!oCtx || !oModel) {
				return;
			}

			var sRowPath = oCtx.getPath();
			var oRow = oModel.getProperty(sRowPath) || {};
			var fBalance = this._materialBalanceBaseForRemain(oRow);

			var sShippingRaw = String((oEvent.getParameter("value") || "")).trim();
			var fShipping = parseFloat(sShippingRaw);
			if (!isFinite(fShipping) || fShipping < 0) {
				fShipping = 0;
			}
			if (fShipping > fBalance) {
				fShipping = fBalance;
			}

			var fRemain = fBalance - fShipping;
			if (!isFinite(fRemain) || fRemain < 0) {
				fRemain = 0;
			}

			var sFormattedShipping = (fShipping % 1 === 0) ? String(Math.floor(fShipping)) : fShipping.toFixed(2);
			var sFormattedRemain = (fRemain % 1 === 0) ? String(Math.floor(fRemain)) : fRemain.toFixed(2);

			oModel.setProperty(sRowPath + "/ShippingQty", sFormattedShipping);
			oModel.setProperty(sRowPath + "/RemainQty", sFormattedRemain);
		},

		onMaterialQtyOrBalanceDispatchChange: function () {
			this.onMaterialBalanceOrDispatchQtyChange();
		},

		onMaterialBalanceOrDispatchQtyChange: function () {
			var sBal = (this.byId("idMaterialBalanceQty")?.getValue() || "").trim();
			var sShip = (this.byId("idMaterialDispatchQty")?.getValue() || "").trim();
			var fBalance = 0;
			if (sBal) {
				var fB = parseFloat(sBal);
				if (!isNaN(fB) && isFinite(fB) && fB >= 0) {
					fBalance = fB;
				}
			} else {
				var sQty = (this.byId("idMaterialQty")?.getValue() || "").trim();
				if (sQty) {
					var fQ = parseFloat(sQty);
					if (!isNaN(fQ) && isFinite(fQ) && fQ >= 0) {
						fBalance = fQ;
					}
				}
			}
			var fShipping = 0;
			if (sShip) {
				var fS = parseFloat(sShip);
				if (!isNaN(fS) && isFinite(fS) && fS >= 0) {
					fShipping = fS;
				}
			}
			if (fShipping > fBalance) {
				fShipping = fBalance;
				var sCap = (fShipping % 1 === 0) ? String(Math.floor(fShipping)) : fShipping.toFixed(2);
				this.byId("idMaterialDispatchQty")?.setValue(sCap);
			}
			var fRemain = fBalance - fShipping;
			if (!isFinite(fRemain) || fRemain < 0) {
				fRemain = 0;
			}
			var sRem = (fRemain % 1 === 0) ? String(Math.floor(fRemain)) : fRemain.toFixed(2);
			this.byId("idMaterialRemainQty")?.setValue(sRem);
		},

		onCloseSelectMaterialsDialog: function () {
			if (this._oSelectMaterialsDialog) {
				this._oSelectMaterialsDialog.close();
			}
		},

		onSaveRefDocDialog: function (oEvent) {
			// Keep add/update action local to the dialog and avoid bubbling
			// into parent controls (which can trigger tab/navigation side effects).
			if (oEvent) {
				oEvent.preventDefault?.();
				oEvent.cancelBubble?.();
			}
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

			if (!this._bIsRefDocEditMode && this._hasLocalReferenceDoc(sTripNumber, sDocTypeUi, sDocNoUi)) {
				return MessageToast.show("Reference document already exists");
			}

			var oPayload = this._buildOrderDetailPayload();
			if (!oPayload) {
				return MessageBox.error("Unable to build reference document payload.");
			}

			if (this._bIsRefDocEditMode && this._oEditingRefDoc) {
				// Update existing reference document
				var oOriginalRefDoc = Object.assign({}, this._oEditingRefDoc);
				var oEditGuardSource = Object.assign({}, oOriginalRefDoc, {
					tripNumber: String(oOriginalRefDoc.tripNumber || oOriginalRefDoc.TripNumber || oPayload.TripNumber || "").trim(),
					docType: String(oOriginalRefDoc.docType || oOriginalRefDoc.DocType || oPayload.DocType || "").trim(),
					documentNumber: String(oOriginalRefDoc.documentNumber || oOriginalRefDoc.DocumentNumber || oPayload.DocumentNumber || "").trim()
				});
				var sOptimisticRefEditKey = this._getRefDocGuardKey(oEditGuardSource);
				this._setUiGuard(this._mRefDocUiGuard, sOptimisticRefEditKey, "upsert");
				// Immediate UI update
				this._updateLocalReferenceDoc(oPayload, oOriginalRefDoc);
				return this._updateOrderDetail(oPayload, this._oEditingRefDoc)
					.then(function (oResponse) {
						var oUpdatedRefDoc = oResponse || oPayload;
						this._updateLocalReferenceDoc(oUpdatedRefDoc, this._oEditingRefDoc);
						this._setUiGuard(this._mRefDocUiGuard, this._getRefDocGuardKey(oUpdatedRefDoc), "upsert");
						MessageToast.show("Reference document updated");
						this._loadRefDocSuggestions(this._sSelectedDocType || oPayload.DocType);
						this._loadMaterialDocTypesFromRefDocs();
						this._loadMaterialRefDocNumbersFromRefDocs();
						this._closeRefDocDialog();
						this._resetRefDocDialog();
					}.bind(this))
					.catch(function (oError) {
						// Roll back immediate UI update on backend failure.
						this._updateLocalReferenceDoc(oOriginalRefDoc, oPayload);
						var sMessage = this._extractErrorMessage(oError) || "Unable to save reference document";
						MessageBox.error(sMessage);
					}.bind(this));
			}

			// Create new reference document
			var oOptimisticRefDoc = {
				tripNumber: oPayload.TripNumber || "",
				docType: oPayload.DocType || "",
				documentNumber: oPayload.DocumentNumber || ""
			};
			var sOptimisticRefDocKey = this._getRefDocGuardKey(oOptimisticRefDoc);
			this._setUiGuard(this._mRefDocUiGuard, sOptimisticRefDocKey, "upsert");
			// Optimistically update UI so users see the row immediately.
			this._appendLocalReferenceDoc(oPayload);
			return this._saveOrderDetail(oPayload)
				.then(function (oResponse) {
					var oSavedRefDoc = oResponse || oPayload;
					// Replace optimistic row with backend-confirmed payload fields.
					this._updateLocalReferenceDoc(oSavedRefDoc, oOptimisticRefDoc);
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
					// Roll back optimistic row when backend create fails.
					this._removeLocalReferenceDoc(oOptimisticRefDoc);
					delete this._mRefDocUiGuard[sOptimisticRefDocKey];
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
						var oModel = this._ensureRefDocModel();
						var aRefDocsSnapshot = (oModel.getProperty("/referenceDocs") || []).slice();
						var aMaterialsSnapshot = (oModel.getProperty("/materialDetails") || []).slice();
						var oGlobalModelDel = sap.ui.getCore().getModel("globalData");
						var sGlobalTripDel = String((oGlobalModelDel && oGlobalModelDel.getProperty("/TripNumber")) || "").trim();
						var sRowTripDel = this._materialRowFieldStr(oRefDoc, "tripNumber", "TripNumber");
						var oTripOvDel = !sRowTripDel && sGlobalTripDel ? { tripNumber: sGlobalTripDel } : undefined;
						var sRefDeleteKey = this._getRefDocGuardKey(oRefDoc, oTripOvDel);
						this._setUiGuard(this._mRefDocUiGuard, sRefDeleteKey, "delete");
						// Immediate UI delete
						this._removeLocalReferenceDoc(oRefDoc);
						this._deleteOrderDetail(oRefDoc).catch(function () {
							// Roll back immediate UI delete on backend failure.
							oModel.setProperty("/referenceDocs", aRefDocsSnapshot, true);
							oModel.setProperty("/materialDetails", aMaterialsSnapshot, true);
							this._filterMaterialDetails();
							this._loadMaterialDocTypesFromRefDocs();
							this._loadMaterialRefDocNumbersFromRefDocs();
						}.bind(this));
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
			console.log("[MaterialDebug] onMaterialRefDocNoChange", {
				docType: sDocType,
				refDocNo: sRefDocNo
			});

			// Load available material items for the selected reference document
			if (sDocType && sRefDocNo) {
				this._loadMaterialItemsForRefDoc(sDocType, sRefDocNo);
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

		onSaveMaterialDialog: function (oEvent) {
			// Keep add/update action local to the dialog and avoid bubbling
			// into parent controls (which can trigger tab/navigation side effects).
			if (oEvent) {
				oEvent.preventDefault?.();
				oEvent.cancelBubble?.();
			}
			if (this._bSavingMaterialDialog) {
				console.warn("[MaterialDebug] Save blocked: already in progress");
				return;
			}
			var oPayload = this._buildMaterialDetailPayload();
			console.log("[MaterialDebug] onSaveMaterialDialog payload", {
				tripNumber: oPayload.TripNumber,
				docType: oPayload.DocType,
				refDocNo: oPayload.RefDocNo,
				refDocItemNo: oPayload.RefDocItemNo,
				isEditMode: !!this._bIsEditMode
			});
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
			this._bSavingMaterialDialog = true;
			this.byId("idMaterialDialogSaveBtn")?.setEnabled(false);
			var fnReleaseMaterialSave = function () {
				this._bSavingMaterialDialog = false;
				this.byId("idMaterialDialogSaveBtn")?.setEnabled(true);
			}.bind(this);
			
			if (this._bIsEditMode && this._oEditingMaterial) {
				// Update existing material
				var oOriginalMaterial = Object.assign({}, this._oEditingMaterial);
				var sOptimisticMaterialEditKey = [
					String(oOriginalMaterial.tripNumber || oOriginalMaterial.TripNumber || oPayload.TripNumber || "").trim().toUpperCase(),
					String(oOriginalMaterial.docType || oOriginalMaterial.DocType || oPayload.DocType || "").trim().toUpperCase(),
					String(oOriginalMaterial.refDocNo || oOriginalMaterial.RefDocNo || oPayload.RefDocNo || "").trim().toUpperCase(),
					String(oOriginalMaterial.refDocItemNo || oOriginalMaterial.RefDocItemNo || oPayload.RefDocItemNo || "").trim().toUpperCase()
				].join("|");
				this._setUiGuard(this._mMaterialUiGuard, sOptimisticMaterialEditKey, "upsert");
				// Immediate UI update
				this._updateLocalMaterialDetail(oPayload, oOriginalMaterial);
				this._updateMaterialDetail(oPayload, this._oEditingMaterial)
					.then(function (oResponse) {
						var oUpdatedMaterial = oResponse || oPayload;
						this._updateLocalMaterialDetail(oUpdatedMaterial, this._oEditingMaterial);
						var sMaterialKey = [
							String(oUpdatedMaterial.TripNumber || oUpdatedMaterial.tripNumber || "").trim().toUpperCase(),
							String(oUpdatedMaterial.DocType || oUpdatedMaterial.docType || "").trim().toUpperCase(),
							String(oUpdatedMaterial.RefDocNo || oUpdatedMaterial.refDocNo || "").trim().toUpperCase(),
							String(oUpdatedMaterial.RefDocItemNo || oUpdatedMaterial.refDocItemNo || "").trim().toUpperCase()
						].join("|");
						this._setUiGuard(this._mMaterialUiGuard, sMaterialKey, "upsert");
						this._oEventBus?.publish("RefDoc", "MaterialsUpdated");
						MessageToast.show("Material row updated");
						this._closeMaterialDialog();
						this._resetMaterialDialog();
					}.bind(this))
					.catch(function (oError) {
						// Roll back immediate UI update on backend failure.
						this._updateLocalMaterialDetail(oOriginalMaterial, oPayload);
						var sMessage = this._extractErrorMessage(oError) || "Unable to update material row";
						MessageToast.show(sMessage);
					}.bind(this))
					.finally(fnReleaseMaterialSave);
			} else {
				// Create new material
				var oOptimisticMaterial = {
					tripNumber: oPayload.TripNumber || "",
					docType: oPayload.DocType || "",
					refDocNo: oPayload.RefDocNo || "",
					refDocItemNo: oPayload.RefDocItemNo || ""
				};
				var sOptimisticMaterialKey = [
					String(oOptimisticMaterial.tripNumber || "").trim().toUpperCase(),
					String(oOptimisticMaterial.docType || "").trim().toUpperCase(),
					String(oOptimisticMaterial.refDocNo || "").trim().toUpperCase(),
					String(oOptimisticMaterial.refDocItemNo || "").trim().toUpperCase()
				].join("|");
				this._setUiGuard(this._mMaterialUiGuard, sOptimisticMaterialKey, "upsert");
				// Optimistically update UI so users see the row immediately.
				this._appendLocalMaterialDetail(oPayload);
				this._saveMaterialDetail(oPayload)
					.then(function (oResponse) {
						console.log("[MaterialDebug] saveMaterialDetail success", {
							responseKey: [
								oResponse?.TripNumber || oPayload.TripNumber,
								oResponse?.DocType || oPayload.DocType,
								oResponse?.RefDocNo || oPayload.RefDocNo,
								oResponse?.RefDocItemNo || oPayload.RefDocItemNo
							].join("|")
						});
						// Replace optimistic row with backend-confirmed payload fields.
						this._updateLocalMaterialDetail(oResponse || oPayload, oOptimisticMaterial);
						this._oEventBus?.publish("RefDoc", "MaterialsUpdated");
						MessageToast.show("Material row added");
						this._closeMaterialDialog();
						this._resetMaterialDialog();
					}.bind(this))
					.catch(function (oError) {
						console.error("[MaterialDebug] saveMaterialDetail failed", oError);
						// Roll back optimistic row when backend create fails.
						this._removeLocalMaterialDetail(oOptimisticMaterial);
						delete this._mMaterialUiGuard[sOptimisticMaterialKey];
						var sMessage = this._extractErrorMessage(oError) || "Unable to save material row";
						MessageToast.show(sMessage);
					}.bind(this))
					.finally(fnReleaseMaterialSave);
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
						var oModel = this._ensureRefDocModel();
						var aMaterialsSnapshot = (oModel.getProperty("/materialDetails") || []).slice();
						var sMaterialDeleteKey = [
							this._materialRowFieldStr(oMaterial, "tripNumber", "TripNumber").toUpperCase(),
							this._materialRowFieldStr(oMaterial, "docType", "DocType").toUpperCase(),
							this._materialRowFieldStr(oMaterial, "refDocNo", "RefDocNo").toUpperCase(),
							this._materialRowFieldStr(oMaterial, "refDocItemNo", "RefDocItemNo").toUpperCase()
						].join("|");
						this._setUiGuard(this._mMaterialUiGuard, sMaterialDeleteKey, "delete");
						// Immediate UI delete
						this._removeLocalMaterialDetail(oMaterial);
						this._deleteMaterialDetail(oMaterial).catch(function () {
							// Roll back immediate UI delete on backend failure.
							oModel.setProperty("/materialDetails", aMaterialsSnapshot, true);
							this._filterMaterialDetails();
						}.bind(this));
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

		/** Trip / doc / item keys: do not use `||` so numeric 0 (e.g. line 0) is preserved. */
		_materialRowFieldStr: function (oRow, sLowerProp, sUpperProp) {
			if (!oRow) {
				return "";
			}
			var v = oRow[sLowerProp];
			if (v === undefined || v === null) {
				v = oRow[sUpperProp];
			}
			if (v === undefined || v === null) {
				return "";
			}
			return String(v).trim();
		},

		/**
		 * Base quantity for RemainQty = BalanceQty - ShippingQty. Uses BalanceQty when present; otherwise Quantity.
		 */
		_materialBalanceBaseForRemain: function (oRow) {
			if (!oRow) {
				return 0;
			}
			var vBal = oRow.BalanceQty;
			if (vBal === undefined || vBal === null) {
				vBal = oRow.balanceQty;
			}
			var fBal = parseFloat(vBal);
			if (isFinite(fBal) && fBal >= 0) {
				return fBal;
			}
			var vQty = oRow.Quantity;
			if (vQty === undefined || vQty === null) {
				vQty = oRow.quantity;
			}
			var fQty = parseFloat(vQty);
			return (isFinite(fQty) && fQty >= 0) ? fQty : 0;
		},

		/**
		 * Canonical ref-doc key for UI guards and _setReferenceDocsFromService merge (trip|docType|docNo), uppercased.
		 * @param {object} [oDoc] row or payload (camelCase and/or PascalCase)
		 * @param {object} [oOverrides] shallow-merged onto oDoc (e.g. tripNumber from globalData when the row has no trip)
		 */
		_getRefDocGuardKey: function (oDoc, oOverrides) {
			var o = oDoc;
			if (oDoc && oOverrides) {
				o = Object.assign({}, oDoc, oOverrides);
			} else if (!oDoc && oOverrides) {
				o = oOverrides;
			}
			if (!o) {
				return "";
			}
			var fnNormalize = function (vValue) {
				return String(vValue || "").trim().toUpperCase();
			};
			var fnGetVal = function (oObj, sPrimary, sFallback) {
				return (oObj && (oObj[sPrimary] || oObj[sFallback])) || "";
			};
			return [
				fnNormalize(fnGetVal(o, "tripNumber", "TripNumber")),
				fnNormalize(fnGetVal(o, "docType", "DocType")),
				fnNormalize(fnGetVal(o, "documentNumber", "DocumentNumber"))
			].join("|");
		},

		/**
		 * Skip merging an empty ItemDetails snapshot when orders still exist and multiple material
		 * rows are shown for the trip (avoids wiping the table on partial/stale payloads).
		 * Single-row / zero-row cases are not skipped so last-line delete can clear the UI.
		 */
		_shouldSkipEmptyMaterialSnapshot: function (aItemDetails, aOrderDetails, aMaterialRows, sTripTrim) {
			var aItems = aItemDetails || [];
			var aOrders = aOrderDetails || [];
			var aMat = aMaterialRows || [];
			var sTrip = String(sTripTrim || "").trim();
			if (aItems.length !== 0 || aOrders.length === 0 || aMat.length <= 1 || !sTrip) {
				return false;
			}
			var that = this;
			return aMat.some(function (m) {
				return that._materialRowFieldStr(m, "tripNumber", "TripNumber") === sTrip;
			});
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
			// Apply top-context PO prefill only for the first Add open.
			// On subsequent Add opens (after Add/Cancel), keep DocType but clear document fields.
			if (this._bRefDocInitialPrefillDone) {
				return;
			}

			var oPoPrefill = this._getPoRefDocPrefill();
			if (!oPoPrefill || !oPoPrefill.poNumber) {
				return;
			}
			this._bRefDocInitialPrefillDone = true;

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
					that._bSkipDefaultRefDocType = false;
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
							});
						setTimeout(function () {
							that._setDefaultRefDocTypeIfEmpty(aDocTypes);
						}, 0);
						resolve(that._oAddRefDocDialog);
					}
				}).catch(function (oError) {
					// Even if loading fails, still try to open dialog with existing model
					that._bSkipDefaultRefDocType = false;
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
			// Keep "Add Reference Document" aligned with Reporting Reference Document Type.
			// Always apply this on Add open so the dialog starts fresh and consistent.
			if (this._bIsRefDocEditMode) {
				return;
			}

			var oSelect = this.byId("idRefDocType");
			if (!oSelect) {
				return;
			}

			// Prefer the freshly loaded list; fallback to model data if not provided.
			var aItems = Array.isArray(aDocTypes) ? aDocTypes : (this._getDocTypeModel()?.getProperty("/items") || []);
			if (!Array.isArray(aItems) || aItems.length === 0) {
				return;
			}

			var oGlobalModel = sap.ui.getCore().getModel("globalData");
			var sTripNumber = String(oGlobalModel?.getProperty("/TripNumber") || "").trim();
			var sOutgoingRefKey = String(oGlobalModel?.getProperty("/OutgoingReferenceByKey") || "").trim().toUpperCase();
			var sReportingDocType = "";
			if (sTripNumber) {
				if (sOutgoingRefKey === "INVOICE" || sOutgoingRefKey === "CHALLAN") {
					sReportingDocType = String(oGlobalModel?.getProperty("/OutgoingBillingDocType") || "").trim();
				}
				if (!sReportingDocType) {
					sReportingDocType = String(oGlobalModel?.getProperty("/OutgoingRefDocDocType") || "").trim();
				}
			} else {
				sReportingDocType = String(oGlobalModel?.getProperty("/IncomingRefDocDocType") || "").trim();
			}

			var bExists = !!aItems.find(function (oItem) {
				return String(oItem?.ConfigID || "").trim() === sReportingDocType;
			});
			var sResolvedKey = bExists ? sReportingDocType : String(aItems[0]?.ConfigID || "").trim();
			if (!sResolvedKey) {
				return;
			}

			oSelect.setSelectedKey(sResolvedKey);
			this._sSelectedDocType = sResolvedKey;
			this._loadRefDocSuggestions(sResolvedKey);
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
					// Normalize with UI field names used in fragment bindings.
					var aSelectionItems = (aMaterials || []).map(function (oItem) {
						var vQty = (oItem.Quantity !== undefined && oItem.Quantity !== null) ? oItem.Quantity : 0;
						var vShippingQty = (oItem.ShippingQty !== undefined && oItem.ShippingQty !== null) ? oItem.ShippingQty :
							((oItem.DispatchQty !== undefined && oItem.DispatchQty !== null) ? oItem.DispatchQty : oItem.Quantity);
						var vRemainQty = oItem.RemainQty;
						var fQty = parseFloat(vQty);
						if (!isFinite(fQty) || fQty < 0) {
							fQty = 0;
						}
						var fBalance = that._materialBalanceBaseForRemain(oItem);
						var vBalRaw = oItem.BalanceQty;
						if (vBalRaw === undefined || vBalRaw === null || vBalRaw === "") {
							vBalRaw = oItem.balanceQty;
						}
						var fBalDisplay = parseFloat(vBalRaw);
						if (!isFinite(fBalDisplay) || fBalDisplay < 0) {
							fBalDisplay = fBalance;
						}
						var fShipping = parseFloat(vShippingQty);
						if (!isFinite(fShipping) || fShipping < 0) {
							fShipping = 0;
						}
						if (fShipping > fBalance) {
							fShipping = fBalance;
						}
						if (vRemainQty === null || vRemainQty === undefined || vRemainQty === "") {
							vRemainQty = fBalance - fShipping;
						}
						var fRemain = parseFloat(vRemainQty);
						if (!isFinite(fRemain) || fRemain < 0) {
							fRemain = 0;
						}
						return Object.assign({}, oItem, {
							Quantity: (fQty % 1 === 0) ? String(Math.floor(fQty)) : fQty.toFixed(2),
							BalanceQty: (fBalDisplay % 1 === 0) ? String(Math.floor(fBalDisplay)) : fBalDisplay.toFixed(2),
							ShippingQty: (fShipping % 1 === 0) ? String(Math.floor(fShipping)) : fShipping.toFixed(2),
							RemainQty: (fRemain % 1 === 0) ? String(Math.floor(fRemain)) : fRemain.toFixed(2)
						});
					});
					// Set materials data
					oModel.setProperty("/items", aSelectionItems);
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
			var bScannerScenarioActive = this._isScannerScenarioActive();
			
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
				var sQuantity = oMaterial.Quantity !== null && oMaterial.Quantity !== undefined ? String(oMaterial.Quantity) : "0";
				var vBal = oMaterial.BalanceQty;
				if (vBal === undefined || vBal === null || vBal === "") {
					vBal = oMaterial.balanceQty;
				}
				var sBalanceQty = (vBal !== undefined && vBal !== null && vBal !== "") ? String(vBal) : "";
				var sShippingQty = oMaterial.ShippingQty !== null && oMaterial.ShippingQty !== undefined && oMaterial.ShippingQty !== "" ?
					String(oMaterial.ShippingQty) :
					"0";
				var sRemainQty = oMaterial.RemainQty !== null && oMaterial.RemainQty !== undefined ? String(oMaterial.RemainQty) : "0";
				var oPayload = {
					TripNumber: sTripNumber,
					DocType: oMaterial.DocType || "",
					RefDocNo: oMaterial.RefDocNo || "",
					RefDocItemNo: oMaterial.RefDocItemNo || "",
					MaterialCode: oMaterial.MaterialCode || "",
					MaterialDescription: oMaterial.MaterialDescription || oMaterial.MaterialCode || "",
					Quantity: sQuantity,
					BalanceQty: sBalanceQty,
					ShippingQty: sShippingQty,
					RemainQty: sRemainQty,
					UoM: oMaterial.UoM || "",
					IsDeleted: "",
					IsSplitActive: false
				};
				if (bScannerScenarioActive) {
					oPayload.SheduleItem = oMaterial.SheduleItem || "";
				}
				
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
				// Preserve current DocType across Add/Cancel reopen flow.
				if (this._sSelectedDocType) {
					oDocTypeSelect.setSelectedKey(this._sSelectedDocType);
				}
			}
			this._bSkipDefaultRefDocType = false;
			// Reset other Input fields (not Doc Type)
			[
				"idRefDocNumber",
				"idRefDocPartyCode",
				"idRefDocPartyName",
				"idRefDocSalesDoc",
				"idRefDocSalesDoctype",
				"idRefDocEwayBillNumber",
				"idRefDocEwayBillDate",
				"idRefDocInvRefDate"
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
			this._oSelectedOrderDetail = null;
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
			this.byId("idRefDocSalesDoc")?.setValue(oRefDoc.invRefNo || oRefDoc.salesDoc || "");
			this.byId("idRefDocInvRefDate")?.setValue(this._formatODataDate(oRefDoc.InvRefDate || oRefDoc.invRefDate || null));
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
				"idMaterialBalanceQty",
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
			var bTripLocked = !!(sap.ui.getCore().getModel("globalData")?.getProperty("/TripLocked"));

			oDialog?.setTitle(bIsEdit ? "Edit Material Row" : "Add Material Row");
			oSaveButton?.setText(bIsEdit ? "Update" : "Add");
			// Keep material fields read-only when trip is completed/locked.
			this.byId("idMaterialCode")?.setEditable(!bTripLocked);
			this.byId("idMaterialDesc")?.setEditable(!bTripLocked);
			this.byId("idMaterialUoM")?.setEditable(!bTripLocked);
			this.byId("idMaterialQty")?.setEditable(!bTripLocked);
			this.byId("idMaterialBalanceQty")?.setEditable(!bTripLocked);
			this.byId("idMaterialDispatchQty")?.setEditable(!bTripLocked);
			this.byId("idMaterialRemainQty")?.setEditable(false);
			this.byId("idMaterialDispatchDate")?.setEditable(!bTripLocked);
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
			var vBalQty = oMaterial.balanceQty;
			if (vBalQty === undefined || vBalQty === null || vBalQty === "") {
				vBalQty = oMaterial.BalanceQty;
			}
			this.byId("idMaterialBalanceQty")?.setValue(vBalQty != null && vBalQty !== "" ? String(vBalQty) : "");
			var vShippingQty = oMaterial.shippingQty;
			if (vShippingQty === undefined || vShippingQty === null || vShippingQty === "") {
				vShippingQty = oMaterial.dispatchQty;
			}
			this.byId("idMaterialDispatchQty")?.setValue(vShippingQty != null && vShippingQty !== "" ? String(vShippingQty) : "");
			this.byId("idMaterialRemainQty")?.setValue(oMaterial.remainQty != null && oMaterial.remainQty !== "" ? String(oMaterial.remainQty) : "");
			this.onMaterialBalanceOrDispatchQtyChange();
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
			var vBal = oItem.BalanceQty;
			if (vBal === undefined || vBal === null) {
				vBal = oItem.balanceQty;
			}
			var sBal = (vBal === null || vBal === undefined) ? "" : String(vBal);
			this.byId("idMaterialBalanceQty")?.setValue(sBal);
			this.byId("idMaterialUoM")?.setValue(oItem.UoM || "");
			this.onMaterialBalanceOrDispatchQtyChange();
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
			var vBalRow = oItem.BalanceQty;
			if (vBalRow === undefined || vBalRow === null) {
				vBalRow = oItem.balanceQty;
			}
			this.byId("idMaterialBalanceQty")?.setValue(vBalRow !== undefined && vBalRow !== null ? String(vBalRow) : "");
			this.byId("idMaterialUoM")?.setValue(oItem.UoM || "");
			this._sSelectedMaterialDocType = this.byId("idMaterialDocType")?.getValue() || this._sSelectedMaterialDocType;
			this.onMaterialBalanceOrDispatchQtyChange();
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
			this.byId("idRefDocSalesDoc")?.setValue(oDoc.InvRefNo || oDoc.InvDc || oDoc.SalesDoc || "");
			this.byId("idRefDocInvRefDate")?.setValue(this._formatODataDate(oDoc.InvRefDate || null));
			this.byId("idRefDocSalesDoctype")?.setValue(oDoc.SalesDoctype || "");
		},

		_fetchOrderDetails: function (sDocType, mOpts) {
			return new Promise(function (resolve, reject) {
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

				// Prefer expanded TripData to reduce duplicate OrderDetails reads.
				var oTripDataModel = sap.ui.getCore().getModel("TripData");
				var aExpandedOrderDetails = this._extractResults(oTripDataModel?.getProperty("/OrderDetails"));
				if (Array.isArray(aExpandedOrderDetails) && aExpandedOrderDetails.length > 0) {
					var aCached = aExpandedOrderDetails.slice();
					if (sTripNumber) {
						aCached = aCached.filter(function (o) {
							return String(o?.TripNumber || "") === String(sTripNumber);
						});
					}
					if (sDocType) {
						aCached = aCached.filter(function (o) {
							return String(o?.DocType || "").trim() === String(sDocType || "").trim();
						});
					}
					if (sSearchTerm) {
						var sTermLower = sSearchTerm.toLowerCase();
						aCached = aCached.filter(function (o) {
							return String(o?.DocumentNumber || "").toLowerCase().indexOf(sTermLower) !== -1;
						});
					}
					var iSafeSkip = (!Number.isNaN(iSkip) && iSkip >= 0) ? iSkip : 0;
					var iSafeTop = (!Number.isNaN(iTop) && iTop > 0) ? iTop : aCached.length;
					resolve(aCached.slice(iSafeSkip, iSafeSkip + iSafeTop));
					return;
				}

				var oService = this._getOrderDetailsService();
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
					// Create-mode PO prefill: use exact match to avoid stale/partial matches
					// from previous or unrelated trips.
					aFilters.push(new Filter("DocumentNumber", FilterOperator.EQ, sIncomingPo));
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
						var vBal = oItem.BalanceQty;
						if (vBal === undefined || vBal === null) {
							vBal = oItem.balanceQty;
						}
						var sBalanceQtyDisplay = (vBal === null || vBal === undefined || vBal === "") ? "" : String(vBal);
						var vShippingQty = (oItem.ShippingQty !== undefined && oItem.ShippingQty !== null) ? oItem.ShippingQty : oItem.DispatchQty;
						var sShippingQtyDisplay = (vShippingQty === null || vShippingQty === undefined || vShippingQty === "") ? "" : String(vShippingQty);
						var sRemainQtyDisplay = (oItem.RemainQty === null || oItem.RemainQty === undefined || oItem.RemainQty === "") ? "" : String(oItem.RemainQty);
						if (sRemainQtyDisplay === "") {
							var fB = that._materialBalanceBaseForRemain(oItem);
							var fS = parseFloat(sShippingQtyDisplay);
							if (isFinite(fB) && !isNaN(fS) && isFinite(fS)) {
								sRemainQtyDisplay = String(fB - fS);
							} else if (isFinite(fB)) {
								sRemainQtyDisplay = String(fB);
							}
						}
						
						return {
							tripNumber: oItem.TripNumber || "",
							docType: oItem.DocType || "",
							refDocNo: oItem.RefDocNo || "",
							refDocItemNo: oItem.RefDocItemNo || "",
							materialCode: oItem.MaterialCode || "",
							materialDescription: oItem.MaterialDescription || "",
							qty: sQtyDisplay,
							balanceQty: sBalanceQtyDisplay,
							shippingQty: sShippingQtyDisplay,
							dispatchQty: sShippingQtyDisplay,
							remainQty: sRemainQtyDisplay,
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
			var vBal = oItem.BalanceQty;
			if (vBal === undefined || vBal === null) {
				vBal = oItem.balanceQty;
			}
			var sBal = (vBal === null || vBal === undefined) ? "" : String(vBal);
			this.byId("idMaterialBalanceQty")?.setValue(sBal);
			this.byId("idMaterialUoM")?.setValue(oItem.UoM || "");
			this.onMaterialBalanceOrDispatchQtyChange();
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
			// In Add mode, always honor current UI values and ignore stale
			// selection objects from prior value-help interactions.
			var oSelected = this._bIsRefDocEditMode ? this._oSelectedOrderDetail : null;

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
			var oInvRefDatePicker = this.byId("idRefDocInvRefDate");
			var sInvRefDateUi = String(oInvRefDatePicker?.getValue?.() || "").trim();
			var sInvRefNo = String(sSalesDoc || "").trim();
			// OData V2: calendar day as JavaScript Date serializes to JSON /Date(ms)/ (same as DocumentDate / Edm.DateTime date-only).
			var oInvRefDateFromUi = this._toEdmDateTime(oInvRefDatePicker?.getDateValue?.() || sInvRefDateUi || null);
			var bInvRefDateInUi = !!(oInvRefDatePicker?.getDateValue?.() || sInvRefDateUi);
			var oInvRefDateEdm = bInvRefDateInUi
				? this._toEdmDateTime(oInvRefDateFromUi || oSelected?.InvRefDate || null)
				: null;

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
				InvRefNo: String(oSelected?.InvRefNo || oSelected?.InvDc || oSelected?.SalesDoc || sInvRefNo || "").trim(),
				InvRefDate: oInvRefDateEdm,
				InvDc: String(oSelected?.InvDc || oSelected?.SalesDoc || sSalesDoc || "").trim(),
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
			var sBalanceQty = (this.byId("idMaterialBalanceQty")?.getValue() || "").trim();
			var sShippingQty = (this.byId("idMaterialDispatchQty")?.getValue() || "").trim();
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
			var fBalanceBase = 0;
			if (sBalanceQty) {
				var fBalParsed = parseFloat(sBalanceQty);
				if (!isNaN(fBalParsed) && isFinite(fBalParsed) && fBalParsed >= 0) {
					fBalanceBase = fBalParsed;
				}
			} else {
				fBalanceBase = fQty;
			}
			var fShippingQty = 0;
			if (sShippingQty) {
				var fS = parseFloat(sShippingQty);
				if (!isNaN(fS) && isFinite(fS)) {
					fShippingQty = fS;
				}
			}
			if (fShippingQty > fBalanceBase) {
				fShippingQty = fBalanceBase;
			}
			var fRemainQty = fBalanceBase - fShippingQty;
			if (!isFinite(fRemainQty)) {
				fRemainQty = 0;
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
			var sFormattedShippingQty = (fShippingQty % 1 === 0) ? String(Math.floor(fShippingQty)) : fShippingQty.toFixed(2);
			var sFormattedRemainQty = (fRemainQty % 1 === 0) ? String(Math.floor(fRemainQty)) : fRemainQty.toFixed(2);
			var sFormattedBalanceQty = "";
			if (sBalanceQty || fBalanceBase !== 0) {
				sFormattedBalanceQty = (fBalanceBase % 1 === 0) ? String(Math.floor(fBalanceBase)) : fBalanceBase.toFixed(2);
			}
			var bScannerScenarioActive = this._isScannerScenarioActive();

			var oPayload = {
				TripNumber: sTripNumber,
				DocType: sDocType,
				RefDocNo: sRefDocNo,
				RefDocItemNo: sRefDocItemNo,
				MaterialCode: sMaterialCode,
				MaterialDescription: sMaterialDesc || sMaterialCode, // Required, fallback to MaterialCode
				Quantity: sFormattedQty,
				BalanceQty: sFormattedBalanceQty,
				ShippingQty: sFormattedShippingQty,
				RemainQty: sFormattedRemainQty,
				UoM: sUoM || "", // Set to empty string if not provided
				IsDeleted: "", // Required MaxLength="1", use empty string for not deleted
				IsSplitActive: false
			};
			if (bScannerScenarioActive) {
				oPayload.SheduleItem = (this.byId("idMaterialSheduleItem")?.getValue() || "").trim();
			}

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
				EwayBill: oPayload.EwayBill || "",
				EwaybillDate: oPayload.EwaybillDate || "",
				InvRefNo: oPayload.InvRefNo || "",
				InvRefDate: oPayload.InvRefDate,
				InvDc: oPayload.InvDc || "",
				SalesDoctype: oPayload.SalesDoctype || "",
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
						var oGlobalModelOk = sap.ui.getCore().getModel("globalData");
						var sGlobalTripOk = String((oGlobalModelOk && oGlobalModelOk.getProperty("/TripNumber")) || "").trim();
						var sRowTripOk = that._materialRowFieldStr(oRefDoc, "tripNumber", "TripNumber");
						var oTripOvOk = !sRowTripOk && sGlobalTripOk ? { tripNumber: sGlobalTripOk } : undefined;
						that._setUiGuard(that._mRefDocUiGuard, that._getRefDocGuardKey(oRefDoc, oTripOvOk), "delete");
						// Keep TripData in sync so TripData/Updated handlers do not repaint deleted rows.
						that._stripDeletedRefDocFromTripDataModel(oRefDoc);
						// Keep suggestions fresh from backend (source of truth).
						var sDocTypeRaw = String(oRefDoc?.DocType || oRefDoc?.docType || that._sSelectedDocType || "").trim();
						if (sDocTypeRaw) {
							that._loadRefDocSuggestions(sDocTypeRaw);
						} else {
							that._getRefDocSuggestionModel()?.setProperty("/items", []);
						}
						
						MessageToast.show("Reference document deleted");

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
			var sTargetTrip = String(oRefDoc?.tripNumber || oRefDoc?.TripNumber || "").trim();
			var sTargetDocType = String(oRefDoc?.docType || oRefDoc?.DocType || "").trim().toUpperCase();
			var sTargetDocNoRaw = String(oRefDoc?.documentNumber || oRefDoc?.DocumentNumber || "").trim();
			var sTargetDocNoNorm = this._normalizeDocNumberForMatch(sTargetDocNoRaw);
			
			// Remove the reference document
			var aFiltered = aRefDocs.filter(function (oDoc) {
				var sDocTrip = String(oDoc?.tripNumber || oDoc?.TripNumber || "").trim();
				var sDocType = String(oDoc?.docType || oDoc?.DocType || "").trim().toUpperCase();
				var sDocNoRaw = String(oDoc?.documentNumber || oDoc?.DocumentNumber || "").trim();
				var sDocNoNorm = this._normalizeDocNumberForMatch(sDocNoRaw);
				var bDocNoMatch =
					(sDocNoRaw && sTargetDocNoRaw && sDocNoRaw === sTargetDocNoRaw) ||
					(sDocNoNorm && sTargetDocNoNorm && sDocNoNorm === sTargetDocNoNorm);
				return !(sDocTrip === sTargetTrip && sDocType === sTargetDocType && bDocNoMatch);
			}.bind(this));
			
			oModel.setProperty("/referenceDocs", aFiltered);
			
			// Also remove related materials
			var aMaterials = oModel.getProperty("/materialDetails") || [];
			var aFilteredMaterials = aMaterials.filter(function (oMat) {
				var sMatTrip = String(oMat?.tripNumber || oMat?.TripNumber || "").trim();
				var sMatDocType = String(oMat?.docType || oMat?.DocType || "").trim().toUpperCase();
				var sMatRefRaw = String(oMat?.refDocNo || oMat?.RefDocNo || "").trim();
				var sMatRefNorm = this._normalizeDocNumberForMatch(sMatRefRaw);
				var bMatDocMatch =
					(sMatRefRaw && sTargetDocNoRaw && sMatRefRaw === sTargetDocNoRaw) ||
					(sMatRefNorm && sTargetDocNoNorm && sMatRefNorm === sTargetDocNoNorm);
				return !(sMatTrip === sTargetTrip && sMatDocType === sTargetDocType && bMatDocMatch);
			}.bind(this));
			
			oModel.setProperty("/materialDetails", aFilteredMaterials);
			
			// Update filtered materials
			this._filterMaterialDetails();
			
			// Update dropdowns
			this._loadMaterialDocTypesFromRefDocs();
			this._loadMaterialRefDocNumbersFromRefDocs();
			
			// Clear selection if deleted ref doc was selected
			if (this._oSelectedRefDoc) {
				var sSelTrip = String(this._oSelectedRefDoc?.tripNumber || this._oSelectedRefDoc?.TripNumber || "").trim();
				var sSelDocType = String(this._oSelectedRefDoc?.docType || this._oSelectedRefDoc?.DocType || "").trim().toUpperCase();
				var sSelDocNoRaw = String(this._oSelectedRefDoc?.documentNumber || this._oSelectedRefDoc?.DocumentNumber || "").trim();
				var sSelDocNoNorm = this._normalizeDocNumberForMatch(sSelDocNoRaw);
				var bSelectedDocMatch =
					(sSelDocNoRaw && sTargetDocNoRaw && sSelDocNoRaw === sTargetDocNoRaw) ||
					(sSelDocNoNorm && sTargetDocNoNorm && sSelDocNoNorm === sTargetDocNoNorm);
				if (sSelTrip === sTargetTrip && sSelDocType === sTargetDocType && bSelectedDocMatch) {
					this._oSelectedRefDoc = null;
				}
			}
		},

		_updateLocalReferenceDoc: function (oPayload, oOriginalRefDoc) {
			var oModel = this._ensureRefDocModel();
			var aRefDocs = oModel.getProperty("/referenceDocs") || [];
			var sTargetTrip = String(oOriginalRefDoc?.tripNumber || oOriginalRefDoc?.TripNumber || "").trim();
			var sTargetDocType = String(oOriginalRefDoc?.docType || oOriginalRefDoc?.DocType || "").trim().toUpperCase();
			var sTargetDocNoRaw = String(oOriginalRefDoc?.documentNumber || oOriginalRefDoc?.DocumentNumber || "").trim();
			var sTargetDocNoNorm = this._normalizeDocNumberForMatch(sTargetDocNoRaw);

			// Find and update the reference document in the array
			var iIndex = aRefDocs.findIndex(function (oDoc) {
				var sDocTrip = String(oDoc?.tripNumber || oDoc?.TripNumber || "").trim();
				var sDocType = String(oDoc?.docType || oDoc?.DocType || "").trim().toUpperCase();
				var sDocNoRaw = String(oDoc?.documentNumber || oDoc?.DocumentNumber || "").trim();
				var sDocNoNorm = this._normalizeDocNumberForMatch(sDocNoRaw);
				var bDocNoMatch =
					(sDocNoRaw && sTargetDocNoRaw && sDocNoRaw === sTargetDocNoRaw) ||
					(sDocNoNorm && sTargetDocNoNorm && sDocNoNorm === sTargetDocNoNorm);
				return sDocTrip === sTargetTrip && sDocType === sTargetDocType && bDocNoMatch;
			}.bind(this));

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
					ewayBillNumber: oPayload.EwayBill || aRefDocs[iIndex].ewayBillNumber || "",
					ewayBillDate: this._blankIfInvalidDate(this._formatODataDate(oPayload.EwaybillDate)) || aRefDocs[iIndex].ewayBillDate || "",
					InvRefNo: oPayload.InvRefNo || aRefDocs[iIndex].InvRefNo || "",
					InvRefDate: oPayload.InvRefDate || aRefDocs[iIndex].InvRefDate || "",
					invRefNo: oPayload.InvRefNo || aRefDocs[iIndex].invRefNo || "",
					invRefDate: this._blankIfInvalidDate(this._formatODataDate(oPayload.InvRefDate)) || aRefDocs[iIndex].invRefDate || "",
					salesDoc: oPayload.InvDc || oPayload.SalesDoc || aRefDocs[iIndex].salesDoc || "",
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
			var sTripNumber = String(oPayload.TripNumber || "").trim();
			var sDocType = String(oPayload.DocType || sDialogDocType || "").trim();
			var sDocumentNumber = String(oPayload.DocumentNumber || sDialogDocNumber || "").trim();

			var bExists = this._hasLocalReferenceDoc(sTripNumber, sDocType, sDocumentNumber);

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
				ewayBillNumber: oPayload.EwayBill || "",
				ewayBillDate: this._blankIfInvalidDate(this._formatODataDate(oPayload.EwaybillDate)) || "",
				InvRefNo: oPayload.InvRefNo || "",
				InvRefDate: oPayload.InvRefDate || "",
				invRefNo: oPayload.InvRefNo || sDialogSalesDoc || "",
				invRefDate: this._blankIfInvalidDate(this._formatODataDate(oPayload.InvRefDate)) || "",
				salesDoc: oPayload.InvDc || oPayload.SalesDoc || sDialogSalesDoc || "",
				salesDoctype: oPayload.SalesDoctype || sDialogSalesDoctype || "",
				_isLocal: true
			});
			// Force model refresh by setting the entire array
			oModel.setProperty("/referenceDocs", aRefDocs, true); // true = force refresh
		},

		_hasLocalReferenceDoc: function (sTripNumber, sDocType, sDocumentNumber) {
			var oModel = this._ensureRefDocModel();
			var aRefDocs = oModel.getProperty("/referenceDocs") || [];
			var sTrip = String(sTripNumber || "").trim();
			var sType = String(sDocType || "").trim();
			var sDocNo = String(sDocumentNumber || "").trim();

			return aRefDocs.some(function (oDoc) {
				var sRowTrip = String(oDoc.tripNumber || oDoc.TripNumber || "").trim();
				var sRowType = String(oDoc.docType || oDoc.DocType || "").trim();
				var sRowDocNo = String(oDoc.documentNumber || oDoc.DocumentNumber || "").trim();
				return sRowTrip === sTrip && sRowType === sType && sRowDocNo === sDocNo;
			});
		},

		_backfillReferenceDocsFromMaterialsIfMissing: function () {
			var oModel = this._ensureRefDocModel();
			var aRefDocs = oModel.getProperty("/referenceDocs") || [];
			var aMaterials = oModel.getProperty("/materialDetails") || [];

			// Keep existing behavior intact: only synthesize rows when table source is empty.
			if (!Array.isArray(aRefDocs) || aRefDocs.length > 0 || !Array.isArray(aMaterials) || aMaterials.length === 0) {
				return;
			}

			var mSeen = {};
			var aDerived = [];
			aMaterials.forEach(function (oMat) {
				var sTrip = String(oMat.tripNumber || oMat.TripNumber || "").trim();
				var sType = String(oMat.docType || oMat.DocType || "").trim();
				var sDocNo = String(oMat.refDocNo || oMat.RefDocNo || "").trim();
				if (!sType || !sDocNo) {
					return;
				}
				var sKey = [sTrip, sType, sDocNo].join("|");
				if (mSeen[sKey]) {
					return;
				}
				mSeen[sKey] = true;
				aDerived.push({
					TripNumber: sTrip,
					DocType: sType,
					DocumentNumber: sDocNo,
					tripNumber: sTrip,
					docType: sType,
					documentNumber: sDocNo,
					documentDate: "",
					partyCode: "",
					partyName: "",
					salesDoc: "",
					salesDoctype: "",
				});
			});

			if (aDerived.length > 0) {
				oModel.setProperty("/referenceDocs", aDerived, true);
			}
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
				BalanceQty: oPayload.BalanceQty || "",
				ShippingQty: oPayload.ShippingQty || oPayload.DispatchQty || "",
				RemainQty: oPayload.RemainQty || "",
				UoM: oPayload.UoM || "",
				IsDeleted: oPayload.IsDeleted || "",
				IsSplitActive: oPayload.IsSplitActive !== undefined ? oPayload.IsSplitActive : false
			};
			if (this._isScannerScenarioActive()) {
				oUpdatePayload.SheduleItem = oPayload.SheduleItem || "";
			}

			

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

			var sDocType = this._escapeODataValue(this._materialRowFieldStr(oMaterial, "docType", "DocType"));
			var sTripNumber = this._escapeODataValue(
				this._materialRowFieldStr(oMaterial, "tripNumber", "TripNumber") || (sCurrentTripNumber || "")
			);
			var sRefDocNo = this._escapeODataValue(this._materialRowFieldStr(oMaterial, "refDocNo", "RefDocNo"));
			var sRefDocItemNo = this._escapeODataValue(this._materialRowFieldStr(oMaterial, "refDocItemNo", "RefDocItemNo"));

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
						var sMaterialKey = [
							that._materialRowFieldStr(oMaterial, "tripNumber", "TripNumber").toUpperCase(),
							that._materialRowFieldStr(oMaterial, "docType", "DocType").toUpperCase(),
							that._materialRowFieldStr(oMaterial, "refDocNo", "RefDocNo").toUpperCase(),
							that._materialRowFieldStr(oMaterial, "refDocItemNo", "RefDocItemNo").toUpperCase()
						].join("|");
						that._setUiGuard(that._mMaterialUiGuard, sMaterialKey, "delete");
						// Notify dependent tabs (Gate In / Gate Out) that materials changed.
						that._oEventBus?.publish("RefDoc", "MaterialsUpdated");
						
						MessageToast.show("Material row deleted");

						that._refreshBothTables({ forceBackend: true });
						
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
			var sTargetTrip = this._materialRowFieldStr(oMaterial, "tripNumber", "TripNumber");
			var sTargetDocType = this._materialRowFieldStr(oMaterial, "docType", "DocType").toUpperCase();
			var sTargetRefNoRaw = this._materialRowFieldStr(oMaterial, "refDocNo", "RefDocNo");
			var sTargetItemNoRaw = this._materialRowFieldStr(oMaterial, "refDocItemNo", "RefDocItemNo");
			var sTargetRefNoNorm = this._normalizeDocNumberForMatch(sTargetRefNoRaw);
			var sTargetItemNoNorm = this._normalizeDocNumberForMatch(sTargetItemNoRaw);
			
			// Remove the material
			var aFiltered = aMaterials.filter(function (oMat) {
				var sMatTrip = this._materialRowFieldStr(oMat, "tripNumber", "TripNumber");
				var sMatDocType = this._materialRowFieldStr(oMat, "docType", "DocType").toUpperCase();
				var sMatRefNoRaw = this._materialRowFieldStr(oMat, "refDocNo", "RefDocNo");
				var sMatItemNoRaw = this._materialRowFieldStr(oMat, "refDocItemNo", "RefDocItemNo");
				var sMatRefNoNorm = this._normalizeDocNumberForMatch(sMatRefNoRaw);
				var sMatItemNoNorm = this._normalizeDocNumberForMatch(sMatItemNoRaw);
				var bRefNoMatch =
					(sMatRefNoRaw && sTargetRefNoRaw && sMatRefNoRaw === sTargetRefNoRaw) ||
					(sMatRefNoNorm && sTargetRefNoNorm && sMatRefNoNorm === sTargetRefNoNorm);
				var bItemNoMatch =
					(sMatItemNoRaw && sTargetItemNoRaw && sMatItemNoRaw === sTargetItemNoRaw) ||
					(sMatItemNoNorm && sTargetItemNoNorm && sMatItemNoNorm === sTargetItemNoNorm);
				return !(sMatTrip === sTargetTrip &&
						 sMatDocType === sTargetDocType &&
						 bRefNoMatch &&
						 bItemNoMatch);
			}.bind(this));
			
			oModel.setProperty("/materialDetails", aFiltered, true);
			
			// Update filtered materials
			this._filterMaterialDetails();
		},

		_updateLocalMaterialDetail: function (oPayload, oOriginalMaterial) {
			var oModel = this._ensureRefDocModel();
			var aMaterials = oModel.getProperty("/materialDetails") || [];
			var sTargetTrip = String(oOriginalMaterial?.tripNumber || oOriginalMaterial?.TripNumber || "").trim();
			var sTargetDocType = String(oOriginalMaterial?.docType || oOriginalMaterial?.DocType || "").trim().toUpperCase();
			var sTargetRefNo = String(oOriginalMaterial?.refDocNo || oOriginalMaterial?.RefDocNo || "").trim();
			var sTargetItemNo = String(oOriginalMaterial?.refDocItemNo || oOriginalMaterial?.RefDocItemNo || "").trim();

			// Find and update the material in the array
			var iIndex = aMaterials.findIndex(function (oMat) {
				var sMatTrip = String(oMat?.tripNumber || oMat?.TripNumber || "").trim();
				var sMatDocType = String(oMat?.docType || oMat?.DocType || "").trim().toUpperCase();
				var sMatRefNo = String(oMat?.refDocNo || oMat?.RefDocNo || "").trim();
				var sMatItemNo = String(oMat?.refDocItemNo || oMat?.RefDocItemNo || "").trim();
				return sMatTrip === sTargetTrip &&
					sMatDocType === sTargetDocType &&
					sMatRefNo === sTargetRefNo &&
					sMatItemNo === sTargetItemNo;
			});

			if (iIndex >= 0) {
				console.log("[MaterialDebug] _updateLocalMaterialDetail matched existing row", {
					index: iIndex,
					target: {
						trip: sTargetTrip,
						docType: sTargetDocType,
						refDocNo: sTargetRefNo,
						refDocItemNo: sTargetItemNo
					}
				});
				var vQty = oPayload.Quantity;
				var sQtyDisplay = (vQty === null || vQty === undefined || vQty === "") ? "" : String(vQty);

				// Update the material with all fields from backend response
				var vShippingQtyDisplay = oPayload.ShippingQty;
				if (vShippingQtyDisplay === undefined || vShippingQtyDisplay === null || vShippingQtyDisplay === "") {
					vShippingQtyDisplay = oPayload.DispatchQty;
				}
				var sShippingQtyDisplay = (vShippingQtyDisplay === null || vShippingQtyDisplay === undefined || vShippingQtyDisplay === "") ? "" : String(vShippingQtyDisplay);
				var vBalPl = oPayload.BalanceQty;
				if (vBalPl === undefined || vBalPl === null || vBalPl === "") {
					vBalPl = oPayload.balanceQty;
				}
				var sBalanceQtyDisplay = (vBalPl === null || vBalPl === undefined || vBalPl === "") ? "" : String(vBalPl);
				var fBaseDisplay = this._materialBalanceBaseForRemain({
					BalanceQty: sBalanceQtyDisplay,
					balanceQty: sBalanceQtyDisplay,
					Quantity: sQtyDisplay,
					quantity: sQtyDisplay
				});
				var fShippingDisplay = parseFloat(sShippingQtyDisplay);
				var sRemainQtyDisplay = (isFinite(fBaseDisplay) && !isNaN(fShippingDisplay) && isFinite(fShippingDisplay)) ?
					String(fBaseDisplay - fShippingDisplay) :
					((oPayload.RemainQty === null || oPayload.RemainQty === undefined || oPayload.RemainQty === "") ? "" : String(oPayload.RemainQty));
				aMaterials[iIndex] = Object.assign({}, aMaterials[iIndex], {
					// Keep uppercase versions for backend compatibility
					TripNumber: oPayload.TripNumber || aMaterials[iIndex].TripNumber || aMaterials[iIndex].tripNumber,
					DocType: oPayload.DocType || aMaterials[iIndex].DocType || aMaterials[iIndex].docType,
					RefDocNo: oPayload.RefDocNo || aMaterials[iIndex].RefDocNo || aMaterials[iIndex].refDocNo,
					RefDocItemNo: oPayload.RefDocItemNo || aMaterials[iIndex].RefDocItemNo || aMaterials[iIndex].refDocItemNo,
					BalanceQty: sBalanceQtyDisplay || oPayload.BalanceQty || aMaterials[iIndex].BalanceQty,
					// Lowercase versions for UI binding
					tripNumber: oPayload.TripNumber || aMaterials[iIndex].tripNumber,
					docType: oPayload.DocType || aMaterials[iIndex].docType,
					refDocNo: oPayload.RefDocNo || aMaterials[iIndex].refDocNo,
					refDocItemNo: oPayload.RefDocItemNo || aMaterials[iIndex].refDocItemNo,
					materialCode: oPayload.MaterialCode || aMaterials[iIndex].materialCode,
					materialDescription: oPayload.MaterialDescription || aMaterials[iIndex].materialDescription,
					qty: sQtyDisplay,
					balanceQty: sBalanceQtyDisplay || aMaterials[iIndex].balanceQty,
					shippingQty: sShippingQtyDisplay,
					dispatchQty: sShippingQtyDisplay,
					remainQty: sRemainQtyDisplay,
					uom: oPayload.UoM || aMaterials[iIndex].uom,
					changedBy: oPayload.ChangedBy || aMaterials[iIndex].changedBy || "",
					changedOnDate: this._formatODataDate(oPayload.ChangedDate) || aMaterials[iIndex].changedOnDate,
					changedOnTime: this._formatODataTime(oPayload.ChangedTime) || aMaterials[iIndex].changedOnTime,
					// Convert optimistic local row to confirmed backend row after successful save.
					_isLocal: false
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
			var sDialogBal = (this.byId("idMaterialBalanceQty")?.getValue() || "").trim();
			var sDialogUoM = this.byId("idMaterialUoM")?.getValue() || "";

			var vQty = oPayload.Quantity;
			var sQtyDisplay = (vQty === null || vQty === undefined || vQty === "") ? sDialogQty : String(vQty);
			var vBalPl = oPayload.BalanceQty;
			if (vBalPl === undefined || vBalPl === null || vBalPl === "") {
				vBalPl = oPayload.balanceQty;
			}
			var sBalanceQtyDisplay = (vBalPl === null || vBalPl === undefined || vBalPl === "") ? sDialogBal : String(vBalPl);
			var vShippingQtyDisplay = oPayload.ShippingQty;
			if (vShippingQtyDisplay === undefined || vShippingQtyDisplay === null || vShippingQtyDisplay === "") {
				vShippingQtyDisplay = oPayload.DispatchQty;
			}
			var sShippingQtyDisplay = (vShippingQtyDisplay === null || vShippingQtyDisplay === undefined || vShippingQtyDisplay === "") ? "" : String(vShippingQtyDisplay);
			var fBaseDisplay = this._materialBalanceBaseForRemain({
				BalanceQty: sBalanceQtyDisplay,
				balanceQty: sBalanceQtyDisplay,
				Quantity: sQtyDisplay,
				quantity: sQtyDisplay
			});
			var fShippingDisplay = parseFloat(sShippingQtyDisplay);
			var sRemainQtyDisplay = (isFinite(fBaseDisplay) && !isNaN(fShippingDisplay) && isFinite(fShippingDisplay)) ?
				String(fBaseDisplay - fShippingDisplay) :
				((oPayload.RemainQty === null || oPayload.RemainQty === undefined || oPayload.RemainQty === "") ? "" : String(oPayload.RemainQty));
			var sTripKey = String(oPayload.TripNumber || "").trim().toUpperCase();
			var sDocTypeKey = String(oPayload.DocType || sDialogDocType || "").trim().toUpperCase();
			var sRefDocKey = String(oPayload.RefDocNo || sDialogRefDocNo || "").trim().toUpperCase();
			var sItemKey = String(oPayload.RefDocItemNo || sDialogRefDocItem || "").trim().toUpperCase();
			var bExists = aMaterials.some(function (oMat) {
				return String(oMat?.tripNumber || oMat?.TripNumber || "").trim().toUpperCase() === sTripKey &&
					String(oMat?.docType || oMat?.DocType || "").trim().toUpperCase() === sDocTypeKey &&
					String(oMat?.refDocNo || oMat?.RefDocNo || "").trim().toUpperCase() === sRefDocKey &&
					String(oMat?.refDocItemNo || oMat?.RefDocItemNo || "").trim().toUpperCase() === sItemKey;
			});
			if (bExists) {
				console.warn("[MaterialDebug] _appendLocalMaterialDetail duplicate blocked", {
					key: [sTripKey, sDocTypeKey, sRefDocKey, sItemKey].join("|"),
					existingCount: aMaterials.length
				});
				return;
			}
			console.log("[MaterialDebug] _appendLocalMaterialDetail adding row", {
				key: [sTripKey, sDocTypeKey, sRefDocKey, sItemKey].join("|"),
				beforeCount: aMaterials.length
			});

			aMaterials.push({
				tripNumber: oPayload.TripNumber || "",
				docType: oPayload.DocType || sDialogDocType,
				refDocNo: oPayload.RefDocNo || sDialogRefDocNo,
				refDocItemNo: oPayload.RefDocItemNo || sDialogRefDocItem,
				materialCode: oPayload.MaterialCode || sDialogMaterial,
				materialDescription: oPayload.MaterialDescription || sDialogDesc,
				qty: sQtyDisplay,
				balanceQty: sBalanceQtyDisplay,
				shippingQty: sShippingQtyDisplay,
				dispatchQty: sShippingQtyDisplay,
				remainQty: sRemainQtyDisplay,
				dispatchDate: this._formatODataDate(oPayload.DispatchDate) || "",
				uom: oPayload.UoM || sDialogUoM,
				createdBy: oPayload.CreatedBy || "",
				createdOnDate: this._formatODataDate(oPayload.CreatedOn),
				createdOnTime: this._formatODataTime(oPayload.CreatedTime),
				changedBy: oPayload.ChangedBy || "",
				changedOnDate: this._formatODataDate(oPayload.ChangedDate),
				changedOnTime: this._formatODataTime(oPayload.ChangedTime),
				_isLocal: true
			});

			// Force model refresh by setting the entire array
			oModel.setProperty("/materialDetails", aMaterials, true); // true = force refresh
			console.log("[MaterialDebug] _appendLocalMaterialDetail added row", {
				afterCount: aMaterials.length
			});
			// If ref docs are missing (for example material-first flow), derive minimal rows.
			this._backfillReferenceDocsFromMaterialsIfMissing();
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

			// Scanner-first ASN scenarios and completed trips:
			// keep Add/Edit/Delete ref docs and manual material actions hidden.
			var sItemKey = oTripData.getProperty("/MovementScenarioItemKey") || "";
			if (!sItemKey) {
				sItemKey = MovementScenarioIcons.getMovementScenarioItemKey(
					oTripData.getProperty("/MovementType") || "",
					oTripData.getProperty("/MovementScenario")
				);
			}
			var bScannerScenario = MovementScenarioIcons.isScannerMovementScenarioItemKey(sItemKey);
			var sTripStatus = String(oTripData.getProperty("/TripStatus") || "")
				.trim()
				.toLowerCase()
				.replace(/[\s_-]+/g, "");
			var bTripCompleted = sTripStatus === "completed" || sTripStatus === "tripcompleted" || sTripStatus === "done";
			oGlobalModel.setProperty("/DisableRefDocMaterialsActions", !!bScannerScenario || bTripCompleted);
			oGlobalModel.setProperty("/TripLocked", bTripCompleted);
			
			var vOrderDetails = oTripData.getProperty("/OrderDetails");
			var vItemDetails = oTripData.getProperty("/ItemDetails");
			var bHasOrderDetailsPayload = Array.isArray(vOrderDetails) ||
				(vOrderDetails && Array.isArray(vOrderDetails.results)) ||
				(vOrderDetails && vOrderDetails.__deferred);
			var bHasItemDetailsPayload = Array.isArray(vItemDetails) ||
				(vItemDetails && Array.isArray(vItemDetails.results)) ||
				(vItemDetails && vItemDetails.__deferred);
			var aExistingRefDocs = oModel.getProperty("/referenceDocs") || [];
			var aExistingMaterials = oModel.getProperty("/materialDetails") || [];

			// Gate-In fallback sometimes publishes TripData updates without expanded ref doc/material payload.
			// Preserve current rows for the same trip instead of wiping local model state.
			if (!bHasOrderDetailsPayload && !bHasItemDetailsPayload) {
				var sTripFromTripData = String(oTripData.getProperty("/TripNumber") || "").trim();
				var sTripFromExistingData = String(
					(aExistingRefDocs[0] && (aExistingRefDocs[0].tripNumber || aExistingRefDocs[0].TripNumber)) ||
					(aExistingMaterials[0] && (aExistingMaterials[0].tripNumber || aExistingMaterials[0].TripNumber)) ||
					""
				).trim();
				if (sTripFromTripData && sTripFromExistingData && sTripFromTripData === sTripFromExistingData) {
					// Same trip but materials not loaded yet: still fetch /ItemDetails (partial TripData must not block this).
					if (aExistingMaterials.length === 0) {
						this._loadItemDetailsSeparately(sTripFromTripData);
					}
					return;
				}
			}

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
			
			if (bHasResults) {
				// Data is already available from $expand (has results property), use it directly
				// DO NOT make separate ItemDetails calls - use the expanded data
				var aOrderDetails = this._extractResults(vOrderDetails);
				var aItemDetails = this._extractResults(vItemDetails);

				// Pass flag=true to indicate ItemDetails is already loaded from expand
				// This prevents _loadAllMaterialsForAllRefDocs from making separate calls
				this._setReferenceDocsFromService(aOrderDetails, true);
				var sTripCtx = String(oTripData.getProperty("/TripNumber") || "").trim();
				var bSkipEmptyItems = this._shouldSkipEmptyMaterialSnapshot(
					aItemDetails,
					aOrderDetails,
					aExistingMaterials,
					sTripCtx
				);
				if (!bSkipEmptyItems) {
					this._setMaterialDetailsFromService(aItemDetails);
				}
			} else {
				// No usable ItemDetails shape on TripData — refresh ref docs, load items from service
				// instead of clearing materials (avoids wiping on partial TripData payloads).
				this._setReferenceDocsFromService(this._extractResults(vOrderDetails), true);
				var sTripElse = String(oTripData.getProperty("/TripNumber") || "").trim();
				if (sTripElse) {
					this._loadItemDetailsSeparately(sTripElse);
				} else {
					this._setMaterialDetailsFromService([]);
				}
			}
		},

		_setReferenceDocsFromService: function (aDocs, bItemDetailsAlreadyLoaded) {
			// Default to false if parameter not provided (backward compatibility)
			if (bItemDetailsAlreadyLoaded === undefined) {
				bItemDetailsAlreadyLoaded = false;
			}
			var oModel = this._ensureRefDocModel();
			var aExisting = oModel.getProperty("/referenceDocs") || [];
			var aLocalRefDocs = aExisting.filter(function (oDoc) {
				return oDoc && oDoc._isLocal === true;
			});
			// Filter out deleted records (Deleted === true)
			var aBackendRefDocs = (aDocs || [])
				.filter(function (oDoc) {
					return oDoc.Deleted !== true && oDoc.Deleted !== "X";
				})
				.map(function (oDoc) {
					var sTripNumber = String(oDoc.TripNumber || "").trim();
					var sDocType = String(oDoc.DocType || "").trim();
					var sDocumentNumber = String(oDoc.DocumentNumber || "").trim();
					return {
						// Store both original service values (uppercase) and local model values (lowercase)
						// This ensures we can use the correct values for OData operations
						TripNumber: sTripNumber,
						DocType: sDocType,
						DocumentNumber: sDocumentNumber,
						InvRefNo: oDoc.InvRefNo || "",
						InvRefDate: oDoc.InvRefDate || "",
						MovementType: oDoc.MovementType || "",
						tripNumber: sTripNumber,
						docType: sDocType,
						documentNumber: sDocumentNumber,
						invRefNo: oDoc.InvRefNo || "",
						invRefDate: this._formatODataDate(oDoc.InvRefDate),
						movementType: oDoc.MovementType || "",
						documentDate: this._formatODataDate(oDoc.DocumentDate),
						partyCode: oDoc.Vendor || oDoc.Customer || "",
						partyName: oDoc.Name || "",
						salesDoc: oDoc.InvDc || oDoc.SalesDoc || "",
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
			var mExistingRefDocByKey = {};
			aExisting.forEach(function (oDoc) {
				var sExistingKey = this._getRefDocGuardKey(oDoc);
				mExistingRefDocByKey[sExistingKey] = oDoc;
			}.bind(this));
			var aGuardedBackendRefDocs = [];
			aBackendRefDocs.forEach(function (oDoc) {
				var sKey = this._getRefDocGuardKey(oDoc);
				var oGuard = this._getUiGuard(this._mRefDocUiGuard, sKey);
				if (oGuard && oGuard.type === "delete") {
					return;
				}
				if (oGuard && oGuard.type === "upsert" && mExistingRefDocByKey[sKey]) {
					aGuardedBackendRefDocs.push(mExistingRefDocByKey[sKey]);
					return;
				}
				aGuardedBackendRefDocs.push(oDoc);
			}.bind(this));
			var aRefDocs = aGuardedBackendRefDocs.concat(aLocalRefDocs);
			var oRefDocsByKey = {};
			aRefDocs.forEach(function (oDoc) {
				var sKey = this._getRefDocGuardKey(oDoc);
				var oExistingDoc = oRefDocsByKey[sKey];
				if (!oExistingDoc) {
					oRefDocsByKey[sKey] = oDoc;
					return;
				}
				// Prefer backend record over optimistic local duplicate
				if (oExistingDoc._isLocal === true && oDoc._isLocal !== true) {
					oRefDocsByKey[sKey] = oDoc;
				}
			}.bind(this));
			aRefDocs = Object.values(oRefDocsByKey);
			oModel.setProperty("/referenceDocs", aRefDocs);
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
			var oModel = this._ensureRefDocModel();
			var aExisting = oModel.getProperty("/materialDetails") || [];
			var that = this;
			console.log("[MaterialDebug] _setMaterialDetailsFromService start", {
				existingCount: aExisting.length,
				incomingCount: (aItems || []).length
			});
			var fnNormalize = function (vValue) {
				if (vValue === undefined || vValue === null) {
					return "";
				}
				return String(vValue).trim().toUpperCase();
			};
			var aLocalMaterials = aExisting.filter(function (oMat) {
				return oMat && oMat._isLocal === true;
			});
			// Filter out deleted records (IsDeleted === "X")
			var aBackendMaterials = (aItems || [])
				.filter(function (oItem) {
					return oItem.IsDeleted !== "X";
				})
				.map(function (oItem) {
					var vCases = oItem.Cases;
					var sCasesDisplay = (vCases === null || vCases === undefined || vCases === "") ? "" : String(vCases);
					var vQuantity = (oItem.Quantity === null || oItem.Quantity === undefined) ? "" : String(oItem.Quantity);
					var vBalanceQty = oItem.BalanceQty;
					if (vBalanceQty === undefined || vBalanceQty === null) {
						vBalanceQty = oItem.balanceQty;
					}
					var sBalanceQty = (vBalanceQty === null || vBalanceQty === undefined || vBalanceQty === "") ? "" : String(vBalanceQty);
					var vShippingQty = (oItem.ShippingQty === null || oItem.ShippingQty === undefined) ? oItem.DispatchQty : oItem.ShippingQty;
					var sShippingQty = (vShippingQty === null || vShippingQty === undefined) ? "" : String(vShippingQty);
					var vRemainQty = oItem.RemainQty;
					if (vRemainQty === null || vRemainQty === undefined || vRemainQty === "") {
						var fBase = that._materialBalanceBaseForRemain(oItem);
						var fShip = parseFloat(sShippingQty);
						if (isFinite(fBase) && !isNaN(fShip) && isFinite(fShip)) {
							vRemainQty = String(fBase - fShip);
						} else if (isFinite(fBase)) {
							vRemainQty = String(fBase);
						} else {
							vRemainQty = "";
						}
					}
					return {
						// Store both original service values (uppercase) and local model values (lowercase)
						// This ensures we can use the correct values for OData operations
						TripNumber: oItem.TripNumber === undefined || oItem.TripNumber === null ? "" : String(oItem.TripNumber),
						DocType: oItem.DocType === undefined || oItem.DocType === null ? "" : String(oItem.DocType),
						RefDocNo: oItem.RefDocNo === undefined || oItem.RefDocNo === null ? "" : String(oItem.RefDocNo),
						RefDocItemNo: oItem.RefDocItemNo === undefined || oItem.RefDocItemNo === null ? "" : String(oItem.RefDocItemNo),
						ScheduleItem: oItem.SheduleItem || oItem.ScheduleItem || "",
						MovementType: oItem.MovementType || "",
						Cases: sCasesDisplay,
						tripNumber: oItem.TripNumber === undefined || oItem.TripNumber === null ? "" : String(oItem.TripNumber),
						docType: oItem.DocType === undefined || oItem.DocType === null ? "" : String(oItem.DocType),
						refDocNo: oItem.RefDocNo === undefined || oItem.RefDocNo === null ? "" : String(oItem.RefDocNo),
						refDocItemNo: oItem.RefDocItemNo === undefined || oItem.RefDocItemNo === null ? "" : String(oItem.RefDocItemNo),
						scheduleItem: oItem.SheduleItem || oItem.ScheduleItem || "",
						movementType: oItem.MovementType || "",
						materialCode: oItem.MaterialCode || "",
						materialDescription: oItem.MaterialDescription || "",
						qty: vQuantity,
						balanceQty: sBalanceQty,
						BalanceQty: sBalanceQty,
						// Backend ItemDetails "Cases" shown as "Bins (Trolleys)" in UI
						binsTrolleys: sCasesDisplay,
						uom: oItem.UoM || "",
						// ShippingQty shown separately from Quantity; fallback to DispatchQty for legacy payloads
						shippingQty: sShippingQty,
						dispatchQty: (oItem.DispatchQty === null || oItem.DispatchQty === undefined) ?
							((oItem.ShippingQty === null || oItem.ShippingQty === undefined) ? "" : String(oItem.ShippingQty)) :
							String(oItem.DispatchQty),
						remainQty: String(vRemainQty),
						dispatchDate: this._formatODataDate(oItem.DispatchDate),
						createdBy: oItem.CreatedBy || "",
						createdOnDate: this._formatODataDate(oItem.CreatedOn),
						createdOnTime: this._formatODataTime(oItem.CreatedTime),
						changedBy: oItem.ChangedBy || "",
						changedOnDate: this._formatODataDate(oItem.ChangedDate),
						changedOnTime: this._formatODataTime(oItem.ChangedTime),
						_isLocal: false
					};
				}.bind(this));
			var mExistingMaterialByKey = {};
			var fnMaterialMergeKey = function (oMat) {
				return [
					fnNormalize(that._materialRowFieldStr(oMat, "tripNumber", "TripNumber")),
					fnNormalize(that._materialRowFieldStr(oMat, "docType", "DocType")),
					fnNormalize(that._materialRowFieldStr(oMat, "refDocNo", "RefDocNo")),
					fnNormalize(that._materialRowFieldStr(oMat, "refDocItemNo", "RefDocItemNo"))
				].join("|");
			};
			aExisting.forEach(function (oMat) {
				var sExistingKey = fnMaterialMergeKey(oMat);
				mExistingMaterialByKey[sExistingKey] = oMat;
			});
			var aGuardedBackendMaterials = [];
			aBackendMaterials.forEach(function (oMat) {
				var sKey = fnMaterialMergeKey(oMat);
				var oGuard = this._getUiGuard(this._mMaterialUiGuard, sKey);
				if (oGuard && oGuard.type === "delete") {
					return;
				}
				if (oGuard && oGuard.type === "upsert" && mExistingMaterialByKey[sKey]) {
					aGuardedBackendMaterials.push(mExistingMaterialByKey[sKey]);
					return;
				}
				aGuardedBackendMaterials.push(oMat);
			}.bind(this));
			var aMaterials = aGuardedBackendMaterials.concat(aLocalMaterials);
			var oMaterialsByKey = {};
			aMaterials.forEach(function (oMat) {
				var sKey = fnMaterialMergeKey(oMat);
				var oExistingMat = oMaterialsByKey[sKey];
				if (!oExistingMat) {
					oMaterialsByKey[sKey] = oMat;
					return;
				}
				// Prefer backend record over optimistic local duplicate
				if (oExistingMat._isLocal === true && oMat._isLocal !== true) {
					oMaterialsByKey[sKey] = oMat;
				}
			});
			aMaterials = Object.values(oMaterialsByKey);
			oModel.setProperty("/materialDetails", aMaterials);
			console.log("[MaterialDebug] _setMaterialDetailsFromService end", {
				finalCount: aMaterials.length
			});
			// If backend returned materials but no OrderDetails payload, keep Reference Docs table usable.
			this._backfillReferenceDocsFromMaterialsIfMissing();
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

		/**
		 * Removes the deleted reference document (and its item lines) from the in-memory
		 * TripData model so subscribers do not flash stale expanded data before OData reads finish.
		 */
		_stripDeletedRefDocFromTripDataModel: function (oRefDoc) {
			var oTripData = sap.ui.getCore().getModel("TripData");
			if (!oTripData || !oRefDoc) {
				return;
			}
			var oGlobalModel = sap.ui.getCore().getModel("globalData");
			var sGlobalTrip = oGlobalModel ? String(oGlobalModel.getProperty("/TripNumber") || "").trim() : "";
			var fnNorm = function (v) {
				return String(v || "").trim().toUpperCase();
			};
			var sTrip = fnNorm(oRefDoc.tripNumber || oRefDoc.TripNumber || sGlobalTrip);
			var sDocType = fnNorm(oRefDoc.docType || oRefDoc.DocType);
			var sDocRaw = String(oRefDoc.documentNumber || oRefDoc.DocumentNumber || "").trim();
			var sDocNorm = this._normalizeDocNumberForMatch(sDocRaw);
			if (!sTrip || !sDocType) {
				return;
			}
			var that = this;
			var fnMatchRefDocRow = function (sRowTrip, sRowDocType, sRowDocNoRaw) {
				var t = fnNorm(sRowTrip);
				var d = fnNorm(sRowDocType);
				var nRaw = String(sRowDocNoRaw || "").trim();
				var nNorm = that._normalizeDocNumberForMatch(nRaw);
				if (t !== sTrip || d !== sDocType) {
					return false;
				}
				return (
					!!(sDocRaw && nRaw && sDocRaw === nRaw) ||
					!!(sDocNorm && nNorm && sDocNorm === nNorm)
				);
			};

			var vOD = oTripData.getProperty("/OrderDetails");
			var aOD = this._extractResults(vOD);
			if (aOD && aOD.length) {
				var aFilteredOD = aOD.filter(function (o) {
					return !fnMatchRefDocRow(o.TripNumber, o.DocType, o.DocumentNumber);
				});
				if (aFilteredOD.length !== aOD.length) {
					if (Array.isArray(vOD)) {
						oTripData.setProperty("/OrderDetails", aFilteredOD);
					} else if (vOD && Array.isArray(vOD.results)) {
						oTripData.setProperty("/OrderDetails/results", aFilteredOD);
					}
				}
			}

			var vID = oTripData.getProperty("/ItemDetails");
			var aID = this._extractResults(vID);
			if (aID && aID.length) {
				var aFilteredID = aID.filter(function (o) {
					return !fnMatchRefDocRow(o.TripNumber, o.DocType, o.RefDocNo);
				});
				if (aFilteredID.length !== aID.length) {
					if (Array.isArray(vID)) {
						oTripData.setProperty("/ItemDetails", aFilteredID);
					} else if (vID && Array.isArray(vID.results)) {
						oTripData.setProperty("/ItemDetails/results", aFilteredID);
					}
				}
			}
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
					var oModelCache = this._ensureRefDocModel();
					var aExMatCache = oModelCache.getProperty("/materialDetails") || [];
					var sTripCache = String(oTripData.getProperty("/TripNumber") || "").trim();

					// Use data from TripData (already loaded from expand)
					this._setReferenceDocsFromService(aOrderDetails, true);
					if (!this._shouldSkipEmptyMaterialSnapshot(aItemDetails, aOrderDetails, aExMatCache, sTripCache)) {
						this._setMaterialDetailsFromService(aItemDetails);
					}
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
			var sTripAtRefresh = String(sTripNumber).trim();
			var iRefreshToken = Date.now();
			this._iLastRefDocRefreshToken = iRefreshToken;

			var pOrders = new Promise(function (resolve, reject) {
				oOrderService.read("/OrderDetails", {
					filters: [
						new Filter("TripNumber", FilterOperator.EQ, sTripAtRefresh),
						new Filter("Deleted", FilterOperator.NE, true)
					],
					success: function (oData) {
						resolve((oData && oData.results) ? oData.results : []);
					},
					error: function (oError) {
						reject(oError);
					}
				});
			});

			var pItems = new Promise(function (resolve, reject) {
				oItemService.read("/ItemDetails", {
					filters: [
						new Filter("TripNumber", FilterOperator.EQ, sTripAtRefresh),
						new Filter("IsDeleted", FilterOperator.NE, "X")
					],
					success: function (oData) {
						resolve((oData && oData.results) ? oData.results : []);
					},
					error: function (oError) {
						reject(oError);
					}
				});
			});

			Promise.all([pOrders, pItems]).then(function (aResults) {
				if (that._iLastRefDocRefreshToken !== iRefreshToken) {
					return;
				}
				var oGd = sap.ui.getCore().getModel("globalData");
				var sTripNow = String(oGd && oGd.getProperty("/TripNumber") || "").trim();
				if (sTripNow !== sTripAtRefresh) {
					return;
				}
				var aOrderDetails = aResults[0] || [];
				var aItemDetails = aResults[1] || [];
				var oModelRef = that._ensureRefDocModel();
				var aExMat = oModelRef.getProperty("/materialDetails") || [];
				var bSkipEmptyItems = that._shouldSkipEmptyMaterialSnapshot(
					aItemDetails,
					aOrderDetails,
					aExMat,
					sTripAtRefresh
				);
				that._setReferenceDocsFromService(aOrderDetails, true);
				if (!bSkipEmptyItems) {
					that._setMaterialDetailsFromService(aItemDetails);
				}
			}).catch(function (oError) {
				// Do not clear UI on refresh failure (error is not "empty trip").
				if (typeof console !== "undefined" && console.error) {
					console.error("ReferenceDocuments: atomic refresh failed", oError);
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
					var bVis = !!oColumn.visible;
					oCol.setVisible(bVis);
					// Column visibility and header control visibility can get out of sync (e.g. EWB Date header stayed blank).
					var oHeader = oCol.getHeader();
					if (oHeader && oHeader.setVisible) {
						oHeader.setVisible(bVis);
					}
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

