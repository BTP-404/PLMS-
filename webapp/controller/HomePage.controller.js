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
    MovementScenarioIcons
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

        var oTable = this.getView().byId("tripTable");
        if (oTable) {
          // Re-apply client-side VehicleNumber filtering whenever table updates (initial load, refresh, growing).
          oTable.attachUpdateFinished(this._applyClientSideVehicleNumberFilter, this);
        }
        this.getView().setModel(
          new JSONModel({
            reportDateFrom: null,
            reportDateTo: null,
          }),
          "homeFilter"
        );
        this._initializeColumnVisibility();
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

        this.onRefresh();

        this._oReportVehicleMatOptsModel = new JSONModel({
          selectedIndex: 0,
        });
        this._oIncomingEntryMethodModel = new JSONModel({
          selectedKey: "PO",
          entryComplete: false,
          skipDocument: false,
        });
        this._oIncomingPoSuggestModel = new JSONModel({ items: [] });
        this._oOutgoingPoSuggestModel = new JSONModel({ items: [] });
        this._oOutgoingInvoiceSuggestModel = new JSONModel({ items: [] });
        this._oOutgoingEntryMethodModel = new JSONModel({
          selectedKey: "INVOICE",
          billingDocument: "",
          poNumber: "",
          skipDocumentInvoice: false,
          skipDocumentPo: false,
          invoiceMovementType: "",
          invoiceMovementScenario: "",
          invoiceMovementDescription: "",
        });
        this._sLastPostedPoNumber = null;
        this._sPendingOrderDetailPo = null;
      },

      onExit: function () {
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
          this._oOutgoingEntryMethodModel.setData({
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
          });
        } else {
          this._oIncomingEntryMethodModel.setData({
            selectedKey: "PO",
            entryComplete: false,
            skipDocument: false,
          });
        }
        if (this._oIncomingPoSuggestModel) {
          this._oIncomingPoSuggestModel.setData({ items: [] });
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
              oDialog.open();
            }.bind(this)
          );
        } else {
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
       * Outgoing counterpart to _focusIncomingEntryMethodPrimaryInput: Invoice vs PO field, two timeouts after MessageBox / rerender.
       */
      _focusOutgoingEntryMethodPrimaryInput: function (iDelay) {
        var that = this;
        var iMs = typeof iDelay === "number" ? iDelay : 100;
        var fnFocus = function () {
          if (!that._oIncomingEntryMethodDialog) {
            return;
          }
          var sViewId = that.getView().getId();
          var sKey = that._oOutgoingEntryMethodModel
            ? that._oOutgoingEntryMethodModel.getProperty("/selectedKey")
            : "INVOICE";
          var oFocus =
            sKey === "PO"
              ? Fragment.byId(sViewId, "idOutgoingDialogPoInput")
              : Fragment.byId(sViewId, "idOutgoingDialogInvoiceInput");
          if (oFocus && oFocus.focus) {
            oFocus.focus();
          }
        };
        setTimeout(fnFocus, iMs);
        setTimeout(fnFocus, iMs + 120);
      },

      _resetIncomingEntryMethodDialogFields: function () {
        var sViewId = this.getView().getId();
        var oSelect = Fragment.byId(sViewId, "idIncomingEntrySearchSelect");
        if (oSelect && oSelect.setSelectedKey) {
          oSelect.setSelectedKey("PO");
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
        }
        if (this._oIncomingPoSuggestModel) {
          this._oIncomingPoSuggestModel.setProperty("/items", []);
        }
        var oOutSel = Fragment.byId(sViewId, "idOutgoingEntrySearchSelect");
        if (oOutSel && oOutSel.setSelectedKey) {
          oOutSel.setSelectedKey("INVOICE");
        }
        if (this._oOutgoingEntryMethodModel) {
          this._oOutgoingEntryMethodModel.setData({
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
        if (this._oOutgoingPoSuggestModel) {
          this._oOutgoingPoSuggestModel.setProperty("/items", []);
        }
        if (this._oOutgoingInvoiceSuggestModel) {
          this._oOutgoingInvoiceSuggestModel.setProperty("/items", []);
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
        var sPo = oIn && oIn.getValue ? String(oIn.getValue() || "").trim() : "";

        var bSkip = !!(
          this._oIncomingEntryMethodModel &&
          this._oIncomingEntryMethodModel.getProperty("/skipDocument")
        );

        // Validation: PO should be there OR Skip Document should be Yes
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

        var fnParsePoRow = function (oRow) {
          // PoNumberSH (YIGP_PLMS_SRV): MovementType (I/O), MovementScenario (e.g. "04"),
          // scenario text in MovementDescription (preferred) or MovementScenarioDesc / LongText.
          if (!oRow) {
            return { movementType: "", movementScenario: "", movementScenarioDesc: "" };
          }
          var sMt =
            oRow.MovementType !== undefined && oRow.MovementType !== null
              ? String(oRow.MovementType).trim()
              : "";
          var sMs =
            oRow.MovementScenario !== undefined && oRow.MovementScenario !== null
              ? String(oRow.MovementScenario).trim()
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
          return { movementType: sMt, movementScenario: sMs, movementScenarioDesc: sDesc };
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
            error: function () {
              if (fnNextFallback) {
                fnNextFallback();
              } else {
                fnApplyAndNav({});
              }
            },
          });
        };

        // Prefer direct key read: PoNumberSH('<selectedPo>')
        oModel.read("/PoNumberSH('" + encodeURIComponent(sPo) + "')", {
          success: function (oData) {
            var oRow =
              (oData && oData.d) ? oData.d : oData; // support raw "d" envelope if present
            fnApplyAndNav(fnParsePoRow(oRow));
          },
          error: function () {
        // Fallback: filter by Ebeln (PO number field in metadata)
        fnReadPoNumberShCollection("Ebeln");
          },
        });
      },

      onIncomingEntryMethodSelectChange: function () {
        var sViewId = this.getView().getId();
        var oSelect = Fragment.byId(sViewId, "idIncomingEntrySearchSelect");
        var sKey = oSelect ? oSelect.getSelectedKey() : "";
        if (this._oIncomingEntryMethodModel) {
          this._oIncomingEntryMethodModel.setProperty("/selectedKey", sKey || "");
          this._oIncomingEntryMethodModel.setProperty("/entryComplete", false);
          this._oIncomingEntryMethodModel.setProperty("/skipDocument", false);
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
          MessageToast.show("Complete PO submit or scan successfully first.");
          this._focusIncomingEntryMethodPrimaryInput(150);
          return;
        }

        var oTrip = sap.ui.getCore().getModel("TripData");
        var sTripNo = oTrip ? oTrip.getProperty("/TripNumber") : "";
        if (!sTripNo) {
          MessageToast.show("Trip number is missing.");
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
        if (!sTerm || sTerm.length < 2) {
          this._sIncomingDialogPoSuggestLastTerm = "";
          this._oIncomingPoSuggestModel.setProperty("/items", []);
          return;
        }
        if (this._sIncomingDialogPoSuggestLastTerm === sTerm) {
          return;
        }
        this._sIncomingDialogPoSuggestLastTerm = sTerm;

        // PoNumberSH: PO number field in metadata is typically Ebeln.
        // Search by PO number (Ebeln) or vendor name.
        var oOrFilter = new Filter(
          [
            new Filter("Ebeln", FilterOperator.Contains, sTerm),
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
            var n =
              (o.Ebeln && String(o.Ebeln).trim()) ||
              (o.PoNumber && String(o.PoNumber).trim()) ||
              "";
            if (n && !mSeen[n]) {
              mSeen[n] = true;
              aItems.push({
                Ebeln: n,
                PoNumber: n, // keep alias for backends that return PoNumber
                VendorName: (o.VendorName && String(o.VendorName).trim()) || "",
              });
            }
          });
          that._oIncomingPoSuggestModel.setProperty("/items", aItems);
        };

        var fnPoOnly = function () {
          var aFilters = [new Filter("Ebeln", FilterOperator.Contains, sTerm)];
          oModel.read("/PoNumberSH", {
            filters: aFilters,
            urlParameters: { $top: "40" },
            success: fnSuccess,
            error: function () {
              that._oIncomingPoSuggestModel.setProperty("/items", []);
            },
          });
        };

        oModel.read("/PoNumberSH", {
          filters: [oOrFilter],
          urlParameters: { $top: "40" },
          success: fnSuccess,
          error: fnPoOnly,
        });
      },

      onIncomingDialogPoSuggestionSelected: function (oEvent) {
        var oItem = oEvent.getParameter("selectedItem");
        if (!oItem) {
          return;
        }
        var sPo = oItem.getText();
        oEvent.getSource().setValue(sPo);
      },

      _navigateToTripFromIncomingDialog: function (sTripNo, sTabKey) {
        var sTrip = String(sTripNo || "").trim();
        if (!sTrip) {
          MessageToast.show("Trip number is missing.");
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
        sap.ui.getCore().getEventBus().publish("HomePage", "RefreshTripTable");
      },

      _incomingDialogFetchTripByPoAndNavigate: function () {
        var sViewId = this.getView().getId();
        var oIn = Fragment.byId(sViewId, "idIncomingDialogPoInput");
        var sPo = oIn && oIn.getValue ? String(oIn.getValue() || "").trim() : "";
        if (!sPo) {
          MessageToast.show("Enter or select a PO number");
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
                new Filter("Ebeln", FilterOperator.EQ, sPo),
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
       */
      onIncomingDialogScanChange: function (oEvent) {
        var oIn = oEvent.getSource();
        var sText = (oIn && oIn.getValue ? oIn.getValue() : "") || "";
        sText = String(sText).trim();
        if (!sText) {
          return;
        }
        this._incomingDialogProcessScannedCode(sText.split("|")[0]);
      },

      onIncomingDialogScanSubmit: function (oEvent) {
        var oIn = oEvent.getSource();
        var sText = (oIn && oIn.getValue ? oIn.getValue() : "") || "";
        sText = String(sText).trim();
        if (!sText) {
          return;
        }
        this._incomingDialogProcessScannedCode(sText.split("|")[0]);
      },

      onIncomingDialogScanPress: function () {
        var that = this;
        BarcodeScanner.scan(
          function (oResult) {
            if (oResult.cancelled) {
              that._clearIncomingDialogScanInput(false);
              return;
            }
            var sParsed = (oResult.text || "").split("|")[0];
            that._incomingDialogProcessScannedCode(sParsed);
            that._clearIncomingDialogScanInput();
          },
          function (oError) {
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

      _loadTripDetailsAfterIncomingDialog: function (sTripNumber, fnDone) {
        var oModel = this.getView().getModel();
        var that = this;
        if (!oModel || !sTripNumber) {
          if (typeof fnDone === "function") {
            fnDone();
          }
          return;
        }
        oModel.read("/TripDetails('" + sTripNumber + "')", {
          urlParameters: {
            $expand: "OrderDetails,ItemDetails,Feeds,ActivityHistory",
          },
          success: function (oData) {
            if (oData.Weighment_Req !== undefined) {
              oData.WeighmentRequired =
                oData.Weighment_Req === true || oData.Weighment_Req === "X"
                  ? "Y"
                  : "N";
            }
            var oTripDataModel = new JSONModel(oData);
            that._syncMovementScenarioItemKeyOnTripDataHome(oTripDataModel);
            sap.ui.getCore().setModel(oTripDataModel, "TripData");
            sap.ui.getCore().getEventBus().publish("TripData", "Updated");
            sap.ui.getCore().getEventBus().publish("Stage", "TripCreated", {
              tripNumber: sTripNumber,
            });
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
      },

      /**
       * POST /AsnDetails — supports ASN scan (AsnId+OrgId) OR PO/D-Note (PoNumber).
       */
      _incomingDialogPostAsnDetails: function (sAsnId, sOrgId, sPoNumber) {
        var oModel = this.getView().getModel();
        var that = this;
        var oPayload = {};

        if (sAsnId && sOrgId) {
          oPayload = { AsnId: sAsnId, OrgId: sOrgId };
          this._sPendingOrderDetailPo = null;
        } else if (sPoNumber && String(sPoNumber).trim()) {
          oPayload = { PoNumber: String(sPoNumber).trim() };
          this._sPendingOrderDetailPo = String(sPoNumber).trim();
        } else {
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
       * POST /PoNumberSH — PO number is typically Ebeln in metadata.
       */
      _incomingDialogPostPoNumber: function (sPo) {
        var sPoNumber = String(sPo || "").trim();
        if (!sPoNumber) {
          MessageToast.show("Enter or select a PO number");
          this._focusIncomingEntryMethodPrimaryInput(150);
          return;
        }

        var oModel = this.getView().getModel();
        var that = this;
        this._sPendingOrderDetailPo = sPoNumber;
        if (this._oIncomingEntryMethodDialog) {
          this._oIncomingEntryMethodDialog.setBusy(true);
        }
        // Send both fields for compatibility across backend variants.
        oModel.create("/PoNumberSH", { Ebeln: sPoNumber, PoNumber: sPoNumber }, {
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
        var that = this;
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
      },

      _onIncomingIdentificationCreateSuccess: function (oResponse) {
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
          var fnLoadTrip = function () {
            that._loadTripDetailsAfterIncomingDialog(sTripNumber);
            sap.ui.getCore().getEventBus().publish("HomePage", "RefreshTripTable");
          };
          if (sPoForOrder) {
            this._createOrderDetailForIncomingPoTrip(sTripNumber, sPoForOrder, fnLoadTrip);
          } else {
            fnLoadTrip();
          }
          MessageToast.show(
            "Trip created: " + sFormatted + ". Press Continue."
          );
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
          MessageToast.show(
            "Request completed but no trip number was returned."
          );
          if (
            this._oIncomingEntryMethodModel &&
            this._oIncomingEntryMethodModel.getProperty("/selectedKey") === "SCAN"
          ) {
            this._clearIncomingDialogScanInput();
          }
        }
      },

      _onIncomingIdentificationCreateError: function (
        oError,
        sDefaultMessage,
        sPoForDedupReset
      ) {
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
        var sErrorMessage = sDefaultMessage;
        try {
          var oResp = JSON.parse(oError.responseText);
          if (
            oResp.error &&
            oResp.error.message &&
            oResp.error.message.value
          ) {
            sErrorMessage = oResp.error.message.value;
          } else if (oResp.error && oResp.error.message) {
            sErrorMessage = oResp.error.message;
          }
        } catch (e) {
          if (oError.message && oError.message.value) {
            sErrorMessage = oError.message.value;
          } else if (oError.message) {
            sErrorMessage += ": " + oError.message;
          }
        }
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

      _clearIncomingGlobalForOutgoing: function () {
        var oG = sap.ui.getCore().getModel("globalData");
        if (!oG) {
          return;
        }
        oG.setProperty("/IncomingPoNumber", "");
        oG.setProperty("/IncomingMovementScenarioDesc", "");
        oG.setProperty("/IncomingMovementType", "");
        oG.setProperty("/IncomingMovementScenario", "");
        oG.setProperty("/IncomingRefDocSkip", " ");
      },

      onOutgoingEntryMethodSelectChange: function () {
        var sViewId = this.getView().getId();
        var oSelect = Fragment.byId(sViewId, "idOutgoingEntrySearchSelect");
        var sKey = oSelect ? oSelect.getSelectedKey() : "";
        if (this._oOutgoingEntryMethodModel) {
          this._oOutgoingEntryMethodModel.setProperty("/selectedKey", sKey || "INVOICE");
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
        var that = this;
        var fnFocus = function () {
          var oFocus =
            sKey === "PO"
              ? Fragment.byId(that.getView().getId(), "idOutgoingDialogPoInput")
              : Fragment.byId(that.getView().getId(), "idOutgoingDialogInvoiceInput");
          if (oFocus && oFocus.focus) {
            oFocus.focus();
          }
        };
        setTimeout(fnFocus, 100);
        setTimeout(fnFocus, 250);
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
      },

      /**
       * Outgoing Report Vehicle — same rules as incoming PO/invoice:
       * PO with number: scenario from PoNumberSH (see _incomingDialogNavigateToGateEntryWithPo).
       * PO skip-only / Invoice / Invoice skip: scenario empty here; user picks on Reporting (OrderTypeSH), like incoming skip-only.
       * Returns true if sync navigation may proceed; PO-with-number path is async and returns false.
       */
      _validateAndNavigateOutgoingReportVehicle: function () {
        var oOut = this._oOutgoingEntryMethodModel;
        if (!oOut) {
          return false;
        }
        var sSearch = (oOut.getProperty("/selectedKey") || "INVOICE").toString();

        if (sSearch === "PO") {
          var sViewId = this.getView().getId();
          var oPoIn = Fragment.byId(sViewId, "idOutgoingDialogPoInput");
          var sPo =
            oPoIn && oPoIn.getValue
              ? String(oPoIn.getValue() || "").trim()
              : String(oOut.getProperty("/poNumber") || "").trim();
          var bSkipPo = !!oOut.getProperty("/skipDocumentPo");
          if (!sPo && !bSkipPo) {
            var thatOut = this;
            MessageBox.error("Enter/select a PO number or choose Skip document.", {
              onClose: function () {
                thatOut._focusOutgoingEntryMethodPrimaryInput(150);
              },
            });
            return false;
          }
          if (sPo) {
            this._outgoingNavigateToGateEntryWithPo();
            return false;
          }
          var sRefSkip = bSkipPo ? "X" : " ";
          this._setOutgoingGlobalPrefill({
            movementScenario: "",
            movementScenarioDesc: "",
            movementScenarioItemKey: "",
            billingDocument: "",
            refDocSkip: sRefSkip,
            poNumber: "",
          });
          return true;
        }

        var sInv =
          String(oOut.getProperty("/billingDocument") || "").trim();
        var bSkipInv = !!oOut.getProperty("/skipDocumentInvoice");
        if (!sInv && !bSkipInv) {
          var thatInv = this;
          MessageBox.error("Enter an invoice number or select Skip document.", {
            onClose: function () {
              thatInv._focusOutgoingEntryMethodPrimaryInput(150);
            },
          });
          return false;
        }
        var sRefSkipInv = bSkipInv ? "X" : " ";
        var sInvMs = oOut.getProperty("/invoiceMovementScenario") || "";
        var sInvDesc = oOut.getProperty("/invoiceMovementDescription") || "";
        var sInvItemKey = sInvMs
          ? MovementScenarioIcons.getMovementScenarioItemKey("O", sInvMs) || ""
          : "";
        this._setOutgoingGlobalPrefill({
          movementScenario: sInvMs,
          movementScenarioDesc: sInvDesc,
          movementScenarioItemKey: sInvItemKey,
          billingDocument: sInv,
          refDocSkip: sRefSkipInv,
          poNumber: "",
        });
        return true;
      },

      _outgoingNavigateToGateEntryWithPo: function () {
        var sViewId = this.getView().getId();
        var oIn = Fragment.byId(sViewId, "idOutgoingDialogPoInput");
        var sPo = oIn && oIn.getValue ? String(oIn.getValue() || "").trim() : "";
        var bSkip = !!(this._oOutgoingEntryMethodModel &&
          this._oOutgoingEntryMethodModel.getProperty("/skipDocumentPo"));
        var sRefDocSkip = bSkip ? "X" : " ";
        var oModel = this.getView().getModel();
        var that = this;

        var fnParsePoRow = function (oRow) {
          if (!oRow) {
            return { movementType: "", movementScenario: "", movementScenarioDesc: "" };
          }
          var sMt =
            oRow.MovementType !== undefined && oRow.MovementType !== null
              ? String(oRow.MovementType).trim()
              : "";
          var sMs =
            oRow.MovementScenario !== undefined && oRow.MovementScenario !== null
              ? String(oRow.MovementScenario).trim()
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
          return { movementType: sMt, movementScenario: sMs, movementScenarioDesc: sDesc };
        };

        var fnCloseAndNav = function () {
          if (that._oIncomingEntryMethodDialog) {
            that._oIncomingEntryMethodDialog.setBusy(false);
            that._oIncomingEntryMethodDialog.close();
          }
          sap.ui.core.UIComponent.getRouterFor(that).navTo("Stage");
          sap.ui.getCore().getEventBus().publish("HomePage", "RefreshTripTable");
        };

        var fnApplyFromApiRow = function (mParsed) {
          var m = mParsed || {};
          if (m.movementType && String(m.movementType).toUpperCase() !== "O") {
            MessageBox.error(
              "This PO is not for an outward movement. Choose another PO."
            );
            if (that._oIncomingEntryMethodDialog) {
              that._oIncomingEntryMethodDialog.setBusy(false);
            }
            return;
          }
          var sMs = m.movementScenario || "";
          var sDesc = m.movementScenarioDesc || "";
          var sItemKey = MovementScenarioIcons.getMovementScenarioItemKey("O", sMs) || "";
          that._setOutgoingGlobalPrefill({
            movementScenario: sMs,
            movementScenarioDesc: sDesc,
            movementScenarioItemKey: sItemKey,
            billingDocument: "",
            refDocSkip: sRefDocSkip,
            poNumber: sPo,
          });
          fnCloseAndNav();
        };

        if (!oModel) {
          fnApplyFromApiRow(fnParsePoRow(null));
          return;
        }

        if (this._oIncomingEntryMethodDialog) {
          this._oIncomingEntryMethodDialog.setBusy(true);
        }

        var fnReadPoNumberShCollection = function (sFilterProp, fnNextFallback) {
          oModel.read("/PoNumberSH", {
            filters: [new Filter(sFilterProp, FilterOperator.EQ, sPo)],
            urlParameters: { $top: "1" },
            success: function (oData2) {
              var oRow2 =
                oData2 && oData2.results && oData2.results[0] ? oData2.results[0] : null;
              if (oRow2) {
                fnApplyFromApiRow(fnParsePoRow(oRow2));
              } else if (fnNextFallback) {
                fnNextFallback();
              } else {
                fnApplyFromApiRow(fnParsePoRow(null));
              }
            },
            error: function () {
              if (fnNextFallback) {
                fnNextFallback();
              } else {
                fnApplyFromApiRow(fnParsePoRow(null));
              }
            },
          });
        };

        oModel.read("/PoNumberSH('" + encodeURIComponent(sPo) + "')", {
          success: function (oData) {
            var oRow = oData && oData.d ? oData.d : oData;
            fnApplyFromApiRow(fnParsePoRow(oRow));
          },
          error: function () {
            fnReadPoNumberShCollection("Ebeln");
          },
        });
      },

      /**
       * Same pattern as onOutgoingDialogPoSuggest: debounce then load JSONModel for suggestionItems.
       */
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

      _loadOutgoingInvoiceSuggestions: function (sTerm) {
        var oModel = this.getView().getModel();
        if (!oModel || !this._oOutgoingInvoiceSuggestModel) {
          return;
        }
        if (!sTerm || sTerm.length < 2) {
          this._oOutgoingInvoiceSuggestModel.setProperty("/items", []);
          return;
        }
        var that = this;
        oModel.read("/BillingDocSH", {
          filters: [new Filter("BillingDoc", FilterOperator.Contains, sTerm)],
          urlParameters: { $top: "40" },
          success: function (oData) {
            var a = (oData && oData.results) || [];
            var mSeen = {};
            var aItems = [];
            a.forEach(function (o) {
              var sV =
                o && o.BillingDoc ? String(o.BillingDoc).trim() : "";
              if (!sV || mSeen[sV]) {
                return;
              }
              mSeen[sV] = true;
              aItems.push({
                BillingDoc: sV,
                MovementType:
                  o && o.MovementType
                    ? String(o.MovementType).trim()
                    : "",
                MovementScenario:
                  o && o.MovementScenario
                    ? String(o.MovementScenario).trim()
                    : "",
                MovementDescription:
                  o && o.MovementDescription
                    ? String(o.MovementDescription).trim()
                    : "",
              });
            });
            that._oOutgoingInvoiceSuggestModel.setProperty("/items", aItems);
          },
          error: function () {
            that._oOutgoingInvoiceSuggestModel.setProperty("/items", []);
          },
        });
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
      },

      onOutgoingReportInvoiceChange: function (oEvent) {
        var sVal = oEvent.getParameter("value") || "";
        if (this._oOutgoingEntryMethodModel) {
          this._oOutgoingEntryMethodModel.setProperty(
            "/billingDocument",
            String(sVal || "").trim()
          );
        }
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
            new Filter("Ebeln", FilterOperator.Contains, sTerm),
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
            var n =
              (o.Ebeln && String(o.Ebeln).trim()) ||
              (o.PoNumber && String(o.PoNumber).trim()) ||
              "";
            if (n && !mSeen[n]) {
              mSeen[n] = true;
              aItems.push({
                Ebeln: n,
                PoNumber: n,
                VendorName: (o.VendorName && String(o.VendorName).trim()) || "",
              });
            }
          });
          that._oOutgoingPoSuggestModel.setProperty("/items", aItems);
        };
        oModel.read("/PoNumberSH", {
          filters: [oOrFilter],
          urlParameters: { $top: "40" },
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
        var sTripNo = oRowData.TripNumber;
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

        var oTripDataModel = new JSONModel(oRowData);
        this._syncMovementScenarioItemKeyOnTripDataHome(oTripDataModel);
        sap.ui.getCore().setModel(oTripDataModel, "TripData");
        sap.ui.getCore().getEventBus().publish("TripData", "Updated");

        this.getView().byId("tripTable").removeSelections(true);
        sap.ui.core.UIComponent.getRouterFor(this).navTo("StagewithParam", {
          tripNo: sTripNo || "",
        });
      },

      onRefresh: function () {
        var oTable = this.getView().byId("tripTable");
        var oModel = this.getView().getModel();
        if (oModel) {
          oTable.setBusy(true);
          oModel.refresh(true);
          oModel.attachRequestCompleted(function () {
            oTable.setBusy(false);
            // MessageToast.show("Trip details refreshed");
          });
        }
      },

      _onExternalRefresh: function () {
        this.onRefresh();
      },

      /**
       * Event handler for route matched - automatically refreshes table when navigating to HomePage
       * @private
       */
      _onRouteMatched: function () {
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
              var oRange = this._getReportDateRange();
              if (this._isReportDateRangeOrderValid(oRange.from, oRange.to)) {
                this._applyTableFilter();
              }
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
        var oRange = this._getReportDateRange();
        if (this._isReportDateRangeOrderValid(oRange.from, oRange.to)) {
          this._applyTableFilter();
        }
      },

      /**
       * True if end date is on or after start date (same calendar day). Single date ok.
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
       * Validates range: end cannot be before start. Clears invalid end and syncs homeFilter model.
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
       * When filter text is committed (Enter or focus leaves), re-apply filters (e.g. after clearing).
       */
      onFilterInputChange: function () {
        var oRange = this._getReportDateRange();
        if (!this._isReportDateRangeOrderValid(oRange.from, oRange.to)) {
          return;
        }
        this._applyTableFilter();
      },

      /**
       * While typing in Trip / Vehicle filters, re-apply after a short pause (e.g. user clears text).
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
      // TABLE FILTERING LOGIC
      // --------------------------------------------
      _applyTableFilter: function () {
        var oTable = this.getView().byId("tripTable");
        var oBinding = oTable.getBinding("items");
        if (!oBinding) return;

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

        // Handle date range first
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

        // Handle text inputs
        aInputs.forEach(
          function (oInput) {
            if (oInput.isA("sap.m.DatePicker")) {
              // already handled
              return;
            }
            var sField = oInput.data("field");
            var sValue = (oInput.getValue ? oInput.getValue() : "").trim();
            if (sField && sValue) {
              var oFieldConfig = this._getFieldConfiguration(sField);
              if (oFieldConfig) {
                if (sField === "vehicleNumber") {
                  // VehicleNumber is marked as non-filterable in metadata in some systems.
                  // Also, OData "contains" is often case-sensitive depending on backend.
                  // So we do a client-side, case-insensitive filter on the already-bound items.
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

        oBinding.filter(aFilters.length ? new Filter(aFilters, true) : []);
        // Apply immediately for current items (updateFinished will also re-apply after refresh/growing).
        this._applyClientSideVehicleNumberFilter();
      },

      /**
       * Client-side, case-insensitive filter for VehicleNumber (hides/shows table rows).
       * This avoids backend case-sensitivity and works even if VehicleNumber is not filterable.
       */
      _applyClientSideVehicleNumberFilter: function () {
        var oTable = this.getView().byId("tripTable");
        if (!oTable) return;

        var sNeedleLower = (this._sVehicleNumberNeedleLower || "").trim().toLowerCase();
        var aItems = oTable.getItems ? oTable.getItems() : [];

        aItems.forEach(function (oItem) {
          if (!oItem || !oItem.getBindingContext) return;
          var oCtx = oItem.getBindingContext();
          var oObj = oCtx && oCtx.getObject ? oCtx.getObject() : null;
          var sVeh = (oObj && oObj.VehicleNumber != null) ? String(oObj.VehicleNumber) : "";

          var bMatch = !sNeedleLower || sVeh.toLowerCase().indexOf(sNeedleLower) > -1;
          if (oItem.setVisible) {
            oItem.setVisible(bMatch);
          }
        });
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
              sTitle: "Select Trip Number",
            };
          case "vehicleNumber":
            return {
              sKeyField: "VehicleNumber",
              sDescField: "VehicleType",
              sTitle: "Select Vehicle Number",
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
          "colVehicleNumber",
          "colTripStatus",
          "colMovementType",
          "colMovementScenario",
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

      /**
       * Formatter to get CSS class based on Trip Status
       * @param {string} sTripStatus - Trip status value
       * @returns {string} CSS class name
       */
      getTripStatusClass: function (sTripStatus) {
        if (!sTripStatus) {
          return "";
        }
        
        // Normalize status to lowercase for comparison
        var sStatus = sTripStatus.toLowerCase().trim();
        
        // Map status values to CSS classes
        if (sStatus === "new" || sStatus === "created") {
          return "tripStatusNew";
        } else if (sStatus === "pending" || sStatus === "pending approval") {
          return "tripStatusPending";
        } else if (sStatus === "in progress" || sStatus === "active" || sStatus === "in-progress") {
          return "tripStatusInProgress";
        } else if (sStatus === "gate in" || sStatus === "gate-in") {
          return "tripStatusGateIn";
        } else if (sStatus === "loading" || sStatus === "loading start" || sStatus === "loading end") {
          return "tripStatusLoading";
        } else if (sStatus === "gate out" || sStatus === "gate-out") {
          return "tripStatusGateOut";
        } else if (sStatus === "completed" || sStatus === "done") {
          return "tripStatusCompleted";
        } else if (sStatus === "cancelled" || sStatus === "canceled") {
          return "tripStatusCancelled";
        } else if (sStatus === "error" || sStatus === "failed") {
          return "tripStatusError";
        } else if (sStatus === "test" || sStatus === "testing") {
          return "tripStatusTest";
        }
        
        // Default: no special color
        return "";
      },

      // User-role-based visibility for Report Vehicle has been removed;
      // button visibility is now controlled purely by view configuration.
    });
  }
);
