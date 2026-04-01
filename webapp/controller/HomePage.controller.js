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

      onContinueReportVehicleCombinedDialog: function () {
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

        if (bIncoming) {
          this.onContinueIncomingEntryMethodDialog();
        } else {
          if (this._oIncomingEntryMethodDialog) {
            this._oIncomingEntryMethodDialog.close();
          }
          oGlobalModel.setProperty("/IncomingReportingMethod", null);
          this._executeNewReportVehicleNavigation();
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
          var sKey = that._oIncomingEntryMethodModel
            ? that._oIncomingEntryMethodModel.getProperty("/selectedKey")
            : "";
          var sViewId = that.getView().getId();
          var oFocus =
            sKey === "SCAN"
              ? Fragment.byId(sViewId, "idIncomingDialogScanInput")
              : Fragment.byId(sViewId, "idIncomingDialogPoInput");
          if (oFocus && oFocus.focus) {
            oFocus.focus();
          }
        }, 150);
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
        if (this._oIncomingEntryMethodDialog) {
          this._oIncomingEntryMethodDialog.setBusy(false);
        }
        this._sLastPostedPoNumber = null;
        this._sPendingOrderDetailPo = null;
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
          MessageBox.error("Enter/select a PO number or choose Skip Document.");
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
            movementScenarioDesc: m.movementScenarioDesc || "",
            movementType: m.movementType || "",
            movementScenario: m.movementScenario || "",
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
          // Backend variants:
          // - key field may be PoNumber or Ebeln
          // - description may be MovementDescription or MovementScenarioDesc
          var sMt = (oRow && oRow.MovementType != null) ? String(oRow.MovementType).trim() : "";
          var sMs = (oRow && oRow.MovementScenario != null) ? String(oRow.MovementScenario).trim() : "";
          var sDesc = "";
          if (oRow && oRow.MovementDescription != null) {
            sDesc = String(oRow.MovementDescription).trim();
          } else if (oRow && oRow.MovementScenarioDesc != null) {
            sDesc = String(oRow.MovementScenarioDesc).trim();
          }
          return { movementType: sMt, movementScenario: sMs, movementScenarioDesc: sDesc };
        };

        // Prefer direct key read: PoNumberSH('<selectedPo>')
        oModel.read("/PoNumberSH('" + encodeURIComponent(sPo) + "')", {
          success: function (oData) {
            var oRow =
              (oData && oData.d) ? oData.d : oData; // support raw "d" envelope if present
            fnApplyAndNav(fnParsePoRow(oRow));
          },
          error: function () {
            // Fallback: older metadata uses Ebeln, and returns collection
            oModel.read("/PoNumberSH", {
              filters: [new Filter("Ebeln", FilterOperator.EQ, sPo)],
              urlParameters: { $top: "1" },
              success: function (oData2) {
                var oRow2 =
                  oData2 && oData2.results && oData2.results[0] ? oData2.results[0] : oData2;
                fnApplyAndNav(fnParsePoRow(oRow2));
              },
              error: function () {
                fnApplyAndNav({});
              },
            });
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
          return;
        }

        var oTrip = sap.ui.getCore().getModel("TripData");
        var sTripNo = oTrip ? oTrip.getProperty("/TripNumber") : "";
        if (!sTripNo) {
          MessageToast.show("Trip number is missing.");
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

        // Try to search by PO number OR Vendor Name to minimize user effort.
        // Some backends may not support filtering on VendorName; we fall back to PO-only in that case.
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
            var n = (o.Ebeln && String(o.Ebeln).trim()) || "";
            if (n && !mSeen[n]) {
              mSeen[n] = true;
              aItems.push({
                Ebeln: n,
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
          return;
        }

        var oModel = this.getView().getModel();
        if (!oModel) {
          MessageToast.show("Backend model is not available.");
          return;
        }

        if (this._oIncomingEntryMethodDialog) {
          this._oIncomingEntryMethodDialog.setBusy(true);
        }

        var that = this;
        oModel.read("/PoNumberSH", {
          filters: [new Filter("Ebeln", FilterOperator.EQ, sPo)],
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
            if (!oResult.cancelled) {
              var sParsed = (oResult.text || "").split("|")[0];
              that._incomingDialogProcessScannedCode(sParsed);
              that._clearIncomingDialogScanInput();
            }
          },
          function (oError) {
            MessageToast.show(
              "Scan failed: " + (oError.message || oError)
            );
            setTimeout(function () {
              var oIn = Fragment.byId(
                that.getView().getId(),
                "idIncomingDialogScanInput"
              );
              if (oIn) {
                oIn.focus();
              }
            }, 200);
          }
        );
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

      _clearIncomingDialogScanInput: function () {
        var oIn = Fragment.byId(
          this.getView().getId(),
          "idIncomingDialogScanInput"
        );
        if (oIn) {
          oIn.setValue("");
          setTimeout(function () {
            oIn.focus();
          }, 100);
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
       * POST /PoNumberSH with key Ebeln — PO entry / scan-as-PO path.
       */
      _incomingDialogPostPoNumber: function (sPo) {
        var sEbeln = String(sPo || "").trim();
        if (!sEbeln) {
          MessageToast.show("Enter or select a PO number");
          return;
        }

        var oModel = this.getView().getModel();
        var that = this;
        this._sPendingOrderDetailPo = sEbeln;
        if (this._oIncomingEntryMethodDialog) {
          this._oIncomingEntryMethodDialog.setBusy(true);
        }
        oModel.create("/PoNumberSH", { Ebeln: sEbeln }, {
          headers: { "X-Requested-With": "X" },
          success: function (oResponse) {
            that._onIncomingIdentificationCreateSuccess(oResponse);
          },
          error: function (oError) {
            that._onIncomingIdentificationCreateError(
              oError,
              "Failed to post PO Number",
              sEbeln
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
        MessageBox.error(sErrorMessage);
        if (
          this._oIncomingEntryMethodModel &&
          this._oIncomingEntryMethodModel.getProperty("/selectedKey") === "SCAN"
        ) {
          this._clearIncomingDialogScanInput();
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
