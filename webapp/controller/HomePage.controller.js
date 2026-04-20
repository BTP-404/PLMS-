sap.ui.define(
  [
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/odata/v2/ODataModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/SelectDialog",
    "sap/m/StandardListItem",
    "sap/m/SuggestionItem",
    "sap/ui/core/Fragment",
    "sap/ui/model/json/JSONModel",
    "sap/ndc/BarcodeScanner",
    "com/incresolZ_INC_PLMS/util/MovementScenarioIcons",
    "com/incresolZ_INC_PLMS/util/TripDataDocumentsVerified",
  ],
  function (
    Controller,
    ODataModel,
    MessageToast,
    MessageBox,
    Filter,
    FilterOperator,
    SelectDialog,
    StandardListItem,
    SuggestionItem,
    Fragment,
    JSONModel,
    BarcodeScanner,
    MovementScenarioIcons,
    TripDataDocumentsVerified
  ) {
    "use strict";

    return Controller.extend("com.incresolZ_INC_PLMS.controller.HomePage", {
      onInit: function () {
        var serviceUrl = "/sap/opu/odata/sap/YIGP_PLMS_SRV/";
        var oModel = new ODataModel(serviceUrl, {
          useBatch: false,
          defaultBindingMode: "TwoWay",
        });
        this.getView().setModel(oModel);
        this._sVehicleNumberNeedleLower = "";
        this._bHomeInitialLoadDone = false;
        this._bHomeFilterInitialApplyDone = false;
        this.getView().setModel(
          new JSONModel({
            reportDateFrom: null,
            reportDateTo: null,
          }),
          "homeFilter"
        );
        this._initializeColumnVisibility();
        this.getView().addEventDelegate(
          {
            onAfterShow: function () {
              if (!this._bHomeFilterInitialApplyDone) {
                this._bHomeFilterInitialApplyDone = true;
                this._applyTableFilter();
              }
            },
          },
          this
        );
        this._loadMovementScenarioDescriptions();
        // this is for refresh the table data when user cancels the trip
        this._oEventBus = sap.ui.getCore().getEventBus();

        this._oEventBus.subscribe(
          "HomePage",
          "RefreshTripTable",
          this._onExternalRefresh,
          this
        );

        // Attach route matched event to automatically refresh table when navigating to HomePage
        var oRouter = this.getOwnerComponent().getRouter();
        if (oRouter) {
          oRouter.getRoute("HomePage").attachPatternMatched(this._onRouteMatched, this);
        }

        this._oReportVehicleMatOptsModel = new JSONModel({
          selectedIndex: 0,
        });
        this._oIncomingEntryMethodModel = new JSONModel({
          selectedKey: "PO",
          entryComplete: false,
          skipDocument: false,
          hasPoValue: false,
        });
        this._oIncomingPoSuggestModel = new JSONModel({ items: [] });
        this._oOutgoingPoSuggestModel = new JSONModel({ items: [] });
        this._oOutgoingInvoiceSuggestModel = new JSONModel({ items: [] });
        this._mOutgoingInvoiceSuggestAll = {
          INVOICE: null,
          CHALLAN: null,
        };
        this._mOutgoingInvoiceSuggestLoadPromise = {};
        this._oOutgoingMovementScenarioOptionsModel = new JSONModel({
          items: [],
        });
        this._oOutgoingVehicleTypeOptionsModel = new JSONModel({ items: [] });
        this._oOutgoingEntryMethodModel = new JSONModel({
          selectedScenarioItemKey: "",
          selectedVehicleType: "",
          selectedVehicleTypeDesc: "",
          selectedKey: "INVOICE",
          billingDocument: "",
          poNumber: "",
          skipDocumentInvoice: false,
          skipDocumentPo: false,
          invoiceMovementType: "",
          invoiceMovementScenario: "",
          invoiceMovementDescription: "",
        });
        this._loadOutgoingMovementScenarioOptions();
        this._sLastPostedPoNumber = null;
        this._sPendingOrderDetailPo = null;
        this._bIncomingFromCameraScan = false;
        this._bIncomingScanBackendError = false;
        this._sIncomingOptimisticTempId = null;
        this._bIncomingExpectItemPoll = false;
      },

      onExit: function () {
        if (this._iTripTableTintDeferred) {
          clearTimeout(this._iTripTableTintDeferred);
          this._iTripTableTintDeferred = null;
        }
        if (this._iFilterInputDebounce) {
          clearTimeout(this._iFilterInputDebounce);
          this._iFilterInputDebounce = null;
        }
        if (this._iIncomingDialogPoSuggestTimeout) {
          clearTimeout(this._iIncomingDialogPoSuggestTimeout);
          this._iIncomingDialogPoSuggestTimeout = null;
        }
        if (this._iOutgoingDialogPoSuggestTimeout) {
          clearTimeout(this._iOutgoingDialogPoSuggestTimeout);
          this._iOutgoingDialogPoSuggestTimeout = null;
        }
        if (this._iOutgoingInvoiceSuggestTimeout) {
          clearTimeout(this._iOutgoingInvoiceSuggestTimeout);
          this._iOutgoingInvoiceSuggestTimeout = null;
        }

        if (this._oReportVehicleMaterialDialog) {
          this._oReportVehicleMaterialDialog.destroy();
          this._oReportVehicleMaterialDialog = null;
        }
        if (this._oIncomingEntryMethodDialog) {
          this._oIncomingEntryMethodDialog.destroy();
          this._oIncomingEntryMethodDialog = null;
        }

        this._oEventBus?.unsubscribe(
          "HomePage",
          "RefreshTripTable",
          this._onExternalRefresh,
          this
        );

        // Detach route matched event
        var oRouter = this.getOwnerComponent().getRouter();
        if (oRouter) {
          oRouter.getRoute("HomePage").detachPatternMatched(this._onRouteMatched, this);
        }
      },

      _validateNumericDocNumber10: function (sValue, sLabel, bShowMessage) {
        var sTrimmed = String(sValue || "").trim();
        if (!/^\d{1,10}$/.test(sTrimmed)) {
          if (bShowMessage) {
            MessageBox.error("Enter a valid numeric " + sLabel + " (max 10 digits)");
          }
          return "";
        }
        return sTrimmed;
      },

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

      // --------------------------------------------
      // NAVIGATION
      // --------------------------------------------
      onReportVehicle: function () {
        if (!this._oReportVehicleMatOptsModel) {
          this._oReportVehicleMatOptsModel = new JSONModel({
            selectedIndex: 0,
          });
        } else {
          this._oReportVehicleMatOptsModel.setData({
            selectedIndex: 0,
          });
        }

        this._openIncomingEntryMethodDialog();
      },

      _openReportVehicleMaterialDialog: function () {
        if (!this._oReportVehicleMaterialDialog) {
          Fragment.load({
            id: this.getView().getId(),
            name: "com.incresolZ_INC_PLMS.fragments.HomePageFrags.ReportVehicleMaterialOptions",
            controller: this,
          }).then(
            function (oDialog) {
              this._oReportVehicleMaterialDialog = oDialog;
              this.getView().addDependent(oDialog);
              oDialog.setModel(
                this._oReportVehicleMatOptsModel,
                "reportVehicleMatOpts"
              );
              oDialog.open();
            }.bind(this)
          );
        } else {
          this._oReportVehicleMaterialDialog.open();
        }
      },

      onCancelReportVehicleMaterialDialog: function () {
        if (this._oReportVehicleMaterialDialog) {
          this._oReportVehicleMaterialDialog.close();
        }
      },

      onReportVehicleMaterialDialogAfterOpen: function () {
        var sViewId = this.getView().getId();
        var oGroup = Fragment.byId(sViewId, "GroupA");
        if (oGroup) {
          oGroup.setSelectedIndex(-1);
        }
        if (this._oReportVehicleMatOptsModel) {
          this._oReportVehicleMatOptsModel.setProperty("/selectedIndex", -1);
        }
      },

      onReportVehicleMaterialRadioSelect: function (oEvent) {
        var iSelected = oEvent.getParameter("selectedIndex");
        if (this._oReportVehicleMatOptsModel) {
          this._oReportVehicleMatOptsModel.setProperty(
            "/selectedIndex",
            iSelected
          );
        }
        if (iSelected === 0 && this._oOutgoingEntryMethodModel) {
          var aSc =
            this._oOutgoingMovementScenarioOptionsModel &&
            this._oOutgoingMovementScenarioOptionsModel.getProperty("/items");
          aSc = aSc && aSc.length ? aSc : [];
          this._oOutgoingEntryMethodModel.setData({
            selectedScenarioItemKey: aSc.length ? aSc[0].ItemKey : "",
            selectedVehicleType: "",
            selectedVehicleTypeDesc: "",
            selectedKey: "INVOICE",
            billingDocument: "",
            poNumber: "",
            skipDocumentInvoice: false,
            skipDocumentPo: false,
            invoiceMovementType: "",
            invoiceMovementScenario: "",
            invoiceMovementDescription: "",
          });
        }
        var that = this;
        if (iSelected === 1) {
          setTimeout(function () {
            that._focusOutgoingEntryMethodPrimaryInput(150);
          }, 0);
        } else if (iSelected === 0) {
          setTimeout(function () {
            that._focusIncomingEntryMethodPrimaryInput(150);
          }, 0);
        }
      },

      onContinueReportVehicleMaterialDialog: function () {
        var oOpts = this._oReportVehicleMatOptsModel;
        if (!oOpts) {
          return;
        }
        var iSel = oOpts.getProperty("/selectedIndex");
        if (iSel === undefined || iSel === null || iSel < 0) {
          MessageToast.show("Select an option before continuing.");
          return;
        }

        var bIncoming = iSel === 0;
        var bOutgoing = iSel === 1;

        var oGlobalModel = sap.ui.getCore().getModel("globalData");
        if (!oGlobalModel) {
          oGlobalModel = new JSONModel({
            TripNumber: "",
            HasIncomingMaterials: bIncoming,
            HasOutgoingMaterials: bOutgoing,
            IncomingReportingMethod: null,
          });
          sap.ui.getCore().setModel(oGlobalModel, "globalData");
        } else {
          oGlobalModel.setProperty("/TripNumber", "");
          oGlobalModel.setProperty("/HasIncomingMaterials", bIncoming);
          oGlobalModel.setProperty("/HasOutgoingMaterials", bOutgoing);
        }

        if (this._oReportVehicleMaterialDialog) {
          this._oReportVehicleMaterialDialog.close();
        }

        if (bIncoming) {
          this._openIncomingEntryMethodDialog();
        } else {
          oGlobalModel.setProperty("/IncomingReportingMethod", null);
          this._executeNewReportVehicleNavigation();
        }
      },

      _openIncomingEntryMethodDialog: function () {
        if (!this._oIncomingEntryMethodModel) {
          this._oIncomingEntryMethodModel = new JSONModel({
            selectedKey: "PO",
            entryComplete: false,
            skipDocument: false,
            hasPoValue: false,
          });
        } else {
          this._oIncomingEntryMethodModel.setData({
            selectedKey: "PO",
            entryComplete: false,
            skipDocument: false,
            hasPoValue: false,
          });
        }
        if (this._oIncomingPoSuggestModel) {
          this._oIncomingPoSuggestModel.setData({ items: [] });
        }
        if (!this._oOutgoingInvoiceResponseModel) {
          this._oOutgoingInvoiceResponseModel = new JSONModel({
            loading: false,
            results: [],
            selected: null,
            showVehicleType: false,
          });
        } else {
          this._oOutgoingInvoiceResponseModel.setData({
            loading: false,
            results: [],
            selected: null,
            showVehicleType: false,
          });
        }

        if (!this._oIncomingEntryMethodDialog) {
          Fragment.load({
            id: this.getView().getId(),
            name: "com.incresolZ_INC_PLMS.fragments.HomePageFrags.IncomingEntryMethod",
            controller: this,
          }).then(
            function (oDialog) {
              this._oIncomingEntryMethodDialog = oDialog;
              this.getView().addDependent(oDialog);
              oDialog.setModel(
                this._oIncomingEntryMethodModel,
                "incomingEntryMethod"
              );
              oDialog.setModel(
                this._oReportVehicleMatOptsModel,
                "reportVehicleMatOpts"
              );
              oDialog.setModel(
                this._oIncomingPoSuggestModel,
                "incomingPoSuggest"
              );
              oDialog.setModel(
                this._oOutgoingEntryMethodModel,
                "outgoingEntryMethod"
              );
              oDialog.setModel(
                this._oOutgoingPoSuggestModel,
                "outgoingPoSuggest"
              );
              oDialog.setModel(
                this._oOutgoingInvoiceSuggestModel,
                "outgoingInvoiceSuggest"
              );
              oDialog.setModel(
                this._oOutgoingInvoiceResponseModel,
                "outgoingInvoiceResponse"
              );
              oDialog.setModel(
                this._oOutgoingVehicleTypeOptionsModel,
                "outgoingVehicleTypeOptions"
              );
              oDialog.setModel(
                this._oOutgoingMovementScenarioOptionsModel,
                "outgoingMovementScenarioOptions"
              );
              oDialog.open();
            }.bind(this)
          );
        } else {
          if (this._oOutgoingMovementScenarioOptionsModel) {
            this._oIncomingEntryMethodDialog.setModel(
              this._oOutgoingMovementScenarioOptionsModel,
              "outgoingMovementScenarioOptions"
            );
          }
          this._oIncomingEntryMethodDialog.open();
        }
      },

      onIncomingEntryMethodDialogAfterOpen: function () {
        this._resetIncomingEntryMethodDialogFields();
        var that = this;
        setTimeout(function () {
          var sViewId = that.getView().getId();
          var iMv = that._oReportVehicleMatOptsModel
            ? that._oReportVehicleMatOptsModel.getProperty("/selectedIndex")
            : 0;
          if (iMv === 1) {
            that._focusOutgoingEntryMethodPrimaryInput(150);
            return;
          }
          var sKey = that._oIncomingEntryMethodModel
            ? that._oIncomingEntryMethodModel.getProperty("/selectedKey")
            : "";
          var oFocusIn =
            sKey === "SCAN"
              ? Fragment.byId(sViewId, "idIncomingDialogScanInput")
              : Fragment.byId(sViewId, "idIncomingDialogPoInput");
          if (oFocusIn && oFocusIn.focus) {
            oFocusIn.focus();
          }
        }, 150);
      },

      /**
       * Outgoing Report Vehicle: focus movement scenario dropdown.
       */
      _focusOutgoingEntryMethodPrimaryInput: function (iDelay) {
        var that = this;
        var iMs = typeof iDelay === "number" ? iDelay : 100;
        var fnFocus = function () {
          if (!that._oIncomingEntryMethodDialog) {
            return;
          }
          var sViewId = that.getView().getId();
          var oFocus = Fragment.byId(sViewId, "idOutgoingMovementScenarioSelect");
          if (oFocus && oFocus.focus) {
            oFocus.focus();
          }
        };
        setTimeout(fnFocus, iMs);
        setTimeout(fnFocus, iMs + 120);
      },

      _resetIncomingEntryMethodDialogFields: function () {
        var sViewId = this.getView().getId();
        var oIncomingMode = Fragment.byId(
          sViewId,
          "idIncomingEntrySearchModeGroup"
        );
        if (oIncomingMode && oIncomingMode.setSelectedIndex) {
          oIncomingMode.setSelectedIndex(0);
        }
        var oPoIn = Fragment.byId(sViewId, "idIncomingDialogPoInput");
        if (oPoIn) {
          oPoIn.setValue("");
        }
        var oScanIn = Fragment.byId(sViewId, "idIncomingDialogScanInput");
        if (oScanIn) {
          oScanIn.setValue("");
        }
        if (this._oIncomingEntryMethodModel) {
          this._oIncomingEntryMethodModel.setProperty("/selectedKey", "PO");
          this._oIncomingEntryMethodModel.setProperty("/entryComplete", false);
          this._oIncomingEntryMethodModel.setProperty("/skipDocument", false);
          this._oIncomingEntryMethodModel.setProperty("/hasPoValue", false);
        }
        if (this._oIncomingPoSuggestModel) {
          this._oIncomingPoSuggestModel.setProperty("/items", []);
        }
        var oOutSc = Fragment.byId(sViewId, "idOutgoingMovementScenarioSelect");
        var aScItems =
          this._oOutgoingMovementScenarioOptionsModel &&
          this._oOutgoingMovementScenarioOptionsModel.getProperty("/items");
        aScItems = aScItems && aScItems.length ? aScItems : [];
        var sDefaultScenario = aScItems.length ? aScItems[0].ItemKey : "";
        if (oOutSc && oOutSc.setSelectedKey && sDefaultScenario) {
          oOutSc.setSelectedKey(sDefaultScenario);
        }
        if (this._oOutgoingEntryMethodModel) {
          this._oOutgoingEntryMethodModel.setData({
            selectedScenarioItemKey: sDefaultScenario,
            selectedVehicleType: "",
            selectedVehicleTypeDesc: "",
            selectedKey: "INVOICE",
            billingDocument: "",
            poNumber: "",
            skipDocumentInvoice: false,
            skipDocumentPo: false,
            invoiceMovementType: "",
            invoiceMovementScenario: "",
            invoiceMovementDescription: "",
          });
        }
        if (sDefaultScenario === "O02") {
          this._loadOutgoingVehicleTypeOptions();
        }
        if (this._oOutgoingPoSuggestModel) {
          this._oOutgoingPoSuggestModel.setProperty("/items", []);
        }
        if (this._oOutgoingInvoiceSuggestModel) {
          this._oOutgoingInvoiceSuggestModel.setProperty("/items", []);
        }
        if (!this._oOutgoingInvoiceResponseModel) {
          this._oOutgoingInvoiceResponseModel = new JSONModel({
            loading: false,
            results: [],
            selected: null,
            showVehicleType: false,
          });
        } else {
          this._oOutgoingInvoiceResponseModel.setData({
            loading: false,
            results: [],
            selected: null,
            showVehicleType: false,
          });
        }
        if (this._oOutgoingEntryMethodModel) {
          this._oOutgoingEntryMethodModel.setProperty("/selectedVehicleType", "");
          this._oOutgoingEntryMethodModel.setProperty("/selectedVehicleTypeDesc", "");
          this._oOutgoingEntryMethodModel.setProperty("/existingTripNo", "");
        }
        var oOutInv = Fragment.byId(sViewId, "idOutgoingDialogInvoiceInput");
        if (oOutInv) {
          oOutInv.setValue("");
        }
        var oOutPo = Fragment.byId(sViewId, "idOutgoingDialogPoInput");
        if (oOutPo) {
          oOutPo.setValue("");
        }
        if (this._oIncomingEntryMethodDialog) {
          this._oIncomingEntryMethodDialog.setBusy(false);
        }
        this._sLastPostedPoNumber = null;
        this._sPendingOrderDetailPo = null;
        this._bIncomingFromCameraScan = false;
      },

      /**
       * Puts focus on the PO or scan field for the incoming dialog (matches selectedKey).
       * Uses two timeouts so focus survives MessageBox close and short UI5 rerenders.
       * @param {number} [iDelay] First focus attempt delay in ms (default 100).
       */
      _focusIncomingEntryMethodPrimaryInput: function (iDelay) {
        var that = this;
        var iMs = typeof iDelay === "number" ? iDelay : 100;
        var fnFocus = function () {
          if (!that._oIncomingEntryMethodDialog) {
            return;
          }
          var sViewId = that.getView().getId();
          var sKey = that._oIncomingEntryMethodModel
            ? that._oIncomingEntryMethodModel.getProperty("/selectedKey")
            : "";
          var oFocus =
            sKey === "SCAN"
              ? Fragment.byId(sViewId, "idIncomingDialogScanInput")
              : Fragment.byId(sViewId, "idIncomingDialogPoInput");
          if (oFocus && oFocus.focus) {
            oFocus.focus();
          }
        };
        setTimeout(fnFocus, iMs);
        setTimeout(fnFocus, iMs + 120);
      },

      onContinueReportVehicleCombinedDialog: function () {
        var oGlobalModel = sap.ui.getCore().getModel("globalData");
        if (!oGlobalModel) {
          oGlobalModel = new JSONModel({
            TripNumber: "",
            HasIncomingMaterials: false,
            HasOutgoingMaterials: false,
            IncomingReportingMethod: null,
          });
          sap.ui.getCore().setModel(oGlobalModel, "globalData");
        }

        var iSel = this._oReportVehicleMatOptsModel
          ? this._oReportVehicleMatOptsModel.getProperty("/selectedIndex")
          : -1;

        var bIncoming = iSel === 0;
        var bOutgoing = iSel === 1;

        oGlobalModel.setProperty("/TripNumber", "");
        oGlobalModel.setProperty("/HasIncomingMaterials", bIncoming);
        oGlobalModel.setProperty("/HasOutgoingMaterials", bOutgoing);

        if (bOutgoing) {
          oGlobalModel.setProperty("/IncomingReportingMethod", null);
          this._clearIncomingGlobalForOutgoing();
          if (!this._validateAndNavigateOutgoingReportVehicle()) {
            return;
          }
          if (this._oIncomingEntryMethodDialog) {
            this._oIncomingEntryMethodDialog.close();
          }
          this._executeNewReportVehicleNavigation();
          return;
        }

        // Incoming path:
        // - PO: user is doing Gate Entry (no trip yet). We store PO and navigate to create-mode Stage,
        //       so Reference Documents can be filtered/prefilled from OrderDetails.
        // - SCAN: keep existing “create trip then Continue” behavior
        var sKey = this._oIncomingEntryMethodModel
          ? this._oIncomingEntryMethodModel.getProperty("/selectedKey")
          : "";
        if (sKey === "PO") {
          this._incomingDialogNavigateToGateEntryWithPo();
          return;
        }
        this.onContinueIncomingEntryMethodDialog();
      },

      _incomingDialogSetGateEntryModels: function (m) {
        var oGlobalModel = sap.ui.getCore().getModel("globalData");
        if (!oGlobalModel) {
          oGlobalModel = new JSONModel({ TripNumber: "" });
          sap.ui.getCore().setModel(oGlobalModel, "globalData");
        }

        // Gate entry / create mode: no TripNumber yet.
        oGlobalModel.setProperty("/TripNumber", "");
        oGlobalModel.setProperty("/IncomingPoNumber", (m && m.po) ? m.po : "");
        oGlobalModel.setProperty(
          "/IncomingRefDocDocType",
          (m && m.docType) ? m.docType : ""
        );
        oGlobalModel.setProperty("/IncomingReportingMethod", "PO");
        oGlobalModel.setProperty(
          "/IncomingRefDocSkip",
          (m && m.refDocSkip !== undefined) ? m.refDocSkip : " "
        );
        oGlobalModel.setProperty(
          "/IncomingMovementScenarioDesc",
          (m && m.movementScenarioDesc !== undefined) ? m.movementScenarioDesc : ""
        );
        oGlobalModel.setProperty(
          "/IncomingMovementType",
          (m && m.movementType !== undefined) ? m.movementType : ""
        );
        oGlobalModel.setProperty(
          "/IncomingMovementScenario",
          (m && m.movementScenario !== undefined) ? m.movementScenario : ""
        );

        var oTripData = sap.ui.getCore().getModel("TripData");
        if (!oTripData) {
          oTripData = new JSONModel({});
          sap.ui.getCore().setModel(oTripData, "TripData");
        }

        if (m) {
          if (m.docType !== undefined) {
            oTripData.setProperty("/RefDocType", m.docType);
          }
          if (m.po !== undefined) {
            oTripData.setProperty("/RefDocNo", m.po);
          }
          if (m.refDocSkip !== undefined) {
            oTripData.setProperty("/RefDocSkip", m.refDocSkip);
          }
          if (m.movementScenarioDesc !== undefined) {
            oTripData.setProperty("/MovementScenarioDesc", m.movementScenarioDesc);
          }
          if (m.movementType !== undefined) {
            oTripData.setProperty("/MovementType", m.movementType);
            var sMt = String(m.movementType || "").toUpperCase().trim();
            if (sMt === "I") {
              oTripData.setProperty("/MovementTypeDesc", "Inward");
            } else if (sMt === "O") {
              oTripData.setProperty("/MovementTypeDesc", "Outward");
            }
          }
          if (m.movementScenario !== undefined) {
            oTripData.setProperty("/MovementScenario", m.movementScenario);
          }

          // Keep UI in sync (movement scenario dropdown uses item key)
          try {
            var sKey = MovementScenarioIcons.getMovementScenarioItemKey(
              oTripData.getProperty("/MovementType"),
              oTripData.getProperty("/MovementScenario")
            );
            oTripData.setProperty("/MovementScenarioItemKey", sKey || "");
          } catch (e) {
            // ignore
          }
        }

        sap.ui.getCore().getEventBus().publish("TripData", "Updated");
      },

      _incomingDialogNavigateToGateEntryWithPo: function () {
        var sViewId = this.getView().getId();
        var oIn = Fragment.byId(sViewId, "idIncomingDialogPoInput");
        var sPoRaw = oIn && oIn.getValue ? String(oIn.getValue() || "").trim() : "";
        var sPo = this._validateNumericDocNumber10(sPoRaw, "PO number", !!sPoRaw);

        var bSkip = !!(
          this._oIncomingEntryMethodModel &&
          this._oIncomingEntryMethodModel.getProperty("/skipDocument")
        );

        // Validation: PO should be there OR Skip Document should be Yes
        if (sPoRaw && !sPo) {
          this._focusIncomingEntryMethodPrimaryInput(150);
          return;
        }
        if (!sPo && !bSkip) {
          var thatVal = this;
          MessageBox.error("Enter/select a PO number or choose Skip Document.", {
            onClose: function () {
              thatVal._focusIncomingEntryMethodPrimaryInput(150);
            },
          });
          return;
        }

        var sRefDocSkip = bSkip ? "X" : " ";
        var oModel = this.getView().getModel();
        var that = this;

        var fnCloseAndNav = function () {
          if (that._oIncomingEntryMethodDialog) {
            that._oIncomingEntryMethodDialog.setBusy(false);
            that._oIncomingEntryMethodDialog.close();
          }
          sap.ui.core.UIComponent.getRouterFor(that).navTo("Stage");
          sap.ui.getCore().getEventBus().publish("HomePage", "RefreshTripTable");
        };

        var fnApplyAndNav = function (mPrefill) {
          var m = mPrefill || {};
          that._incomingDialogSetGateEntryModels({
            po: sPo,
            refDocSkip: sRefDocSkip,
            docType:
              m.docType !== undefined && m.docType !== null ? m.docType : "",
            movementScenarioDesc:
              m.movementScenarioDesc !== undefined && m.movementScenarioDesc !== null
                ? m.movementScenarioDesc
                : "",
            movementType:
              m.movementType !== undefined && m.movementType !== null ? m.movementType : "",
            movementScenario:
              m.movementScenario !== undefined && m.movementScenario !== null
                ? m.movementScenario
                : "",
          });
          fnCloseAndNav();
        };

        // Skip-only path: no PO => nothing to fetch
        if (!sPo) {
          fnApplyAndNav({});
          return;
        }

        // If backend model is unavailable, still continue with PO stored and skip flag
        if (!oModel) {
          fnApplyAndNav({});
          return;
        }

        if (this._oIncomingEntryMethodDialog) {
          this._oIncomingEntryMethodDialog.setBusy(true);
        }

        var fnShowPoNumberShReadFailed = function (oError) {
          if (that._oIncomingEntryMethodDialog) {
            that._oIncomingEntryMethodDialog.setBusy(false);
          }
          var sMsg = that._getODataErrorMessage(
            oError,
            "Could not read PO details"
          );
          MessageBox.error(sMsg, {
            onClose: function () {
              that._focusIncomingEntryMethodPrimaryInput(150);
            },
          });
        };

        var fnParsePoRow = function (oRow) {
          // PoNumberSH (YIGP_PLMS_SRV): MovementType (I/O), MovementScenario (e.g. "04"),
          // scenario text in MovementDescription (preferred) or MovementScenarioDesc / LongText.
          if (!oRow) {
            return {
              movementType: "",
              movementScenario: "",
              movementScenarioDesc: "",
              docType: "",
            };
          }
          var sMt =
            oRow.MovementType !== undefined && oRow.MovementType !== null
              ? String(oRow.MovementType).trim()
              : "";
          var sMs =
            oRow.MovementScenario !== undefined && oRow.MovementScenario !== null
              ? String(oRow.MovementScenario).trim()
              : "";
          var sDocType =
            oRow.DocType !== undefined && oRow.DocType !== null
              ? String(oRow.DocType).trim()
              : oRow.DocumentType !== undefined && oRow.DocumentType !== null
                ? String(oRow.DocumentType).trim()
                : "";
          var sDesc = "";
          if (oRow.MovementDescription != null && String(oRow.MovementDescription).trim() !== "") {
            sDesc = String(oRow.MovementDescription).trim();
          } else if (
            oRow.MovementScenarioDesc != null &&
            String(oRow.MovementScenarioDesc).trim() !== ""
          ) {
            sDesc = String(oRow.MovementScenarioDesc).trim();
          } else if (oRow.LongText != null && String(oRow.LongText).trim() !== "") {
            sDesc = String(oRow.LongText).trim();
          }
          return {
            movementType: sMt,
            movementScenario: sMs,
            movementScenarioDesc: sDesc,
            docType: sDocType,
          };
        };

        var fnReadPoNumberShCollection = function (sFilterProp, fnNextFallback) {
          oModel.read("/PoNumberSH", {
            filters: [new Filter(sFilterProp, FilterOperator.EQ, sPo)],
            urlParameters: { $top: "1" },
            success: function (oData2) {
              var oRow2 =
                oData2 && oData2.results && oData2.results[0] ? oData2.results[0] : null;
              if (oRow2) {
                fnApplyAndNav(fnParsePoRow(oRow2));
              } else if (fnNextFallback) {
                fnNextFallback();
              } else {
                fnApplyAndNav({});
              }
            },
            error: function (oError) {
              if (fnNextFallback) {
                fnNextFallback();
              } else {
                fnShowPoNumberShReadFailed(oError);
              }
            },
          });
        };

        // Prefer direct key read first; fallback to collection read for any key-read error.
        oModel.read("/PoNumberSH('" + encodeURIComponent(sPo) + "')", {
          success: function (oData) {
            var oRow =
              (oData && oData.d) ? oData.d : oData; // support raw "d" envelope if present
            fnApplyAndNav(fnParsePoRow(oRow));
          },
          error: function (oError) {
            // Some backends reject direct key addressing even for valid PO values.
            // Always try collection fallback before showing an error.
            fnReadPoNumberShCollection("PoNumber", function () {
              fnShowPoNumberShReadFailed(oError);
            });
          },
        });
      },

      onIncomingEntryMethodSelectChange: function (oEvent) {
        var sViewId = this.getView().getId();
        var oIncomingMode = Fragment.byId(
          sViewId,
          "idIncomingEntrySearchModeGroup"
        );
        var iIdx =
          oEvent && oEvent.getParameter
            ? oEvent.getParameter("selectedIndex")
            : -1;
        if (iIdx === undefined || iIdx === null || iIdx < 0) {
          iIdx =
            oIncomingMode && oIncomingMode.getSelectedIndex
              ? oIncomingMode.getSelectedIndex()
              : 0;
        }
        var sKey = iIdx === 1 ? "SCAN" : "PO";
        if (this._oIncomingEntryMethodModel) {
          this._oIncomingEntryMethodModel.setProperty("/selectedKey", sKey || "");
          this._oIncomingEntryMethodModel.setProperty("/entryComplete", false);
          this._oIncomingEntryMethodModel.setProperty("/skipDocument", false);
          this._oIncomingEntryMethodModel.setProperty("/hasPoValue", false);
        }
        sap.ui.getCore().setModel(null, "TripData");
        var oPoIn = Fragment.byId(sViewId, "idIncomingDialogPoInput");
        if (oPoIn) {
          oPoIn.setValue("");
        }
        var oScanIn = Fragment.byId(sViewId, "idIncomingDialogScanInput");
        if (oScanIn) {
          oScanIn.setValue("");
        }
        if (this._oIncomingPoSuggestModel) {
          this._oIncomingPoSuggestModel.setProperty("/items", []);
        }
        this._sLastPostedPoNumber = null;

        var that = this;
        var fnFocus = function () {
          var oFocus = null;
          if (sKey === "PO") {
            oFocus = Fragment.byId(that.getView().getId(), "idIncomingDialogPoInput");
          } else if (sKey === "SCAN") {
            oFocus = Fragment.byId(that.getView().getId(), "idIncomingDialogScanInput");
          }
          if (oFocus && oFocus.focus) {
            oFocus.focus();
          }
        };
        setTimeout(fnFocus, 100);
        // Second pass: survive rerender / panel visibility switch.
        setTimeout(fnFocus, 250);
      },

      onCancelIncomingEntryMethodDialog: function () {
        var oGlobal = sap.ui.getCore().getModel("globalData");
        if (oGlobal) {
          oGlobal.setProperty("/HasIncomingMaterials", false);
          oGlobal.setProperty("/HasOutgoingMaterials", false);
          oGlobal.setProperty("/IncomingReportingMethod", null);
          oGlobal.setProperty("/IncomingPoNumber", "");
          oGlobal.setProperty("/IncomingRefDocDocType", "");
        }
        this._clearOutgoingGlobalPrefill();
        sap.ui.getCore().setModel(null, "TripData");
        if (this._oIncomingEntryMethodDialog) {
          this._oIncomingEntryMethodDialog.setBusy(false);
          this._oIncomingEntryMethodDialog.close();
        }
      },

      onContinueIncomingEntryMethodDialog: function () {
        var oOpts = this._oIncomingEntryMethodModel;
        if (!oOpts || !oOpts.getProperty("/entryComplete")) {
          var sIncomingMode = oOpts
            ? String(oOpts.getProperty("/selectedKey") || "").toUpperCase()
            : "";
          if (sIncomingMode === "SCAN" && this._bIncomingScanBackendError) {
            this._focusIncomingEntryMethodPrimaryInput(150);
            return;
          }
          MessageToast.show("Complete PO submit or scan successfully first.");
          this._focusIncomingEntryMethodPrimaryInput(150);
          return;
        }

        var oTrip = sap.ui.getCore().getModel("TripData");
        var sTripNo = oTrip ? oTrip.getProperty("/TripNumber") : "";
        if (!sTripNo) {
          MessageToast.show("Gate pass number is missing.");
          this._focusIncomingEntryMethodPrimaryInput(150);
          return;
        }
        this._navigateToTripFromIncomingDialog(sTripNo);
      },

      onIncomingDialogPoSuggest: function (oEvent) {
        var sValue = (oEvent.getParameter("suggestValue") || "").trim();
        if (this._iIncomingDialogPoSuggestTimeout) {
          clearTimeout(this._iIncomingDialogPoSuggestTimeout);
        }
        var that = this;
        this._iIncomingDialogPoSuggestTimeout = setTimeout(function () {
          that._loadIncomingDialogPoSuggestions(sValue);
        }, 300);
      },

      _loadIncomingDialogPoSuggestions: function (sTerm) {
        var oModel = this.getView().getModel();
        if (!oModel || !this._oIncomingPoSuggestModel) {
          return;
        }
        sTerm = String(sTerm || "").trim();
        if (!sTerm || sTerm.length < 2) {
          this._sIncomingDialogPoSuggestLastTerm = "";
          this._oIncomingPoSuggestModel.setProperty("/items", []);
          return;
        }
        if (this._sIncomingDialogPoSuggestLastTerm === sTerm) {
          return;
        }
        this._sIncomingDialogPoSuggestLastTerm = sTerm;

        var oFilter;
        if (/^\d+$/.test(sTerm)) {
          oFilter = new Filter("PoNumber", FilterOperator.Contains, sTerm);
        } else {
          oFilter = new Filter("VendorName", FilterOperator.Contains, sTerm);
        }

        var that = this;
        var fnSuccess = function (oData) {
          var a = (oData && oData.results) || [];
          var mSeen = {};
          var aItems = [];
          a.forEach(function (o) {
            var n = (o.PoNumber && String(o.PoNumber).trim()) || "";
            if (n && !mSeen[n]) {
              mSeen[n] = true;
              aItems.push({
                PoNumber: n,
                VendorName: (o.VendorName && String(o.VendorName).trim()) || "",
              });
            }
          });
          that._oIncomingPoSuggestModel.setProperty("/items", aItems);
        };

        oModel.read("/PoNumberSH", {
          filters: [oFilter],
          urlParameters: {
            $top: "20",
            $skip: "0",
          },
          success: fnSuccess,
          error: function () {
            that._oIncomingPoSuggestModel.setProperty("/items", []);
          },
        });
      },

      onIncomingDialogPoSuggestionSelected: function (oEvent) {
        var oItem = oEvent.getParameter("selectedItem");
        if (!oItem) {
          return;
        }
        var sPo = oItem.getText();
        oEvent.getSource().setValue(sPo);
        this._syncIncomingSkipDocumentState(sPo);
      },

      onIncomingDialogPoInputLiveChange: function (oEvent) {
        var sPo = (oEvent.getParameter("value") || "").trim();
        this._syncIncomingSkipDocumentState(sPo);
      },

      onIncomingSkipDocumentSelect: function (oEvent) {
        var bSelected = !!oEvent.getParameter("selected");
        if (!bSelected) {
          return;
        }
        var sViewId = this.getView().getId();
        var oPoInput = Fragment.byId(sViewId, "idIncomingDialogPoInput");
        var sPo = oPoInput && oPoInput.getValue ? String(oPoInput.getValue() || "").trim() : "";
        if (!sPo) {
          return;
        }
        if (this._oIncomingEntryMethodModel) {
          this._oIncomingEntryMethodModel.setProperty("/skipDocument", false);
          this._oIncomingEntryMethodModel.setProperty("/hasPoValue", true);
        }
        MessageToast.show("Skip Document cannot be selected when PO number is entered.");
      },

      _syncIncomingSkipDocumentState: function (sPo) {
        var bHasPoValue = !!String(sPo || "").trim();
        if (!this._oIncomingEntryMethodModel) {
          return;
        }
        this._oIncomingEntryMethodModel.setProperty("/hasPoValue", bHasPoValue);
        if (bHasPoValue && this._oIncomingEntryMethodModel.getProperty("/skipDocument")) {
          this._oIncomingEntryMethodModel.setProperty("/skipDocument", false);
        }
      },

      /**
       * @param {boolean} [bSkipTripTableRefresh] When true (e.g. typed D-Note/ASN in scan field),
       *   do not run OData refresh on the home trip list after navigation.
       */
      _navigateToTripFromIncomingDialog: function (sTripNo, sTabKey, bSkipTripTableRefresh) {
        var sTrip = String(sTripNo || "").trim();
        if (!sTrip) {
          MessageToast.show("Gate pass number is missing.");
          this._focusIncomingEntryMethodPrimaryInput(150);
          return;
        }
        var sTab = String(sTabKey || "").trim();

        var oGlobal = sap.ui.getCore().getModel("globalData");
        if (!oGlobal) {
          oGlobal = new JSONModel({ TripNumber: "" });
          sap.ui.getCore().setModel(oGlobal, "globalData");
        }
        oGlobal.setProperty("/TripNumber", sTrip);
        oGlobal.setProperty("/HasIncomingMaterials", false);
        oGlobal.setProperty("/HasOutgoingMaterials", false);
        oGlobal.setProperty("/IncomingReportingMethod", null);

        if (this._oIncomingEntryMethodDialog) {
          this._oIncomingEntryMethodDialog.close();
        }

        var mNavArgs = { tripNo: String(sTrip) };
        if (sTab) {
          mNavArgs["?query"] = { tab: sTab };
        }
        sap.ui.core.UIComponent.getRouterFor(this).navTo("StagewithParam", mNavArgs);
        if (!bSkipTripTableRefresh) {
          sap.ui.getCore().getEventBus().publish("HomePage", "RefreshTripTable");
        }
      },

      _incomingDialogFetchTripByPoAndNavigate: function () {
        var sViewId = this.getView().getId();
        var oIn = Fragment.byId(sViewId, "idIncomingDialogPoInput");
        var sPoRaw = oIn && oIn.getValue ? String(oIn.getValue() || "").trim() : "";
        var sPo = this._validateNumericDocNumber10(sPoRaw, "PO number", true);
        if (!sPo) {
          this._focusIncomingEntryMethodPrimaryInput(150);
          return;
        }

        var oModel = this.getView().getModel();
        if (!oModel) {
          MessageToast.show("Backend model is not available.");
          this._focusIncomingEntryMethodPrimaryInput(150);
          return;
        }

        if (this._oIncomingEntryMethodDialog) {
          this._oIncomingEntryMethodDialog.setBusy(true);
        }

        var that = this;
        oModel.read("/PoNumberSH", {
          filters: [
            new Filter({
              filters: [
                new Filter("PoNumber", FilterOperator.EQ, sPo),
              ],
              and: false,
            }),
          ],
          urlParameters: { $top: "1" },
          success: function (oData) {
            if (that._oIncomingEntryMethodDialog) {
              that._oIncomingEntryMethodDialog.setBusy(false);
            }

            // Support both collection and single-entity response shapes
            var oRow =
              (oData && oData.results && oData.results[0]) ? oData.results[0] : oData;

            var sTripNumber = (oRow && oRow.TripNumber) ? String(oRow.TripNumber).trim() : "";
            if (!sTripNumber) {
              MessageToast.show("No PO matched with the entered PO number.");
              that._focusIncomingEntryMethodPrimaryInput(150);
              return;
            }

            // Load TripDetails (incl. OrderDetails) first, then navigate
            that._loadTripDetailsAfterIncomingDialog(sTripNumber, function () {
              that._navigateToTripFromIncomingDialog(sTripNumber, "gateIn");
            });
          },
          error: function (oError) {
            if (that._oIncomingEntryMethodDialog) {
              that._oIncomingEntryMethodDialog.setBusy(false);
            }
            that._onIncomingIdentificationCreateError(
              oError,
              "Failed to fetch PO details",
              null
            );
          },
        });
      },

      /**
       * Scan field: fires on Enter or when focus leaves after the value changed.
       * Typed entry skips HomePage OData trip-list refresh after successful ASN/D-Note post.
       */
      onIncomingDialogScanChange: function (oEvent) {
        var oIn = oEvent.getSource();
        var sText = (oIn && oIn.getValue ? oIn.getValue() : "") || "";
        sText = String(sText).trim();
        if (!sText) {
          return;
        }
        this._bIncomingScanBackendError = false;
        this._bIncomingFromCameraScan = false;
        this._bIncomingScanSkipTripTableRefresh = true;
        this._incomingDialogProcessScannedCode(sText.split("|")[0]);
      },

      onIncomingDialogScanSubmit: function (oEvent) {
        var oIn = oEvent.getSource();
        var sText = (oIn && oIn.getValue ? oIn.getValue() : "") || "";
        sText = String(sText).trim();
        if (!sText) {
          return;
        }
        this._bIncomingFromCameraScan = false;
        this._incomingDialogProcessScannedCode(sText.split("|")[0]);
      },

      onIncomingDialogScanPress: function () {
        var that = this;
        BarcodeScanner.scan(
          function (oResult) {
            if (oResult.cancelled) {
              that._bIncomingFromCameraScan = false;
              that._clearIncomingDialogScanInput(false);
              return;
            }
            var sParsed = (oResult.text || "").split("|")[0];
            that._bIncomingFromCameraScan = true;
            that._bIncomingScanSkipTripTableRefresh = false;
            that._incomingDialogProcessScannedCode(sParsed);
            that._clearIncomingDialogScanInput();
          },
          function (oError) {
            that._bIncomingFromCameraScan = false;
            MessageToast.show(
              "Scan failed: " + (oError.message || oError)
            );
            that._clearIncomingDialogScanInput(false);
          }
        );
        // UI5 leaves focus on the scan button after press; move it back to the input
        // (same pattern as cancel/error callbacks so typing/scan flow stays in the field).
        that._clearIncomingDialogScanInput(false);
      },

      _incomingDialogParseKeyValueString: function (sString) {
        try {
          var oResult = {};
          var aPairs = sString.split(",");
          aPairs.forEach(function (sPair) {
            var aKeyValue = sPair.split("=");
            if (aKeyValue.length === 2) {
              oResult[aKeyValue[0].trim()] = aKeyValue[1].trim();
            }
          });
          return oResult;
        } catch (e) {
          return null;
        }
      },

      _incomingDialogProcessScannedCode: function (sScannedCode) {
        if (!sScannedCode || !sScannedCode.trim()) {
          this._bIncomingScanSkipTripTableRefresh = false;
          MessageToast.show("Invalid scan code");
          this._clearIncomingDialogScanInput();
          return;
        }
        var oScannedData = null;
        try {
          oScannedData = JSON.parse(sScannedCode);
        } catch (e) {
          oScannedData = this._incomingDialogParseKeyValueString(sScannedCode);
        }
        var sAsnId = oScannedData ? oScannedData.asnId : null;
        var sOrgId = oScannedData ? oScannedData.orgId : null;
        var sPo = sScannedCode.trim();
        this._incomingDialogPostAsnDetails(sAsnId, sOrgId, sPo);
      },

      /**
       * @param {boolean} [bClear=true] When false, only refocus (e.g. after camera cancel or error toast).
       */
      _clearIncomingDialogScanInput: function (bClear) {
        var oIn = Fragment.byId(
          this.getView().getId(),
          "idIncomingDialogScanInput"
        );
        if (oIn) {
          if (bClear !== false) {
            oIn.setValue("");
          }
          var fnFocus = function () {
            oIn.focus();
          };
          setTimeout(fnFocus, 0);
          setTimeout(fnFocus, 100);
          setTimeout(fnFocus, 250);
        }
      },

      _syncMovementScenarioItemKeyOnTripDataHome: function (oTripDataModel) {
        if (!oTripDataModel) {
          return;
        }
        var mt = oTripDataModel.getProperty("/MovementType");
        var ms = oTripDataModel.getProperty("/MovementScenario");
        var sKey = MovementScenarioIcons.getMovementScenarioItemKey(mt, ms);
        oTripDataModel.setProperty("/MovementScenarioItemKey", sKey || "");
      },

      _ensureHomeRefDocModel: function () {
        var oModel = sap.ui.getCore().getModel("refDocModel");
        if (!oModel) {
          oModel = new JSONModel({
            referenceDocs: [],
            materialDetails: [],
            filteredMaterialDetails: [],
            materialDocTypes: [],
            materialRefDocNumbers: [],
          });
          sap.ui.getCore().setModel(oModel, "refDocModel");
        }
        return oModel;
      },

      _clearIncomingOptimisticRefDocs: function () {
        var oModel = sap.ui.getCore().getModel("refDocModel");
        this._sIncomingOptimisticTempId = null;
        if (!oModel) {
          return;
        }
        var aRef = (oModel.getProperty("/referenceDocs") || []).filter(function (r) {
          return !(r && r._incomingPending);
        });
        oModel.setProperty("/referenceDocs", aRef);
      },

      _pushIncomingOptimisticIdentification: function (mInfo) {
        this._clearIncomingOptimisticRefDocs();
        var oModel = this._ensureHomeRefDocModel();
        var sTempId = "incoming_pending_" + Date.now();
        this._sIncomingOptimisticTempId = sTempId;
        var sKind = String((mInfo && mInfo.kind) || "PO").toUpperCase();
        var sDocType = String((mInfo && mInfo.docType) || (sKind === "ASN" ? "ASN" : "PO")).trim() || "PO";
        var sDocNo = String((mInfo && mInfo.documentNumber) || "").trim();
        var sParty =
          (mInfo && mInfo.partyName) ||
          (sKind === "ASN" ? "Submitting ASN…" : "Submitting purchase order…");
        var oRow = {
          tempId: sTempId,
          _incomingPending: true,
          _isLocal: true,
          status: "pending",
          TripNumber: "",
          tripNumber: "",
          DocType: sDocType,
          docType: sDocType,
          DocumentNumber: sDocNo,
          documentNumber: sDocNo,
          partyName: sParty,
          invRefNo: "",
          invRefDate: "",
          movementType: "",
        };
        var aRef = (oModel.getProperty("/referenceDocs") || []).slice();
        aRef.push(oRow);
        oModel.setProperty("/referenceDocs", aRef);
        oModel.updateBindings(true);
        sap.ui.getCore().getEventBus().publish("RefDoc", "MaterialsUpdated");
      },

      _patchIncomingOptimisticWithTrip: function (sTripNumber) {
        var sTempId = this._sIncomingOptimisticTempId;
        if (!sTempId) {
          return;
        }
        var oModel = sap.ui.getCore().getModel("refDocModel");
        if (!oModel) {
          return;
        }
        var sRaw = String(sTripNumber || "").trim();
        var sPadded = sRaw;
        if (/^\d+$/.test(sPadded)) {
          sPadded = sPadded.padStart(10, "0");
        }
        var aRef = (oModel.getProperty("/referenceDocs") || []).map(function (r) {
          if (r && r.tempId === sTempId && r._incomingPending) {
            return Object.assign({}, r, {
              TripNumber: sPadded,
              tripNumber: sPadded,
            });
          }
          return r;
        });
        oModel.setProperty("/referenceDocs", aRef);
        oModel.updateBindings(true);
      },

      _expandedCollectionLength: function (vNav) {
        if (!vNav) {
          return 0;
        }
        if (Array.isArray(vNav)) {
          return vNav.length;
        }
        if (vNav.results && Array.isArray(vNav.results)) {
          return vNav.results.length;
        }
        return 0;
      },

      /**
       * Loads TripDetails after incoming identification. Optionally polls until ItemDetails
       * are populated (PO / async backend item creation).
       */
      _loadTripDetailsAfterIncomingDialog: function (sTripNumber, fnDone, mOpts) {
        var oModel = this.getView().getModel();
        var that = this;
        mOpts = mOpts || {};
        var bPoll = !!mOpts.pollItemDetails;
        var iMax = Math.max(1, Number(mOpts.maxAttempts || 12));
        var iInterval = Math.max(200, Number(mOpts.intervalMs || 400));
        if (!oModel || !sTripNumber) {
          if (typeof fnDone === "function") {
            fnDone();
          }
          return;
        }
        var iAttempt = 0;
        var fnPublishTrip = function (oData) {
          if (oData.Weighment_Req !== undefined) {
            oData.WeighmentRequired =
              oData.Weighment_Req === true || oData.Weighment_Req === "X"
                ? "Y"
                : "N";
          }
          TripDataDocumentsVerified.applyDocumentsVerifiedToVerifiedDocs(oData);
          var oTripDataModel = new JSONModel(oData);
          that._syncMovementScenarioItemKeyOnTripDataHome(oTripDataModel);
          sap.ui.getCore().setModel(oTripDataModel, "TripData");
          sap.ui.getCore().getEventBus().publish("TripData", "Updated");
          sap.ui.getCore().getEventBus().publish("Stage", "TripCreated", {
            tripNumber: sTripNumber,
          });
        };
        var fnAttempt = function () {
          iAttempt += 1;
          oModel.read("/TripDetails('" + sTripNumber + "')", {
            urlParameters: {
              $expand: "OrderDetails,ItemDetails,Feeds,ActivityHistory",
            },
            success: function (oData) {
              fnPublishTrip(oData);
              var iItems = that._expandedCollectionLength(oData && oData.ItemDetails);
              var bContinue =
                bPoll && iItems === 0 && iAttempt < iMax;
              if (bContinue) {
                setTimeout(fnAttempt, iInterval);
                return;
              }
              if (typeof fnDone === "function") {
                fnDone();
              }
            },
            error: function () {
              sap.ui.getCore().getEventBus().publish("Stage", "TripCreated", {
                tripNumber: sTripNumber,
              });
              if (typeof fnDone === "function") {
                fnDone();
              }
            },
          });
        };
        fnAttempt();
      },

      /**
       * POST /AsnDetails — supports ASN scan (AsnId+OrgId) OR PO/D-Note (PoNumber).
       */
      _incomingDialogPostAsnDetails: function (sAsnId, sOrgId, sPoNumber) {
        var oModel = this.getView().getModel();
        var that = this;
        var oPayload = {};
        var sIncomingMode = this._oIncomingEntryMethodModel
          ? String(this._oIncomingEntryMethodModel.getProperty("/selectedKey") || "").toUpperCase()
          : "";

        if (sAsnId && sOrgId) {
          oPayload = { AsnId: sAsnId, OrgId: sOrgId };
          this._sPendingOrderDetailPo = null;
          this._bIncomingExpectItemPoll = false;
        } else if (sPoNumber && String(sPoNumber).trim()) {
          var sPoTrimmed = String(sPoNumber).trim();
          if (sIncomingMode === "PO") {
            sPoTrimmed = this._validateNumericDocNumber10(sPoTrimmed, "PO number", true);
            if (!sPoTrimmed) {
              this._bIncomingScanSkipTripTableRefresh = false;
              this._bIncomingFromCameraScan = false;
              this._clearIncomingDialogScanInput();
              return;
            }
          }
          oPayload = { PoNumber: sPoTrimmed };
          this._sPendingOrderDetailPo = sPoTrimmed;
          this._bIncomingExpectItemPoll = true;
          this._pushIncomingOptimisticIdentification({
            kind: "PO",
            documentNumber: sPoTrimmed,
            docType: "PO",
            partyName: "Submitting purchase order…",
          });
        } else {
          this._bIncomingScanSkipTripTableRefresh = false;
          this._bIncomingFromCameraScan = false;
          MessageToast.show("Invalid input: provide ASN scan or PO number");
          this._clearIncomingDialogScanInput();
          return;
        }

        if (this._oIncomingEntryMethodDialog) {
          this._oIncomingEntryMethodDialog.setBusy(true);
        }
        oModel.create("/AsnDetails", oPayload, {
          headers: { "X-Requested-With": "X" },
          success: function (oResponse) {
            that._onIncomingIdentificationCreateSuccess(oResponse);
          },
          error: function (oError) {
            that._onIncomingIdentificationCreateError(
              oError,
              (sAsnId && sOrgId) ? "Failed to post ASN Details" : "Failed to post PO Number",
              null
            );
          },
        });
      },

      /**
       * POST /PoNumberSH using PoNumber from metadata.
       */
      _incomingDialogPostPoNumber: function (sPo) {
        var sPoNumber = this._validateNumericDocNumber10(sPo, "PO number", true);
        if (!sPoNumber) {
          this._focusIncomingEntryMethodPrimaryInput(150);
          return;
        }

        this._bIncomingScanSkipTripTableRefresh = false;
        this._bIncomingFromCameraScan = false;
        var oModel = this.getView().getModel();
        var that = this;
        this._sPendingOrderDetailPo = sPoNumber;
        this._bIncomingExpectItemPoll = true;
        this._pushIncomingOptimisticIdentification({
          kind: "PO",
          documentNumber: sPoNumber,
          docType: "PO",
          partyName: "Submitting purchase order…",
        });
        if (this._oIncomingEntryMethodDialog) {
          this._oIncomingEntryMethodDialog.setBusy(true);
        }
        oModel.create("/PoNumberSH", { PoNumber: sPoNumber }, {
          headers: { "X-Requested-With": "X" },
          success: function (oResponse) {
            that._onIncomingIdentificationCreateSuccess(oResponse);
          },
            error: function (oError) {
            that._onIncomingIdentificationCreateError(
              oError,
              "Failed to post PO Number",
              sPoNumber
            );
          },
        });
      },

      _createOrderDetailForIncomingPoTrip: function (sTripNumber, sPoNumber, fnDone) {
        var sTripRaw = String(sTripNumber || "").trim();
        var sPo = String(sPoNumber || "").trim();
        if (!sTripRaw || !sPo) {
          if (typeof fnDone === "function") {
            fnDone();
          }
          return;
        }
        var sTripPadded = String(sTripRaw).padStart(10, "0");
        var oModel = this.getView().getModel();
        if (!oModel) {
          if (typeof fnDone === "function") {
            fnDone();
          }
          return;
        }
        var oPayload = {
          TripNumber: sTripPadded,
          DocType: "PO",
          DocumentNumber: sPo,
          Vendor: "",
          Customer: "",
          Name: "",
          Deleted: false,
        };
        var fnCreateOrderDetail = function () {
          oModel.create("/OrderDetails", oPayload, {
            headers: {
              "X-Requested-With": "X",
              "Content-Type": "application/json",
            },
            success: function () {
              if (typeof fnDone === "function") {
                fnDone();
              }
            },
            error: function () {
              if (typeof fnDone === "function") {
                fnDone();
              }
            },
          });
        };

        oModel.read("/OrderDetails", {
          filters: [
            new Filter("TripNumber", FilterOperator.EQ, sTripPadded),
            new Filter("DocType", FilterOperator.EQ, "PO"),
            new Filter("DocumentNumber", FilterOperator.EQ, sPo),
          ],
          urlParameters: {
            $top: "1",
            $skip: "0",
          },
          success: function (oData) {
            var aRows = (oData && oData.results) || [];
            if (aRows.length > 0) {
              if (typeof fnDone === "function") {
                fnDone();
              }
              return;
            }
            fnCreateOrderDetail();
          },
          error: function () {
            // On check failure, proceed with create and let backend enforce uniqueness.
            fnCreateOrderDetail();
          },
        });
      },

      _onIncomingIdentificationCreateSuccess: function (oResponse) {
        this._bIncomingScanBackendError = false;
        if (this._oIncomingEntryMethodDialog) {
          this._oIncomingEntryMethodDialog.setBusy(false);
        }
        var oCoreTrip = sap.ui.getCore().getModel("TripData");
        var sFromCore = oCoreTrip ? oCoreTrip.getProperty("/TripNumber") : "";
        var sTripNumber = oResponse.TripNumber || sFromCore || "";
        var sFormatted = sTripNumber
          ? String(sTripNumber).replace(/^0+/, "") || "0"
          : "";
        if (sTripNumber) {
          var that = this;
          var sPoForOrder = this._sPendingOrderDetailPo;
          this._sPendingOrderDetailPo = null;
          var bPollItems = !!sPoForOrder || !!this._bIncomingExpectItemPoll;
          this._bIncomingExpectItemPoll = false;
          this._patchIncomingOptimisticWithTrip(sTripNumber);
          var fnNavigateToGateIn = function () {
            var bSkip = !!that._bIncomingScanSkipTripTableRefresh;
            that._bIncomingScanSkipTripTableRefresh = false;
            that._navigateToTripFromIncomingDialog(sTripNumber, "gateIn", bSkip);
          };
          var fnLoadTrip = function () {
            that._loadTripDetailsAfterIncomingDialog(sTripNumber, fnNavigateToGateIn, {
              pollItemDetails: bPollItems,
            });
          };
          if (sPoForOrder) {
            this._createOrderDetailForIncomingPoTrip(sTripNumber, sPoForOrder, fnLoadTrip);
          } else {
            fnLoadTrip();
          }
          MessageToast.show("Gate pass created: " + sFormatted);
          if (this._oIncomingEntryMethodModel) {
            this._oIncomingEntryMethodModel.setProperty(
              "/entryComplete",
              true
            );
          }
          if (
            this._oIncomingEntryMethodModel &&
            this._oIncomingEntryMethodModel.getProperty("/selectedKey") === "SCAN"
          ) {
            this._clearIncomingDialogScanInput();
          }
        } else {
          this._sPendingOrderDetailPo = null;
          this._bIncomingScanSkipTripTableRefresh = false;
          this._bIncomingFromCameraScan = false;
          MessageToast.show(
            "Request completed but no gate pass number was returned."
          );
          if (
            this._oIncomingEntryMethodModel &&
            this._oIncomingEntryMethodModel.getProperty("/selectedKey") === "SCAN"
          ) {
            this._clearIncomingDialogScanInput();
          }
        }
      },

      /**
       * Extracts OData message from failed read/create responses (JSON error body).
       */
      _getODataErrorMessage: function (oError, sDefaultMessage) {
        var sErrorMessage = sDefaultMessage || "Error";
        if (!oError) {
          return sErrorMessage;
        }
        try {
          if (oError.responseText) {
            var oResp = JSON.parse(oError.responseText);
            if (
              oResp.error &&
              oResp.error.message &&
              oResp.error.message.value
            ) {
              sErrorMessage = oResp.error.message.value;
            } else if (oResp.error && oResp.error.message) {
              sErrorMessage =
                typeof oResp.error.message === "string"
                  ? oResp.error.message
                  : oResp.error.message;
            }
          }
        } catch (e) {
          if (oError.message && oError.message.value) {
            sErrorMessage = oError.message.value;
          } else if (oError.message) {
            sErrorMessage = sDefaultMessage + ": " + oError.message;
          }
        }
        return sErrorMessage;
      },

      _onIncomingIdentificationCreateError: function (
        oError,
        sDefaultMessage,
        sPoForDedupReset
      ) {
        this._clearIncomingOptimisticRefDocs();
        this._bIncomingExpectItemPoll = false;
        this._bIncomingScanSkipTripTableRefresh = false;
        this._bIncomingFromCameraScan = false;
        if (this._oIncomingEntryMethodDialog) {
          this._oIncomingEntryMethodDialog.setBusy(false);
        }
        this._sPendingOrderDetailPo = null;
        var sFailedPo =
          sPoForDedupReset && String(sPoForDedupReset).trim()
            ? String(sPoForDedupReset).trim()
            : "";
        if (sFailedPo && this._sLastPostedPoNumber === sFailedPo) {
          this._sLastPostedPoNumber = null;
        }
        var sErrorMessage = this._getODataErrorMessage(oError, sDefaultMessage);
        var sIncomingMode = this._oIncomingEntryMethodModel
          ? String(this._oIncomingEntryMethodModel.getProperty("/selectedKey") || "").toUpperCase()
          : "";
        this._bIncomingScanBackendError = sIncomingMode === "SCAN";
        var that = this;
        MessageBox.error(sErrorMessage, {
          onClose: function () {
            if (
              that._oIncomingEntryMethodModel &&
              that._oIncomingEntryMethodModel.getProperty("/selectedKey") ===
                "SCAN"
            ) {
              that._clearIncomingDialogScanInput();
            } else {
              that._focusIncomingEntryMethodPrimaryInput(150);
            }
          },
        });
      },

      /**
       * Outward movement scenarios for Report Vehicle (from OrderTypeSH, MovementType O).
       * @private
       */
      _loadOutgoingMovementScenarioOptions: function () {
        var oModel = this.getView().getModel();
        if (!oModel || !this._oOutgoingMovementScenarioOptionsModel) {
          return;
        }
        var that = this;
        oModel.read("/OrderTypeSH", {
          success: function (oData) {
            var aAll = MovementScenarioIcons.enrichOrderTypeRows(
              (oData && oData.results) || []
            );
            var aOut = aAll.filter(function (r) {
              return r && String(r.MovementType || "").trim().toUpperCase() === "O";
            });
            aOut.sort(function (a, b) {
              return (a.LongText || "").localeCompare(b.LongText || "");
            });
            that._oOutgoingMovementScenarioOptionsModel.setProperty("/items", aOut);
            if (
              that._oOutgoingEntryMethodModel &&
              !that._oOutgoingEntryMethodModel.getProperty("/selectedScenarioItemKey") &&
              aOut.length
            ) {
              that._oOutgoingEntryMethodModel.setProperty(
                "/selectedScenarioItemKey",
                aOut[0].ItemKey
              );
            }
          },
          error: function () {
            that._oOutgoingMovementScenarioOptionsModel.setProperty("/items", []);
          },
        });
      },

      /**
       * @param {string} sItemKey e.g. O01
       * @returns {object|null} enriched OrderType row
       * @private
       */
      _getOutgoingScenarioRowByItemKey: function (sItemKey) {
        if (!sItemKey || !this._oOutgoingMovementScenarioOptionsModel) {
          return null;
        }
        var a =
          this._oOutgoingMovementScenarioOptionsModel.getProperty("/items") || [];
        var s = String(sItemKey).trim();
        for (var i = 0; i < a.length; i++) {
          if (a[i] && String(a[i].ItemKey || "") === s) {
            return a[i];
          }
        }
        return null;
      },

      /**
       * Clears invoice/PO inputs and related models when outgoing scenario or reference type changes.
       * @private
       */
      _clearOutgoingDialogDocumentFields: function () {
        var sViewId = this.getView().getId();
        if (this._oOutgoingEntryMethodModel) {
          this._oOutgoingEntryMethodModel.setProperty("/skipDocumentInvoice", false);
          this._oOutgoingEntryMethodModel.setProperty("/skipDocumentPo", false);
          this._oOutgoingEntryMethodModel.setProperty("/billingDocument", "");
          this._oOutgoingEntryMethodModel.setProperty("/poNumber", "");
          this._oOutgoingEntryMethodModel.setProperty("/invoiceMovementType", "");
          this._oOutgoingEntryMethodModel.setProperty("/invoiceMovementScenario", "");
          this._oOutgoingEntryMethodModel.setProperty("/invoiceMovementDescription", "");
        }
        var oInv = Fragment.byId(sViewId, "idOutgoingDialogInvoiceInput");
        if (oInv) {
          oInv.setValue("");
        }
        var oPo = Fragment.byId(sViewId, "idOutgoingDialogPoInput");
        if (oPo) {
          oPo.setValue("");
        }
        if (this._oOutgoingPoSuggestModel) {
          this._oOutgoingPoSuggestModel.setProperty("/items", []);
        }
        if (this._oOutgoingInvoiceSuggestModel) {
          this._oOutgoingInvoiceSuggestModel.setProperty("/items", []);
        }
        if (this._oOutgoingInvoiceResponseModel) {
          this._oOutgoingInvoiceResponseModel.setData({
            loading: false,
            results: [],
            selected: null,
            showVehicleType: false,
          });
        }
        if (this._oOutgoingEntryMethodModel) {
          this._oOutgoingEntryMethodModel.setProperty("/selectedVehicleType", "");
          this._oOutgoingEntryMethodModel.setProperty("/selectedVehicleTypeDesc", "");
          this._oOutgoingEntryMethodModel.setProperty("/existingTripNo", "");
        }
      },

      _clearIncomingGlobalForOutgoing: function () {
        var oG = sap.ui.getCore().getModel("globalData");
        if (!oG) {
          return;
        }
        oG.setProperty("/IncomingPoNumber", "");
        oG.setProperty("/IncomingRefDocDocType", "");
        oG.setProperty("/IncomingMovementScenarioDesc", "");
        oG.setProperty("/IncomingMovementType", "");
        oG.setProperty("/IncomingMovementScenario", "");
        oG.setProperty("/IncomingRefDocSkip", " ");
      },

      onOutgoingMovementScenarioSelectChange: function (oEvent) {
        // Ensure scenario change never leaves the dialog in a blocked/busy state.
        if (this._oIncomingEntryMethodDialog) {
          this._oIncomingEntryMethodDialog.setBusy(false);
        }
        var oSel = oEvent.getSource();
        var sKey = oSel && oSel.getSelectedKey ? oSel.getSelectedKey() : "";
        if (this._oOutgoingEntryMethodModel) {
          this._oOutgoingEntryMethodModel.setProperty(
            "/selectedScenarioItemKey",
            sKey || ""
          );
        }
        this._clearOutgoingDialogDocumentFields();
        var oG = sap.ui.getCore().getModel("globalData");
        if (oG) {
          oG.setProperty("/OutgoingVehicleType", "");
          oG.setProperty("/OutgoingVehicleTypeDesc", "");
        }
        if (String(sKey || "").trim() === "O02") {
          this._loadOutgoingVehicleTypeOptions();
        }
        var that = this;
        setTimeout(function () {
          if (String(sKey || "").trim() === "O02") {
            var sViewId = that.getView().getId();
            var oVt = Fragment.byId(sViewId, "idOutgoingVehicleTypeSelect");
            if (oVt && oVt.focus) {
              oVt.focus();
            }
          } else {
            that._focusOutgoingEntryMethodPrimaryInput(100);
          }
        }, 0);
        setTimeout(function () {
          if (String(sKey || "").trim() !== "O02") {
            that._focusOutgoingEntryMethodPrimaryInput(250);
          }
        }, 250);
      },

      _setOutgoingGlobalPrefill: function (m) {
        var oG = sap.ui.getCore().getModel("globalData");
        if (!oG) {
          oG = new JSONModel({});
          sap.ui.getCore().setModel(oG, "globalData");
        }
        var mT = m || {};
        oG.setProperty("/OutgoingReportPrefill", true);
        oG.setProperty(
          "/OutgoingMovementScenario",
          mT.movementScenario !== undefined ? mT.movementScenario : ""
        );
        oG.setProperty(
          "/OutgoingMovementScenarioDesc",
          mT.movementScenarioDesc !== undefined ? mT.movementScenarioDesc : ""
        );
        oG.setProperty(
          "/OutgoingMovementScenarioItemKey",
          mT.movementScenarioItemKey !== undefined ? mT.movementScenarioItemKey : ""
        );
        oG.setProperty(
          "/OutgoingBillingDocument",
          mT.billingDocument !== undefined ? mT.billingDocument : ""
        );
        oG.setProperty(
          "/OutgoingRefDocSkip",
          mT.refDocSkip !== undefined ? mT.refDocSkip : " "
        );
        oG.setProperty("/OutgoingPoNumber", mT.poNumber !== undefined ? mT.poNumber : "");
        oG.setProperty(
          "/OutgoingRefDocDocType",
          mT.docType !== undefined ? mT.docType : ""
        );
        oG.setProperty(
          "/OutgoingReferenceByKey",
          mT.referenceByKey !== undefined && mT.referenceByKey !== null
            ? String(mT.referenceByKey)
            : ""
        );
      },

      _clearOutgoingGlobalPrefill: function () {
        var oG = sap.ui.getCore().getModel("globalData");
        if (!oG) {
          return;
        }
        oG.setProperty("/OutgoingReportPrefill", false);
        oG.setProperty("/OutgoingMovementScenario", "");
        oG.setProperty("/OutgoingMovementScenarioDesc", "");
        oG.setProperty("/OutgoingMovementScenarioItemKey", "");
        oG.setProperty("/OutgoingBillingDocument", "");
        oG.setProperty("/OutgoingRefDocSkip", " ");
        oG.setProperty("/OutgoingPoNumber", "");
        oG.setProperty("/OutgoingRefDocDocType", "");
        oG.setProperty("/OutgoingBillingDocType", "");
        oG.setProperty("/OutgoingReferenceByKey", "");
        oG.setProperty("/OutgoingVehicleType", "");
        oG.setProperty("/OutgoingVehicleTypeDesc", "");
      },

      /**
       * Outgoing Report Vehicle — movement scenario only; reference document skipped at entry.
       */
      _validateAndNavigateOutgoingReportVehicle: function () {
        var oOut = this._oOutgoingEntryMethodModel;
        if (!oOut) {
          return false;
        }
        var sScenarioItemKey = String(oOut.getProperty("/selectedScenarioItemKey") || "").trim();
        if (!sScenarioItemKey) {
          var thatScenario = this;
          MessageBox.error("Select a movement scenario.", {
            onClose: function () {
              var sViewId = thatScenario.getView().getId();
              var oSc = Fragment.byId(sViewId, "idOutgoingMovementScenarioSelect");
              if (oSc && oSc.focus) {
                setTimeout(function () {
                  oSc.focus();
                }, 150);
              }
            },
          });
          return false;
        }
        var oScenarioRow = this._getOutgoingScenarioRowByItemKey(sScenarioItemKey);
        if (!oScenarioRow) {
          MessageBox.error("Select a valid movement scenario.");
          return false;
        }
        var sMsFromPicker = String(oScenarioRow.MovementScenario || "").trim();
        var sDescFromPicker = String(oScenarioRow.LongText || "").trim();
        var sItemKeyFromPicker =
          oScenarioRow.ItemKey ||
          MovementScenarioIcons.getMovementScenarioItemKey("O", sMsFromPicker) ||
          "";
        var bO02 =
          String(sItemKeyFromPicker || "").toUpperCase() === "O02" ||
          (String(oScenarioRow.MovementType || "")
            .trim()
            .toUpperCase() === "O" &&
            String(sMsFromPicker || "")
              .trim()
              .replace(/^0+/, "") === "2");
        if (bO02) {
          var sVt = String(oOut.getProperty("/selectedVehicleType") || "").trim();
          var sVtDesc = String(oOut.getProperty("/selectedVehicleTypeDesc") || "").trim();
          if (!sVt) {
            var sViewIdForVt = this.getView().getId();
            var oVtSel = Fragment.byId(sViewIdForVt, "idOutgoingVehicleTypeSelect");
            if (oVtSel && oVtSel.getSelectedKey) {
              sVt = String(oVtSel.getSelectedKey() || "").trim();
            }
            if (!sVt && oVtSel && oVtSel.getSelectedItem) {
              var oSelItem = oVtSel.getSelectedItem();
              sVt = oSelItem ? String(oSelItem.getKey() || "").trim() : "";
              if (!sVtDesc && oSelItem) {
                sVtDesc = String(oSelItem.getText() || "").trim();
              }
            }
            if (sVt) {
              oOut.setProperty("/selectedVehicleType", sVt);
              if (sVtDesc) {
                oOut.setProperty("/selectedVehicleTypeDesc", sVtDesc);
              }
            }
          }
          if (!sVt) {
            var thatVt = this;
            MessageBox.error(
              "Select Vehicle Type. It is required for movement scenario O02 before continuing.",
              {
                onClose: function () {
                  var sViewId = thatVt.getView().getId();
                  var oVt = Fragment.byId(sViewId, "idOutgoingVehicleTypeSelect");
                  if (oVt && oVt.focus) {
                    setTimeout(function () {
                      oVt.focus();
                    }, 150);
                  }
                },
              }
            );
            return false;
          }
          var oGv = sap.ui.getCore().getModel("globalData");
          if (!oGv) {
            oGv = new JSONModel({});
            sap.ui.getCore().setModel(oGv, "globalData");
          }
          oGv.setProperty("/OutgoingVehicleType", sVt);
          oGv.setProperty("/OutgoingVehicleTypeDesc", sVtDesc);
        }
        this._setOutgoingGlobalPrefill({
          movementScenario: sMsFromPicker,
          movementScenarioDesc: sDescFromPicker,
          movementScenarioItemKey: sItemKeyFromPicker,
          billingDocument: "",
          refDocSkip: "X",
          poNumber: "",
          docType: "",
          referenceByKey: "INVOICE",
        });
        return true;
      },

      /**
       * Same pattern as onOutgoingDialogPoSuggest: debounce then load JSONModel for suggestionItems.
       */
      _fetchReferenceSuggestions: function (sTerm, sKey, oLocalModel) {
        var sValue = String(sTerm || "").trim();
        if (!oLocalModel) {
          return;
        }
        if (!sValue || sValue.length < 2) {
          oLocalModel.setProperty("/items", []);
          return;
        }
        var oModel = this.getView().getModel();
        if (!oModel) {
          oLocalModel.setProperty("/items", []);
          return;
        }

        sKey = String(sKey || "").toUpperCase();
        var bNumeric = /^\d+$/.test(sValue);
        var sPath = "";
        var oFilter = null;

        if (sKey === "INVOICE") {
          sPath = "/BillingDocSH";
          oFilter = bNumeric
            ? new Filter("BillingDoc", FilterOperator.Contains, sValue)
            : new Filter("PayerName", FilterOperator.Contains, sValue);
        } else if (sKey === "CHALLAN") {
          sPath = "/ChallanSh";
          oFilter = bNumeric
            ? new Filter("MaterialDoc", FilterOperator.Contains, sValue)
            : new Filter("SupplierName", FilterOperator.Contains, sValue);
        } else if (sKey === "PO") {
          sPath = "/PoNumberSH";
          oFilter = bNumeric
            ? new Filter("PoNumber", FilterOperator.Contains, sValue)
            : new Filter("VendorName", FilterOperator.Contains, sValue);
        } else {
          oLocalModel.setProperty("/items", []);
          return;
        }

        oModel.read(sPath, {
          filters: [oFilter],
          urlParameters: {
            $top: "20",
            $skip: "0",
          },
          success: function (oData) {
            var aResults = (oData && oData.results) || [];
            var mSeen = {};
            var aItems = [];

            aResults.forEach(function (o) {
              var sDoc = "";
              if (sKey === "INVOICE") {
                sDoc = String((o && o.BillingDoc) || "").trim();
              } else if (sKey === "CHALLAN") {
                sDoc = String((o && o.MaterialDoc) || "").trim();
              } else {
                sDoc = String((o && o.PoNumber) || "").trim();
              }
              if (!sDoc || mSeen[sDoc]) {
                return;
              }
              mSeen[sDoc] = true;
              aItems.push({
                docText: sDoc,
                docDescription: String(
                  (o && (o.PayerName || o.SupplierName || o.VendorName)) || ""
                ).trim(),
                DocNumber: sDoc,
                BillingDoc: sKey === "INVOICE" ? sDoc : "",
                MaterialDoc: sKey === "CHALLAN" ? sDoc : "",
                MovementType: String((o && o.MovementType) || "").trim(),
                MovementScenario: String((o && o.MovementScenario) || "").trim(),
                MovementDescription: String((o && o.MovementDescription) || "").trim(),
              });
            });

            var sNeedle = sValue.toLowerCase();
            aItems = aItems.filter(function (oIt) {
              var sT = String((oIt && oIt.docText) || "").toLowerCase();
              var sD = String((oIt && oIt.docDescription) || "").toLowerCase();
              return sT.indexOf(sNeedle) !== -1 || sD.indexOf(sNeedle) !== -1;
            });
            oLocalModel.setProperty("/items", aItems);
          },
          error: function () {
            oLocalModel.setProperty("/items", []);
          },
        });
      },

      onOutgoingReportInvoiceSuggest: function (oEvent) {
        var sValue = (oEvent.getParameter("suggestValue") || "").trim();
        if (this._iOutgoingInvoiceSuggestTimeout) {
          clearTimeout(this._iOutgoingInvoiceSuggestTimeout);
        }
        var that = this;
        this._iOutgoingInvoiceSuggestTimeout = setTimeout(function () {
          that._loadOutgoingInvoiceSuggestions(sValue);
        }, 300);
      },

      /**
       * Outgoing invoice/challan panel: CHALLAN uses ChallanSh (MaterialDoc), INVOICE uses BillingDocSH.
       */
      _isOutgoingChallanSelected: function () {
        var sKey =
          this._oOutgoingEntryMethodModel &&
          this._oOutgoingEntryMethodModel.getProperty("/selectedKey");
        return String(sKey || "").toUpperCase() === "CHALLAN";
      },

      _ensureOutgoingInvoiceSuggestCacheLoaded: function (bChallan) {
        var oModel = this.getView().getModel();
        var sMode = bChallan ? "CHALLAN" : "INVOICE";
        var sPath = bChallan ? "/ChallanSh" : "/BillingDocSH";
        if (!oModel) {
          return Promise.resolve([]);
        }
        if (Array.isArray(this._mOutgoingInvoiceSuggestAll[sMode])) {
          return Promise.resolve(this._mOutgoingInvoiceSuggestAll[sMode]);
        }
        if (this._mOutgoingInvoiceSuggestLoadPromise[sMode]) {
          return this._mOutgoingInvoiceSuggestLoadPromise[sMode];
        }
        var that = this;
        this._mOutgoingInvoiceSuggestLoadPromise[sMode] = new Promise(function (
          resolve
        ) {
          oModel.read(sPath, {
            success: function (oData) {
              var a = (oData && oData.results) || [];
              that._mOutgoingInvoiceSuggestAll[sMode] = a;
              resolve(a);
            },
            error: function () {
              that._mOutgoingInvoiceSuggestAll[sMode] = [];
              resolve([]);
            },
          });
        }).finally(function () {
          that._mOutgoingInvoiceSuggestLoadPromise[sMode] = null;
        });
        return this._mOutgoingInvoiceSuggestLoadPromise[sMode];
      },

      _loadOutgoingInvoiceSuggestions: function (sTerm) {
        if (!this._oOutgoingInvoiceSuggestModel) {
          return;
        }
        var sKey = this._isOutgoingChallanSelected() ? "CHALLAN" : "INVOICE";
        this._fetchReferenceSuggestions(
          sTerm,
          sKey,
          this._oOutgoingInvoiceSuggestModel
        );
      },

      onOutgoingReportInvoiceSuggestionSelected: function (oEvent) {
        var oItem = oEvent.getParameter("selectedItem");
        var sText = oItem ? (oItem.getText() || "") : "";
        sText = String(sText || "").trim();
        if (this._oOutgoingEntryMethodModel && sText) {
          this._oOutgoingEntryMethodModel.setProperty("/billingDocument", sText);
        }

        var oCtx = oItem && oItem.getBindingContext("outgoingInvoiceSuggest");
        var oRow = oCtx ? oCtx.getObject() : null;
        if (this._oOutgoingEntryMethodModel && oRow) {
          this._oOutgoingEntryMethodModel.setProperty(
            "/invoiceMovementType",
            oRow.MovementType || ""
          );
          this._oOutgoingEntryMethodModel.setProperty(
            "/invoiceMovementScenario",
            oRow.MovementScenario || ""
          );
          this._oOutgoingEntryMethodModel.setProperty(
            "/invoiceMovementDescription",
            oRow.MovementDescription || ""
          );
        }

        // After selecting an invoice, load backend response and decide if Vehicle Type should be shown.
        this._loadOutgoingInvoiceResponse(sText);
      },

      onOutgoingReportInvoiceChange: function (oEvent) {
        var sVal = oEvent.getParameter("value") || "";
        if (this._oOutgoingEntryMethodModel) {
          this._oOutgoingEntryMethodModel.setProperty(
            "/billingDocument",
            String(sVal || "").trim()
          );
        }

        // When user types an invoice manually, fetch the backend response and decide if Vehicle Type should be shown.
        this._loadOutgoingInvoiceResponse(String(sVal || "").trim());
      },

      _buildBillingDocKeyPath: function (sInvoice) {
        var sInv = String(sInvoice || "").trim().replace(/'/g, "''");
        return "/BillingDocSH(BillingDoc='" + sInv + "')";
      },

      _buildChallanShKeyPath: function (sMaterialDoc) {
        var s = String(sMaterialDoc || "").trim().replace(/'/g, "''");
        return "/ChallanSh(MaterialDoc='" + s + "')";
      },

      /**
       * After invoice or challan entered: fetch BillingDocSH or ChallanSh, store in JSON model.
       * Show Vehicle Type dropdown when MovementType='O' AND MovementScenario='02'.
       */
      _loadOutgoingInvoiceResponse: function (sInvoice) {
        var sInv = String(sInvoice || "").trim();

        if (!this._oOutgoingInvoiceResponseModel) {
          this._oOutgoingInvoiceResponseModel = new JSONModel({
            loading: false,
            results: [],
            selected: null,
            showVehicleType: false,
          });
        }

        if (this._oIncomingEntryMethodDialog) {
          this._oIncomingEntryMethodDialog.setModel(
            this._oOutgoingInvoiceResponseModel,
            "outgoingInvoiceResponse"
          );
        }

        var fnClear = function () {
          this._oOutgoingInvoiceResponseModel.setData({
            loading: false,
            results: [],
            selected: null,
            showVehicleType: false,
          });
          if (this._oOutgoingEntryMethodModel) {
            this._oOutgoingEntryMethodModel.setProperty("/invoiceMovementType", "");
            this._oOutgoingEntryMethodModel.setProperty("/invoiceMovementScenario", "");
            this._oOutgoingEntryMethodModel.setProperty("/invoiceMovementDescription", "");
            this._oOutgoingEntryMethodModel.setProperty("/selectedVehicleType", "");
            this._oOutgoingEntryMethodModel.setProperty("/selectedVehicleTypeDesc", "");
            this._oOutgoingEntryMethodModel.setProperty("/existingTripNo", "");
          }
          var oG = sap.ui.getCore().getModel("globalData");
          if (oG) {
            oG.setProperty("/OutgoingInvoiceResponse", null);
            oG.setProperty("/OutgoingVehicleType", "");
            oG.setProperty("/OutgoingBillingDocType", "");
          }
        }.bind(this);

        if (!sInv) {
          fnClear();
          return;
        }

        var oModel = this.getView().getModel();
        if (!oModel) {
          fnClear();
          return;
        }

        this._oOutgoingInvoiceResponseModel.setProperty("/loading", true);

        var that = this;
        var bChallan = this._isOutgoingChallanSelected();
        var sDocLabel = bChallan ? "Material Doc" : "Billing Doc";
        sInv = this._validateNumericDocNumber10(sInv, sDocLabel, false);
        if (!sInv) {
          fnClear();
          return;
        }
        var sKeyPath = bChallan
          ? this._buildChallanShKeyPath(sInv)
          : this._buildBillingDocKeyPath(sInv);
        var fnApplyInvoiceResult = function (oFirst, aResults) {
          var a = Array.isArray(aResults) ? aResults : oFirst ? [oFirst] : [];
          that._oOutgoingInvoiceResponseModel.setProperty("/loading", false);
          that._oOutgoingInvoiceResponseModel.setProperty("/results", a);
          that._oOutgoingInvoiceResponseModel.setProperty("/selected", oFirst || null);

          // Sync movement fields back into outgoingEntryMethod model (existing flow uses these).
          if (that._oOutgoingEntryMethodModel && oFirst) {
            that._oOutgoingEntryMethodModel.setProperty(
              "/invoiceMovementType",
              oFirst.MovementType || ""
            );
            that._oOutgoingEntryMethodModel.setProperty(
              "/invoiceMovementScenario",
              oFirst.MovementScenario || ""
            );
            that._oOutgoingEntryMethodModel.setProperty(
              "/invoiceMovementDescription",
              oFirst.MovementDescription || ""
            );
          }

          // Condition to show Vehicle Type dropdown.
          var sMt = oFirst && oFirst.MovementType ? String(oFirst.MovementType).trim() : "";
          var sMs = oFirst && oFirst.MovementScenario ? String(oFirst.MovementScenario).trim() : "";
          var bShow = sMt === "O" && sMs === "02";
          that._oOutgoingInvoiceResponseModel.setProperty("/showVehicleType", !!bShow);

          // Store response in globalData for downstream tabs.
          var oG = sap.ui.getCore().getModel("globalData");
          if (!oG) {
            oG = new JSONModel({});
            sap.ui.getCore().setModel(oG, "globalData");
          }
          oG.setProperty("/OutgoingInvoiceResponse", oFirst || null);
          oG.setProperty(
            "/OutgoingBillingDocType",
            oFirst
              ? (oFirst.DocType || oFirst.DocumentType || oFirst.BillingType || "")
              : ""
          );
          oG.setProperty("/IsCustomerSaleScenario02", !!bShow);
          // Load VehicleType ConfigValues only when needed.
          if (bShow) {
            that._loadOutgoingVehicleTypeOptions();
          } else if (that._oOutgoingEntryMethodModel) {
            that._oOutgoingEntryMethodModel.setProperty("/selectedVehicleType", "");
            that._oOutgoingEntryMethodModel.setProperty("/selectedVehicleTypeDesc", "");
          }
        };

        // Primary call: key read on BillingDocSH or ChallanSh
        oModel.read(sKeyPath, {
          success: function (oData) {
            var oFirst = oData && oData.d ? oData.d : oData;
            fnApplyInvoiceResult(oFirst || null, oFirst ? [oFirst] : []);
          },
          error: function (oErr1) {
            var sM1 = that._extractErrorMessage(oErr1);

            var fnContinueWithFallback = function () {
              if (bChallan) {
                oModel.read("/ChallanSh", {
                  filters: [
                    new Filter("MaterialDoc", FilterOperator.EQ, sInv),
                  ],
                  urlParameters: { $top: "10" },
                  success: function (oData) {
                    var a = (oData && oData.results) || [];
                    var oFirst = a && a.length ? a[0] : null;
                    fnApplyInvoiceResult(oFirst, a);
                  },
                  error: function (oErr2) {
                    var sM2 = that._extractErrorMessage(oErr2);
                    var sShow = sM2 && sM2 !== "Something went wrong" ? sM2 : sM1;
                    MessageBox.error(sShow);
                    fnClear();
                  },
                });
              } else {
                oModel.read("/BillingDocSH", {
                  filters: [new Filter("BillingDoc", FilterOperator.EQ, sInv)],
                  urlParameters: { $top: "10" },
                  success: function (oData) {
                    var a = (oData && oData.results) || [];
                    var oFirst = a && a.length ? a[0] : null;
                    fnApplyInvoiceResult(oFirst, a);
                  },
                  error: function (oErr2) {
                    var sM2 = that._extractErrorMessage(oErr2);
                    var sShow = sM2 && sM2 !== "Something went wrong" ? sM2 : sM1;
                    MessageBox.error(sShow);
                    fnClear();
                  },
                });
              }
            };

            // Requirement: show backend error first, then continue the next process.
            // If we have a meaningful business message, wait until user closes it.
            if (sM1 && sM1 !== "Something went wrong") {
              MessageBox.error(sM1, {
                onClose: function () {
                  fnContinueWithFallback();
                },
              });
              return;
            }

            // No meaningful message; just proceed with fallback read.
            fnContinueWithFallback();
          },
        });
      },

      _loadOutgoingVehicleTypeOptions: function () {
        if (this._oIncomingEntryMethodDialog) {
          this._oIncomingEntryMethodDialog.setModel(
            this._oOutgoingVehicleTypeOptionsModel,
            "outgoingVehicleTypeOptions"
          );
        }

        var oModel = this.getView().getModel();
        if (!oModel) {
          this._oOutgoingVehicleTypeOptionsModel.setProperty("/items", []);
          return;
        }

        oModel.read("/ConfigValues", {
          filters: [new Filter("ConfigGroup", FilterOperator.EQ, "VehicleType")],
          urlParameters: { $top: "200" },
          success: function (oData) {
            var aItems = (oData && oData.results) || [];
            this._oOutgoingVehicleTypeOptionsModel.setProperty("/items", aItems);

            // Keep model state aligned with Select default visual selection.
            // Without this, UI may display first option while selectedVehicleType remains blank,
            // which triggers O02 validation error on Continue.
            if (this._oOutgoingEntryMethodModel) {
              var sCurrentKey = String(
                this._oOutgoingEntryMethodModel.getProperty("/selectedVehicleType") || ""
              ).trim();
              if (!sCurrentKey && aItems.length) {
                var oG = sap.ui.getCore().getModel("globalData");
                var bAllTypeFlow = !!(oG && oG.getProperty("/IsCustomerSaleScenario02"));
                var iDefaultIndex = bAllTypeFlow && aItems.length > 1 ? 1 : 0;
                var oDefaultItem = aItems[iDefaultIndex] || aItems[0];
                var sDefaultKey = String(oDefaultItem.ConfigID || "").trim();
                var sDefaultText = String(oDefaultItem.Description || "").trim();
                this._oOutgoingEntryMethodModel.setProperty("/selectedVehicleType", sDefaultKey);
                this._oOutgoingEntryMethodModel.setProperty("/selectedVehicleTypeDesc", sDefaultText);

                if (!oG) {
                  oG = new JSONModel({});
                  sap.ui.getCore().setModel(oG, "globalData");
                }
                oG.setProperty("/OutgoingVehicleType", sDefaultKey);
                oG.setProperty("/OutgoingVehicleTypeDesc", sDefaultText);
              }
            }
          }.bind(this),
          error: function () {
            this._oOutgoingVehicleTypeOptionsModel.setProperty("/items", []);
          }.bind(this),
        });
      },

      onOutgoingVehicleTypeSelectionChange: function (oEvent) {
        var oItem = oEvent.getParameter("selectedItem");
        if (!oItem || !this._oOutgoingEntryMethodModel) {
          return;
        }

        var sKey = String(oItem.getKey() || "").trim();
        var sText = String(oItem.getText() || "").trim();
        this._oOutgoingEntryMethodModel.setProperty("/selectedVehicleType", sKey);
        this._oOutgoingEntryMethodModel.setProperty("/selectedVehicleTypeDesc", sText);

        var oG = sap.ui.getCore().getModel("globalData");
        if (!oG) {
          oG = new JSONModel({});
          sap.ui.getCore().setModel(oG, "globalData");
        }
        oG.setProperty("/OutgoingVehicleType", sKey);
        oG.setProperty("/OutgoingVehicleTypeDesc", sText);

        this._oOutgoingEntryMethodModel.setProperty("/existingTripNo", "");
      },

      onOutgoingDialogPoSuggest: function (oEvent) {
        var sValue = (oEvent.getParameter("suggestValue") || "").trim();
        if (this._iOutgoingDialogPoSuggestTimeout) {
          clearTimeout(this._iOutgoingDialogPoSuggestTimeout);
        }
        var that = this;
        this._iOutgoingDialogPoSuggestTimeout = setTimeout(function () {
          that._loadOutgoingDialogPoSuggestions(sValue);
        }, 300);
      },

      _loadOutgoingDialogPoSuggestions: function (sTerm) {
        var oModel = this.getView().getModel();
        if (!oModel || !this._oOutgoingPoSuggestModel) {
          return;
        }
        if (!sTerm || sTerm.length < 2) {
          this._oOutgoingPoSuggestModel.setProperty("/items", []);
          return;
        }
        var oOrFilter = new Filter(
          [
            new Filter("PoNumber", FilterOperator.Contains, sTerm),
            new Filter("VendorName", FilterOperator.Contains, sTerm),
          ],
          false
        );
        var that = this;
        var fnSuccess = function (oData) {
          var a = (oData && oData.results) || [];
          var mSeen = {};
          var aItems = [];
          a.forEach(function (o) {
            var n = (o.PoNumber && String(o.PoNumber).trim()) || "";
            if (n && !mSeen[n]) {
              mSeen[n] = true;
              aItems.push({
                PoNumber: n,
                VendorName: (o.VendorName && String(o.VendorName).trim()) || "",
              });
            }
          });
          that._oOutgoingPoSuggestModel.setProperty("/items", aItems);
        };
        oModel.read("/PoNumberSH", {
          filters: [oOrFilter],
          success: fnSuccess,
          error: function () {
            that._oOutgoingPoSuggestModel.setProperty("/items", []);
          },
        });
      },

      onOutgoingDialogPoSuggestionSelected: function (oEvent) {
        var oItem = oEvent.getParameter("selectedItem");
        if (!oItem) {
          return;
        }
        var sPo = oItem.getText();
        if (this._oOutgoingEntryMethodModel) {
          this._oOutgoingEntryMethodModel.setProperty("/poNumber", sPo);
        }
        var oIn = Fragment.byId(
          this.getView().getId(),
          "idOutgoingDialogPoInput"
        );
        if (oIn && oIn.setValue) {
          oIn.setValue(sPo);
        }
      },

      /**
       * Clears trip context and navigates to Stage for a new vehicle report.
       * @private
       */
      _executeNewReportVehicleNavigation: function () {
        sap.ui.getCore().setModel(null, "TripData");

        sap.ui.getCore().getEventBus().publish("Stage", "ClearAllTabs");
        sap.ui.getCore().getEventBus().publish("TripData", "Updated");
        sap.ui.getCore().getEventBus().publish("Stage", "ResetPageTitle");

        var oRouter = this.getOwnerComponent().getRouter();
        if (oRouter) {
          oRouter.navTo("Stage");
        } else {
          window.location.hash = "#/Stage";
        }
      },

      onTripPress: function (oEvent) {
        var oCtx = oEvent.getParameter("listItem").getBindingContext();
        var oRowData = oCtx.getObject();
        var sTripNo = String(oRowData.TripNumber || "").trim();
        var oGlobalModel = sap.ui.getCore().getModel("globalData");

        if (!oGlobalModel) {
          oGlobalModel = new sap.ui.model.json.JSONModel({
            TripNumber: ""
          });
          sap.ui.getCore().setModel(oGlobalModel, "globalData");
        }

        oGlobalModel.setProperty("/TripNumber", sTripNo);
        oGlobalModel.setProperty("/HasIncomingMaterials", false);
        oGlobalModel.setProperty("/HasOutgoingMaterials", false);
        oGlobalModel.setProperty("/IncomingReportingMethod", null);
        this.getView().byId("tripTable").removeSelections(true);

        // Always load full TripDetails for existing trips before navigation.
        // This prevents stale/partial table-row data from driving tab/panel visibility.
        this._loadTripDetailsAfterIncomingDialog(sTripNo, function () {
          sap.ui.core.UIComponent.getRouterFor(this).navTo("StagewithParam", {
            tripNo: sTripNo || "",
          });
        }.bind(this));
      },

      onRefresh: function () {
        var oTable = this.getView().byId("tripTable");
        var oModel = this.getView().getModel();
        if (!oModel || !oTable) {
          return;
        }

        oTable.setBusy(true);
        oTable.setBusyIndicatorDelay(0);

        var oBinding = oTable.getBinding("items");
        var that = this;
        var bDone = false;

        var fnCleanupAndFinish = function (fnDetach) {
          if (bDone) {
            return;
          }
          bDone = true;
          if (typeof fnDetach === "function") {
            fnDetach();
          }
          oTable.setBusy(false);
          that._applyTableFilter();
        };

        // Prefer list-binding refresh: dataReceived fires after backend response (success or error).
        if (oBinding && typeof oBinding.refresh === "function" && oBinding.attachDataReceived) {
          var fnOnDataReceived = function () {
            fnCleanupAndFinish(function () {
              oBinding.detachDataReceived(fnOnDataReceived);
            });
          };
          oBinding.attachDataReceived(fnOnDataReceived);
          oBinding.refresh(true);
          return;
        }

        // Fallback when items binding is not ready: clear busy on first completed or failed request.
        var fnDetachModelListeners = function () {
          if (oModel.detachRequestCompleted) {
            oModel.detachRequestCompleted(fnOnRequestCompleted);
          }
          if (oModel.detachRequestFailed) {
            oModel.detachRequestFailed(fnOnRequestFailed);
          }
        };
        var fnOnRequestCompleted = function () {
          fnCleanupAndFinish(fnDetachModelListeners);
        };
        var fnOnRequestFailed = function () {
          fnCleanupAndFinish(fnDetachModelListeners);
        };
        if (oModel.attachRequestCompleted) {
          oModel.attachRequestCompleted(fnOnRequestCompleted);
        }
        if (oModel.attachRequestFailed) {
          oModel.attachRequestFailed(fnOnRequestFailed);
        }
        oModel.refresh(true);
      },

      _onExternalRefresh: function () {
        this.onRefresh();
      },

      /**
       * Event handler for route matched - automatically refreshes table when navigating to HomePage
       * @private
       */
      _onRouteMatched: function () {
        if (!this._bHomeInitialLoadDone) {
          this._bHomeInitialLoadDone = true;
          return;
        }
        // Small delay to ensure view is fully rendered before refreshing
        setTimeout(function() {
          this.onRefresh();
        }.bind(this), 100);
      },

      // --------------------------------------------
      // VALUE HELP
      // --------------------------------------------
      onValueHelpRequest: function (oEvent) {
        var oInput = oEvent.getSource();
        var sField = oInput.data("field");
        var oFieldConfig = this._getFieldConfiguration(sField);
        if (!oFieldConfig)
          return MessageToast.show("No value help for " + sField);

        var { sKeyField, sDescField, sTitle } = oFieldConfig;
        var oModel = this.getView().getModel();

        var oSelectDialog = new SelectDialog({
          title: sTitle,
          liveChange: function (oEvt) {
            var sValue = (oEvt.getParameter("value") || "").trim();
            // Make search case-insensitive by normalizing to upper case
            if (sValue) {
              sValue = sValue.toUpperCase();
            }
            var oBinding = oEvt.getSource().getBinding("items");
            
            if (!oBinding) {
              return;
            }
            
            var aFilters = [];
            if (sValue && sValue.length > 0) {
              aFilters = [
                new Filter(
                  [
                    new Filter(sKeyField, FilterOperator.Contains, sValue),
                    new Filter(sDescField, FilterOperator.Contains, sValue),
                  ],
                  false
                ),
              ];
            }
            oBinding.filter(aFilters);
          },
          search: function (oEvt) {
            // Same logic as liveChange for consistency
            var sValue = (oEvt.getParameter("value") || "").trim();
            // Make search case-insensitive by normalizing to upper case
            if (sValue) {
              sValue = sValue.toUpperCase();
            }
            var oBinding = oEvt.getSource().getBinding("items");
            
            if (!oBinding) {
              return;
            }
            
            var aFilters = [];
            if (sValue && sValue.length > 0) {
              aFilters = [
                new Filter(
                  [
                    new Filter(sKeyField, FilterOperator.Contains, sValue),
                    new Filter(sDescField, FilterOperator.Contains, sValue),
                  ],
                  false
                ),
              ];
            }
            oBinding.filter(aFilters);
          },
          confirm: function (oEvt) {
            var oSelectedItem = oEvt.getParameter("selectedItem");
            if (oSelectedItem) {
              oInput.setValue(oSelectedItem.getTitle());
              this._applyTableFilter();
            }
          }.bind(this),
        });

        oSelectDialog.setModel(oModel);
        oSelectDialog.bindAggregation("items", {
          path: "/TripDetails",
          template: new StandardListItem({
            title: "{" + sKeyField + "}",
            description: "{" + sDescField + "}",
          }),
        });

        oSelectDialog.open();
      },

      // --------------------------------------------
      // LIVE SUGGESTIONS
      // --------------------------------------------
      onSuggest: function (oEvent) {
        var oInput = oEvent.getSource();
        var sField = oInput.data("field");
        var sValue = (oEvent.getParameter("suggestValue") || "").trim();
        // Normalize certain fields to reduce case-sensitivity (backend may compare case-sensitively)
        var sFilterValue = sValue;
        if (sField === "vehicleNumber" && sFilterValue) {
          sFilterValue = sFilterValue.toUpperCase();
        }
        var oFieldConfig = this._getFieldConfiguration(sField);
        if (!oFieldConfig) return;

        var { sKeyField, sDescField } = oFieldConfig;
        var aFilters = sFilterValue
          ? [
            new Filter(
              [
                new Filter(sKeyField, FilterOperator.Contains, sFilterValue),
                new Filter(sDescField, FilterOperator.Contains, sFilterValue),
              ],
              false
            ),
          ]
          : [];

        var fnApplySuggestions = function (aItems) {
          oInput.destroySuggestionItems();
          (aItems || []).forEach(function (item) {
            oInput.addSuggestionItem(
              new SuggestionItem({
                key: item[sKeyField],
                text: item[sKeyField],
                description: item[sDescField],
              })
            );
          });
        };

        var fnClientSideFilter = function (aItems, sNeedle) {
          var sNeedleLower = (sNeedle || "").toLowerCase();
          if (!sNeedleLower) {
            return aItems || [];
          }
          return (aItems || []).filter(function (oItem) {
            var sKey = (oItem[sKeyField] || "").toString().toLowerCase();
            var sDesc = (oItem[sDescField] || "").toString().toLowerCase();
            return sKey.indexOf(sNeedleLower) > -1 || sDesc.indexOf(sNeedleLower) > -1;
          });
        };

        var oModel = this.getView().getModel();
        oModel.read("/TripDetails", {
          filters: aFilters,
          success: function (oData) {
            fnApplySuggestions(oData.results || []);
          },
          error: function () {
            // Fallback for backends where some fields are not filterable (e.g. VehicleNumber).
            oModel.read("/TripDetails", {
              success: function (oDataAll) {
                fnApplySuggestions(fnClientSideFilter(oDataAll.results || [], sValue));
              },
              error: function () {
                fnApplySuggestions([]);
              },
            });
          },
        });
      },

      onSuggestionItemSelected: function (oEvent) {
        var oInput = oEvent.getSource();
        oInput.setValue(oEvent.getParameter("selectedItem").getText());
        this._applyTableFilter();
      },

      /**
       * True if end date is on or after start date (same calendar day). Single date ok.
       * @private
       */
      _isReportDateRangeOrderValid: function (oFrom, oTo) {
        if (!oFrom || !oTo) {
          return true;
        }
        var oStart = new Date(oFrom);
        oStart.setHours(0, 0, 0, 0);
        var oEnd = new Date(oTo);
        oEnd.setHours(0, 0, 0, 0);
        return oEnd.getTime() >= oStart.getTime();
      },

      /**
       * Date range: validate and apply table filter when range changes.
       */
      onReportDateRangeChange: function (oEvent) {
        if (oEvent.getParameter("valid") === false) {
          return;
        }
        var oDRS = oEvent.getSource();
        var oFrom = oDRS.getDateValue();
        var oTo = oDRS.getSecondDateValue();
        if (!this._isReportDateRangeOrderValid(oFrom, oTo)) {
          oDRS.setSecondDateValue(null);
          var oHomeModel = this.getView().getModel("homeFilter");
          if (oHomeModel) {
            oHomeModel.setProperty("/reportDateTo", null);
          }
          MessageBox.error(
            "The end date cannot be before the start date. Please choose an end date on or after the start date."
          );
          return;
        }
        this._applyTableFilter();
      },

      /**
       * Trip / vehicle filter inputs: apply on commit (Enter / blur).
       */
      onFilterInputChange: function () {
        var oRange = this._getReportDateRange();
        if (!this._isReportDateRangeOrderValid(oRange.from, oRange.to)) {
          return;
        }
        this._applyTableFilter();
      },

      /**
       * Trip / vehicle filter inputs: debounced apply while typing.
       */
      onFilterInputLiveChange: function () {
        if (this._iFilterInputDebounce) {
          clearTimeout(this._iFilterInputDebounce);
        }
        this._iFilterInputDebounce = setTimeout(
          function () {
            this._iFilterInputDebounce = null;
            var oRange = this._getReportDateRange();
            if (!this._isReportDateRangeOrderValid(oRange.from, oRange.to)) {
              return;
            }
            this._applyTableFilter();
          }.bind(this),
          350
        );
      },

      _getReportDateRange: function () {
        var oDRS = this.byId("ReportDateRange");
        if (!oDRS) {
          return { from: null, to: null };
        }
        return {
          from: oDRS.getDateValue() || null,
          to: oDRS.getSecondDateValue() || null,
        };
      },

      // --------------------------------------------
      // TRIP TABLE: OData filters (trip, date) + client vehicle + status row colors
      // --------------------------------------------
      _applyTableFilter: function () {
        var oTable = this.getView().byId("tripTable");
        if (!oTable) {
          return;
        }
        var oBinding = oTable.getBinding("items");
        if (!oBinding) {
          return;
        }

        var aInputs = this.getView().findAggregatedObjects(
          true,
          function (oCtrl) {
            return (
              oCtrl.isA("sap.m.Input") ||
              oCtrl.isA("sap.m.DatePicker")
            );
          }
        );

        var aFilters = [];
        var sVehicleNeedleLower = "";

        var oRange = this._getReportDateRange();
        var oDateFrom = oRange.from;
        var oDateTo = oRange.to;

        if (oDateFrom || oDateTo) {
          var aDateFilters = [];
          if (oDateFrom) {
            var oStartOfDay = new Date(oDateFrom);
            oStartOfDay.setHours(0, 0, 0, 0);
            aDateFilters.push(
              new Filter("CreatedOn", FilterOperator.GE, oStartOfDay)
            );
          }
          if (oDateTo) {
            var oEndOfDay = new Date(oDateTo);
            oEndOfDay.setHours(23, 59, 59, 999);
            aDateFilters.push(
              new Filter("CreatedOn", FilterOperator.LE, oEndOfDay)
            );
          }
          if (aDateFilters.length) {
            aFilters.push(new Filter(aDateFilters, true));
          }
        }

        aInputs.forEach(
          function (oInput) {
            if (oInput.isA("sap.m.DatePicker")) {
              return;
            }
            var sField = oInput.data("field");
            var sValue = (oInput.getValue ? oInput.getValue() : "").trim();
            if (sField && sValue) {
              var oFieldConfig = this._getFieldConfiguration(sField);
              if (oFieldConfig) {
                if (sField === "vehicleNumber") {
                  sVehicleNeedleLower = sValue.toLowerCase();
                } else {
                  aFilters.push(
                    new Filter(
                      oFieldConfig.sKeyField,
                      FilterOperator.Contains,
                      sValue
                    )
                  );
                }
              }
            }
          }.bind(this)
        );

        this._sVehicleNumberNeedleLower = sVehicleNeedleLower;
        if (oTable && typeof oTable.setGrowing === "function") {
          oTable.setGrowing(!sVehicleNeedleLower);
        }

        oBinding.filter(aFilters.length ? new Filter(aFilters, true) : []);
        this._applyClientSideTripTableFilters();
      },

      /**
       * Client-side vehicle match (case-insensitive) + trip status row tint on tr.
       * @private
       */
      _applyClientSideTripTableFilters: function () {
        var oTable = this.getView().byId("tripTable");
        if (!oTable || typeof oTable.getItems !== "function") {
          return;
        }
        var sNeedleLower = (this._sVehicleNumberNeedleLower || "")
          .trim()
          .toLowerCase();
        if (typeof oTable.setGrowing === "function") {
          oTable.setGrowing(!sNeedleLower);
        }
        var aItems = oTable.getItems() || [];
        var that = this;
        aItems.forEach(function (oItem) {
          if (!oItem || !oItem.getBindingContext) {
            return;
          }
          var oCtx = oItem.getBindingContext();
          var oObj = oCtx && oCtx.getObject ? oCtx.getObject() : null;
          if (!oObj) {
            if (oItem.setVisible) {
              oItem.setVisible(false);
            }
            that._clearTripStatusCategoryDomClasses(oItem);
            return;
          }
          var sVeh =
            oObj.VehicleNumber != null ? String(oObj.VehicleNumber) : "";
          var bMatch =
            !sNeedleLower || sVeh.toLowerCase().indexOf(sNeedleLower) > -1;
          if (oItem.setVisible) {
            oItem.setVisible(bMatch);
          }
          if (bMatch) {
            that._syncTripStatusCategoryDomClasses(oItem, oObj.TripStatus);
          } else {
            that._clearTripStatusCategoryDomClasses(oItem);
          }
        });
      },

      /**
       * @private
       */
      _clearTripStatusCategoryDomClasses: function (oItem) {
        var oDom = oItem.getDomRef && oItem.getDomRef();
        if (!oDom || !oDom.classList) {
          return;
        }
        var aAll = this._TRIP_STATUS_ROW_CLASS_NAMES || [];
        aAll.forEach(function (c) {
          oDom.classList.remove(c);
        });
      },

      /**
       * @private
       */
      _syncTripStatusCategoryDomClasses: function (oItem, vTripStatus) {
        var oDom = oItem.getDomRef && oItem.getDomRef();
        if (!oDom || !oDom.classList) {
          return;
        }
        var aAll = this._TRIP_STATUS_ROW_CLASS_NAMES || [];
        var sNext = this.getTripStatusClass(vTripStatus);
        aAll.forEach(function (c) {
          oDom.classList.remove(c);
        });
        if (sNext) {
          oDom.classList.add(sNext);
        }
      },

      /**
       * @deprecated use _applyClientSideTripTableFilters
       */
      _applyClientSideVehicleNumberFilter: function () {
        this._applyClientSideTripTableFilters();
      },

      // --------------------------------------------
      // FIELD CONFIGURATION
      // --------------------------------------------
      _getFieldConfiguration: function (sField) {
        switch (sField) {
          case "tripNo":
            return {
              sKeyField: "TripNumber",
              sDescField: "VehicleNumber",
              sTitle: "Select Gate Pass No",
            };
          case "vehicleNumber":
            return {
              sKeyField: "VehicleNumber",
              sDescField: "VehicleType",
              sTitle: "Select Vehicle No",
            };
          case "vehicleType":
            return {
              sKeyField: "VehicleType",
              sDescField: "VehicleSize",
              sTitle: "Select Vehicle Type",
            };
          case "transporterName":
            return {
              sKeyField: "TransporterName",
              sDescField: "DriverName",
              sTitle: "Select Transporter",
            };
          case "lrNumber":
            return {
              sKeyField: "LR_Number",
              sDescField: "TripNumber",
              sTitle: "Select LR Number",
            };
          default:
            return null;
        }
      },

      // ============================================================
      // COLUMN VISIBILITY
      // ============================================================
      _initializeColumnVisibility: function () {
        var oTable = this.getView().byId("tripTable");
        if (!oTable) {
          return;
        }

        var that = this;
        var aColumns = oTable.getColumns().map(function (oColumn) {
          var oHeader = oColumn.getHeader();
          var sLabel = oHeader && oHeader.getText ? oHeader.getText() : "";
          var sKey = that._extractColumnKey(oColumn.getId());
          var bDefault = that._getDefaultColumnVisibility(sKey);
          oColumn.setVisible(bDefault);
          return {
            id: sKey,
            label: sLabel,
            visible: bDefault,
          };
        });

        this._oColumnSettingsModel = new JSONModel({ columns: aColumns });
        this.getView().setModel(this._oColumnSettingsModel, "columnSettings");
      },

      _applyColumnVisibilityFromModel: function () {
        if (!this._oColumnSettingsModel) {
          return;
        }
        var oTable = this.getView().byId("tripTable");
        if (!oTable) {
          return;
        }

        var aColumns = this._oColumnSettingsModel.getProperty("/columns") || [];
        var that = this;
        aColumns.forEach(function (oColumnInfo) {
          var oColumn = that.byId(oColumnInfo.id);
          if (oColumn) {
            oColumn.setVisible(oColumnInfo.visible);
          }
        });
      },

      onOpenColumnVisibilityDialog: function () {
        if (!this._oColumnSettingsModel) {
          this._initializeColumnVisibility();
        } else {
          this._applyColumnVisibilityFromModel();
        }

        if (!this._oColumnVisibilityDialog) {
          Fragment.load({
            id: this.getView().getId(),
            name: "com.incresolZ_INC_PLMS.fragments.HomePageFrags.ColumnVisibilityDialog",
            controller: this,
          }).then(
            function (oDialog) {
              this._oColumnVisibilityDialog = oDialog;
              this.getView().addDependent(oDialog);
              oDialog.open();
            }.bind(this)
          );
        } else {
          this._oColumnVisibilityDialog.open();
        }
      },

      onColumnSwitchChanged: function (oEvent) {
        var oSwitch = oEvent.getSource();
        var bState = oSwitch.getState();
        var oContext = oSwitch.getBindingContext("columnSettings");
        if (!oContext) {
          return;
        }
        var sColumnId = oContext.getProperty("id");
        var oColumn = this.byId(sColumnId);
        if (oColumn) {
          oColumn.setVisible(bState);
        }
        oContext.getModel().setProperty(oContext.getPath() + "/visible", bState);
      },

      onResetColumnVisibility: function () {
        if (!this._oColumnSettingsModel) {
          return;
        }
        var aColumns =
          this._oColumnSettingsModel.getProperty("/columns") || [];
        aColumns.forEach(
          function (oCol) {
            oCol.visible = this._getDefaultColumnVisibility(oCol.id);
          }.bind(this)
        );
        this._oColumnSettingsModel.refresh(true);
        this._applyColumnVisibilityFromModel();
      },

      _extractColumnKey: function (sId) {
        if (!sId) return "";
        var aParts = sId.split("--");
        return aParts[aParts.length - 1];
      },

      _getDefaultColumnVisibility: function (sKey) {
        var aDefaultVisible = [
          "colTripNumber",
          "colTripStatus",
          "colVehicleNumber",
          "colReportingDateTime",
          "colMovementType",
          "colMovementScenario",
          "colPartyName",
          "colGRN",
        ];
        return aDefaultVisible.indexOf(sKey) !== -1;
      },

      /**
       * Build mapping: MovementType+MovementScenario -> LongText (scenario description)
       * Source: OrderTypeSH (already used by VehicleReportingTab for movement scenario details).
       * @private
       */
      _loadMovementScenarioDescriptions: function () {
        var oModel = this.getView().getModel();
        if (!oModel) return;

        var that = this;
        this._mMovementScenarioDescByItemKey = {};

        oModel.read("/OrderTypeSH", {
          success: function (oData) {
            var aRows = (oData && oData.results) || [];
            aRows.forEach(function (row) {
              if (!row) return;
              var sKey = MovementScenarioIcons.getMovementScenarioItemKey(
                row.MovementType,
                row.MovementScenario
              );
              if (sKey) {
                that._mMovementScenarioDescByItemKey[sKey] =
                  row.LongText || "";
              }
            });

            // Descriptions are loaded asynchronously; trigger re-evaluation of the formatter bindings
            // so the table replaces raw codes with the resolved LongText.
            try {
              oModel.updateBindings(true);
            } catch (e) {
              // ignore - best effort refresh
            }
          },
          error: function () {
            that._mMovementScenarioDescByItemKey = {};
          },
        });
      },

      /**
       * Formatter used by XML cell to show "Moment Scenario Description".
       */
      formatMovementScenarioDesc: function (sMovementType, sMovementScenario) {
        if (!sMovementScenario) return "";

        var sKey = MovementScenarioIcons.getMovementScenarioItemKey(
          sMovementType,
          sMovementScenario
        );

        if (
          this._mMovementScenarioDescByItemKey &&
          sKey &&
          this._mMovementScenarioDescByItemKey[sKey]
        ) {
          return this._mMovementScenarioDescByItemKey[sKey];
        }

        // Fallback: show raw code if descriptions cannot be loaded.
        return sMovementScenario;
      },

      onCloseColumnVisibilityDialog: function () {
        if (this._oColumnVisibilityDialog) {
          this._oColumnVisibilityDialog.close();
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

      /**
       * Trip reporting timestamp from TripDetails CreatedOn + CreatedTime (OData v2).
       */
      formatReportingDateTime: function (vOn, vTime) {
        if ((vOn === undefined || vOn === null || vOn === "") &&
            (vTime === undefined || vTime === null || vTime === "")) {
          return "";
        }
        var DateFormat = sap.ui.core.format.DateFormat;

        // Force same display across locales (matches Analysis tab expectation).
        // Example: "Apr 20, 2026 8:43 PM"
        var oDateTimeFmt = DateFormat.getDateTimeInstance({
          pattern: "MMM dd, yyyy h:mm a",
        });

        var oDatePart = null;
        if (vOn !== undefined && vOn !== null && vOn !== "") {
          if (vOn instanceof Date) {
            oDatePart = vOn;
          } else if (typeof vOn === "string") {
            var m = /\/Date\((-?\d+)\)\//.exec(vOn);
            if (m) {
              oDatePart = new Date(parseInt(m[1], 10));
            }
          }
        }

        var iTimeMs = null;
        if (vTime !== undefined && vTime !== null && vTime !== "") {
          if (typeof vTime === "object" && typeof vTime.ms === "number") {
            iTimeMs = vTime.ms;
          } else if (typeof vTime === "number") {
            iTimeMs = vTime;
          } else if (vTime instanceof Date && !isNaN(vTime.getTime())) {
            iTimeMs =
              vTime.getHours() * 3600000 +
              vTime.getMinutes() * 60000 +
              vTime.getSeconds() * 1000 +
              vTime.getMilliseconds();
          }
        }

        // If we can combine date+time, do it (preferred).
        if (oDatePart && !isNaN(oDatePart.getTime()) && typeof iTimeMs === "number" && !isNaN(iTimeMs)) {
          var iHours = Math.floor(iTimeMs / 3600000);
          var iMinutes = Math.floor((iTimeMs % 3600000) / 60000);
          var oCombined = new Date(
            oDatePart.getFullYear(),
            oDatePart.getMonth(),
            oDatePart.getDate(),
            iHours,
            iMinutes,
            0,
            0
          );
          return oDateTimeFmt.format(oCombined);
        }

        // Fallback: keep previous behavior (best-effort).
        var oDateFmt = DateFormat.getDateInstance({ style: "medium" });
        var oTimeFmt = DateFormat.getTimeInstance({ style: "short" });
        var sDate = "";
        var sTime = "";
        if (oDatePart && !isNaN(oDatePart.getTime())) {
          sDate = oDateFmt.format(oDatePart);
        }
        if (typeof iTimeMs === "number" && !isNaN(iTimeMs)) {
          var oT = new Date(iTimeMs);
          if (!isNaN(oT.getTime())) {
            sTime = oTimeFmt.format(oT);
          }
        } else if (typeof vTime === "string") {
          sTime = vTime;
        }
        if (sDate && sTime) {
          return sDate + " " + sTime;
        }
        return sDate || sTime || "";
      },

      formatMovementType: function (sMovementType) {
        if (!sMovementType) {
          return "";
        }
        var sType = String(sMovementType).toUpperCase().trim();
        if (sType === "I") {
          return "Inward";
        }
        if (sType === "O") {
          return "Outward";
        }
        return sType;
      },

      /** @type {string[]} All CSS classes applied to trip rows — keep in sync with getTripStatusClass + style.css */
      _TRIP_STATUS_ROW_CLASS_NAMES: [
        "tripStatusCategoryInProgress",
        "tripStatusCategoryCompleted",
      ],

      /**
       * Normalize TripStatus for stable comparisons (UI5 1.38 + OData quirks).
       * @private
       */
      _normalizeTripStatusForRowClass: function (sTripStatus) {
        if (sTripStatus === undefined || sTripStatus === null) {
          return "";
        }
        return String(sTripStatus)
          .replace(/\u00a0/g, " ")
          .replace(/_/g, " ")
          .toLowerCase()
          .trim()
          .replace(/\s+/g, " ")
          .replace(/[\.,;]+$/g, "");
      },

      /**
       * True when trip is finished (Trip Completed) — used for Trip Completed filter and green row tint.
       * Not used for Cancelled / Error / Failed (those stay "In Progress" styling).
       * @param {string} sNorm - normalized status from _normalizeTripStatusForRowClass
       * @private
       */
      _isTripStatusTripCompletedNorm: function (sNorm) {
        if (!sNorm) {
          return false;
        }
        if (
          sNorm === "completed" ||
          sNorm === "done" ||
          sNorm === "trip completed" ||
          sNorm === "tripcompleted"
        ) {
          return true;
        }
        if (sNorm.indexOf("trip completed") === 0) {
          return true;
        }
        return false;
      },

      /**
       * Returns CSS class for home trip row tint: trip completed = green; everything else = yellow.
       * @param {string} sTripStatus - Trip status value
       * @returns {string} CSS class name
       */
      getTripStatusClass: function (sTripStatus) {
        var sNorm = this._normalizeTripStatusForRowClass(sTripStatus);
        if (!sNorm) {
          return "tripStatusCategoryInProgress";
        }
        if (this._isTripStatusTripCompletedNorm(sNorm)) {
          return "tripStatusCategoryCompleted";
        }
        return "tripStatusCategoryInProgress";
      },

      /**
       * UI5 1.x: bound class on ColumnListItem often does not reach the table row DOM.
       * Re-apply status style classes whenever the table finishes updating rows.
       */
      onTripTableUpdateFinished: function (oEvent) {
        var oTable =
          (oEvent && oEvent.getSource && oEvent.getSource()) ||
          this.byId("tripTable");
        if (!oTable || typeof oTable.getItems !== "function") {
          return;
        }
        this._applyClientSideTripTableFilters();
        if (this._iTripTableTintDeferred) {
          clearTimeout(this._iTripTableTintDeferred);
        }
        this._iTripTableTintDeferred = setTimeout(
          function () {
            this._iTripTableTintDeferred = null;
            this._applyClientSideTripTableFilters();
          }.bind(this),
          0
        );
      },

      // User-role-based visibility for Report Vehicle has been removed;
      // button visibility is now controlled purely by view configuration.
    });
  }
);
