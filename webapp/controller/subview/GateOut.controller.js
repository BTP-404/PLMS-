sap.ui.define(
  [
    "sap/ui/core/mvc/Controller",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/odata/v2/ODataModel",
    "sap/ui/core/Fragment",
    "com/incresolZ_INC_PLMS/util/MovementScenarioConfig",
    "com/incresolZ_INC_PLMS/util/PanelAccordion",
    "com/incresolZ_INC_PLMS/util/O02GateException",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
  ],
  function (
    Controller,
    MessageToast,
    MessageBox,
    JSONModel,
    ODataModel,
    Fragment,
    MovementScenarioConfig,
    PanelAccordion,
    O02GateException,
    Filter,
    FilterOperator
  ) {
    "use strict";

    return Controller.extend(
      "com.incresolZ_INC_PLMS.controller.subview.GateOut",
      {
        onInit: function () {
          this._eventBus = sap.ui.getCore().getEventBus();
          this._eventBus.subscribe("TripData", "Updated", this._onTripDataUpdate, this);

          this.oModel = new ODataModel("/sap/opu/odata/sap/YIGP_PLMS_SRV/", {
            useBatch: false,
            defaultBindingMode: "TwoWay",
          });
          this.getView().setModel(this.oModel);

          this._initGateOutAttachmentsModel();

          // Exit gate dropdown model (ComboBox items)
          if (!this._oExitGateModel) {
            this._oExitGateModel = new JSONModel({ items: [] });
            this.getView().setModel(this._oExitGateModel, "exitGateModel");
          }

          this._initGateOutBinTrolleyModel();
          this._initBinTrolleyVisibilityModel();
          this._initGateOutUiModel();
          this._initGateOutRefSuggestModel();
          this._updatePanelVisibility();
          this._updateBinTrolleyVisibility();
          
          // Initialize selected files array
          this._aSelectedFiles = [];

          // Ensure GateOut view can bind to the shared Reference Documents model
          // (refDocModel is created in ReferenceDocuments controller and also set on Core).
          var oRefDocModel = sap.ui.getCore().getModel("refDocModel");
          if (oRefDocModel && !this.getView().getModel("refDocModel")) {
            this.getView().setModel(oRefDocModel, "refDocModel");
          }

          PanelAccordion.attach(this.getView());

          var oGlobal = sap.ui.getCore().getModel("globalData");
          var sTrip =
            oGlobal && oGlobal.getProperty
              ? oGlobal.getProperty("/TripNumber") || ""
              : "";
          MovementScenarioConfig.syncOutgoingDirectSaleFromConfig(
            this.oModel,
            sTrip,
            this.getView()
          );
        },

        _initGateOutAttachmentsModel: function () {
          if (!this._oGateOutAttachmentsModel) {
            this._oGateOutAttachmentsModel = new JSONModel({ attachments: [] });
            this.getView().setModel(this._oGateOutAttachmentsModel, "gateOutAttachmentsModel");
          }
        },
        _initGateOutBinTrolleyModel: function () {
          if (!this.getView().getModel("gateOutBinTrolley")) {
            this.getView().setModel(new JSONModel({ rows: [] }), "gateOutBinTrolley");
          }
        },
        _initBinTrolleyVisibilityModel: function () {
          if (!this.getView().getModel("ui")) {
            this.getView().setModel(
              new JSONModel({ showBinTrolleyTracking: false }),
              "ui"
            );
          }
        },
        _initGateOutUiModel: function () {
          if (!this.getView().getModel("gateOutUi")) {
            this.getView().setModel(
              new JSONModel({
                referenceByKey: "INVOICE",
                refDocSearchValue: "",
                showPanels: false
              }),
              "gateOutUi"
            );
          } else {
            var oUi = this.getView().getModel("gateOutUi");
            if (oUi.getProperty("/refDocSearchValue") === undefined) {
              oUi.setProperty("/refDocSearchValue", "");
            }
            if (oUi.getProperty("/showPanels") === undefined) {
              oUi.setProperty("/showPanels", false);
            }
          }
        },
        _updatePanelVisibility: function () {
          this._initGateOutUiModel();
          var oUi = this.getView().getModel("gateOutUi");
          if (!oUi) {
            return;
          }
          oUi.setProperty("/showPanels", !!this._getTripNumber());
        },
        _initGateOutRefSuggestModel: function () {
          if (!this.getView().getModel("gateOutRefSuggest")) {
            this.getView().setModel(new JSONModel({ items: [] }), "gateOutRefSuggest");
          }
          if (!this._mGateOutRefAll) {
            this._mGateOutRefAll = {
              INVOICE: null,
              CHALLAN: null,
              PO: null,
            };
          }
          if (!this._mGateOutRefLoadPromise) {
            this._mGateOutRefLoadPromise = {};
          }
        },
        _ensureGateOutRefCacheLoaded: function (sMode) {
          var oModel = this.oModel;
          var sKey = String(sMode || "").toUpperCase();
          var sPath = "";
          if (sKey === "INVOICE") sPath = "/BillingDocSH";
          if (sKey === "CHALLAN") sPath = "/ChallanSh";
          if (sKey === "PO") sPath = "/PoNumberSH";
          if (!oModel || !sPath) {
            return Promise.resolve([]);
          }
          if (Array.isArray(this._mGateOutRefAll[sKey])) {
            return Promise.resolve(this._mGateOutRefAll[sKey]);
          }
          if (this._mGateOutRefLoadPromise[sKey]) {
            return this._mGateOutRefLoadPromise[sKey];
          }
          var that = this;
          this._mGateOutRefLoadPromise[sKey] = new Promise(function (resolve) {
            oModel.read(sPath, {
              success: function (oData) {
                var a = (oData && oData.results) || [];
                that._mGateOutRefAll[sKey] = a;
                resolve(a);
              },
              error: function () {
                that._mGateOutRefAll[sKey] = [];
                resolve([]);
              },
            });
          }).finally(function () {
            that._mGateOutRefLoadPromise[sKey] = null;
          });
          return this._mGateOutRefLoadPromise[sKey];
        },
        /**
         * Aligns Gate Out "Reference by" with Report Vehicle (globalData) or trip hints (PO number).
         */
        _syncGateOutReferenceBy: function () {
          this._initGateOutUiModel();
          var oVm = this.getView().getModel("gateOutUi");
          if (!oVm) {
            return;
          }
          var oG = sap.ui.getCore().getModel("globalData");
          var sG = oG && oG.getProperty("/OutgoingReferenceByKey");
          sG = sG ? String(sG).trim().toUpperCase() : "";
          if (sG === "INVOICE" || sG === "CHALLAN" || sG === "PO") {
            oVm.setProperty("/referenceByKey", sG);
          } else {
            var oTrip = sap.ui.getCore().getModel("TripData");
            var sPo = "";
            if (oTrip && oTrip.getProperty("/PoNumber") !== undefined && oTrip.getProperty("/PoNumber") !== null) {
              sPo = String(oTrip.getProperty("/PoNumber")).trim();
            }
            if (!sPo && oG) {
              sPo = String(oG.getProperty("/OutgoingPoNumber") || "").trim();
            }
            if (sPo) {
              oVm.setProperty("/referenceByKey", "PO");
            } else {
              oVm.setProperty("/referenceByKey", "INVOICE");
            }
          }
          this._syncGateOutRefDocInputFromContext();
        },
        /**
         * Prefills the Gate Out document search field from TripData / globalData.
         */
        _syncGateOutRefDocInputFromContext: function () {
          this._initGateOutUiModel();
          var oVm = this.getView().getModel("gateOutUi");
          var oG = sap.ui.getCore().getModel("globalData");
          var oTrip = sap.ui.getCore().getModel("TripData");
          var sRef = oVm ? String(oVm.getProperty("/referenceByKey") || "INVOICE").toUpperCase() : "INVOICE";
          var sVal = "";
          if (sRef === "PO") {
            sVal =
              (oTrip && oTrip.getProperty("/PoNumber") != null
                ? String(oTrip.getProperty("/PoNumber")).trim()
                : "") ||
              (oG ? String(oG.getProperty("/OutgoingPoNumber") || "").trim() : "");
          } else if (sRef === "CHALLAN" || sRef === "INVOICE") {
            sVal =
              (oG ? String(oG.getProperty("/OutgoingBillingDocument") || "").trim() : "") ||
              (oTrip ? String(oTrip.getProperty("/BillingDocument") || oTrip.getProperty("/Vbeln") || "").trim() : "");
          }
          if (oVm) {
            oVm.setProperty("/refDocSearchValue", sVal);
          }
        },
        _getGateOutActiveRefDocNumber: function () {
          this._initGateOutUiModel();
          var oVm = this.getView().getModel("gateOutUi");
          var sMode = oVm
            ? String(oVm.getProperty("/referenceByKey") || "INVOICE").toUpperCase()
            : "INVOICE";
          var sTyped = oVm ? String(oVm.getProperty("/refDocSearchValue") || "").trim() : "";
          if (sTyped) {
            return sTyped;
          }
          var oG = sap.ui.getCore().getModel("globalData");
          var oTrip = sap.ui.getCore().getModel("TripData");
          if (sMode === "PO") {
            return (
              (oTrip && oTrip.getProperty("/PoNumber") != null
                ? String(oTrip.getProperty("/PoNumber")).trim()
                : "") ||
              (oG ? String(oG.getProperty("/OutgoingPoNumber") || "").trim() : "")
            );
          }
          return (
            (oG ? String(oG.getProperty("/OutgoingBillingDocument") || "").trim() : "") ||
            (oTrip
              ? String(oTrip.getProperty("/BillingDocument") || oTrip.getProperty("/Vbeln") || "").trim()
              : "")
          );
        },
        _clearGateOutRefSuggestItems: function () {
          var oM = this.getView().getModel("gateOutRefSuggest");
          if (oM) {
            oM.setProperty("/items", []);
          }
        },
        _escapeODataKey: function (s) {
          return String(s || "").trim().replace(/'/g, "''");
        },
        _buildBillingDocShPath: function (sBillingDoc) {
          return "/BillingDocSH(BillingDoc='" + this._escapeODataKey(sBillingDoc) + "')";
        },
        _buildChallanShPath: function (sMaterialDoc) {
          return "/ChallanSh(MaterialDoc='" + this._escapeODataKey(sMaterialDoc) + "')";
        },
        _buildPoNumberShPath: function (sPo) {
          return "/PoNumberSH(PoNumber='" + this._escapeODataKey(sPo) + "')";
        },
        /**
         * After OData read: push document + movement info into globalData for Reference Documents tab.
         */
        _applyGateOutRefDocGlobalFromRow: function (sMode, oRow) {
          var oG = sap.ui.getCore().getModel("globalData");
          if (!oG) {
            oG = new JSONModel({});
            sap.ui.getCore().setModel(oG, "globalData");
          }
          sMode = String(sMode || "").toUpperCase();
          if (!oRow) {
            return;
          }
          if (sMode === "INVOICE") {
            var sBd = oRow.BillingDoc != null ? String(oRow.BillingDoc).trim() : "";
            var sDt =
              oRow.DocType != null
                ? String(oRow.DocType).trim()
                : oRow.BillingType != null
                  ? String(oRow.BillingType).trim()
                  : "";
            oG.setProperty("/OutgoingBillingDocument", sBd);
            oG.setProperty("/OutgoingBillingDocType", sDt);
            oG.setProperty("/OutgoingPoNumber", "");
            oG.setProperty("/OutgoingReferenceByKey", "INVOICE");
            var oTrip = sap.ui.getCore().getModel("TripData");
            if (oTrip && sBd) {
              oTrip.setProperty("/BillingDocument", sBd);
            }
          } else if (sMode === "CHALLAN") {
            var sMd = oRow.MaterialDoc != null ? String(oRow.MaterialDoc).trim() : "";
            var sChDt = oRow.DocType != null ? String(oRow.DocType).trim() : "";
            oG.setProperty("/OutgoingBillingDocument", sMd);
            oG.setProperty("/OutgoingBillingDocType", sChDt);
            oG.setProperty("/OutgoingPoNumber", "");
            oG.setProperty("/OutgoingReferenceByKey", "CHALLAN");
          } else if (sMode === "PO") {
            var sPo = oRow.PoNumber != null ? String(oRow.PoNumber).trim() : "";
            var sPoDt =
              oRow.DocType != null
                ? String(oRow.DocType).trim()
                : oRow.DocumentType != null
                  ? String(oRow.DocumentType).trim()
                  : "";
            oG.setProperty("/OutgoingPoNumber", sPo);
            oG.setProperty("/OutgoingRefDocDocType", sPoDt);
            oG.setProperty("/OutgoingBillingDocument", "");
            oG.setProperty("/OutgoingBillingDocType", "");
            oG.setProperty("/OutgoingReferenceByKey", "PO");
            var oTripPo = sap.ui.getCore().getModel("TripData");
            if (oTripPo && sPo) {
              oTripPo.setProperty("/PoNumber", sPo);
            }
          }
        },
        _getGateOutSelectedRefDocNumber: function (sMode, oRow, sFallback) {
          var s = "";
          sMode = String(sMode || "").toUpperCase();
          if (oRow) {
            if (sMode === "PO") {
              s = oRow.PoNumber != null ? String(oRow.PoNumber).trim() : "";
            } else if (sMode === "CHALLAN") {
              s = oRow.MaterialDoc != null ? String(oRow.MaterialDoc).trim() : "";
            } else {
              s = oRow.BillingDoc != null ? String(oRow.BillingDoc).trim() : "";
            }
          }
          if (!s) {
            s = String(sFallback || "").trim();
          }
          return s;
        },
        _getRefDocsControllerFromGateOut: function () {
          var oRefView = this.getView().byId("idRefDocsViewGateOut");
          if (oRefView && typeof oRefView.getController === "function") {
            return oRefView.getController();
          }
          return null;
        },
        _buildEmptyBinsPath: function (sTripNumber, sDocumentNumber, sItemNo) {
          return (
            "/EmptyBins(TripNumber='" +
            this._escapeODataKey(sTripNumber) +
            "',DocumentNumber='" +
            this._escapeODataKey(sDocumentNumber) +
            "',ItemNo='" +
            this._escapeODataKey(sItemNo) +
            "')"
          );
        },
        _loadGateOutBinsByKeys: function (sTripNumber, sDocumentNumber, aItemNos) {
          var oModel = this.oModel;
          var oVm = this.getView().getModel("gateOutBinTrolley");
          if (!oModel || !oVm || !sDocumentNumber) {
            return Promise.resolve();
          }
          var aUniqueItemNos = (aItemNos || [])
            .map(function (s) {
              return String(s || "").trim();
            })
            .filter(function (s) {
              return !!s;
            })
            .filter(function (s, i, a) {
              return a.indexOf(s) === i;
            });
          if (!aUniqueItemNos.length) {
            return Promise.resolve();
          }
          var aFilters = [
            new Filter("TripNumber", FilterOperator.EQ, sTripNumber),
            new Filter("DocumentNumber", FilterOperator.EQ, sDocumentNumber),
          ];
          return new Promise(
            function (resolve) {
              oModel.read("/EmptyBins", {
                filters: aFilters,
                urlParameters: {
                  $format: "json",
                },
                success: function (oData) {
                  var aRows = (oData && oData.results) || [];
                  var aMapped = (aRows || [])
                    .filter(function (r) {
                      return aUniqueItemNos.indexOf(String(r.ItemNo || "").trim()) >= 0;
                    })
                    .map(
                      function (r) {
                        var sStatus = this._deriveGateOutDispatchStatus(r.QtyOut);
                        return {
                          DocumentNumber: r.DocumentNumber || "-",
                          ItemNo: r.ItemNo || "-",
                          Material: r.Material || "-",
                          BinTypes: r.BinTypes || r.BinType || "",
                          QtyOut: r.QtyOut != null && r.QtyOut !== "" ? r.QtyOut : "0",
                          Status: sStatus,
                          BinTypeState:
                            String(r.BinTypes || r.BinType || "")
                              .toLowerCase()
                              .indexOf("plastic") >= 0
                              ? "Warning"
                              : "Information",
                        };
                      }.bind(this)
                    );
                  if (aMapped.length) {
                    oVm.setProperty("/rows", aMapped);
                  }
                  resolve();
                }.bind(this),
                error: function () {
                  resolve();
                },
              });
            }.bind(this)
          );
        },
        _refreshGateOutRefDocAndMaterials: function (sDocNumber) {
          var oRefCtrl = this._getRefDocsControllerFromGateOut();
          if (!oRefCtrl) {
            return Promise.resolve();
          }
          if (typeof oRefCtrl._onTripDataUpdated === "function") {
            oRefCtrl._onTripDataUpdated();
          }
          if (typeof oRefCtrl._refreshMaterialsTable === "function") {
            return oRefCtrl._refreshMaterialsTable({ documentNumber: sDocNumber });
          }
          return Promise.resolve();
        },
        _refreshGateOutBinsForSelectedDocument: function (sDocNumber) {
          var sTripNumber = this._getTripNumber();
          if (!sDocNumber) {
            return;
          }
          var oRefModel = sap.ui.getCore().getModel("refDocModel");
          var aMaterials = (oRefModel && oRefModel.getProperty("/filteredMaterialDetails")) || [];
          if (!aMaterials.length) {
            aMaterials = (oRefModel && oRefModel.getProperty("/materialDetails")) || [];
          }
          var aItemNos = aMaterials
            .filter(function (oRow) {
              return String(oRow.refDocNo || "").trim() === sDocNumber;
            })
            .map(function (oRow) {
              return oRow.refDocItemNo;
            });
          this._loadGateOutBinsByKeys(sTripNumber, sDocNumber, aItemNos);
        },
        _afterGateOutRefDocResolved: function (sMode, sTypedValue, oRow) {
          var sDocNumber = this._getGateOutSelectedRefDocNumber(
            sMode,
            oRow,
            sTypedValue
          );
          this._refreshGateOutRefDocAndMaterials(sDocNumber).then(
            function () {
              this._refreshGateOutBinsForSelectedDocument(sDocNumber);
            }.bind(this)
          );
          this._eventBus.publish("TripData", "Updated");
        },
        _loadGateOutRefDocDetailRead: function (sRaw) {
          var sVal = String(sRaw || "").trim();
          var oVm = this.getView().getModel("gateOutUi");
          var sMode = oVm ? String(oVm.getProperty("/referenceByKey") || "INVOICE").toUpperCase() : "INVOICE";
          var oModel = this.oModel;
          if (!oModel || !sVal) {
            return Promise.resolve(null);
          }
          var that = this;
          if (sMode === "INVOICE") {
            return new Promise(function (resolve) {
              oModel.read(that._buildBillingDocShPath(sVal), {
                success: function (oData) {
                  var oFirst = oData && oData.d ? oData.d : oData;
                  that._applyGateOutRefDocGlobalFromRow("INVOICE", oFirst || null);
                  that._afterGateOutRefDocResolved("INVOICE", sVal, oFirst || null);
                  resolve(oFirst || null);
                },
                error: function () {
                  oModel.read("/BillingDocSH", {
                    filters: [new Filter("BillingDoc", FilterOperator.EQ, sVal)],
                    urlParameters: { $top: "1" },
                    success: function (oData2) {
                      var a = (oData2 && oData2.results) || [];
                      that._applyGateOutRefDocGlobalFromRow("INVOICE", a[0] || null);
                      that._afterGateOutRefDocResolved("INVOICE", sVal, a[0] || null);
                      resolve(a[0] || null);
                    },
                    error: function () {
                      resolve(null);
                    },
                  });
                },
              });
            });
          }
          if (sMode === "CHALLAN") {
            return new Promise(function (resolve) {
              oModel.read(that._buildChallanShPath(sVal), {
                success: function (oData) {
                  var oFirst = oData && oData.d ? oData.d : oData;
                  that._applyGateOutRefDocGlobalFromRow("CHALLAN", oFirst || null);
                  that._afterGateOutRefDocResolved("CHALLAN", sVal, oFirst || null);
                  resolve(oFirst || null);
                },
                error: function () {
                  oModel.read("/ChallanSh", {
                    filters: [new Filter("MaterialDoc", FilterOperator.EQ, sVal)],
                    urlParameters: { $top: "1" },
                    success: function (oData2) {
                      var a = (oData2 && oData2.results) || [];
                      that._applyGateOutRefDocGlobalFromRow("CHALLAN", a[0] || null);
                      that._afterGateOutRefDocResolved("CHALLAN", sVal, a[0] || null);
                      resolve(a[0] || null);
                    },
                    error: function () {
                      resolve(null);
                    },
                  });
                },
              });
            });
          }
          if (sMode === "PO") {
            return new Promise(function (resolve) {
              oModel.read(that._buildPoNumberShPath(sVal), {
                success: function (oData) {
                  var oFirst = oData && oData.d ? oData.d : oData;
                  that._applyGateOutRefDocGlobalFromRow("PO", oFirst || null);
                  that._afterGateOutRefDocResolved("PO", sVal, oFirst || null);
                  resolve(oFirst || null);
                },
                error: function (oErr) {
                  var iStatus =
                    oErr && oErr.statusCode !== undefined ? parseInt(oErr.statusCode, 10) : NaN;
                  if (iStatus === 404) {
                    oModel.read("/PoNumberSH", {
                      filters: [new Filter("PoNumber", FilterOperator.EQ, sVal)],
                      urlParameters: { $top: "1" },
                      success: function (oData2) {
                        var a = (oData2 && oData2.results) || [];
                        that._applyGateOutRefDocGlobalFromRow("PO", a[0] || null);
                        that._afterGateOutRefDocResolved("PO", sVal, a[0] || null);
                        resolve(a[0] || null);
                      },
                      error: function () {
                        resolve(null);
                      },
                    });
                  } else {
                    resolve(null);
                  }
                },
              });
            });
          }
          return Promise.resolve(null);
        },
        onGateOutRefDocSuggest: function (oEvent) {
          var sValue = (oEvent.getParameter("suggestValue") || "").trim();
          if (this._iGateOutRefSuggestTimeout) {
            clearTimeout(this._iGateOutRefSuggestTimeout);
          }
          var that = this;
          this._iGateOutRefSuggestTimeout = setTimeout(function () {
            that._loadGateOutRefSuggestions(sValue);
          }, 300);
        },
        _loadGateOutRefSuggestions: function (sTerm) {
          var oM = this.getView().getModel("gateOutRefSuggest");
          var oVm = this.getView().getModel("gateOutUi");
          if (!oM || !oVm) {
            return;
          }
          var sMode = String(oVm.getProperty("/referenceByKey") || "INVOICE").toUpperCase();
          this._fetchReferenceSuggestions(sTerm, sMode, oM);
        },
        _fetchReferenceSuggestions: function (sTerm, sKey, oLocalModel) {
          var sValue = String(sTerm || "").trim();
          if (!oLocalModel) {
            return;
          }
          if (!sValue || sValue.length < 2) {
            oLocalModel.setProperty("/items", []);
            return;
          }
          var oModel = this.oModel || this.getView().getModel();
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
                  raw: o || {},
                });
              });
              oLocalModel.setProperty("/items", aItems);
            },
            error: function () {
              oLocalModel.setProperty("/items", []);
            },
          });
        },
        onGateOutRefDocSuggestionSelected: function (oEvent) {
          var oItem = oEvent.getParameter("selectedItem");
          var sText = oItem ? String(oItem.getText() || "").trim() : "";
          var oVm = this.getView().getModel("gateOutUi");
          if (oVm && sText) {
            oVm.setProperty("/refDocSearchValue", sText);
          }
          this._clearGateOutRefSuggestItems();
          if (sText) {
            this._loadGateOutRefDocDetailRead(sText);
          }
        },
        onGateOutRefDocSearchChange: function (oEvent) {
          var sVal = String((oEvent.getParameter("value") || "")).trim();
          var oVm = this.getView().getModel("gateOutUi");
          if (oVm) {
            oVm.setProperty("/refDocSearchValue", sVal);
          }
          if (sVal) {
            this._loadGateOutRefDocDetailRead(sVal);
          }
        },
        onGateOutReferenceByChange: function (oEvent) {
          var oSel = oEvent.getSource();
          var sKey = oSel && oSel.getSelectedKey ? oSel.getSelectedKey() : "";
          var oG = sap.ui.getCore().getModel("globalData");
          if (!oG) {
            oG = new JSONModel({});
            sap.ui.getCore().setModel(oG, "globalData");
          }
          oG.setProperty("/OutgoingReferenceByKey", sKey || "INVOICE");
          this._clearGateOutRefSuggestItems();
          this._syncGateOutRefDocInputFromContext();
        },
        _updateBinTrolleyVisibility: function () {
          this._initBinTrolleyVisibilityModel();
          var oTripData = sap.ui.getCore().getModel("TripData");
          var oGlobal = sap.ui.getCore().getModel("globalData");

          var sTripFromTripData = String(
            oTripData && oTripData.getProperty("/TripNumber")
          ).trim();
          var sTripFromGlobal = String(
            (oGlobal && oGlobal.getProperty("/TripNumber")) || ""
          ).trim();
          var bTripConsistent =
            !sTripFromGlobal ||
            !sTripFromTripData ||
            sTripFromGlobal === sTripFromTripData;
          // Show Bin/Trolley only for O02, only when TripData is loaded,
          // and only when TripData/global trip context is consistent.
          var bShow =
            !!sTripFromTripData &&
            bTripConsistent &&
            O02GateException.isO02FromTripData(oTripData);
          console.info(
            "[BinTracking][GateOut] visibility",
            {
              tripFromTripData: sTripFromTripData,
              tripFromGlobal: sTripFromGlobal,
              tripConsistent: bTripConsistent,
              movementType: oTripData && oTripData.getProperty("/MovementType"),
              movementScenario: oTripData && oTripData.getProperty("/MovementScenario"),
              movementScenarioItemKey: oTripData && oTripData.getProperty("/MovementScenarioItemKey"),
              isO02: O02GateException.isO02FromTripData(oTripData),
              show: bShow
            }
          );
          this.getView().getModel("ui").setProperty("/showBinTrolleyTracking", bShow);
        },

        /**
         * O02 + Internal (01) exception: bin lines mandatory at Gate Out when panel is shown.
         */
        _requiresMandatoryGateOutBinDetails: function () {
          var oUi = this.getView().getModel("ui");
          var oTripData = sap.ui.getCore().getModel("TripData");
          if (!oUi || !oUi.getProperty("/showBinTrolleyTracking") || !oTripData) {
            return false;
          }
          return O02GateException.isO02InternalException(oTripData);
        },

        onAfterRendering: function () {
          try {
            var oGateOutPanel = this.getView().byId("gateOutPanel");
            if (oGateOutPanel && oGateOutPanel.setExpanded) {
              oGateOutPanel.setExpanded(true);
            }
            // Get trip number from globalData model (safer approach)
            var oGlobalModel = sap.ui.getCore().getModel("globalData");
            this.tripNumber = oGlobalModel ? oGlobalModel.getProperty("/TripNumber") || "" : "";
            
            this.loadExitGateNumber();
            this._loadGateOutBinTrolleyData();
            this._updatePanelVisibility();
            this._updateBinTrolleyVisibility();
            this._syncGateOutReferenceBy();

            // Set initial input state based on whether GateOut data exists
            var oTripData = sap.ui.getCore().getModel("TripData");
            if (oTripData) {
              // Default Skip Document to "No" when not provided by backend/model.
              // (UI binding uses formatRefDocSkipIndex: blank/false => index 1 => "No")
              var vRefDocSkip = oTripData.getProperty("/RefDocSkip");
              if (
                vRefDocSkip === undefined ||
                vRefDocSkip === null ||
                String(vRefDocSkip).trim() === ""
              ) {
                oTripData.setProperty("/RefDocSkip", " ");
              }

              // Default Verified Documents to "No" when not provided by backend/model.
              // (UI binding uses formatVerifiedDocsIndex: missing/false => index 1 => "No")
              var vVerifiedDocs = oTripData.getProperty("/VerifiedDocs");
              if (
                vVerifiedDocs === undefined ||
                vVerifiedDocs === null ||
                String(vVerifiedDocs).trim() === ""
              ) {
                oTripData.setProperty("/VerifiedDocs", 1);
              }

              var sBd = oTripData.getProperty("/BillingDocument");
              var sVb = oTripData.getProperty("/Vbeln");
              if (
                (!sBd || String(sBd).trim() === "") &&
                sVb &&
                String(sVb).trim() !== ""
              ) {
                oTripData.setProperty("/BillingDocument", String(sVb).trim());
              }
              var sExistingExitGateNum = oTripData.getProperty("/ExitGateNum");
              if (sExistingExitGateNum && sExistingExitGateNum.trim() !== "") {
                // GateOut exists - disable inputs (display mode)
                this._setInputsEnabled(false);
              } else {
                // First time - enable inputs (create mode)
                this._setInputsEnabled(true);
              }
            } else {
              // No TripData - enable inputs for new entry
              this._setInputsEnabled(true);
            }
            
            // Removed: this._loadGateOutAttachments(); - will be loaded via event subscription when TripData is available
          } catch (oError) {
            // Error in GateOut onAfterRendering
            // Don't let errors break the view - set defaults
            this._setInputsEnabled(true);
          }
        },
        onExit: function () {
          this._eventBus?.unsubscribe("TripData", "Updated", this._onTripDataUpdate, this);
        },
        _onTripDataUpdate: function () {
          var oTripData = sap.ui.getCore().getModel("TripData");
          this._updatePanelVisibility();
          this._updateBinTrolleyVisibility();
          if (oTripData) {
            this.getView().setModel(oTripData, "TripData");
            
            // Keep refDocModel available for Bin Details bindings.
            var oRefDocModel = sap.ui.getCore().getModel("refDocModel");
            if (oRefDocModel) {
              this.getView().setModel(oRefDocModel, "refDocModel");
            }

            // Ensure Skip Document defaults to "No" when missing.
            var vRefDocSkip = oTripData.getProperty("/RefDocSkip");
            if (
              vRefDocSkip === undefined ||
              vRefDocSkip === null ||
              String(vRefDocSkip).trim() === ""
            ) {
              oTripData.setProperty("/RefDocSkip", " ");
            }

            // Ensure Verified Documents defaults to "No" when missing.
            var vVerifiedDocs = oTripData.getProperty("/VerifiedDocs");
            if (
              vVerifiedDocs === undefined ||
              vVerifiedDocs === null ||
              String(vVerifiedDocs).trim() === ""
            ) {
              oTripData.setProperty("/VerifiedDocs", 1);
            }

            this.loadExitGateNumber();
            this._loadGateOutBinTrolleyData();
            this._normalizeTripDataItemDetails();
            this._syncGateOutReferenceBy();
            // Disable inputs if GateOut data already exists (display mode)
            var sExistingExitGateNum = oTripData.getProperty("/ExitGateNum");
            if (sExistingExitGateNum && sExistingExitGateNum.trim() !== "") {
              this._setInputsEnabled(false);
            } else {
              // First time - enable inputs
              this._setInputsEnabled(true);
            }
          }
        },
        _extractResults: function (vData) {
          if (!vData) return null;
          if (Array.isArray(vData)) return vData;
          if (Array.isArray(vData.results)) return vData.results;
          if (vData.__deferred) return null;
          return [];
        },
        _normalizeTripDataItemDetails: function () {
          var oTripData = sap.ui.getCore().getModel("TripData");
          if (!oTripData) return;
          var aItems = this._extractResults(oTripData.getProperty("/ItemDetails"));
          if (Array.isArray(aItems)) {
            // Ensure XML can bind directly to TripData>/ItemDetails
            oTripData.setProperty("/ItemDetails", aItems);
          }
        },
        _getTripNumber: function () {
          var sTripNumber = "";
          var oGlobalModel = sap.ui.getCore().getModel("globalData");
          if (oGlobalModel) {
            sTripNumber = oGlobalModel.getProperty("/TripNumber") || "";
          }
          if (!sTripNumber) {
            var oCoreTrip = sap.ui.getCore().getModel("TripData");
            if (oCoreTrip) {
              sTripNumber = oCoreTrip.getProperty("/TripNumber") || "";
            }
          }
          if (!sTripNumber) {
            var oTripDataModel = this.getView().getModel("TripData");
            if (oTripDataModel) {
              sTripNumber = oTripDataModel.getProperty("/TripNumber") || "";
            }
          }
          return String(sTripNumber).trim();
        },
        _deriveGateOutDispatchStatus: function (vQtyOut) {
          var iQtyOut = Number(vQtyOut);
          if (!isNaN(iQtyOut) && iQtyOut > 0) {
            return "Dispatched";
          }
          return "Not in GO";
        },
        _loadGateOutBinTrolleyData: function () {
          var oVm = this.getView().getModel("gateOutBinTrolley");
          if (!oVm) {
            return;
          }
          var sDocNumber = this._getGateOutActiveRefDocNumber();
          if (!sDocNumber) {
            oVm.setProperty("/rows", []);
            return;
          }
          this._refreshGateOutRefDocAndMaterials(sDocNumber).then(
            function () {
              this._refreshGateOutBinsForSelectedDocument(sDocNumber);
            }.bind(this)
          );
        },
        /**
         * Loads exit-gate ConfigValues for ConfigGroup ExitGate, always filtered by TripNumber when known.
         */
        loadExitGateNumber: function () {
          var sTripNumber = this._getTripNumber();
          var aFilters = [
            new sap.ui.model.Filter(
              "ConfigGroup",
              sap.ui.model.FilterOperator.EQ,
              "ExitGate"
            ),
          ];

          if (sTripNumber) {
            aFilters.push(
              new sap.ui.model.Filter(
                "TripNumber",
                sap.ui.model.FilterOperator.EQ,
                sTripNumber
              )
            );
          }

          this.oModel.read("/ConfigValues", {
            filters: aFilters,
            success: function (oData) {
              this._ExitGateData = oData.results || [];

              // Feed the ExitGate dropdown (ComboBox) and default-select the first one.
              if (!this._oExitGateModel) {
                this._oExitGateModel = new JSONModel({ items: [] });
                this.getView().setModel(this._oExitGateModel, "exitGateModel");
              }
              this._oExitGateModel.setProperty("/items", this._ExitGateData);

              var oTripData =
                this.getView().getModel("TripData") ||
                sap.ui.getCore().getModel("TripData");
              if (oTripData) {
                var sExistingExitGateNum = oTripData.getProperty("/ExitGateNum");
                var bIsEmpty =
                  !sExistingExitGateNum ||
                  String(sExistingExitGateNum).trim() === "";

                if (bIsEmpty && this._ExitGateData.length > 0) {
                  // Keep default selection only in the dropdown UI.
                  // Do not write into TripData here, otherwise "first time" detection on Save breaks.
                  var oExitCombo = this.getView().byId("idExitGateNumber");
                  if (oExitCombo && oExitCombo.setSelectedKey) {
                    var sFirstGate = this._ExitGateData[0].ConfigID;
                    if (sFirstGate !== undefined && sFirstGate !== null) {
                      oExitCombo.setSelectedKey(String(sFirstGate).trim());
                    }
                  }
                }
              }
            }.bind(this),
            error: function () {
              sap.m.MessageBox.error("Failed to load Exit gates.");
            },
          });
        },

        onExitGateSelectionChange: function (oEvent) {
          var oCombo = oEvent.getSource();
          var sSelectedKey = oCombo.getSelectedKey() || "";

          // Prevent manual/free-text values: keep only configured gate selections.
          if (!sSelectedKey) {
            oCombo.setValue("");
            oCombo.setValueState("Error");
            oCombo.setValueStateText("Please select a valid Exit Gate Number from the list.");
            return;
          }

          oCombo.setValueState("None");
          var oTripData = sap.ui.getCore().getModel("TripData");
          if (oTripData) {
            oTripData.setProperty("/ExitGateNum", sSelectedKey);
          }
        },
        onExitGateValueHelp: function (oEvent) {
          var oInput = oEvent.getSource();
          var oData = this._ExitGateData;

          var that = this;

          // Load fragment directly
          if (!this._ExitGateVH) {
            sap.ui.core.Fragment.load({
              name: "com.incresolZ_INC_PLMS.fragments.VehicleGateOutFrags.ExitGateValueHelp",
              controller: this,
            }).then(function (oDialog) {
              that._ExitGateVH = oDialog;

              // Bind list data
              oDialog.setModel(
                new sap.ui.model.json.JSONModel(oData),
                "ExitGatehelpModel"
              );

              that.getView().addDependent(oDialog);
              oDialog.open();
              that._vhInput = oInput; // input reference
            });
          } else {
            // Update model each time
            this._ExitGateVH.setModel(
              new sap.ui.model.json.JSONModel(oData),
              "ExitGatehelpModel"
            );
            this._vhInput = oInput;
            this._ExitGateVH.open();
          }
        },
        onExitGateValueHelpConfirm: function (oEvent) {
          var oSelected = oEvent.getParameter("selectedItem");
          if (oSelected) {
            this._vhInput.setValue(oSelected.getTitle()); // ConfigID
          }

          this._ExitGateVH.close();
        },
        onExitGateValueHelpSearch: function (oEvent) {
          var sValue = (oEvent.getParameter("value") || "").trim();
          var oBinding = oEvent.getSource().getBinding("items");

          if (!oBinding) {
            return;
          }

          if (sValue && sValue.length > 0) {
            var sLowerValue = sValue.toLowerCase();
            var aFilters = [
              new sap.ui.model.Filter({
                path: "ConfigID",
                operator: function(sConfigID) {
                  return sConfigID && sConfigID.toString().toLowerCase().indexOf(sLowerValue) !== -1;
                }
              }),
              new sap.ui.model.Filter({
                path: "Description",
                operator: function(sDescription) {
                  return sDescription && sDescription.toString().toLowerCase().indexOf(sLowerValue) !== -1;
                }
              }),
            ];

            oBinding.filter(
              new sap.ui.model.Filter({
                filters: aFilters,
                and: false,
              })
            );
          } else {
            // Clear filter when search is empty
            oBinding.filter([]);
          }
        },
        onDelayReasonValueHelp: function (oEvent) {
          var oInput = oEvent.getSource();
          var aData = this._delayReasonData; // <-- use loaded API data

          if (!aData || aData.length === 0) {
            sap.m.MessageToast.show("No delay reason data available");
            return;
          }

          var that = this;

          if (!this._delayReasonVH) {
            sap.ui.core.Fragment.load({
              name: "com.incresolZ_INC_PLMS.fragments.VehicleGateInFrags.DelayReasonValueHelp",
              controller: this,
            }).then(function (oDialog) {
              that._delayReasonVH = oDialog;

              // Bind data
              oDialog.setModel(
                new sap.ui.model.json.JSONModel(aData),
                "delayData"
              );

              that.getView().addDependent(oDialog);
              that._vhInput = oInput;
              oDialog.open();
            });
          } else {
            this._delayReasonVH.setModel(
              new sap.ui.model.json.JSONModel(aData),
              "delayData"
            );
            this._vhInput = oInput;
            this._delayReasonVH.open();
          }
        },
        onDelayReasonValueHelpConfirm: function (oEvent) {
          var oSelected = oEvent.getParameter("selectedItem");

          if (oSelected) {
            var sID = oSelected.getTitle(); // ConfigID
            var sDesc = oSelected.getDescription(); // Description

            this._vhInput.setValue(sDesc + " - " + sID);
          }

          this._delayReasonVH.close();
        },
        onDelayReasonValueHelpSearch: function (oEvent) {
          var sQuery = (oEvent.getParameter("value") || "").trim();
          var oBinding = oEvent.getSource().getBinding("items");

          if (!oBinding) {
            return;
          }

          if (sQuery && sQuery.length > 0) {
            var sLowerQuery = sQuery.toLowerCase();
            var oFilter = new sap.ui.model.Filter({
              filters: [
                new sap.ui.model.Filter({
                  path: "ConfigID",
                  operator: function(sConfigID) {
                    return sConfigID && sConfigID.toString().toLowerCase().indexOf(sLowerQuery) !== -1;
                  }
                }),
                new sap.ui.model.Filter({
                  path: "Description",
                  operator: function(sDescription) {
                    return sDescription && sDescription.toString().toLowerCase().indexOf(sLowerQuery) !== -1;
                  }
                }),
              ],
              and: false,
            });

            oBinding.filter(oFilter);
          } else {
            // Clear filter when search is empty
            oBinding.filter([]);
          }
        },
        formatTripNumber: function (sTripNumber) {
          if (!sTripNumber) {
            return "";
          }
          var sStr = String(sTripNumber);
          return sStr.replace(/^0+/, "") || "0";
        },
        formatRefDocSkipIndex: function (v) {
          if (v === "X" || v === "Y" || v === "1" || v === true) {
            return 0;
          }
          return 1;
        },
        formatVerifiedDocsIndex: function (v) {
          // Accept both index-like values (0/1) and boolean-ish flags.
          if (v === 0 || v === "0" || v === "X" || v === "Y" || v === true || v === "true") {
            return 0; // Yes
          }
          return 1; // No (default)
        },
        formatGateOutDispatchState: function (sStatus) {
          return String(sStatus || "").toLowerCase() === "dispatched" ? "Success" : "Information";
        },
        formatGateOutBinTypeText: function (oRow) {
          if (!oRow) {
            return "";
          }
          var sBinType = oRow.BinTypes || oRow.BinType || "";
          var sIcon = String(sBinType).toLowerCase().indexOf("plastic") >= 0 ? "📦" : "🛒";
          var sType = sBinType;
          var sMat = oRow.Material || "";
          return sIcon + " " + sType + (sMat ? "\n" + sMat : "");
        },
        onRefDocSkipChange: function (oEvent) {
          var iSelectedIndex = oEvent.getParameter("selectedIndex");
          var sRefDocSkip = iSelectedIndex === 0 ? "X" : " ";
          var oTripData = sap.ui.getCore().getModel("TripData");
          if (oTripData) {
            oTripData.setProperty("/RefDocSkip", sRefDocSkip);
          }
        },
        onSaveGateOut: function () {
          var oModel = this.oModel;
          if (!oModel) {
            MessageBox.error("OData model is not loaded.");
            return;
          }

          var oView = this.getView();
          var oTripData = sap.ui.getCore().getModel("TripData");
          if (!oTripData) {
            MessageBox.error("Trip data is not available.");
            return;
          }

          var sGatePassNo = this._getTripNumber();
          if (!sGatePassNo) {
            MessageBox.error(
              "Gate Pass No has not been generated. Save Vehicle Reporting first to generate a Gate Pass No before Gate Out."
            );
            return;
          }

          if (this._requiresMandatoryGateOutBinDetails()) {
            var oBinVm = this.getView().getModel("gateOutBinTrolley");
            var aBinRows = oBinVm ? oBinVm.getProperty("/rows") || [] : [];
            if (!aBinRows.length) {
              MessageBox.error(
                "Bin / Trolley details are required for this movement scenario. Load or enter bin lines before completing Gate Out."
              );
              return;
            }
          }

          var sExistingExitGateNum = oTripData.getProperty("/ExitGateNum");
          var bIsFirstTime =
            !sExistingExitGateNum ||
            String(sExistingExitGateNum).trim() === "";

          // Always read the current dropdown selection.
          // TripData "/ExitGateNum" is used only for "first time" detection.
          var oExit = oView.byId("idExitGateNumber");
          var sExitGateNumber = "";
          if (oExit && oExit.getSelectedKey) {
            sExitGateNumber = oExit.getSelectedKey() || "";
          }
          if (!sExitGateNumber) {
            MessageBox.error("Please select Exit Gate Number from the list.");
            if (oExit) {
              oExit.setValueState("Error");
              oExit.setValueStateText("Exit Gate Number is required.");
            }
            return;
          }
          if (oExit) {
            oExit.setValueState("None");
          }
          var sRemarks = oView.byId("idGateOutRemarks").getValue() || "";

          var oRBGroup = oView.byId("idVerifiedDocs");
          var bVerifiedDocs = oRBGroup ? oRBGroup.getSelectedIndex() === 0 : false;

          var sTripNumber = sGatePassNo;

          var oSkipDocGroup = oView.byId("idSkipDocumentGateOut");
          var sRefdocSkip = " ";
          if (oSkipDocGroup) {
            sRefdocSkip = oSkipDocGroup.getSelectedIndex() === 0 ? "X" : " ";
          } else {
            sRefdocSkip = oTripData.getProperty("/RefDocSkip");
            if (
              sRefdocSkip === undefined ||
              sRefdocSkip === null ||
              String(sRefdocSkip).trim() === ""
            ) {
              sRefdocSkip = " ";
            } else {
              sRefdocSkip = String(sRefdocSkip).trim();
            }
          }

          // Billing document from trip (set on entry / reconciliation flows); no Gate Out invoice field.
          var sBillingDocument = "";
          var vBd = oTripData.getProperty("/BillingDocument");
          if (vBd !== undefined && vBd !== null && String(vBd).trim() !== "") {
            sBillingDocument = String(vBd).trim();
          } else {
            var vVb = oTripData.getProperty("/Vbeln");
            if (vVb !== undefined && vVb !== null && String(vVb).trim() !== "") {
              sBillingDocument = String(vVb).trim();
            }
          }

          oModel.callFunction("/GateOut", {
            method: "POST",
            urlParameters: {
              RefdocSkip: sRefdocSkip,
              BillingDocument: sBillingDocument,
              ExitGateNumber: sExitGateNumber,
              TripNumber: sTripNumber,
              Remarks: sRemarks,
              VerifiedDocuments: bVerifiedDocs,
            },
            headers: {
              "X-Requested-With": "X",
            },
            success: function () {
              var sMessage = bIsFirstTime
                ? "Gate Out information created successfully!"
                : "Gate Out information updated successfully!";
              console.info("[GateOut][SaveSuccess]", {
                tripNumber: sTripNumber,
                preferredTabKey: "gateout",
                hasAttachments: !!(this._aSelectedFiles && this._aSelectedFiles.length > 0)
              });

              var oTd = sap.ui.getCore().getModel("TripData");
              if (oTd) {
                oTd.setProperty("/ExitGateNum", sExitGateNumber);
                oTd.setProperty("/RefDocSkip", sRefdocSkip);
                oTd.setProperty("/VerifiedDocs", bVerifiedDocs ? 0 : 1);
                oTd.setProperty("/BillingDocument", sBillingDocument);
                this._eventBus.publish("TripData", "Updated");
              }
              this._eventBus.publish("Stage", "TripCreated", {
                tripNumber: sTripNumber,
                preferredTabKey: "gateout"
              });

              if (this._aSelectedFiles && this._aSelectedFiles.length > 0) {
                this._uploadGateOutAttachments(
                  function (bSuccess) {
                    if (bSuccess) {
                      MessageBox.success(
                        sMessage + " Attachments uploaded successfully!"
                      );
                    } else {
                      MessageBox.success(sMessage);
                      MessageBox.warning("Some attachments failed to upload.");
                    }
                    this._setInputsEnabled(false);
                    this._loadGateOutAttachments();
                  }.bind(this)
                );
              } else {
                MessageBox.success(sMessage);
                this._setInputsEnabled(false);
              }
            }.bind(this),
            error: function (oError) {
              var sErrorMessage = "Failed Gate Out ";
              try {
                if (oError && oError.responseText) {
                  var oErr = JSON.parse(oError.responseText);
                  if (
                    oErr.error &&
                    oErr.error.message &&
                    oErr.error.message.value
                  ) {
                    sErrorMessage = oErr.error.message.value;
                  }
                }
              } catch (e) {
                // Failed to parse OData error
              }
              MessageBox.error(sErrorMessage);
            },
          });
        },
        onEditGateOut: function () {
          // Enable inputs for edit mode (authorization checks removed)
          this._setInputsEnabled(true);
          MessageToast.show("Edit mode activated");
        },
        _setInputsEnabled: function (bEnabled) {
          try {
            // Keep ExitGate dropdown always enabled/editable (as requested).
            var oExitGateCombo = this.getView().byId("idExitGateNumber");

            var oRelatedTripReadOnly = this.getView().byId("idGateOutRelatedTripNumber");

            var oPanel = this.getView().byId("gateOutPanel");
            if (!oPanel) return;
            
            // Find all aggregated controls in the panel
            var aChildren = oPanel.findAggregatedObjects(true); // deep search
            
            aChildren.forEach(function(ctrl) {
              // Ignore buttons
              if (ctrl.isA && ctrl.isA("sap.m.Button")) return;

              // Don't disable the Exit Gate dropdown.
              if (oExitGateCombo && ctrl === oExitGateCombo) {
                if (ctrl.setEnabled) ctrl.setEnabled(true);
                if (ctrl.setEditable) ctrl.setEditable(true);
                return;
              }

              // Related trip / gate pass display is always read-only.
              if (oRelatedTripReadOnly && ctrl === oRelatedTripReadOnly) {
                if (ctrl.setEnabled) {
                  ctrl.setEnabled(false);
                }
                if (ctrl.setEditable) {
                  ctrl.setEditable(false);
                }
                return;
              }

              // Keep dropdowns as non-editable; only enable/disable them.
              if (ctrl.isA && ctrl.isA("sap.m.ComboBox")) {
                if (ctrl.setEnabled) {
                  ctrl.setEnabled(bEnabled);
                }
                return;
              }
              
              // Try setEditable first (for Input, TextArea, etc.)
              if (ctrl.setEditable) {
                try {
                  ctrl.setEditable(bEnabled);
                } catch (e) {
                  // Fallback to setEnabled if setEditable fails
                  if (ctrl.setEnabled) {
                    ctrl.setEnabled(bEnabled);
                  }
                }
              } else if (ctrl.setEnabled) {
                // For controls that only support setEnabled (like RadioButtonGroup, FileUploader)
                try {
                  ctrl.setEnabled(bEnabled);
                } catch (e) {
                  // Ignore errors
                }
              }
            });
            
            // Ensure Edit/Save buttons remain enabled
            if (this.getView().byId("btnEditGateOut")) {
              this.getView().byId("btnEditGateOut").setEnabled(true);
            }
            if (this.getView().byId("btnSaveGateOut")) {
              this.getView().byId("btnSaveGateOut").setEnabled(true);
            }
          } catch (e) {
            // Don't break if something unexpected happens
            // Error in _setInputsEnabled
          }
        },
        onGateOutAttachmentChange: function (oEvent) {
          var oFileUploader = oEvent.getSource();
          
          // Get files from the native file input element
          var oDomRef = oFileUploader.getDomRef();
          var oFileInput = oDomRef ? oDomRef.querySelector("input[type='file']") : null;
          
          if (!oFileInput || !oFileInput.files || oFileInput.files.length === 0) {
            this._aSelectedFiles = [];
            // Disable preview button
            var oPreviewBtn = this.getView().byId("idPreviewSelectedGateOutFiles");
            if (oPreviewBtn) {
              oPreviewBtn.setEnabled(false);
            }
            return;
          }
          
          // Store selected files
          this._aSelectedFiles = Array.from(oFileInput.files);
          
          // Enable preview button
          var oPreviewBtn = this.getView().byId("idPreviewSelectedGateOutFiles");
          if (oPreviewBtn) {
            oPreviewBtn.setEnabled(true);
          }
        },
        onPreviewSelectedGateOutFiles: function () {
          if (!this._aSelectedFiles || this._aSelectedFiles.length === 0) {
            MessageToast.show("Please select files first");
            return;
          }
          
          // Show preview for first file
          var oFile = this._aSelectedFiles[0];
          var sFileName = oFile.name;
          var sContentType = oFile.type || "application/octet-stream";
          
          // Read file as base64 for preview
          var oReader = new FileReader();
          oReader.onload = function (oEvent) {
            var sBase64Content = oEvent.target.result;
            var sBase64Data = sBase64Content.split(",")[1] || sBase64Content;
            
            var oTempAttachment = {
              fileName: sFileName,
              contentType: sContentType
            };
            
            this._showGateOutPreviewDialog(oTempAttachment, sBase64Data, true);
          }.bind(this);
          
          oReader.onerror = function () {
            MessageToast.show("Failed to read file for preview");
          }.bind(this);
          
          oReader.readAsDataURL(oFile);
        },
        _uploadGateOutAttachments: function (fnCallback) {
          if (!this._aSelectedFiles || this._aSelectedFiles.length === 0) {
            if (fnCallback) {
              fnCallback(true);
            }
            return;
          }

          var oGlobalModel = sap.ui.getCore().getModel("globalData");
          var sTripNumber = oGlobalModel?.getProperty("/TripNumber") || "";

          if (!sTripNumber) {
            MessageToast.show("Please open a trip first");
            if (fnCallback) {
              fnCallback(false);
            }
            return;
          }

          this.getView().setBusy(true);

          var iTotalFiles = this._aSelectedFiles.length;
          var iProcessedFiles = 0;
          var iSuccessCount = 0;
          var iErrorCount = 0;
          var that = this;

          this._aSelectedFiles.forEach(function (oFile) {
            var sFileName = oFile.name;
            var sContentType = oFile.type || "application/octet-stream";

            var oReader = new FileReader();
            oReader.onload = function (oEvent) {
              var sBase64Content = oEvent.target.result;
              var sBase64Data = sBase64Content.split(",")[1] || sBase64Content;

              that._saveGateOutAttachment(sTripNumber, sFileName, sContentType, sBase64Data, function (bSuccess) {
                iProcessedFiles++;
                if (bSuccess) {
                  iSuccessCount++;
                } else {
                  iErrorCount++;
                }

                if (iProcessedFiles === iTotalFiles) {
                  that.getView().setBusy(false);
                  
                  var oFileUploader = that.getView().byId("idGateOutAttachments");
                  if (oFileUploader) {
                    oFileUploader.clear();
                  }
                  that._aSelectedFiles = [];
                  
                  var oPreviewBtn = that.getView().byId("idPreviewSelectedGateOutFiles");
                  if (oPreviewBtn) {
                    oPreviewBtn.setEnabled(false);
                  }

                  if (fnCallback) {
                    fnCallback(iErrorCount === 0);
                  }
                }
              });
            };

            oReader.onerror = function () {
              iProcessedFiles++;
              iErrorCount++;
              
              if (iProcessedFiles === iTotalFiles) {
                that.getView().setBusy(false);
                if (fnCallback) {
                  fnCallback(false);
                }
              }
            };

            oReader.readAsDataURL(oFile);
          });
        },
        _saveGateOutAttachment: function (sTripNumber, sFileName, sContentType, sBase64Data, fnCallback) {
          var oService = this.oModel;
          
          function generateSlug(inputString) {
            return inputString
              .toLowerCase()
              .replace(/\s+/g, '-')
              .replace(/[^\w\-]+/g, '')
              .replace(/--+/g, '-')
              .trim();
          }
          
          var slug = generateSlug(sTripNumber);
          
          var sFileExtension = "";
          var sBaseFileName = sFileName;
          if (sFileName && sFileName.lastIndexOf(".") > 0) {
            sBaseFileName = sFileName.substring(0, sFileName.lastIndexOf("."));
            sFileExtension = sFileName.substring(sFileName.lastIndexOf(".") + 1);
          } else if (sContentType && sContentType.indexOf("/") > 0) {
            sFileExtension = sContentType.split("/")[1];
          } else {
            sFileExtension = "bin";
          }
          
          var sSlugFileName = "GateOut_" + sBaseFileName + "_" + slug + "." + sFileExtension;
          
          var oPayload = {
            TripNumber: sTripNumber,
            FileName: sSlugFileName,
            ContentType: sContentType,
            Content: sBase64Data
          };

          var that = this;

          oService.create("/Attachments", oPayload, {
            headers: {
              "X-Requested-With": "X",
              "X-Driver-Slug": slug
            },
            success: function () {
              if (fnCallback) {
                fnCallback(true);
              }
            },
            error: function (oError) {
              if (oError.statusCode === 409 || oError.statusCode === 400) {
                that._updateGateOutAttachment(sTripNumber, sSlugFileName, sContentType, sBase64Data, fnCallback);
              } else {
                if (fnCallback) {
                  fnCallback(false);
                }
                // Upload error
              }
            }
          });
        },
        _updateGateOutAttachment: function (sTripNumber, sFileName, sContentType, sBase64Data, fnCallback) {
          var oService = this.oModel;
          var sPath = "/Attachments('" + sTripNumber + "')";
          
          var oPayload = {
            FileName: sFileName,
            ContentType: sContentType,
            Content: sBase64Data
          };

          oService.update(sPath, oPayload, {
            headers: {
              "X-Requested-With": "X"
            },
            success: function () {
              if (fnCallback) {
                fnCallback(true);
              }
            },
            error: function (oError) {
              if (fnCallback) {
                fnCallback(false);
              }
              // Update attachment error
            }
          });
        },
        _loadGateOutAttachments: function () {
          // Ensure attachments model is initialized
          if (!this._oGateOutAttachmentsModel) {
            this._initGateOutAttachmentsModel();
          }

          var oGlobalModel = sap.ui.getCore().getModel("globalData");
          var sTripNumber = oGlobalModel?.getProperty("/TripNumber") || "";

          if (!sTripNumber) {
            this._oGateOutAttachmentsModel.setProperty("/attachments", []);
            return;
          }

          var oService = this.oModel;
          oService.read("/Attachments", {
            filters: [
              new sap.ui.model.Filter("TripNumber", sap.ui.model.FilterOperator.EQ, sTripNumber)
            ],
            success: function (oData) {
              var aAttachments = [];
              if (oData && oData.results && Array.isArray(oData.results)) {
                oData.results.forEach(function(oAttachment) {
                  if (oAttachment.FileName && oAttachment.FileName.startsWith("GateOut_")) {
                    aAttachments.push({
                      tripNumber: oAttachment.TripNumber || sTripNumber,
                      fileName: oAttachment.FileName || "",
                      contentType: oAttachment.ContentType || ""
                    });
                  }
                });
              } else if (oData && oData.FileName && oData.FileName.startsWith("GateOut_")) {
                aAttachments.push({
                  tripNumber: oData.TripNumber || sTripNumber,
                  fileName: oData.FileName || "",
                  contentType: oData.ContentType || ""
                });
              }
              this._oGateOutAttachmentsModel.setProperty("/attachments", aAttachments);
            }.bind(this),
            error: function (oError) {
              // Try reading by key if collection read fails
              oService.read("/Attachments('" + sTripNumber + "')", {
                success: function (oData) {
                  var aAttachments = [];
                  if (oData && oData.FileName && oData.FileName.startsWith("GateOut_")) {
                    aAttachments.push({
                      tripNumber: oData.TripNumber || sTripNumber,
                      fileName: oData.FileName || "",
                      contentType: oData.ContentType || ""
                    });
                  }
                  this._oGateOutAttachmentsModel.setProperty("/attachments", aAttachments);
                }.bind(this),
                error: function () {
                  this._oGateOutAttachmentsModel.setProperty("/attachments", []);
                }.bind(this)
              });
            }.bind(this)
          });
        },
        onPreviewGateOutAttachment: function (oEvent) {
          var oSource = oEvent.getSource();
          var oListItem = oSource.getParent();
          
          var oParent = oSource.getParent();
          while (oParent) {
            if (oParent.getBindingContext && oParent.getBindingContext("gateOutAttachmentsModel")) {
              oListItem = oParent;
              break;
            }
            oParent = oParent.getParent ? oParent.getParent() : null;
          }
          
          if (oListItem) {
            var oContext = oListItem.getBindingContext("gateOutAttachmentsModel");
            if (oContext) {
              var oAttachment = oContext.getObject();
              this._previewGateOutAttachment(oAttachment);
              return;
            }
          }
          
          MessageToast.show("Unable to load attachment");
        },
        _previewGateOutAttachment: function (oAttachment) {
          var sTripNumber = oAttachment.tripNumber || sap.ui.getCore().getModel("globalData")?.getProperty("/TripNumber") || "";

          if (!sTripNumber) {
            MessageToast.show("Trip number not found");
            return;
          }

          var oService = this.oModel;
          oService.read("/Attachments", {
            filters: [
              new sap.ui.model.Filter("TripNumber", sap.ui.model.FilterOperator.EQ, sTripNumber),
              new sap.ui.model.Filter("FileName", sap.ui.model.FilterOperator.EQ, oAttachment.fileName)
            ],
            success: function (oData) {
              var oAttachmentData = null;
              if (oData && oData.results && Array.isArray(oData.results) && oData.results.length > 0) {
                oAttachmentData = oData.results[0];
              } else if (oData && oData.FileName === oAttachment.fileName) {
                oAttachmentData = oData;
              }
              
              if (oAttachmentData && oAttachmentData.Content) {
                this._showGateOutPreviewDialog(oAttachment, oAttachmentData.Content, false);
              } else {
                // Try reading by key
                oService.read("/Attachments('" + sTripNumber + "')", {
                  success: function (oDataByKey) {
                    if (oDataByKey && oDataByKey.Content) {
                      this._showGateOutPreviewDialog(oAttachment, oDataByKey.Content, false);
                    } else {
                      MessageToast.show("Attachment content not found");
                    }
                  }.bind(this),
                  error: function () {
                    MessageToast.show("Attachment not found");
                  }
                });
              }
            }.bind(this),
            error: function (oError) {
              // Try reading by key if collection read fails
              oService.read("/Attachments('" + sTripNumber + "')", {
                success: function (oDataByKey) {
                  if (oDataByKey && oDataByKey.Content) {
                    this._showGateOutPreviewDialog(oAttachment, oDataByKey.Content, false);
                  } else {
                    MessageToast.show("Attachment content not found");
                  }
                }.bind(this),
                error: function () {
                  MessageToast.show("Failed to load attachment for preview");
                  // Preview error
                }
              });
            }.bind(this)
          });
        },
        _showGateOutPreviewDialog: function (oAttachment, sBase64Content, bIsSelectedFile) {
          var that = this;
          
          if (!this._oGateOutPreviewDialog) {
            this._oGateOutPreviewDialog = new sap.m.Dialog({
              title: oAttachment.fileName,
              contentWidth: "90%",
              contentHeight: "85%",
              resizable: true,
              draggable: true,
              beginButton: new sap.m.Button({
                text: "Close",
                press: function () {
                  that._oGateOutPreviewDialog.close();
                }
              }),
              endButton: new sap.m.Button({
                text: "Download",
                type: "Emphasized",
                icon: "sap-icon://download",
                press: function () {
                  that._downloadGateOutAttachment(oAttachment, sBase64Content);
                }
              })
            });
            this.getView().addDependent(this._oGateOutPreviewDialog);
          }

          this._oGateOutPreviewDialog.setTitle(oAttachment.fileName || "Preview");
          this._oGateOutPreviewDialog.removeAllContent();

          var sContentType = oAttachment.contentType || "";
          var sBase64 = sBase64Content || "";

          if (!sBase64) {
            var oText = new sap.m.Text({
              text: "No content available for preview."
            });
            this._oGateOutPreviewDialog.addContent(oText);
            this._oGateOutPreviewDialog.open();
            return;
          }

          var sDataUrl = "data:" + sContentType + ";base64," + sBase64;

          if (sContentType.startsWith("image/")) {
            var oScrollContainer = new sap.m.ScrollContainer({
              width: "100%",
              height: "100%",
              vertical: true,
              horizontal: true,
              content: [
                new sap.m.Image({
                  src: sDataUrl,
                  densityAware: false,
                  width: "100%",
                  height: "auto"
                })
              ]
            });
            this._oGateOutPreviewDialog.addContent(oScrollContainer);
          } else if (sContentType === "application/pdf") {
            var oHTML = new sap.ui.core.HTML({
              content: '<iframe src="' + sDataUrl + '" style="width:100%;height:100%;border:none;"></iframe>'
            });
            this._oGateOutPreviewDialog.addContent(oHTML);
          } else {
            var oText = new sap.m.Text({
              text: "Preview not available for this file type. Please download to view."
            });
            this._oGateOutPreviewDialog.addContent(oText);
          }

          this._oGateOutPreviewDialog.open();
        },
        _downloadGateOutAttachment: function (oAttachment, sBase64Content) {
          var sContentType = oAttachment.contentType || "application/octet-stream";
          var sFileName = oAttachment.fileName || "attachment";
          
          var sDataUrl = "data:" + sContentType + ";base64," + sBase64Content;
          
          var oLink = document.createElement("a");
          oLink.href = sDataUrl;
          oLink.download = sFileName;
          document.body.appendChild(oLink);
          oLink.click();
          document.body.removeChild(oLink);
        },

        // User-role-based authorization for GateOut has been removed; buttons are
        // controlled purely by TripData state and standard UI logic.
      }
    );
  }
);
