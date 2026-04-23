sap.ui.define(
  [
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/odata/v2/ODataModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/m/SelectDialog",
    "sap/m/StandardListItem",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "com/incresolZ_INC_PLMS/util/PanelAccordion",
    "com/incresolZ_INC_PLMS/util/O02GateException",
    "com/incresolZ_INC_PLMS/util/TripDataDocumentsVerified",
  ],
  function (
    Controller,
    ODataModel,
    MessageToast,
    MessageBox,
    SelectDialog,
    StandardListItem,
    JSONModel,
    Filter,
    PanelAccordion,
    O02GateException,
    TripDataDocumentsVerified
  ) {
    "use strict";

    var tripNumber;
    return Controller.extend(
      "com.incresolZ_INC_PLMS.controller.subview.GateIn",
      {
        onInit: function () {
          this.oModel = new ODataModel("/sap/opu/odata/sap/YIGP_PLMS_SRV/", {
            useBatch: false,
            defaultBindingMode: "TwoWay",
          });
          this.getView().setModel(this.oModel);
          this._initGateInUiModel();
          this._eventBus = sap.ui.getCore().getEventBus();
          this._eventBus.subscribe("TripData", "Updated", this._onTripDataUpdate, this);
          this._eventBus.subscribe("RefDoc", "MaterialsUpdated", this._onRefDocMaterialsUpdated, this);
          this._eventBus.subscribe("Stage", "ClearAllTabs", this._clearAllData, this);
          this._bGateInEditMode = false;
          this._bGateInReadOnlyAfterSave = false;
          this._sGateInReadOnlyTripNumber = "";
          this._sLastGateInTripForGateList = "";
          this._sLastGateInBinReloadTrip = "";
          this._iLastGateInBinReloadAt = 0;
          this._iGateInBinReloadTimer = null;
          this._sGateInAttachmentsTripLoading = "";
          this._sGateInAttachmentsLastLoadedTrip = "";
          this._iGateInAttachmentsLastLoadedAt = 0;
          
          // Initialize weighment required if not set (default to "No")
          var oTripData = sap.ui.getCore().getModel("TripData");
          if (!oTripData) {
            oTripData = new JSONModel({ RefDocSkip: " " });
            sap.ui.getCore().setModel(oTripData, "TripData");
          }
          if (oTripData && !oTripData.getProperty("/WeighmentRequired")) {
            oTripData.setProperty("/WeighmentRequired", "N");
          }
          if (oTripData) {
            var vSkip = oTripData.getProperty("/RefDocSkip");
            if (vSkip === undefined || vSkip === null || String(vSkip).trim() === "") {
              oTripData.setProperty("/RefDocSkip", " ");
            }
          }
          
          // Initialize attachments model
          this._initGateInAttachmentsModel();

          this._oEntryGateSelectModel = new JSONModel({
            Enabled: true,
            Editable: true,
            ProductCollection2: [],
            SelectedProduct2: "",
          });
          this.getView().setModel(this._oEntryGateSelectModel, "entryGateSelect");

          this._oDelayReasonSelectModel = new JSONModel({
            Enabled: true,
            Editable: true,
            DelayReasonCollection: [],
            SelectedDelayKey: "",
          });
          this.getView().setModel(this._oDelayReasonSelectModel, "delayReasonSelect");

          this.getView().setModel(new JSONModel({ items: [] }), "partCodeSuggest");
          this._sPartCodeSuggestRowPath = "";
          this._sPartCodeSuggestLatestTerm = "";
          this._iPartCodeSuggestTimer = null;

          this._initBinTrolleyTrackingModel();
          this._initBinTrolleyVisibilityModel();
          this._updateBinTrolleyVisibility();
          
          // Initialize selected files array
          this._aSelectedFiles = [];
          PanelAccordion.attach(this.getView());
          this._attachGateInPanelExpansionPersistence();
          this._updatePanelVisibility();

        },
        _attachGateInPanelExpansionPersistence: function () {
          try {
            var oView = this.getView();
            if (!oView || typeof oView.findAggregatedObjects !== "function") {
              return;
            }
            var oUi = oView.getModel("gateInUi");
            if (!oUi) {
              this._initGateInUiModel();
              oUi = oView.getModel("gateInUi");
            }
            var aPanels = oView.findAggregatedObjects(true, function (o) {
              return o && o.isA && o.isA("sap.m.Panel") && o.getExpandable && o.getExpandable();
            });
            aPanels.forEach(function (oPanel) {
              if (oPanel._plmsExpandPersistAttached) {
                return;
              }
              oPanel._plmsExpandPersistAttached = true;
              oPanel.attachExpand(function (oEvent) {
                if (!oEvent.getParameter("expand")) {
                  return;
                }
                // Persist the last expanded panel (store local ID so it survives view recreation).
                try {
                  var sViewPrefix = (typeof oView.getId === "function" ? oView.getId() : "") + "--";
                  var sFullId = oPanel.getId();
                  var sLocalId = sFullId && sViewPrefix && sFullId.indexOf(sViewPrefix) === 0
                    ? sFullId.slice(sViewPrefix.length)
                    : sFullId;
                  oUi && oUi.setProperty("/lastExpandedPanelLocalId", sLocalId);
                } catch (e2) {
                  // ignore
                }
              });
            });
          } catch (e) {
            // ignore
          }
        },
        _initGateInUiModel: function () {
          if (!this.getView().getModel("gateInUi")) {
            this.getView().setModel(
              new JSONModel({
                showPanels: false
              }),
              "gateInUi"
            );
          } else {
            var oUi = this.getView().getModel("gateInUi");
            if (oUi.getProperty("/showPanels") === undefined) {
              oUi.setProperty("/showPanels", false);
            }
          }
        },
        _updatePanelVisibility: function () {
          this._initGateInUiModel();
          var oUi = this.getView().getModel("gateInUi");
          if (!oUi) {
            return;
          }
          var oCoreTrip = sap.ui.getCore().getModel("TripData");
          var oViewTrip = this.getView().getModel("TripData");
          var sTripNumber = (oCoreTrip && oCoreTrip.getProperty("/TripNumber")) ||
            (oViewTrip && oViewTrip.getProperty("/TripNumber")) || "";
          oUi.setProperty("/showPanels", !!String(sTripNumber).trim());
        },
        /**
         * Single expanded panel on the tab: Reporting when it is shown here; otherwise Gate-In.
         */
        _applyGateInTabDefaultPanelExpansion: function () {
          try {
            var oUi = this.getView().getModel("gateInUi");
            var sLastExpandedLocalId = oUi && oUi.getProperty("/lastExpandedPanelLocalId");
            if (sLastExpandedLocalId) {
              var oLast = this.getView().byId(sLastExpandedLocalId);
              if (oLast && oLast.setExpanded) {
                PanelAccordion.collapseAllExcept(this.getView(), oLast);
                return;
              }
            }
            var oStageUi = sap.ui.getCore().getModel("stageUi");
            var bReportingOnGateOut = !!(oStageUi && oStageUi.getProperty("/showReportingInGateOut"));
            var oEmb = this.getView().byId("idVehicleReportingEmbeddedGateIn");
            var oRep = oEmb && oEmb.byId("reportingDetailsPanel");
            if (!bReportingOnGateOut && oRep) {
              PanelAccordion.collapseAllExcept(this.getView(), oRep);
            } else {
              var oGateIn = this.getView().byId("gateInInfoPanel");
              PanelAccordion.collapseAllExcept(this.getView(), oGateIn);
            }
          } catch (e) {
            // ignore
          }
        },
        _ensureReportingPanelExpanded: function () {
          // Intentionally no-op.
          // Auto-expanding Reporting from Gate In refresh handlers caused
          // the screen to jump away from the user's current Gate In context.
        },

        _initBinTrolleyTrackingModel: function () {
          var oTrackingModel = sap.ui.getCore().getModel("binTrolleyTrackingGateIn");
          if (!oTrackingModel) {
            var aInitialRows = [this._getEmptyTrackingRow()];
            oTrackingModel = new JSONModel({
              rows: aInitialRows,
              items: aInitialRows,
              totalQtyOut: 0,
              totalQtyIn: 0,
              totalDifference: 0,
              totalReturnStatusSummary: "No entries",
              isPosted: true
            });
            sap.ui.getCore().setModel(oTrackingModel, "binTrolleyTrackingGateIn");
          } else if (!oTrackingModel.getProperty("/items")) {
            oTrackingModel.setProperty("/items", oTrackingModel.getProperty("/rows") || []);
          }
          this.getView().setModel(oTrackingModel, "binTrolleyTracking");
        },
        _getTrackingItems: function (oTrackingModel) {
          if (!oTrackingModel) {
            return [];
          }
          var aItems = oTrackingModel.getProperty("/items");
          if (Array.isArray(aItems)) {
            return aItems;
          }
          var aRows = oTrackingModel.getProperty("/rows");
          return Array.isArray(aRows) ? aRows : [];
        },
        _setTrackingItems: function (oTrackingModel, aItems) {
          if (!oTrackingModel) {
            return;
          }
          oTrackingModel.setProperty("/items", aItems || []);
          oTrackingModel.setProperty("/rows", aItems || []);
          oTrackingModel.updateBindings(true);
          this.getView().getModel("binTrolleyTracking")?.updateBindings(true);
        },
        _initBinTrolleyVisibilityModel: function () {
          if (!this.getView().getModel("ui")) {
            this.getView().setModel(
              new JSONModel({ showBinTrolleyTracking: false }),
              "ui"
            );
          }
        },
        _updateBinTrolleyVisibility: function () {
          this._initBinTrolleyVisibilityModel();
          var oTripData = sap.ui.getCore().getModel("TripData");
          var oGlobal = sap.ui.getCore().getModel("globalData");

          var sTripFromTripData = String(
            (oTripData && oTripData.getProperty("/TripNumber")) || ""
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
          this.getView().getModel("ui").setProperty("/showBinTrolleyTracking", bShow);
        },

        /**
         * O02 + non-Internal: bins enforced at Gate In. O02 + Internal (01): not here (captured at Gate Out).
         */
        _requiresMandatoryGateInBinDetails: function () {
          this._initBinTrolleyVisibilityModel();
          var oUi = this.getView().getModel("ui");
          var oTripData = sap.ui.getCore().getModel("TripData");
          if (!oUi || !oUi.getProperty("/showBinTrolleyTracking") || !oTripData) {
            return false;
          }
          return !O02GateException.isO02InternalException(oTripData);
        },

        _getEmptyTrackingRow: function () {
          return {
            LocalId: this._createManualRowId(),
            TripNumber: "",
            DocumentNumber: "",
            ItemNo: "",
            Customer: "",
            CusromerName: "",
            Material: "",
            MaterialDescription: "",
            BinType: "",
            BinTypeDesc: "",
            QtyIn: 0,
            QtyOut: 0,
            Difference: 0,
            ReturnStatus: "New Entry",
            IsManual: true
          };
        },
        _createManualRowId: function () {
          return "m_" + Date.now() + "_" + Math.floor(Math.random() * 1000000);
        },

        onAddTrackingRow: function () {
          var iScrollY = (typeof window !== "undefined" && typeof window.scrollY === "number")
            ? window.scrollY
            : null;
          var oTrackingModel = this.getView().getModel("binTrolleyTracking");
          if (!oTrackingModel) {
            return;
          }
          var sTripNumber = String(this._getTripNumber() || "").trim();
          var aRows = this._getTrackingItems(oTrackingModel);
          var oRow = this._getEmptyTrackingRow();
          oRow.TripNumber = sTripNumber;
          aRows.push(oRow);
          this._setTrackingItems(oTrackingModel, aRows);
          this._recalculateTrackingTotals();
          this._persistTrackingRows();
          oTrackingModel.setProperty("/isPosted", false);
          if (iScrollY !== null) {
            setTimeout(function () {
              window.scrollTo(0, iScrollY);
            }, 0);
          }
        },

        onTrackingFieldLiveChange: function () {
          this._recalculateTrackingTotals();
          this._persistTrackingRows();
          var oTrackingModel = this.getView().getModel("binTrolleyTracking");
          if (oTrackingModel) {
            oTrackingModel.setProperty("/isPosted", false);
          }
        },

        /** Non-negative whole number for bin/trolley QtyIn/QtyOut (OData / model). */
        _coerceWholeBinQty: function (v) {
          var n = Number(v);
          if (isNaN(n) || n < 0) {
            return 0;
          }
          return Math.trunc(n);
        },

        _scheduleBinTrackingExcessWarning: function () {
          if (this._iBinExcessWarnTimer) {
            clearTimeout(this._iBinExcessWarnTimer);
          }
          this._iBinExcessWarnTimer = setTimeout(
            function () {
              this._iBinExcessWarnTimer = null;
              this._warnBinTrackingQtyInExcessIfAny();
            }.bind(this),
            600
          );
        },

        _warnBinTrackingQtyInExcessIfAny: function () {
          var oUi = this.getView().getModel("ui");
          if (!oUi || !oUi.getProperty("/showBinTrolleyTracking")) {
            return;
          }
          var oTrackingModel = this.getView().getModel("binTrolleyTracking");
          if (!oTrackingModel) {
            return;
          }
          var aRows = this._getTrackingItems(oTrackingModel);
          var bExcess = (aRows || []).some(
            function (oRow) {
              if (!oRow) {
                return false;
              }
              var iIn = this._coerceWholeBinQty(oRow.QtyIn);
              var iOut = this._coerceWholeBinQty(oRow.QtyOut);
              return iIn > iOut;
            }.bind(this)
          );
          if (!bExcess) {
            return;
          }
          MessageToast.show(
            "Warning: Qty In is greater than Qty Out for one or more bin/trolley rows."
          );
        },

        _onBinTrackingQtyInUiChanged: function () {
          this._recalculateTrackingTotals();
          var oTrackingModel = this.getView().getModel("binTrolleyTracking");
          if (oTrackingModel) {
            oTrackingModel.setProperty("/isPosted", false);
          }
        },

        onBinTrackingQtyInLiveChange: function (oEvent) {
          var sNew = oEvent.getParameter("value");
          var sPrev = oEvent.getParameter("previousValue");
          if (sNew === "" || /^\d+$/.test(sNew)) {
            this._onBinTrackingQtyInUiChanged();
            return;
          }
          oEvent.getSource().setValue(sPrev == null ? "" : String(sPrev));
          this._onBinTrackingQtyInUiChanged();
        },

        onBinTrackingQtyInPaste: function (oEvent) {
          var oBE = oEvent.getParameter("browserEvent");
          var sPaste = "";
          if (oBE && oBE.clipboardData) {
            sPaste = String(oBE.clipboardData.getData("text") || "").trim();
          }
          oEvent.preventDefault();
          if (sPaste === "") {
            return;
          }
          if (!/^\d+$/.test(sPaste)) {
            MessageToast.show("Only whole numbers are allowed.");
            return;
          }
          var oInput = oEvent.getSource();
          var sCur = String(oInput.getValue() || "");
          var oFR = oInput.getFocusDomRef();
          var iStart = 0;
          var iEnd = sCur.length;
          if (oFR && typeof oFR.selectionStart === "number") {
            iStart = oFR.selectionStart;
            iEnd = oFR.selectionEnd;
          }
          var sNew = sCur.slice(0, iStart) + sPaste + sCur.slice(iEnd);
          if (!/^\d*$/.test(sNew)) {
            MessageToast.show("Only whole numbers are allowed.");
            return;
          }
          oInput.setValue(sNew);
          this.onTrackingFieldLiveChange();
          setTimeout(function () {
            var el = oInput.getFocusDomRef();
            if (el && typeof el.setSelectionRange === "function") {
              var iCaret = iStart + sPaste.length;
              el.setSelectionRange(iCaret, iCaret);
            }
          }, 0);
        },

        onRemoveTrackingRow: function (oEvent) {
          var oTrackingModel = this.getView().getModel("binTrolleyTracking");
          if (!oTrackingModel) {
            return;
          }

          var oContext = oEvent.getSource().getBindingContext("binTrolleyTracking");
          if (!oContext) {
            return;
          }

          var sPath = oContext.getPath(); // /rows/2
          var aParts = sPath.split("/");
          var iIndex = Number(aParts[aParts.length - 1]);
          if (isNaN(iIndex)) {
            return;
          }

          var aRows = this._getTrackingItems(oTrackingModel);
          if (iIndex < 0 || iIndex >= aRows.length) {
            return;
          }
          var oRow = aRows[iIndex];
          if (!oRow) {
            return;
          }

          if (oRow.IsManual !== true) {
            var sTripNumber = String(oRow.TripNumber || this._getTripNumber() || "").trim();
            var sDocumentNumber = String(oRow.DocumentNumber || "").trim();
            var sItemNo = String(oRow.ItemNo || "").trim();
            if (!sTripNumber || !sDocumentNumber || !sItemNo) {
              MessageBox.error("Unable to delete row. Missing key fields.");
              return;
            }
            if (!this.oModel) {
              MessageBox.error("OData model is not loaded.");
              return;
            }
            var aPreviousRows = aRows.slice();
            aRows.splice(iIndex, 1);
            if (!aRows.length) {
              aRows.push(this._getEmptyTrackingRow());
            }
            this._setTrackingItems(oTrackingModel, aRows);
            this._recalculateTrackingTotals();
            this._persistTrackingRows();
            oTrackingModel.setProperty("/isPosted", false);
            var sEntityPath = this._buildEmptyBinsPath(sTripNumber, sDocumentNumber, sItemNo);
            this.oModel.remove(sEntityPath, {
              success: function () {
                MessageToast.show("Row deleted.");
              }.bind(this),
              error: function () {
                this._setTrackingItems(oTrackingModel, aPreviousRows);
                this._recalculateTrackingTotals();
                this._persistTrackingRows();
                MessageBox.error("Failed to delete row.");
              }
            });
            return;
          }

          aRows.splice(iIndex, 1);
          if (!aRows.length) {
            aRows.push(this._getEmptyTrackingRow());
          }

          this._setTrackingItems(oTrackingModel, aRows);
          this._recalculateTrackingTotals();
          this._persistTrackingRows();
          oTrackingModel.setProperty("/isPosted", false);
        },
        _buildTrackingRowsForBackend: function (sTripNumber) {
          var oTrackingModel = this.getView().getModel("binTrolleyTracking");
          var aRows = this._getTrackingItems(oTrackingModel);
          var fnHasMeaningfulData = function (oRow) {
            if (!oRow) {
              return false;
            }
            var sMaterial = String(oRow.Material || "").trim();
            var sBin = String(
              oRow.BinType ||
                oRow.BinTypes ||
                oRow.BinTypeDesc ||
                oRow.BintypeDesc ||
                oRow.BinTypeDescription ||
                ""
            ).trim();
            var iQtyIn = this._coerceWholeBinQty(oRow.QtyIn);
            var iQtyOut = this._coerceWholeBinQty(oRow.QtyOut);
            var iActualQty = this._coerceWholeBinQty(oRow.ActualQty);
            return !!(sMaterial || sBin || iQtyIn > 0 || iQtyOut > 0 || iActualQty > 0);
          }.bind(this);
          return aRows
            .filter(function (oRow) {
              // Backend can accept bin rows without DocumentNumber/ItemNo (manual rows).
              // Only skip completely blank rows.
              return fnHasMeaningfulData(oRow);
            })
            .map(function (oRow) {
              var iQtyIn = this._coerceWholeBinQty(oRow.QtyIn);
              var iQtyOut = this._coerceWholeBinQty(oRow.QtyOut);
              var iActualQty = this._coerceWholeBinQty(oRow.ActualQty);
              // Keep payload aligned with backend expectation for EmptyBins lines.
              // Do not force DocumentNumber/ItemNo into payload when not provided.
              var oPayloadRow = {
                TripNumber: String(oRow.TripNumber || sTripNumber || "").trim(),
                Customer: String(oRow.Customer || ""),
                Material: String(oRow.Material || ""),
                BinType: String(oRow.BinType || "").trim(),
                BintypeDesc: String(oRow.BinTypeDesc || oRow.BintypeDesc || oRow.BinTypeDescription || oRow.BinType || oRow.BinTypes || "").trim(),
                ActualQty: String(iActualQty),
                QtyIn: String(iQtyIn),
                QtyOut: String(iQtyOut)
              };
              // Preserve doc/item when present (helps backend keying if supported).
              var sDoc = String(oRow.DocumentNumber || "").trim();
              var sItem = String(oRow.ItemNo || "").trim();
              if (sDoc) {
                oPayloadRow.DocumentNumber = sDoc;
              }
              if (sItem) {
                oPayloadRow.ItemNo = sItem;
              }
              return oPayloadRow;
            }.bind(this));
        },

        /**
         * Collapse duplicate EmptyBins lines from OData (same doc/item/bin) so the grid does not show doubles.
         */
        _dedupeEmptyBinsODataRows: function (aRows) {
          var mSeen = {};
          var aOut = [];
          var fnNorm = function (s) {
            var t = String(s || "").trim();
            t = t.replace(/^0+/, "");
            return t || "0";
          };
          (aRows || []).forEach(function (r) {
            if (!r) {
              return;
            }
            var sBin = String(
              r.BinType || r.BinTypes || r.BinTypeDesc || r.BintypeDesc || r.BinTypeDescription || ""
            ).trim();
            var sMat = String(r.Material || r.MaterialCode || "").trim();
            var sKey =
              fnNorm(r.DocumentNumber) + "|" + fnNorm(r.ItemNo) + "|" + sBin + "|" + sMat;
            if (mSeen[sKey]) {
              return;
            }
            mSeen[sKey] = true;
            aOut.push(r);
          });
          return aOut;
        },

        /** Same key as _dedupeEmptyBinsODataRows — doc/item normalized, bin literal. */
        _binTrackingRowCanonicalKey: function (oRow) {
          if (!oRow) {
            return "";
          }
          var fnNorm = function (s) {
            var t = String(s || "").trim();
            t = t.replace(/^0+/, "");
            return t || "0";
          };
          var sBin = String(
            oRow.BinType || oRow.BinTypes || oRow.BinTypeDesc || oRow.BintypeDesc || oRow.BinTypeDescription || ""
          ).trim();
          var sMat = String(oRow.Material || oRow.MaterialCode || "").trim();
          return fnNorm(oRow.DocumentNumber) + "|" + fnNorm(oRow.ItemNo) + "|" + sBin + "|" + sMat;
        },

        _markGateInBinJustSaved: function () {
          this._iGateInBinSaveSuppressReloadUntil = Date.now() + 4000;
        },

        _saveEmptyBinsViaTripDetails: function (sTripNumber, aRows) {
          var that = this;
          var oModel = this.oModel;
          if (!oModel) {
            return Promise.reject(new Error("OData model is not loaded."));
          }
          sTripNumber = String(sTripNumber || "").trim();
          if (!sTripNumber) {
            return Promise.reject(new Error("Trip number is required."));
          }
          var oTripData = sap.ui.getCore().getModel("TripData");
          var oPayload = {
            TripNumber: sTripNumber,
            MovementType: String((oTripData && oTripData.getProperty("/MovementType")) || ""),
            MovementScenario: String((oTripData && oTripData.getProperty("/MovementScenario")) || ""),
            MovementTypeDesc: String((oTripData && oTripData.getProperty("/MovementTypeDesc")) || ""),
            TripStatus: "Vehicle Reported",
            VehicleNumber: String((oTripData && oTripData.getProperty("/VehicleNumber")) || ""),
            DriverName: String((oTripData && oTripData.getProperty("/DriverName")) || ""),
            DriverMobile: String((oTripData && oTripData.getProperty("/DriverMobile")) || ""),
            Plant: String((oTripData && oTripData.getProperty("/Plant")) || ""),
            CompanyCode: String((oTripData && oTripData.getProperty("/CompanyCode")) || ""),
            EmptyBins: aRows || []
          };
          this._updateBinTrolleyVisibility();
          var oUi = this.getView().getModel("ui");
          var bShowBinTrolley = !!(oUi && oUi.getProperty("/showBinTrolleyTracking"));
          var sPath = "/TripDetails('" + this._escapeODataKey(sTripNumber) + "')";

          var fnReadTripDetails = function () {
            return new Promise(function (resolve, reject) {
              oModel.read(sPath, {
                urlParameters: {
                  "$expand": "EmptyBins"
                },
                success: function (oData) {
                  resolve(oData || {});
                },
                error: function (oError) {
                  reject(oError);
                }
              });
            });
          };

          var fnMergeSaveResponseToUi = function (oTripHeader, aEmptyBins) {
            var oTrackingModel = this.getView().getModel("binTrolleyTracking");
            if (!oTrackingModel) {
              return;
            }
            if (!bShowBinTrolley) {
              return;
            }
            var aDeduped = this._dedupeEmptyBinsODataRows(aEmptyBins || []);
            var aMappedRows = aDeduped.map(function (r) {
              var iQtyOut = this._coerceWholeBinQty(r.QtyOut);
              var iQtyIn = this._coerceWholeBinQty(r.QtyIn);
              var iDiff = iQtyOut - iQtyIn;
              return {
                TripNumber: String(r.TripNumber || sTripNumber).trim(),
                DocumentNumber: String(r.DocumentNumber || "").trim(),
                ItemNo: String(r.ItemNo || "").trim(),
                Customer: String(r.Customer || "").trim(),
                CusromerName: String(r.CusromerName || r.CustomerName || "").trim(),
                Material: String(r.Material || "").trim(),
                MaterialDescription: String(
                  r.MaterialDescription || r.PartcodeDesc || r.PartCodeDesc || r.MaterialDesc || ""
                ).trim(),
                BinType: String(r.BinType || r.BinTypes || r.BinTypeDesc || r.BintypeDesc || r.BinTypeDescription || "").trim(),
                BinTypeDesc: String(r.BinTypeDesc || r.BintypeDesc || r.BinTypeDescription || r.BinType || r.BinTypes || "").trim(),
                BintypeDesc: String(r.BinTypeDesc || r.BintypeDesc || r.BinTypeDescription || r.BinType || r.BinTypes || "").trim(),
                QtyIn: iQtyIn,
                QtyOut: iQtyOut,
                Difference: iDiff,
                ReturnStatus: this._deriveTrackingStatus(iQtyIn, iQtyOut, iDiff, "Pending", false),
                IsManual: false
              };
            }.bind(this));

            if (!aMappedRows.length) {
              return;
            }
            this._setTrackingItems(
              oTrackingModel,
              this._mergeWithPersistedRows(sTripNumber, aMappedRows)
            );
            this._recalculateTrackingTotals();
            oTrackingModel.setProperty("/isPosted", true);

            if (oTripData && oTripHeader) {
              oTripData.setProperty("/TripStatus", String(oTripHeader.TripStatus || "Vehicle Reported"));
            }
          }.bind(this);

          var fnAfterPersistSuccess = function () {
            return fnReadTripDetails()
              .then(function (oTripHeader) {
                var vExpanded = oTripHeader && oTripHeader.EmptyBins;
                var aExpandedEmptyBins = [];
                if (Array.isArray(vExpanded)) {
                  aExpandedEmptyBins = vExpanded;
                } else if (vExpanded && Array.isArray(vExpanded.results)) {
                  aExpandedEmptyBins = vExpanded.results;
                }
                fnMergeSaveResponseToUi(oTripHeader, aExpandedEmptyBins);
                that._markGateInBinJustSaved();
                return oTripHeader;
              })
              .catch(function () {
                that._markGateInBinJustSaved();
                return { TripNumber: sTripNumber };
              });
          };

          // POST only: GW rejects deep MERGE/PUT with inline EmptyBins ("Inline component is not defined or not allowed").
          return new Promise(function (resolve, reject) {
            oModel.create("/TripDetails", oPayload, {
              headers: { "X-Requested-With": "X" },
              success: function () {
                fnAfterPersistSuccess().then(resolve).catch(function () {
                  resolve({ TripNumber: sTripNumber });
                });
              },
              error: function (oCreateError) {
                reject(oCreateError);
              }
            });
          });
        },

        _recalculateTrackingTotals: function () {
          var oTrackingModel = this.getView().getModel("binTrolleyTracking");
          if (!oTrackingModel) {
            return;
          }
          var aRows = this._getTrackingItems(oTrackingModel);
          var iTotalQtyOut = 0;
          var iTotalQty = 0;
          var iTotalDiff = 0;
          var mStatusCounts = {};

          aRows.forEach(function (oRow) {
            var iQtyIn = this._coerceWholeBinQty(oRow.QtyIn);
            var iQtyOut = this._coerceWholeBinQty(oRow.QtyOut);
            oRow.QtyIn = iQtyIn;
            oRow.QtyOut = iQtyOut;
            var iDiff = oRow.IsManual === true ? iQtyIn : (iQtyOut - iQtyIn);

            if (!isNaN(iDiff)) {
              oRow.Difference = iDiff;
            }
            oRow.ReturnStatus = this._deriveTrackingStatus(iQtyIn, iQtyOut, iDiff, oRow.ReturnStatus, oRow.IsManual);
            if (!isNaN(iQtyOut)) {
              iTotalQtyOut += iQtyOut;
            }
            if (!isNaN(iQtyIn)) {
              iTotalQty += iQtyIn;
            }
            if (!isNaN(iDiff)) {
              iTotalDiff += iDiff;
            }
            var bMeaningfulRow =
              String(oRow.Material || "").trim() !== "" ||
              String(oRow.MaterialDescription || "").trim() !== "" ||
              String(oRow.DocumentNumber || "").trim() !== "" ||
              String(oRow.ItemNo || "").trim() !== "" ||
              iQtyIn > 0 ||
              iQtyOut > 0;
            if (bMeaningfulRow) {
              var sStatus = String(oRow.ReturnStatus || "").trim() || "Pending";
              mStatusCounts[sStatus] = (mStatusCounts[sStatus] || 0) + 1;
            }
          }.bind(this));

          var aStatusOrder = ["Pending", "Partial", "Returned", "Excess", "New Entry"];
          var aStatusSummary = aStatusOrder
            .filter(function (sKey) {
              return !!mStatusCounts[sKey];
            })
            .map(function (sKey) {
              var iCount = mStatusCounts[sKey];
              return sKey + " (" + iCount + " row" + (iCount === 1 ? "" : "s") + ")";
            });
          if (!aStatusSummary.length) {
            aStatusSummary = ["No entries"];
          }

          this._setTrackingItems(oTrackingModel, aRows);
          oTrackingModel.setProperty("/totalQtyOut", iTotalQtyOut);
          oTrackingModel.setProperty("/totalQtyIn", iTotalQty);
          oTrackingModel.setProperty("/totalDifference", iTotalDiff);
          oTrackingModel.setProperty("/totalReturnStatusSummary", aStatusSummary.join(", "));
          this._scheduleBinTrackingExcessWarning();
        },

        _deriveTrackingStatus: function (iQtyIn, iQtyOut, iDiff, sFallbackStatus, bIsManual) {
          if (bIsManual === true) {
            return "New Entry";
          }
          if (isNaN(iQtyIn) || isNaN(iQtyOut)) {
            return "Pending";
          }
          if (iQtyIn === 0 && iQtyOut > 0) {
            return "Pending";
          }
          if (iQtyIn === iQtyOut) {
            return "Returned";
          }
          if (iQtyIn > iQtyOut || (!isNaN(iDiff) && iDiff < 0)) {
            return "Excess";
          }
          if (iQtyIn < iQtyOut) {
            return "Partial";
          }
          return String(sFallbackStatus || "Pending");
        },
        _escapeODataKey: function (s) {
          return String(s == null ? "" : s).trim().replace(/'/g, "''");
        },

        _getPartCodeShDescription: function (oRow) {
          oRow = oRow || {};
          return String(oRow.PartcodeDesc || oRow.PartCodeDesc || "").trim();
        },

        /**
         * Normalizes a PartCodeSH OData row or cached VH row for apply / compare.
         */
        _normalizePartCodeShRow: function (oRow) {
          oRow = oRow || {};
          return {
            PartCode: String(oRow.PartCode || "").trim(),
            PartcodeDesc: String(
              oRow.PartcodeDesc || oRow.PartCodeDesc || this._getPartCodeShDescription(oRow) || ""
            ).trim(),
            BinType: String(oRow.BinType || "").trim(),
            BinTypeDesc: String(oRow.BinTypeDesc || "").trim(),
          };
        },

        _applyPartCodeShToTrackingRow: function (sPath, oMatch) {
          var oTM = this.getView().getModel("binTrolleyTracking");
          if (!oTM || !sPath || !oMatch) {
            return;
          }
          var o = this._normalizePartCodeShRow(oMatch);
          oTM.setProperty(sPath + "/Material", o.PartCode);
          oTM.setProperty(sPath + "/MaterialDescription", o.PartcodeDesc);
          oTM.setProperty(sPath + "/BinType", o.BinType);
          oTM.setProperty(sPath + "/BinTypeDesc", o.BinTypeDesc);
          oTM.setProperty(sPath + "/BintypeDesc", o.BinTypeDesc);
        },

        _findLocalPartCodeShMatches: function (sPartCode) {
          var sKey = String(sPartCode || "").trim();
          if (!sKey || !this._oPartCodeVhJsonModel) {
            return [];
          }
          var aItems = this._oPartCodeVhJsonModel.getProperty("/items") || [];
          var sUp = sKey.toUpperCase();
          return aItems.filter(function (o) {
            return String((o && o.PartCode) || "")
              .trim()
              .toUpperCase() === sUp;
          });
        },

        /**
         * If several PartCodeSH rows share the same part code, only auto-apply when bin data agrees.
         * @returns {object|null|string} normalized row, null if none, "AMBIGUOUS" if conflicting bins
         */
        _pickConsensusPartCodeSh: function (aRawRows) {
          if (!aRawRows || !aRawRows.length) {
            return null;
          }
          var aNorm = aRawRows.map(this._normalizePartCodeShRow.bind(this));
          if (aNorm.length === 1) {
            return aNorm[0];
          }
          var o0 = aNorm[0];
          var bSameBin = aNorm.every(function (o) {
            return (
              String(o.BinType || "").trim() === String(o0.BinType || "").trim() &&
              String(o.BinTypeDesc || "").trim() === String(o0.BinTypeDesc || "").trim()
            );
          });
          return bSameBin ? o0 : "AMBIGUOUS";
        },

        /**
         * Resolves PartCode against cached VH data or OData PartCodeSH (EQ filter).
         */
        _resolvePartCodeShByPartCode: function (sPartCode, fnCallback) {
          var that = this;
          var sPart = String(sPartCode || "").trim();
          if (!sPart) {
            fnCallback(null);
            return;
          }
          var aLocal = this._findLocalPartCodeShMatches(sPart);
          if (aLocal.length) {
            fnCallback(this._pickConsensusPartCodeSh(aLocal));
            return;
          }
          var oModel = this.oModel;
          if (!oModel) {
            fnCallback(null);
            return;
          }
          oModel.read("/PartCodeSH", {
            filters: [
              new Filter("PartCode", sap.ui.model.FilterOperator.EQ, sPart),
            ],
            urlParameters: { $top: "20" },
            success: function (oData) {
              var aRows = (oData && oData.results) || [];
              var oPick = that._pickConsensusPartCodeSh(aRows);
              if (oPick || oPick === "AMBIGUOUS") {
                fnCallback(oPick);
                return;
              }
              // EQ returned no rows (e.g. case mismatch): try broad read + client match
              that._readPartCodeShBulkForTypedResolve(sPart, fnCallback);
            },
            error: function () {
              that._readPartCodeShBulkForTypedResolve(sPart, fnCallback);
            },
          });
        },

        /**
         * Loads PartCodeSH without $filter (for GW entities where PartCode is not filterable).
         */
        _readPartCodeShBulkForTypedResolve: function (sPartCode, fnCallback) {
          var that = this;
          var sPart = String(sPartCode || "").trim();
          var oModel = this.oModel;
          if (!oModel || !sPart) {
            fnCallback(null);
            return;
          }
          var sUp = sPart.toUpperCase();
          oModel.read("/PartCodeSH", {
            urlParameters: { $top: "2000" },
            success: function (oData) {
              var aRows = (oData && oData.results) || [];
              var aExact = aRows.filter(function (r) {
                return (
                  String((r && r.PartCode) || "")
                    .trim()
                    .toUpperCase() === sUp
                );
              });
              fnCallback(that._pickConsensusPartCodeSh(aExact));
            },
            error: function () {
              fnCallback(null);
            },
          });
        },

        /**
         * After blur/enter on Bin/Trolley Part Code: fill BinType/BinTypeDesc from PartCodeSH when unique.
         */
        onBinTrolleyPartCodeChange: function (oEvent) {
          var oInput = oEvent.getSource();
          var oCtx = oInput.getBindingContext("binTrolleyTracking");
          if (!oCtx) {
            return;
          }
          var oRow = oCtx.getObject();
          if (!oRow || !oRow.IsManual) {
            return;
          }
          var sPath = oCtx.getPath();
          var sPart = String(oEvent.getParameter("value") || "").trim();
          var oTM = this.getView().getModel("binTrolleyTracking");
          if (!oTM) {
            return;
          }
          if (!sPart) {
            oTM.setProperty(sPath + "/BinType", "");
            oTM.setProperty(sPath + "/BinTypeDesc", "");
            oTM.setProperty(sPath + "/BintypeDesc", "");
            oTM.setProperty(sPath + "/MaterialDescription", "");
            oTM.setProperty("/isPosted", false);
            this._recalculateTrackingTotals();
            this._persistTrackingRows();
            return;
          }
          var sRequested = sPart;
          var that = this;
          this._resolvePartCodeShByPartCode(sPart, function (oResolved) {
            var sCurrent = String(oTM.getProperty(sPath + "/Material") || "").trim();
            if (sCurrent !== sRequested) {
              return;
            }
            if (oResolved === "AMBIGUOUS") {
              MessageToast.show(
                "Multiple bin types for this part code. Use value help to pick a row."
              );
              return;
            }
            if (!oResolved) {
              MessageToast.show("Part code not found. Use value help or check the code.");
              return;
            }
            that._applyPartCodeShToTrackingRow(sPath, oResolved);
            oTM.setProperty("/isPosted", false);
            that._recalculateTrackingTotals();
            that._persistTrackingRows();
          });
        },

        onPartCodeValueHelpRequest: function (oEvent) {
          var oInput = oEvent.getSource();
          var oCtx = oInput.getBindingContext("binTrolleyTracking");
          if (!oCtx) {
            return;
          }
          this._sPartCodeVhRowPath = oCtx.getPath();
          this._openPartCodeSelectDialog();
        },

        /**
         * Loads / refreshes PartCodeSH into _oPartCodeVhJsonModel (shared by VH + type-ahead).
         */
        _readPartCodeShCatalogIntoJsonModel: function (fnSuccess, fnError) {
          var that = this;
          if (!this._oPartCodeVhJsonModel) {
            this._oPartCodeVhJsonModel = new JSONModel({ items: [] });
          }
          var oModel = this.oModel;
          if (!oModel) {
            if (fnError) {
              fnError();
            }
            return;
          }
          oModel.read("/PartCodeSH", {
            urlParameters: { $top: "2000" },
            success: function (oData) {
              var aRows = (oData && oData.results) || [];
              var aItems = aRows.map(function (r) {
                return that._normalizePartCodeShRow(r);
              });
              that._oPartCodeVhJsonModel.setProperty("/items", aItems);
              if (fnSuccess) {
                fnSuccess(aItems);
              }
            },
            error: function () {
              if (fnError) {
                fnError();
              }
            },
          });
        },

        _applyBinTrolleyPartCodeSuggestItems: function (sTerm) {
          var oSugg = this.getView().getModel("partCodeSuggest");
          if (!oSugg || !this._oPartCodeVhJsonModel) {
            return;
          }
          var aAll = this._oPartCodeVhJsonModel.getProperty("/items") || [];
          var sLower = String(sTerm || "").trim().toLowerCase();
          var aOut;
          if (!sLower) {
            aOut = aAll.slice(0, 30);
          } else {
            aOut = aAll
              .filter(function (o) {
                if (!o) {
                  return false;
                }
                return (
                  String(o.PartCode || "")
                    .toLowerCase()
                    .indexOf(sLower) >= 0 ||
                  String(o.PartcodeDesc || "")
                    .toLowerCase()
                    .indexOf(sLower) >= 0 ||
                  String(o.BinType || "")
                    .toLowerCase()
                    .indexOf(sLower) >= 0 ||
                  String(o.BinTypeDesc || "")
                    .toLowerCase()
                    .indexOf(sLower) >= 0
                );
              })
              .slice(0, 40);
          }
          oSugg.setProperty("/items", aOut);
        },

        onBinTrolleyPartCodeSuggest: function (oEvent) {
          var oInput = oEvent.getSource();
          var oCtx = oInput.getBindingContext("binTrolleyTracking");
          if (!oCtx || !oCtx.getObject() || !oCtx.getObject().IsManual) {
            return;
          }
          this._sPartCodeSuggestRowPath = oCtx.getPath();
          var sVal = (oEvent.getParameter("suggestValue") || "").trim();
          this._sPartCodeSuggestLatestTerm = sVal;
          if (this._iPartCodeSuggestTimer) {
            clearTimeout(this._iPartCodeSuggestTimer);
          }
          var that = this;
          this._iPartCodeSuggestTimer = setTimeout(function () {
            that._iPartCodeSuggestTimer = null;
            var sUse = that._sPartCodeSuggestLatestTerm;
            var oSugg = that.getView().getModel("partCodeSuggest");
            if (!oSugg) {
              return;
            }
            if (!sUse) {
              oSugg.setProperty("/items", []);
              return;
            }
            if (!that._oPartCodeVhJsonModel) {
              that._oPartCodeVhJsonModel = new JSONModel({ items: [] });
            }
            var aCatalog = that._oPartCodeVhJsonModel.getProperty("/items") || [];
            if (aCatalog.length) {
              that._applyBinTrolleyPartCodeSuggestItems(sUse);
              return;
            }
            that._readPartCodeShCatalogIntoJsonModel(
              function () {
                that._applyBinTrolleyPartCodeSuggestItems(
                  that._sPartCodeSuggestLatestTerm
                );
              },
              function () {
                oSugg.setProperty("/items", []);
              }
            );
          }, 250);
        },

        onBinTrolleyPartCodeSuggestionSelected: function (oEvent) {
          var oItem = oEvent.getParameter("selectedItem");
          var oInput = oEvent.getSource();
          var oBinCtx = oInput.getBindingContext("binTrolleyTracking");
          if (!oItem || !oBinCtx) {
            return;
          }
          var oRow = null;
          var oSuggCtx = oItem.getBindingContext("partCodeSuggest");
          if (oSuggCtx) {
            oRow = oSuggCtx.getObject();
          }
          if (!oRow) {
            var sKey = String(oItem.getKey() || "");
            var aItems =
              (this.getView().getModel("partCodeSuggest") &&
                this.getView().getModel("partCodeSuggest").getProperty("/items")) ||
              [];
            var iPipe = sKey.indexOf("|");
            var sCode = iPipe >= 0 ? sKey.slice(0, iPipe) : String(oItem.getText() || "").trim();
            var sBin = iPipe >= 0 ? sKey.slice(iPipe + 1) : "";
            oRow =
              aItems.find(function (o) {
                return (
                  String((o && o.PartCode) || "").trim() === sCode &&
                  (!sBin || String((o && o.BinType) || "").trim() === sBin)
                );
              }) || null;
          }
          if (!oRow) {
            return;
          }
          var sPath = oBinCtx.getPath();
          this._applyPartCodeShToTrackingRow(sPath, oRow);
          var oTM = this.getView().getModel("binTrolleyTracking");
          if (oTM) {
            oTM.setProperty("/isPosted", false);
          }
          this._recalculateTrackingTotals();
          this._persistTrackingRows();
        },

        _getPartCodeSelectDialog: function () {
          var that = this;
          if (!this._oPartCodeVhJsonModel) {
            this._oPartCodeVhJsonModel = new JSONModel({ items: [] });
          }
          if (!this._oPartCodeSelectDialog) {
            this._oPartCodeSelectDialog = new SelectDialog({
              title: "Select Part Code",
              search: this._onPartCodeVHSearch.bind(this),
              confirm: this._onPartCodeVHConfirm.bind(this),
              cancel: function () {
                that._sPartCodeVhRowPath = "";
              },
              multiSelect: false,
              growing: true,
              growingThreshold: 50
            });
            this._oPartCodeSelectDialog.setModel(this._oPartCodeVhJsonModel, "partCodeVH");
            this._oPartCodeSelectDialog.bindAggregation("items", {
              path: "partCodeVH>/items",
              template: new StandardListItem({
                title: "{partCodeVH>PartCode}",
                description: "{partCodeVH>PartcodeDesc}",
                type: "Active"
              })
            });
            this.getView().addDependent(this._oPartCodeSelectDialog);
          }
          return this._oPartCodeSelectDialog;
        },

        _openPartCodeSelectDialog: function () {
          var that = this;
          if (!this.oModel) {
            MessageToast.show("Service not available.");
            return;
          }
          var oDialog = this._getPartCodeSelectDialog();
          oDialog.setBusy(true);
          this._readPartCodeShCatalogIntoJsonModel(
            function () {
              var oBind = oDialog.getBinding("items");
              if (oBind) {
                oBind.filter([]);
              }
              oDialog.setBusy(false);
              oDialog.open();
            },
            function () {
              oDialog.setBusy(false);
              MessageToast.show("Could not load part codes.");
            }
          );
        },

        _onPartCodeVHSearch: function (oEvent) {
          var oSrc = oEvent.getSource();
          var oDialog = oSrc;
          while (oDialog && (!oDialog.isA || !oDialog.isA("sap.m.SelectDialog"))) {
            oDialog =
              typeof oDialog.getParent === "function" ? oDialog.getParent() : null;
          }
          if (!oDialog) {
            oDialog = this._oPartCodeSelectDialog;
          }
          if (!oDialog) {
            return;
          }
          var sVal = (
            oEvent.getParameter("value") ||
            oEvent.getParameter("newValue") ||
            ""
          )
            .trim()
            .toLowerCase();
          var oBind = oDialog.getBinding("items");
          if (!oBind) {
            return;
          }
          if (!sVal) {
            oBind.filter([]);
            return;
          }
          oBind.filter(
            new Filter({
              filters: [
                new Filter({
                  path: "PartCode",
                  test: function (v) {
                    return String(v || "")
                      .toLowerCase()
                      .indexOf(sVal) >= 0;
                  }
                }),
                new Filter({
                  path: "PartcodeDesc",
                  test: function (v) {
                    return String(v || "")
                      .toLowerCase()
                      .indexOf(sVal) >= 0;
                  }
                }),
                new Filter({
                  path: "BinType",
                  test: function (v) {
                    return String(v || "")
                      .toLowerCase()
                      .indexOf(sVal) >= 0;
                  }
                }),
                new Filter({
                  path: "BinTypeDesc",
                  test: function (v) {
                    return String(v || "")
                      .toLowerCase()
                      .indexOf(sVal) >= 0;
                  }
                })
              ],
              and: false
            })
          );
        },

        _onPartCodeVHConfirm: function (oEvent) {
          var aCtx = oEvent.getParameter("selectedContexts");
          var oSel = aCtx && aCtx[0] && aCtx[0].getObject();
          var sPath = this._sPartCodeVhRowPath;
          this._sPartCodeVhRowPath = "";
          if (!oSel || !sPath) {
            return;
          }
          var oTM = this.getView().getModel("binTrolleyTracking");
          if (!oTM) {
            return;
          }
          this._applyPartCodeShToTrackingRow(sPath, oSel);
          oTM.setProperty("/isPosted", false);
          this._recalculateTrackingTotals();
          this._persistTrackingRows();
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
        _getGateInEmptyBinsReadKeys: function () {
          var oRefModel = sap.ui.getCore().getModel("refDocModel");
          var aMaterials = (oRefModel && oRefModel.getProperty("/filteredMaterialDetails")) || [];
          if (!aMaterials.length) {
            aMaterials = (oRefModel && oRefModel.getProperty("/materialDetails")) || [];
          }
          return (aMaterials || [])
            .map(function (oRow) {
              var iQtyOut = this._coerceWholeBinQty(
                oRow.Quantity !== undefined && oRow.Quantity !== null
                  ? oRow.Quantity
                  : oRow.qty
              );
              return {
                DocumentNumber: String(oRow.refDocNo || oRow.RefDocNo || "").trim(),
                ItemNo: String(oRow.refDocItemNo || oRow.RefDocItemNo || "").trim(),
                Material: String(
                  oRow.Material ||
                  oRow.MaterialCode ||
                  oRow.materialCode ||
                  oRow.material ||
                  oRow.MaterialNo ||
                  oRow.PartCode ||
                  ""
                ).trim(),
                MaterialDescription: String(
                  oRow.MaterialDescription ||
                  oRow.materialDescription ||
                  oRow.Description ||
                  oRow.MaterialDesc ||
                  oRow.PartcodeDesc ||
                  ""
                ).trim(),
                Customer: String(
                  oRow.Customer ||
                  oRow.CustomerCode ||
                  oRow.customerCode ||
                  oRow.customer ||
                  oRow.CustNo ||
                  ""
                ).trim(),
                CustomerName: String(
                  oRow.CustomerName ||
                  oRow.customerName ||
                  oRow.CusromerName ||
                  oRow.CustName ||
                  ""
                ).trim(),
                QtyOut: iQtyOut
              };
            }.bind(this))
            .filter(function (oKey) {
              return !!oKey.DocumentNumber && !!oKey.ItemNo;
            })
            .filter(function (oKey, i, aAll) {
              return aAll.findIndex(function (k) {
                return (
                  k.DocumentNumber === oKey.DocumentNumber &&
                  k.ItemNo === oKey.ItemNo
                );
              }) === i;
            });
        },
        /**
         * Builds Bin/Trolley grid rows from reference-document material keys only (no EmptyBins OData reads).
         */
        _buildGateInBinRowsFromMaterialKeys: function (sTripNumber, fnKeyFilter) {
          var aKeys = this._getGateInEmptyBinsReadKeys();
          if (typeof fnKeyFilter === "function") {
            aKeys = (aKeys || []).filter(fnKeyFilter);
          }
          return (aKeys || []).map(function (oKey) {
            var iQtyIn = 0;
            var iQtyOut = this._coerceWholeBinQty(oKey.QtyOut);
            var iDiff = iQtyOut - iQtyIn;
            return {
              TripNumber: String(sTripNumber || "").trim(),
              DocumentNumber: String(oKey.DocumentNumber || "").trim(),
              ItemNo: String(oKey.ItemNo || "").trim(),
              Customer: String(oKey.Customer || "").trim(),
              CusromerName: String(oKey.CustomerName || "").trim(),
              Material: String(oKey.Material || "").trim(),
              MaterialDescription: String(oKey.MaterialDescription || "").trim(),
              BinType: "",
              BinTypeDesc: "",
              QtyIn: iQtyIn,
              QtyOut: iQtyOut,
              Difference: iDiff,
              ReturnStatus: this._deriveTrackingStatus(iQtyIn, iQtyOut, iDiff, "Pending", false),
              IsManual: false
            };
          }.bind(this));
        },
        _loadGateInBinsByKeys: function (sTripNumber, sDocumentNumber, aItemNos) {
          var oModel = this.oModel;
          var oTrackingModel = this.getView().getModel("binTrolleyTracking");
          if (!oModel || !oTrackingModel) {
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
          var fnNormalizeItemNo = function (sItemNo) {
            var s = String(sItemNo || "").trim();
            if (!s) {
              return "";
            }
            s = s.replace(/^0+/, "");
            return s || "0";
          };
          var aNormalizedItemNos = aUniqueItemNos
            .map(fnNormalizeItemNo)
            .filter(function (s) {
              return !!s;
            })
            .filter(function (s, i, a) {
              return a.indexOf(s) === i;
            });
          // Fetch by TripNumber only (backend can return multiple docs/items; UI can filter locally).
          var aFilters = [
            new sap.ui.model.Filter("TripNumber", sap.ui.model.FilterOperator.EQ, sTripNumber)
          ];
          var sTargetDoc = String(sDocumentNumber || "").trim();
          return new Promise(function (resolve) {
            oModel.read("/EmptyBins", {
              filters: aFilters,
              urlParameters: { $format: "json" },
              success: function (oData) {
                var aRows = (oData && oData.results) || [];
                var aDocRows = aRows;
                if (sTargetDoc) {
                  aDocRows = (aDocRows || []).filter(function (r) {
                    return String(r.DocumentNumber || "").trim() === sTargetDoc;
                  });
                }
                if (aUniqueItemNos.length) {
                  aDocRows = (aRows || []).filter(function (r) {
                    var sRaw = String(r.ItemNo || "").trim();
                    var sNorm = fnNormalizeItemNo(sRaw);
                    return (
                      aUniqueItemNos.indexOf(sRaw) >= 0 ||
                      aNormalizedItemNos.indexOf(sNorm) >= 0
                    );
                  });
                }
                var aMappedRows = (aDocRows || []).map(function (r) {
                  var iQtyOut = this._coerceWholeBinQty(r.QtyOut);
                  var iQtyIn = this._coerceWholeBinQty(r.QtyIn);
                  var iDiff = iQtyOut - iQtyIn;
                  return {
                    TripNumber: r.TripNumber || sTripNumber,
                    DocumentNumber: r.DocumentNumber || "",
                    ItemNo: r.ItemNo || "",
                    Customer: r.Customer || "",
                    CusromerName: r.CusromerName || r.CustomerName || "",
                    Material: r.Material || "",
                    MaterialDescription: String(
                      r.MaterialDescription || r.PartcodeDesc || r.PartCodeDesc || r.MaterialDesc || ""
                    ).trim(),
                    BinType: r.BinType || r.BinTypes || r.BinTypeDesc || r.BintypeDesc || r.BinTypeDescription || "",
                    BinTypeDesc: r.BinTypeDesc || r.BintypeDesc || r.BinTypeDescription || r.BinType || r.BinTypes || "",
                    BintypeDesc: r.BinTypeDesc || r.BintypeDesc || r.BinTypeDescription || r.BinType || r.BinTypes || "",
                    QtyIn: iQtyIn,
                    QtyOut: iQtyOut,
                    Difference: iDiff,
                    ReturnStatus: this._deriveTrackingStatus(iQtyIn, iQtyOut, iDiff, "Pending", false),
                    IsManual: false
                  };
                }.bind(this));
                var mBackendByKey = {};
                (aMappedRows || []).forEach(function (oRow) {
                  var sKey =
                    fnNormalizeItemNo(String(oRow.DocumentNumber || "").trim()) +
                    "|" +
                    fnNormalizeItemNo(String(oRow.ItemNo || "").trim());
                  if (sKey !== "|") {
                    mBackendByKey[sKey] = oRow;
                  }
                });
                var aCurrentRows = this._getTrackingItems(oTrackingModel);
                var aMergedRows = (aCurrentRows || []).map(function (oRow) {
                  if (oRow.IsManual === true) {
                    return oRow;
                  }
                  var sKey =
                    fnNormalizeItemNo(String(oRow.DocumentNumber || "").trim()) +
                    "|" +
                    fnNormalizeItemNo(String(oRow.ItemNo || "").trim());
                  var oBackendRow = mBackendByKey[sKey];
                  if (!oBackendRow) {
                    return oRow;
                  }
                  return Object.assign({}, oRow, oBackendRow, { IsManual: false });
                });
                (aMappedRows || []).forEach(function (oBackendRow) {
                  var sKey =
                    fnNormalizeItemNo(String(oBackendRow.DocumentNumber || "").trim()) +
                    "|" +
                    fnNormalizeItemNo(String(oBackendRow.ItemNo || "").trim());
                  var bExists = (aMergedRows || []).some(function (oRow) {
                    var sRowKey =
                      fnNormalizeItemNo(String(oRow.DocumentNumber || "").trim()) +
                      "|" +
                      fnNormalizeItemNo(String(oRow.ItemNo || "").trim());
                    return sRowKey === sKey;
                  });
                  if (!bExists) {
                    aMergedRows.push(oBackendRow);
                  }
                });
                this._setTrackingItems(
                  oTrackingModel,
                  this._mergeWithPersistedRows(sTripNumber, aMergedRows)
                );
                oTrackingModel.setProperty("/isPosted", true);
                this._recalculateTrackingTotals();
                resolve();
              }.bind(this),
              error: function () {
                resolve();
              }
            });
          }.bind(this));
        },
        _refreshGateInBinsForSelectedDocument: function (sDocNumber) {
          var sTripNumber = String(this._getTripNumber() || "").trim();
          var oTrackingModel = this.getView().getModel("binTrolleyTracking");
          if (!oTrackingModel) {
            return;
          }
          if (!sTripNumber) {
            this._requestBinTrolleyReload(0);
            return;
          }
          var sTargetDoc = String(sDocNumber || "").trim();
          var aKeys = this._getGateInEmptyBinsReadKeys();
          var fnDocFilter = null;
          if (sTargetDoc) {
            fnDocFilter = function (oKey) {
              return String(oKey.DocumentNumber || "").trim() === sTargetDoc;
            };
          }
          var aUiRows = this._buildGateInBinRowsFromMaterialKeys(sTripNumber, fnDocFilter);
          this._setTrackingItems(
            oTrackingModel,
            this._mergeWithPersistedRows(sTripNumber, aUiRows)
          );
          oTrackingModel.setProperty("/isPosted", true);
          this._recalculateTrackingTotals();
          if (!sTargetDoc) {
            var aDocs = (aKeys || [])
              .map(function (oKey) {
                return String(oKey.DocumentNumber || "").trim();
              })
              .filter(function (sDoc, i, aAll) {
                return !!sDoc && aAll.indexOf(sDoc) === i;
              });
            if (aDocs.length === 1) {
              sTargetDoc = aDocs[0];
            }
          }
          if (!sTargetDoc) {
            return;
          }
          var aItemNos = (aUiRows || [])
            .map(function (oKey) {
              return String(oKey.ItemNo || "").trim();
            });
          if (!aItemNos.length) {
            return;
          }
          this._loadGateInBinsByKeys(sTripNumber, sTargetDoc, aItemNos);
        },
        _loadBinTrolleyTrackingData: function () {
          var oTrackingModel = this.getView().getModel("binTrolleyTracking");
          var sTripNumber = String(this._getTripNumber() || "").trim();
          this._iGateInBinLoadSeq = (this._iGateInBinLoadSeq || 0) + 1;
          var iRequestSeq = this._iGateInBinLoadSeq;
          if (!oTrackingModel || !this.oModel) {
            return;
          }
          if (
            this._iGateInBinSaveSuppressReloadUntil &&
            Date.now() < this._iGateInBinSaveSuppressReloadUntil
          ) {
            return;
          }
          // Keep backend reads aligned with Bin/Trolley applicability.
          // If panel is not applicable/visible, skip EmptyBins service calls.
          this._updateBinTrolleyVisibility();
          var oUi = this.getView().getModel("ui");
          var bShowBinTrolley = !!(oUi && oUi.getProperty("/showBinTrolleyTracking"));
          if (!bShowBinTrolley) {
            this._setTrackingItems(
              oTrackingModel,
              this._mergeWithPersistedRows(sTripNumber, [])
            );
            oTrackingModel.setProperty("/isPosted", true);
            this._recalculateTrackingTotals();
            return;
          }
          if (!sTripNumber) {
            this._setTrackingItems(oTrackingModel, this._mergeWithPersistedRows(sTripNumber, []));
            oTrackingModel.setProperty("/isPosted", true);
            this._recalculateTrackingTotals();
            return;
          }
          if (iRequestSeq !== this._iGateInBinLoadSeq) {
            return;
          }
          this._refreshGateInBinsForSelectedDocument();
        },
        _getTrackingStorageKey: function (sTripNumber) {
          return "binTracking_gateIn_" + String(sTripNumber || "").trim();
        },
        _loadPersistedTrackingRows: function (sTripNumber) {
          try {
            var sRaw = localStorage.getItem(this._getTrackingStorageKey(sTripNumber));
            var aRows = sRaw ? JSON.parse(sRaw) : [];
            return Array.isArray(aRows) ? aRows : [];
          } catch (e) {
            return [];
          }
        },
        _persistTrackingRows: function () {
          var sTripNumber = String(this._getTripNumber() || "").trim();
          if (!sTripNumber) {
            return;
          }
          var oTrackingModel = this.getView().getModel("binTrolleyTracking");
          var aRows = this._getTrackingItems(oTrackingModel);
          try {
            localStorage.setItem(this._getTrackingStorageKey(sTripNumber), JSON.stringify(aRows));
          } catch (e) {
            // Ignore local persistence failures.
          }
        },
        _prunePersistedTrackingRowsByRefDocs: function () {
          var sTripNumber = String(this._getTripNumber() || "").trim();
          if (!sTripNumber) {
            return;
          }
          var aPersisted = this._loadPersistedTrackingRows(sTripNumber);
          if (!Array.isArray(aPersisted) || !aPersisted.length) {
            return;
          }
          var oRefModel = sap.ui.getCore().getModel("refDocModel");
          var aMaterials = (oRefModel && oRefModel.getProperty("/filteredMaterialDetails")) || [];
          if (!aMaterials.length) {
            aMaterials = (oRefModel && oRefModel.getProperty("/materialDetails")) || [];
          }
          var mAllowed = {};
          (aMaterials || []).forEach(function (oRow) {
            var sDoc = String(oRow.refDocNo || "").trim();
            var sItem = String(oRow.refDocItemNo || "").trim();
            if (sDoc && sItem) {
              mAllowed[sDoc + "|" + sItem] = true;
            }
          });
          var aFiltered = (aPersisted || []).filter(function (oRow) {
            var sDoc = String((oRow && oRow.DocumentNumber) || "").trim();
            var sItem = String((oRow && oRow.ItemNo) || "").trim();
            if (!sDoc && !sItem) {
              return true;
            }
            return !!mAllowed[sDoc + "|" + sItem];
          });
          try {
            localStorage.setItem(this._getTrackingStorageKey(sTripNumber), JSON.stringify(aFiltered));
          } catch (e) {
            // Ignore local persistence failures.
          }
        },
        _mergeWithPersistedRows: function (sTripNumber, aBackendRows) {
          var aPersisted = this._loadPersistedTrackingRows(sTripNumber);
          var mPersistedByKey = {};
          var aManualRows = [];
          (aPersisted || []).forEach(function (oRow) {
            var bManual = oRow && oRow.IsManual === true;
            if (bManual) {
              aManualRows.push(oRow);
              return;
            }
            var sKey =
              String(oRow.TripNumber || "").trim() + "|" +
              String(oRow.DocumentNumber || "").trim() + "|" +
              String(oRow.ItemNo || "").trim() + "|" +
              String(oRow.BinType || oRow.BinTypes || oRow.BinTypeDesc || oRow.BintypeDesc || oRow.BinTypeDescription || "").trim();
            if (sKey !== "||") {
              mPersistedByKey[sKey] = oRow;
            }
          });

          var aMergedBackend = (aBackendRows || []).map(function (oRow) {
            var sKey =
              String(oRow.TripNumber || "").trim() + "|" +
              String(oRow.DocumentNumber || "").trim() + "|" +
              String(oRow.ItemNo || "").trim() + "|" +
              String(oRow.BinType || oRow.BinTypes || oRow.BinTypeDesc || oRow.BintypeDesc || oRow.BinTypeDescription || "").trim();
            var oStored = mPersistedByKey[sKey];
            if (!oStored) {
              return oRow;
            }
            var iQtyIn = this._coerceWholeBinQty(oStored.QtyIn);
            var iQtyOut = this._coerceWholeBinQty(oRow.QtyOut);
            var iDiff = iQtyOut - iQtyIn;
            return {
              TripNumber: oRow.TripNumber,
              DocumentNumber: oRow.DocumentNumber,
              ItemNo: oRow.ItemNo,
              Customer: oRow.Customer,
              CusromerName: oRow.CusromerName,
              Material: oRow.Material,
              MaterialDescription: String(
                oRow.MaterialDescription || oStored.MaterialDescription || ""
              ).trim(),
              BinType: oRow.BinType || oRow.BinTypes || oRow.BinTypeDesc || oRow.BintypeDesc || oRow.BinTypeDescription || "",
              BinTypeDesc: oRow.BinTypeDesc || oRow.BintypeDesc || oRow.BinTypeDescription || oRow.BinType || oRow.BinTypes || "",
              BintypeDesc: oRow.BinTypeDesc || oRow.BintypeDesc || oRow.BinTypeDescription || oRow.BinType || oRow.BinTypes || "",
              QtyIn: iQtyIn,
              QtyOut: iQtyOut,
              Difference: iDiff,
              ReturnStatus: this._deriveTrackingStatus(iQtyIn, iQtyOut, iDiff, "Pending", false),
              IsManual: false
            };
          }.bind(this));

          var mSeenManual = {};
          var aUniqueManual = aManualRows.filter(function (oRow) {
            var sManualId = String(oRow.LocalId || "").trim();
            if (!sManualId) {
              sManualId =
                String(oRow.TripNumber || "").trim() + "|" +
                String(oRow.DocumentNumber || "").trim() + "|" +
                String(oRow.ItemNo || "").trim() + "|" +
                String(oRow.BinType || oRow.BinTypes || oRow.BinTypeDesc || oRow.BintypeDesc || oRow.BinTypeDescription || "").trim() + "|" +
                String(oRow.Material || "").trim();
            }
            if (mSeenManual[sManualId]) {
              return false;
            }
            mSeenManual[sManualId] = true;
            return true;
          });
          var mBackendCanon = {};
          (aMergedBackend || []).forEach(function (oRow) {
            var sK = this._binTrackingRowCanonicalKey(oRow);
            if (sK && sK !== "||") {
              mBackendCanon[sK] = true;
            }
          }.bind(this));
          var aUniqueManualNotOnBackend = aUniqueManual.filter(function (oRow) {
            var sK = this._binTrackingRowCanonicalKey(oRow);
            if (!sK || sK === "||") {
              return true;
            }
            return !mBackendCanon[sK];
          }.bind(this));
          var aMerged = aMergedBackend.concat(
            aUniqueManualNotOnBackend.map(function (oRow) {
              var iQtyIn = this._coerceWholeBinQty(oRow.QtyIn);
              var iQtyOut = this._coerceWholeBinQty(oRow.QtyOut);
              var iDiff = iQtyIn;
              return {
                LocalId: String(oRow.LocalId || this._createManualRowId()),
                TripNumber: String(oRow.TripNumber || sTripNumber || "").trim(),
                DocumentNumber: String(oRow.DocumentNumber || ""),
                ItemNo: String(oRow.ItemNo || ""),
                Customer: String(oRow.Customer || ""),
                CusromerName: String(oRow.CusromerName || oRow.CustomerName || ""),
                Material: String(oRow.Material || ""),
                MaterialDescription: String(oRow.MaterialDescription || "").trim(),
                BinType: String(oRow.BinType || oRow.BinTypes || oRow.BinTypeDesc || oRow.BintypeDesc || oRow.BinTypeDescription || ""),
                BinTypeDesc: String(oRow.BinTypeDesc || oRow.BintypeDesc || oRow.BinTypeDescription || oRow.BinType || oRow.BinTypes || ""),
                BintypeDesc: String(oRow.BinTypeDesc || oRow.BintypeDesc || oRow.BinTypeDescription || oRow.BinType || oRow.BinTypes || ""),
                QtyIn: iQtyIn,
                QtyOut: iQtyOut,
                Difference: iDiff,
                ReturnStatus: "New Entry",
                IsManual: true
              };
            }.bind(this))
          );
          return aMerged.length ? aMerged : [this._getEmptyTrackingRow()];
        },

        onSaveTrackingRows: function () {
          var iScrollY = (typeof window !== "undefined" && typeof window.scrollY === "number")
            ? window.scrollY
            : null;
          var oTrackingModel = this.getView().getModel("binTrolleyTracking");
          if (!oTrackingModel) {
            MessageBox.error("Tracking model is not available.");
            return;
          }
          var sTripNumber = String(this._getTripNumber() || "").trim();
          if (!sTripNumber) {
            MessageBox.error("Trip number is missing.");
            return;
          }
          var aRows = this._getTrackingItems(oTrackingModel);
          var aRowsToSave = aRows.filter(function (oRow) {
            return (
              String(oRow.Material || "").trim() !== "" ||
              String(oRow.QtyIn || "").trim() !== ""
            );
          });
          if (!aRowsToSave.length) {
            MessageToast.show("No Bin/Trolley rows to save.");
            return;
          }
          var aRowsForBackend = this._buildTrackingRowsForBackend(sTripNumber);
          if (!aRowsForBackend.length) {
            MessageToast.show("No valid Bin/Trolley rows to save.");
            return;
          }
          this._saveEmptyBinsViaTripDetails(sTripNumber, aRowsForBackend)
            .then(function () {
              this._persistTrackingRows();
              oTrackingModel.setProperty("/isPosted", true);
              // Do not call _loadBinTrolleyTrackingData() here — it causes a second
              // rebuild + fetch and duplicate rows. _saveEmptyBinsViaTripDetails
              // already refreshes via fnMergeSaveResponseToUi and the post-save read.
              MessageBox.success("Bin / Trolley tracking saved for Trip " + sTripNumber + ".");
              if (iScrollY !== null) {
                setTimeout(function () {
                  window.scrollTo(0, iScrollY);
                }, 0);
              }
            }.bind(this))
            .catch(function (oError) {
              var sErrorMessage = "Failed to save Bin / Trolley tracking.";
              try {
                if (oError && oError.responseText) {
                  var oErr = JSON.parse(oError.responseText);
                  if (oErr.error && oErr.error.message && oErr.error.message.value) {
                    sErrorMessage = oErr.error.message.value;
                  }
                }
              } catch (e) {
                // Ignore parse failure
              }
              MessageBox.error(sErrorMessage);
              if (iScrollY !== null) {
                setTimeout(function () {
                  window.scrollTo(0, iScrollY);
                }, 0);
              }
            });
        },
        
        _initGateInAttachmentsModel: function () {
          if (!this._oGateInAttachmentsModel) {
            this._oGateInAttachmentsModel = new JSONModel({ attachments: [] });
            this.getView().setModel(this._oGateInAttachmentsModel, "gateInAttachmentsModel");
          }
        },
        onAfterRendering: function () {
          // Keep data refresh on every render, but run heavy one-time init only once.
          if (!this._bGateInAfterRenderInitialized) {
            this.loadDelayReason();
            this._applyGateInTabDefaultPanelExpansion();
            this._bGateInAfterRenderInitialized = true;
          }
          this._requestBinTrolleyReload(0);
          this._updateBinTrolleyVisibility();
          this._updatePanelVisibility();
          
          if (this._bGateInReadOnlyAfterSave) {
            this._setInputsEnabled(false);
          } else {
            this._setInputsEnabled(true);
          }
          
          // Removed: this._loadGateInAttachments(); - will be loaded via event subscription when TripData is available
        },
        onExit: function () {
          if (this._iGateInRefDocReloadTimer) {
            clearTimeout(this._iGateInRefDocReloadTimer);
            this._iGateInRefDocReloadTimer = null;
          }
          if (this._iBinSyncReloadTimer) {
            clearTimeout(this._iBinSyncReloadTimer);
            this._iBinSyncReloadTimer = null;
          }
          if (this._iGateInBinReloadTimer) {
            clearTimeout(this._iGateInBinReloadTimer);
            this._iGateInBinReloadTimer = null;
          }
          this._eventBus?.unsubscribe("TripData", "Updated", this._onTripDataUpdate, this);
          this._eventBus?.unsubscribe("RefDoc", "MaterialsUpdated", this._onRefDocMaterialsUpdated, this);
          this._eventBus?.unsubscribe("Stage", "ClearAllTabs", this._clearAllData, this);
          if (this._oPartCodeSelectDialog) {
            this._oPartCodeSelectDialog.destroy();
            this._oPartCodeSelectDialog = null;
          }
          this._oPartCodeVhJsonModel = null;
        },
        _requestBinTrolleyReload: function (iDelay) {
          var iWait = typeof iDelay === "number" ? iDelay : 0;
          if (this._iGateInBinReloadTimer) {
            clearTimeout(this._iGateInBinReloadTimer);
            this._iGateInBinReloadTimer = null;
          }
          this._iGateInBinReloadTimer = setTimeout(function () {
            var sTrip = String(this._getTripNumber() || "").trim();
            var iNow = Date.now();
            // Skip burst reloads for same trip occurring within a short interval.
            if (
              sTrip &&
              this._sLastGateInBinReloadTrip === sTrip &&
              iNow - (this._iLastGateInBinReloadAt || 0) < 250
            ) {
              return;
            }
            this._sLastGateInBinReloadTrip = sTrip;
            this._iLastGateInBinReloadAt = iNow;
            this._loadBinTrolleyTrackingData();
          }.bind(this), iWait);
        },
        _onRefDocMaterialsUpdated: function () {
          // Ref doc/material changes affect derived bin rows; refresh from material keys.
          this._prunePersistedTrackingRowsByRefDocs();
          if (this._iGateInRefDocReloadTimer) {
            clearTimeout(this._iGateInRefDocReloadTimer);
          }
          // Wait for refDocModel filtered list updates, then reload.
          this._iGateInRefDocReloadTimer = setTimeout(function () {
            this._refreshGateInBinsForSelectedDocument();
          }.bind(this), 0);
        },
        
        _clearAllData: function () {
          this._bGateInEditMode = false;
          this._bGateInReadOnlyAfterSave = false;
          this._sGateInReadOnlyTripNumber = "";
          this._sLastGateInTripForGateList = "";
          this._sLastGateInBinReloadTrip = "";
          this._iLastGateInBinReloadAt = 0;
          this._iGateInBinSaveSuppressReloadUntil = 0;
          // Clear attachments model
          if (this._oGateInAttachmentsModel) {
            this._oGateInAttachmentsModel.setData({ attachments: [] });
          }
          
          // Clear selected files
          this._aSelectedFiles = [];

          var oTrackingModel = this.getView().getModel("binTrolleyTracking");
          if (oTrackingModel) {
            var aInitialRows = [this._getEmptyTrackingRow()];
            oTrackingModel.setData({
              rows: aInitialRows,
              items: aInitialRows,
              totalQtyOut: 0,
              totalQtyIn: 0,
              totalDifference: 0,
              totalReturnStatusSummary: "No entries",
              isPosted: true
            });
          }
          
          // Clear any file uploaders
          var oFileUploader = this.byId("idGateInFileUploader");
          if (oFileUploader) {
            oFileUploader.clear();
          }
          
          if (this._oEntryGateSelectModel) {
            this._oEntryGateSelectModel.setProperty("/SelectedProduct2", "");
            this._oEntryGateSelectModel.setProperty("/ProductCollection2", []);
          }

          if (this._oDelayReasonSelectModel) {
            this._oDelayReasonSelectModel.setProperty("/SelectedDelayKey", "");
            this._oDelayReasonSelectModel.setProperty("/DelayReasonCollection", []);
          }

          // Clear input fields by resetting TripData properties if model exists
          var oTripData = this.getView().getModel("TripData");
          if (oTripData) {
            oTripData.setProperty("/EntryGateNum", "");
            oTripData.setProperty("/EntryTime", "");
            oTripData.setProperty("/DelayReason", "");
            oTripData.setProperty("/DelayReasonDesc", "");
            oTripData.setProperty("/WeighmentRequired", "N");
            oTripData.setProperty("/RefDocSkip", " ");
            oTripData.setProperty("/GrossWeight", "");
            oTripData.setProperty("/TareWeight", "");
            oTripData.setProperty("/NetWeight", "");
          }

          this.loadDelayReason();
          this._updateBinTrolleyVisibility();
          this._updatePanelVisibility();
        },
        _onTripDataUpdate: function () {
          var oTripData = sap.ui.getCore().getModel("TripData");
          this._updatePanelVisibility();
          this._updateBinTrolleyVisibility();
          if (oTripData) {
            var rawTrip = String(oTripData.getProperty("/TripNumber") || "").trim();
            var sTripNow = /^\d+$/.test(rawTrip) ? rawTrip.padStart(10, "0") : rawTrip;
            var sLock = this._sGateInReadOnlyTripNumber;
            if (sLock && sTripNow) {
              var sLockNorm = /^\d+$/.test(sLock) ? String(sLock).trim().padStart(10, "0") : String(sLock).trim();
              if (sLockNorm !== sTripNow) {
                this._bGateInReadOnlyAfterSave = false;
                this._sGateInReadOnlyTripNumber = "";
              }
            }
            var oRefDocModel = sap.ui.getCore().getModel("refDocModel");
            if (oRefDocModel) {
              this.getView().setModel(oRefDocModel, "refDocModel");
            }
            // Map Weighment_Req (boolean) from backend to WeighmentRequired ("Y"/"N") for frontend
            var vWeighmentReq = oTripData.getProperty("/Weighment_Req");
            if (vWeighmentReq !== undefined && vWeighmentReq !== null) {
              // Convert boolean to "Y"/"N" format for frontend
              var sWeighmentRequired = (vWeighmentReq === true || vWeighmentReq === "X") ? "Y" : "N";
              oTripData.setProperty("/WeighmentRequired", sWeighmentRequired);
            }
            // TripDetails RefDocSkip: single-char flag; normalize for radio (Yes = skip)
            var vRefSkip = oTripData.getProperty("/RefDocSkip");
            if (vRefSkip === undefined || vRefSkip === null || vRefSkip === "") {
              oTripData.setProperty("/RefDocSkip", " ");
            }
            // Map EntryGateNumber to EntryGateNum if backend returns different property name
            var sEntryGate = oTripData.getProperty("/EntryGateNumber");
            var sEntryGateNum = oTripData.getProperty("/EntryGateNum");
            if (sEntryGate && (!sEntryGateNum || (typeof sEntryGateNum === "string" && sEntryGateNum.trim() === ""))) {
              oTripData.setProperty("/EntryGateNum", sEntryGate);
            }
            
            this.getView().setModel(oTripData, "TripData");
            // Reload trip-dependent dropdown data after TripData changes.
            if (sTripNow && this._sLastGateInTripForGateList !== sTripNow) {
              this._sLastGateInTripForGateList = sTripNow;
              this.loadGateNumber();
            }
            this._syncEntryGateSelectionFromTripData();
            this._syncDelayReasonSelectionFromTripData();
            this._refreshGateSelectKeysFromModels();
            this._requestBinTrolleyReload(0);
            if (this._bGateInReadOnlyAfterSave) {
              this._setInputsEnabled(false);
            } else {
              this._setInputsEnabled(true);
            }
          }
        },
        _getTripNumber: function () {
          var oGlobalModel = sap.ui.getCore().getModel("globalData");
          var sTripNumber = "";
          if (oGlobalModel) {
            sTripNumber = oGlobalModel.getProperty("/TripNumber") || "";
          }
          if (!sTripNumber) {
            var oTripDataModel = this.getView().getModel("TripData");
            if (oTripDataModel) {
              sTripNumber = oTripDataModel.getProperty("/TripNumber") || "";
            }
          }
          if (!sTripNumber) {
            var oCoreTripDataModel = sap.ui.getCore().getModel("TripData");
            if (oCoreTripDataModel) {
              sTripNumber = oCoreTripDataModel.getProperty("/TripNumber") || "";
            }
          }
          return sTripNumber;
        },

        /**
         * Builds OData $filter for /ConfigValues: ConfigGroup eq {group} and optionally TripNumber eq {trip}.
         * Entry gate list matches YIGP_PLMS_SRV (e.g. EntryGate plus current trip number).
         */
        _getConfigValuesFilters: function (sConfigGroup, sTripNumber) {
          var aFilters = [
            new sap.ui.model.Filter(
              "ConfigGroup",
              sap.ui.model.FilterOperator.EQ,
              sConfigGroup
            ),
          ];
          var sTrip = sTripNumber != null ? String(sTripNumber).trim() : "";
          if (/^\d+$/.test(sTrip)) {
            sTrip = sTrip.padStart(10, "0");
          }
          if (sTrip) {
            aFilters.push(
              new sap.ui.model.Filter(
                "TripNumber",
                sap.ui.model.FilterOperator.EQ,
                sTrip
              )
            );
          }
          return aFilters;
        },

        _populateEntryGateSelect: function (aProducts, iRetry) {
          iRetry = iRetry || 0;
          var oSelect = this.getView().byId("idEntryGateNumber");
          if (!oSelect) {
            if (aProducts && aProducts.length && iRetry < 2) {
              var that = this;
              setTimeout(function () {
                that._populateEntryGateSelect(aProducts, iRetry + 1);
              }, 100);
            }
            return;
          }
          oSelect.destroyItems();
          (aProducts || []).forEach(function (p) {
            oSelect.addItem(
              new sap.ui.core.Item({
                key: String(p.ProductId),
                text: p.Name || String(p.ProductId),
              })
            );
          });
          if (aProducts && aProducts.length && oSelect.getItems().length === 0 && iRetry < 1) {
            var that2 = this;
            setTimeout(function () {
              that2._populateEntryGateSelect(aProducts, iRetry + 1);
            }, 100);
          }
          if (aProducts && aProducts.length) {
            var sSelectedGate = String(
              (this._oEntryGateSelectModel && this._oEntryGateSelectModel.getProperty("/SelectedProduct2")) || ""
            ).trim();
            if (!sSelectedGate) {
              var sFirstGate = String(aProducts[0].ProductId || "").trim();
              if (sFirstGate) {
                this._oEntryGateSelectModel.setProperty("/SelectedProduct2", sFirstGate);
                oSelect.setSelectedKey(sFirstGate);
              }
            }
          }
        },

        _populateDelayReasonSelect: function (aItems) {
          var oSelect = this.getView().byId("idDelayReasons");
          if (!oSelect) {
            return;
          }
          oSelect.destroyItems();
          (aItems || []).forEach(function (p) {
            oSelect.addItem(
              new sap.ui.core.Item({
                key: String(p.ProductId),
                text: p.Name || String(p.ProductId),
              })
            );
          });
        },

        _refreshGateSelectKeysFromModels: function () {
          if (!this._oEntryGateSelectModel || !this._oDelayReasonSelectModel) {
            return;
          }
          var sGateKey = this._oEntryGateSelectModel.getProperty("/SelectedProduct2") || "";
          var sDelayKey = this._oDelayReasonSelectModel.getProperty("/SelectedDelayKey") || "";
          var oGateSel = this.getView().byId("idEntryGateNumber");
          var oDelaySel = this.getView().byId("idDelayReasons");
          if (oGateSel) {
            oGateSel.setSelectedKey(sGateKey);
          }
          if (oDelaySel) {
            oDelaySel.setSelectedKey(sDelayKey);
          }
        },

        loadDelayReason: function () {
          var aFilters = this._getConfigValuesFilters("Delayed_Reasons");

          this.oModel.read("/ConfigValues", {
            filters: aFilters,
            success: function (oData) {
              this._delayReasonData = oData.results;
              // ConfigID = DelayReasons param; Description = dropdown label (no default selection)
              var aItems = (oData.results || []).map(function (r) {
                var sDesc = r.Description != null ? String(r.Description).trim() : "";
                return {
                  ProductId: r.ConfigID,
                  Name: sDesc || r.ConfigID,
                };
              });
              this._oDelayReasonSelectModel.setProperty("/DelayReasonCollection", aItems);
              var that = this;
              setTimeout(function () {
                that._populateDelayReasonSelect(aItems);
                that._syncDelayReasonSelectionFromTripData();
                var sDelayKey =
                  that._oDelayReasonSelectModel.getProperty("/SelectedDelayKey") || "";
                var oDelaySel = that.getView().byId("idDelayReasons");
                if (oDelaySel) {
                  oDelaySel.setSelectedKey(sDelayKey);
                }
              }, 0);
              this.loadGateNumber();
            }.bind(this),
            error: function () {
              sap.m.MessageBox.error("Failed to load delay reasons.");
              this.loadGateNumber();
            }.bind(this),
          });
        },

        _syncDelayReasonSelectionFromTripData: function () {
          if (!this._oDelayReasonSelectModel) {
            return;
          }
          var oTripData = sap.ui.getCore().getModel("TripData");
          var aItems = this._oDelayReasonSelectModel.getProperty("/DelayReasonCollection") || [];
          var sCode = "";
          if (oTripData) {
            sCode =
              (oTripData.getProperty("/DelayReason") ||
                oTripData.getProperty("/DelayReasons") ||
                oTripData.getProperty("/Delay_Reason") ||
                oTripData.getProperty("/DelayedReason") ||
                oTripData.getProperty("/DelayReasonCode") ||
                "") + "";
            sCode = sCode.trim();
          }
          var fnNormKey = function (v) {
            var s = v == null ? "" : String(v);
            s = s.trim().replace(/\s+/g, " ");
            if (/^\d+$/.test(s)) {
              // Normalize purely-numeric keys to avoid leading-zero mismatches
              s = s.replace(/^0+/, "") || "0";
            }
            return s;
          };

          if (sCode) {
            // Resolve to the actual ProductId from the collection (handles leading zeros / spacing)
            var sCodeNorm = fnNormKey(sCode);
            var oFound =
              aItems.find(function (i) {
                return String(i.ProductId).trim() === String(sCode).trim();
              }) ||
              aItems.find(function (i) {
                return fnNormKey(i.ProductId) === sCodeNorm;
              });

            if (oFound) {
              this._oDelayReasonSelectModel.setProperty("/SelectedDelayKey", String(oFound.ProductId));
              if (oTripData && String(oTripData.getProperty("/DelayReason") || "").trim() !== String(oFound.ProductId).trim()) {
                oTripData.setProperty("/DelayReason", String(oFound.ProductId));
              }
            } else {
              this._oDelayReasonSelectModel.setProperty("/SelectedDelayKey", "");
            }
            return;
          }
          if (oTripData) {
            var sDescRaw = (
              oTripData.getProperty("/DelayReasonDesc") ||
              oTripData.getProperty("/DelayReasonsDesc") ||
              oTripData.getProperty("/Delay_Reason_Desc") ||
              oTripData.getProperty("/DelayedReasonDesc") ||
              oTripData.getProperty("/DelayReasonText") ||
              ""
            ).trim();
            if (sDescRaw) {
              var oMatch = aItems.find(function (i) {
                if (i.Name === sDescRaw) {
                  return true;
                }
                return i.Name + " - " + i.ProductId === sDescRaw;
              });
              if (oMatch) {
                this._oDelayReasonSelectModel.setProperty("/SelectedDelayKey", oMatch.ProductId);
                oTripData.setProperty("/DelayReason", oMatch.ProductId);
                return;
              }
            }
          }
          this._oDelayReasonSelectModel.setProperty("/SelectedDelayKey", "");
        },

        onDelayReasonSelectChange: function () {
          var oSelect = this.getView().byId("idDelayReasons");
          var sKey = oSelect ? oSelect.getSelectedKey() : "";
          var oTripData = sap.ui.getCore().getModel("TripData");
          if (!oTripData) {
            return;
          }
          if (sKey) {
            var aItems = this._oDelayReasonSelectModel.getProperty("/DelayReasonCollection") || [];
            var oRow = aItems.find(function (i) {
              return String(i.ProductId) === String(sKey);
            });
            oTripData.setProperty("/DelayReason", sKey);
            oTripData.setProperty("/DelayReasonDesc", oRow ? oRow.Name : "");
          } else {
            oTripData.setProperty("/DelayReason", "");
            oTripData.setProperty("/DelayReasonDesc", "");
          }
        },

        loadGateNumber: function () {
          var sTripNumber = String(this._getTripNumber() || "").trim();
          var aFilters = this._getConfigValuesFilters("EntryGate", sTripNumber);

          this.oModel.read("/ConfigValues", {
            filters: aFilters,
            success: function (oData) {
              this._entryGateData = oData.results;
              // ConfigID = value for GateIn/EntryGateNumber; Description = dropdown label
              var aProducts = (oData.results || []).map(function (r) {
                var sDesc = r.Description != null ? String(r.Description).trim() : "";
                return {
                  ProductId: r.ConfigID,
                  Name: sDesc || r.ConfigID,
                };
              });
              this._oEntryGateSelectModel.setProperty("/ProductCollection2", aProducts);
              var that = this;
              setTimeout(function () {
                that._populateEntryGateSelect(aProducts);
                that._syncEntryGateSelectionFromTripData();
                var sGateKey =
                  that._oEntryGateSelectModel.getProperty("/SelectedProduct2") || "";
                var oGateSel = that.getView().byId("idEntryGateNumber");
                if (oGateSel) {
                  oGateSel.setSelectedKey(sGateKey);
                }
              }, 0);
            }.bind(this),
            error: function () {
              sap.m.MessageBox.error("Failed to load entry gates.");
            },
          });
        },

        _syncEntryGateSelectionFromTripData: function () {
          if (!this._oEntryGateSelectModel) {
            return;
          }
          var oTripData = sap.ui.getCore().getModel("TripData");
          var aProducts = this._oEntryGateSelectModel.getProperty("/ProductCollection2") || [];
          var sExisting = "";
          if (oTripData) {
            sExisting =
              (oTripData.getProperty("/EntryGateNum") ||
                oTripData.getProperty("/EntryGateNumber") ||
                "") + "";
            sExisting = sExisting.trim();
          }

          var fnResolveConfigId = function (sKey) {
            if (!sKey || !aProducts.length) {
              return null;
            }
            var sNorm = String(sKey).trim();
            var i;
            for (i = 0; i < aProducts.length; i++) {
              if (String(aProducts[i].ProductId).trim() === sNorm) {
                return aProducts[i].ProductId;
              }
            }
            var sNormSp = sNorm.replace(/\s+/g, " ");
            for (i = 0; i < aProducts.length; i++) {
              if (
                String(aProducts[i].ProductId)
                  .trim()
                  .replace(/\s+/g, " ") === sNormSp
              ) {
                return aProducts[i].ProductId;
              }
            }
            return null;
          };

          if (sExisting) {
            var sResolved = fnResolveConfigId(sExisting);
            if (sResolved != null) {
              this._oEntryGateSelectModel.setProperty("/SelectedProduct2", String(sResolved));
              if (oTripData && String(oTripData.getProperty("/EntryGateNum") || "").trim() !== String(sResolved).trim()) {
                oTripData.setProperty("/EntryGateNum", sResolved);
              }
            } else if (aProducts.length > 0) {
              var sFirst = aProducts[0].ProductId;
              this._oEntryGateSelectModel.setProperty("/SelectedProduct2", sFirst);
              if (oTripData) {
                oTripData.setProperty("/EntryGateNum", sFirst);
              }
            } else {
              this._oEntryGateSelectModel.setProperty("/SelectedProduct2", "");
            }
          } else if (aProducts.length > 0) {
            var sFirst2 = aProducts[0].ProductId;
            this._oEntryGateSelectModel.setProperty("/SelectedProduct2", sFirst2);
            if (oTripData) {
              oTripData.setProperty("/EntryGateNum", sFirst2);
            }
          } else {
            this._oEntryGateSelectModel.setProperty("/SelectedProduct2", "");
          }
        },

        onEntryGateSelectChange: function () {
          var oSelect = this.getView().byId("idEntryGateNumber");
          var sKey = oSelect ? oSelect.getSelectedKey() : "";
          var oTripData = sap.ui.getCore().getModel("TripData");
          if (oTripData && sKey) {
            oTripData.setProperty("/EntryGateNum", sKey);
          }
        },
        onSaveGateInInfo: function () {
          var oTripData = sap.ui.getCore().getModel("TripData");
          var bIsFirstTime = false;
          if (oTripData) {
            var sExistingEntryGateNum = oTripData.getProperty("/EntryGateNum") ||
              oTripData.getProperty("/EntryGateNumber") || "";
            bIsFirstTime = !sExistingEntryGateNum || (typeof sExistingEntryGateNum === "string" && sExistingEntryGateNum.trim() === "");
          } else {
            bIsFirstTime = true;
          }
          
          // Use the ODataModel created in onInit()
          
          var oModel = this.oModel;

          if (!oModel) {
            MessageBox.error("OData model is not loaded.");
            return;
          }

          var sGatePassNo = String(this._getTripNumber() || "").trim();
          if (!sGatePassNo) {
            MessageBox.error(
              "Gate Pass No has not been generated. Save Vehicle Reporting first to generate a Gate Pass No before Gate In."
            );
            return;
          }

          var oTrackingSaveCheck = this.getView().getModel("binTrolleyTracking");
          var aTrackingRows = this._getTrackingItems(oTrackingSaveCheck);
          var aTrackingRowsValid = aTrackingRows.filter(function (oRow) {
            return (
              String(oRow.DocumentNumber || "").trim() !== "" &&
              String(oRow.ItemNo || "").trim() !== ""
            );
          });
          var bGateInBinPanelVisible =
            this.getView().getModel("ui") &&
            this.getView().getModel("ui").getProperty("/showBinTrolleyTracking");
          if (bGateInBinPanelVisible && aTrackingRowsValid.length) {
            var aRowsForAutoSave = this._buildTrackingRowsForBackend(sGatePassNo);
            if (!aRowsForAutoSave.length) {
              MessageBox.error(
                "Bin / Trolley rows are incomplete. Maintain Document and Item before Gate In save."
              );
              return;
            }
          }

          var oView = this.getView();

          var oEntryGateSelect = oView.byId("idEntryGateNumber");
          var sEntryGateNumber =
            (oEntryGateSelect && oEntryGateSelect.getSelectedKey && oEntryGateSelect.getSelectedKey()) || "";
          if (!sEntryGateNumber && this._oEntryGateSelectModel) {
            sEntryGateNumber = this._oEntryGateSelectModel.getProperty("/SelectedProduct2") || "";
          }
          if (!sEntryGateNumber) {
            var oCoreTripData = sap.ui.getCore().getModel("TripData");
            if (oCoreTripData) {
              sEntryGateNumber = oCoreTripData.getProperty("/EntryGateNum") ||
                oCoreTripData.getProperty("/EntryGateNumber") || "";
            }
          }
          sEntryGateNumber = String(sEntryGateNumber || "").trim();
          if (!sEntryGateNumber) {
            MessageBox.error("Please select Entry Gate Number before saving Gate In.");
            return;
          }
          // var sDelayReasons = oView.byId("idDelayReasons").getValue();
          var sRemarks = oView.byId("idGateInRemarks").getValue() || "";
          
          // Get weighment required value
          var oWeighmentRadioGroup = oView.byId("idWeighmentRequired");
          var sWeighmentRequired = "N"; // Default to No
          var bWeighmentRequired = false; // Default to false (boolean)
          if (oWeighmentRadioGroup) {
            var iSelectedIndex = oWeighmentRadioGroup.getSelectedIndex();
            sWeighmentRequired = iSelectedIndex === 0 ? "Y" : "N";
            bWeighmentRequired = iSelectedIndex === 0; // Direct boolean assignment
          }

          var oSkipDocGroup = oView.byId("idSkipDocument");
          var sRefDocSkip = " ";
          if (oSkipDocGroup) {
            sRefDocSkip = oSkipDocGroup.getSelectedIndex() === 0 ? "X" : " ";
          }

          var sTripNumber = sGatePassNo;

          // Format TripNumber to 10 digits with leading zeros (e.g., '0000000099')
          if (sTripNumber) {
            sTripNumber = String(sTripNumber).padStart(10, "0");
          }
          
          var oDelayReasonSelect = oView.byId("idDelayReasons");
          var sDelayReasons =
            (oDelayReasonSelect && oDelayReasonSelect.getSelectedKey && oDelayReasonSelect.getSelectedKey()) || "";
          
          // Update TripData model with weighment required value
          var oTripData = sap.ui.getCore().getModel("TripData");
          if (oTripData) {
            oTripData.setProperty("/WeighmentRequired", sWeighmentRequired);
            oTripData.setProperty("/RefDocSkip", sRefDocSkip);
            // Publish event so Loading controller can react
            this._eventBus.publish("TripData", "WeighmentRequiredChanged", {
              weighmentRequired: sWeighmentRequired
            });
          }

          // Determine if this is first time (create) or update
          // Check if EntryGateNum/EntryGateNumber already exists in TripData
          var bIsFirstTime = false;
          if (oTripData) {
            var sExistingEntryGateNum = oTripData.getProperty("/EntryGateNum") ||
              oTripData.getProperty("/EntryGateNumber") || "";
            // If EntryGateNum is empty, null, or undefined, it's the first time (create)
            bIsFirstTime = !sExistingEntryGateNum || (typeof sExistingEntryGateNum === "string" && sExistingEntryGateNum.trim() === "");
          } else {
            // If TripData doesn't exist, assume it's first time
            bIsFirstTime = true;
          }

          // Modified flag: false for create (first time), true for update
          var bModified = !bIsFirstTime;

          var fnCallGateIn = function () {
            oModel.callFunction("/GateIn", {
              method: "POST",
              urlParameters: {
                TripNumber: sTripNumber,
                EntryGateNumber: sEntryGateNumber,
                Modified: bModified,
                Remarks: sRemarks || "",
                DelayReasons: sDelayReasons,
                Weighment_Req: bWeighmentRequired,
                RefdocSkip: sRefDocSkip,
              },
              headers: {
                "X-Requested-With": "X",
              },
              success: function (oData, oResponse) {
                var sMessage = bIsFirstTime
                  ? "Gate In completed successfully for Trip " + sTripNumber + "."
                  : "Gate In completed successfully for Trip " + sTripNumber + ".";

                var sTripForLock = String(sTripNumber || "").trim();
                this._bGateInReadOnlyAfterSave = true;
                this._sGateInReadOnlyTripNumber = sTripForLock;
                this._bGateInEditMode = false;

                // Reload complete TripData from backend (use padded sTripNumber from outer scope)
                if (sTripNumber) {
                  this._reloadTripDataAfterSave(sTripNumber, sEntryGateNumber, sDelayReasons);
                } else {
                  // Fallback: just update the property if no trip number
                  var oTripData = sap.ui.getCore().getModel("TripData");
                  if (oTripData) {
                    oTripData.setProperty("/EntryGateNum", sEntryGateNumber);
                    oTripData.setProperty("/RefDocSkip", sRefDocSkip);
                    this._eventBus.publish("TripData", "Updated");
                  }
                }
                this._eventBus.publish("Stage", "TripCreated", {
                  tripNumber: sTripNumber,
                  preferredTabKey: "gateIn"
                });

                this._setInputsEnabled(false);

                // Upload attachments if any files were selected
                if (this._aSelectedFiles && this._aSelectedFiles.length > 0) {
                  this._uploadGateInAttachments(function (bSuccess) {
                    if (bSuccess) {
                      MessageBox.success(sMessage + " Attachments uploaded successfully!", {
                        onClose: function () {
                          this._refreshHomeTripTableAfterGateSave();
                        }.bind(this),
                      });
                    } else {
                      MessageBox.success(sMessage, {
                        onClose: function () {
                          MessageBox.warning("Some attachments failed to upload.", {
                            onClose: function () {
                              this._refreshHomeTripTableAfterGateSave();
                            }.bind(this),
                          });
                        }.bind(this),
                      });
                    }
                    this._setInputsEnabled(false);
                    this._loadGateInAttachments(true);
                  }.bind(this));
                } else {
                  MessageBox.success(sMessage, {
                    onClose: function () {
                      this._refreshHomeTripTableAfterGateSave();
                    }.bind(this),
                  });
                }
              }.bind(this),
              error: function (oError) {
                this.getView().setBusy(false);

                var sMessage = "Failed to Gate In"; // default message

                try {
                  // oError.responseText is JSON string from backend
                  var oResponse = JSON.parse(oError.responseText);
                  if (
                    oResponse.error &&
                    oResponse.error.message &&
                    oResponse.error.message.value
                  ) {
                    sMessage = oResponse.error.message.value;
                  }
                } catch (e) {
                  // fallback if parsing fails, try oError.message.value
                  if (oError.message && oError.message.value) {
                    sMessage = oError.message.value;
                  }
                }

                MessageBox.error(sMessage);
              }.bind(this),
            });
          }.bind(this);

          // Save bins before Gate In when needed; skip if bin save just ran (avoids duplicate POST).
          var bSkipBinDuplicatePost =
            this._iGateInBinSaveSuppressReloadUntil &&
            Date.now() < this._iGateInBinSaveSuppressReloadUntil;
          var bNeedsBinAutoSave = !!(
            bGateInBinPanelVisible &&
            aTrackingRowsValid.length &&
            !bSkipBinDuplicatePost
          );

          if (!bNeedsBinAutoSave) {
            fnCallGateIn();
            return;
          }

          var aRowsForBackend = this._buildTrackingRowsForBackend(sGatePassNo);
          this._saveEmptyBinsViaTripDetails(sGatePassNo, aRowsForBackend)
            .then(function () {
              this._persistTrackingRows();
              if (oTrackingSaveCheck) {
                oTrackingSaveCheck.setProperty("/isPosted", true);
              }
              fnCallGateIn();
            }.bind(this))
            .catch(function (oError) {
              var sErrorMessage = "Failed to save Bin / Trolley tracking.";
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
                // Ignore parse failure
              }
              MessageBox.error(sErrorMessage);
            });
        },
        formatTripDate: function (vDate) {
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
        formatTripTime: function (vTime) {
          if (vTime == null) {
            return "";
          }
          var iMs = NaN;
          if (typeof vTime === "object" && typeof vTime.ms === "number") {
            iMs = vTime.ms;
          } else if (typeof vTime === "number") {
            iMs = vTime;
          } else if (typeof vTime === "string") {
            var oMatch = vTime.match(/PT(\d+)H(\d+)M(\d+)S/);
            if (oMatch) {
              iMs =
                ((parseInt(oMatch[1], 10) || 0) * 3600 +
                  (parseInt(oMatch[2], 10) || 0) * 60 +
                  (parseInt(oMatch[3], 10) || 0)) *
                1000;
            }
          }
          if (isNaN(iMs)) {
            return "";
          }
          var iHours = Math.floor(iMs / 3600000);
          var iMinutes = Math.floor((iMs % 3600000) / 60000);
          var iSeconds = Math.floor((iMs % 60000) / 1000);
          return (
            String(iHours).padStart(2, "0") +
            ":" +
            String(iMinutes).padStart(2, "0") +
            ":" +
            String(iSeconds).padStart(2, "0")
          );
        },
        formatWeighmentRequiredIndex: function (sValue) {
          // Convert "Y"/"N" to radio button index (0 = Yes, 1 = No)
          if (sValue === "Y" || sValue === "Yes") {
            return 0;
          }
          return 1; // Default to "No"
        },
        onWeighmentRequiredChange: function (oEvent) {
          var iSelectedIndex = oEvent.getParameter("selectedIndex");
          var sValue = iSelectedIndex === 0 ? "Y" : "N";
          
          var oTripData = sap.ui.getCore().getModel("TripData");
          if (oTripData) {
            oTripData.setProperty("/WeighmentRequired", sValue);
            // Publish event so Loading controller can react
            this._eventBus.publish("TripData", "WeighmentRequiredChanged", {
              weighmentRequired: sValue
            });
          }
        },
        formatRefDocSkipIndex: function (v) {
          if (v === "X" || v === "Y" || v === "1" || v === true) {
            return 0;
          }
          return 1;
        },
        onRefDocSkipChange: function (oEvent) {
          // Keep UI interaction smooth: defer TripData mutation until Save.
          // Save flow already reads the radio selection directly from the control.
        },
        onEditGateInInfo: function () {
          var bTripLocked = !!(sap.ui.getCore().getModel("globalData")?.getProperty("/TripLocked"));
          if (bTripLocked) {
            MessageToast.show("Trip is completed. Editing is disabled.");
            this._setInputsEnabled(false);
            return;
          }
          this._bGateInReadOnlyAfterSave = false;
          this._sGateInReadOnlyTripNumber = "";
          this._bGateInEditMode = true;
          this._setInputsEnabled(true);
          MessageToast.show("Edit mode activated");
        },
        _setInputsEnabled: function (bEnabled) {
          try {
            var bTripLocked = !!(sap.ui.getCore().getModel("globalData")?.getProperty("/TripLocked"));
            var bEffectiveEnabled = !!bEnabled && !bTripLocked;
            var oPanel = this.getView().byId("gateInInfoPanel");
            if (!oPanel) return;
            
            // Check if vehicle is reported yet
            var oTripData = sap.ui.getCore().getModel("TripData");
            var bVehicleReported = false;
            if (oTripData) {
              var sVehicleNumber = oTripData.getProperty("/VehicleNumber");
              bVehicleReported = sVehicleNumber && sVehicleNumber.trim() !== "";
            }
            
            // Find all aggregated controls in the panel
            var aChildren = oPanel.findAggregatedObjects(true); // deep search
            
            var that = this;
            aChildren.forEach(function(ctrl) {
              var sCtrlId = ctrl.getId();
              
              // Ignore Edit/Save buttons (they are handled separately)
              if (sCtrlId && (sCtrlId.indexOf("btnEditGateInInfo") !== -1 || 
                              sCtrlId.indexOf("btnSaveGateInInfo") !== -1)) {
                return;
              }
              
              // Keep controls enabled if vehicle is not reported
              if (!bVehicleReported && sCtrlId && !bTripLocked) {
                if (ctrl.setEditable) {
                  ctrl.setEditable(true);
                } else if (ctrl.setEnabled) {
                  ctrl.setEnabled(true);
                }
                return;
              }
              
              // Ignore other buttons
              if (ctrl.isA && ctrl.isA("sap.m.Button")) return;
              
              // Try setEditable first (for Input, TextArea, etc.)
              if (ctrl.setEditable) {
                try {
                  ctrl.setEditable(bEffectiveEnabled);
                } catch (e) {
                  // Fallback to setEnabled if setEditable fails
                  if (ctrl.setEnabled) {
                    ctrl.setEnabled(bEffectiveEnabled);
                  }
                }
              } else if (ctrl.setEnabled) {
                // For controls that only support setEnabled (like RadioButtonGroup)
                try {
                  ctrl.setEnabled(bEffectiveEnabled);
                } catch (e) {
                  // Ignore errors
                }
              }
            });
            
            if (this._oEntryGateSelectModel) {
              var bGateEditable = !bTripLocked && (!bVehicleReported ? true : bEffectiveEnabled);
              this._oEntryGateSelectModel.setProperty("/Enabled", bGateEditable);
              this._oEntryGateSelectModel.setProperty("/Editable", bGateEditable);
            }

            if (this._oDelayReasonSelectModel) {
              var bDelayEditable = !bTripLocked && (!bVehicleReported ? true : bEffectiveEnabled);
              this._oDelayReasonSelectModel.setProperty("/Enabled", bDelayEditable);
              this._oDelayReasonSelectModel.setProperty("/Editable", bDelayEditable);
            }

            // Ensure Edit/Save buttons remain enabled
            if (this.getView().byId("btnEditGateInInfo")) {
              this.getView().byId("btnEditGateInInfo").setEnabled(true);
            }
            if (this.getView().byId("btnSaveGateInInfo")) {
              this.getView().byId("btnSaveGateInInfo").setEnabled(true);
            }
          } catch (e) {
            // Don't break if something unexpected happens
          }
        },
        onGateInAttachmentChange: function (oEvent) {
          var oFileUploader = oEvent.getSource();
          
          // Get files from the native file input element
          var oDomRef = oFileUploader.getDomRef();
          var oFileInput = oDomRef ? oDomRef.querySelector("input[type='file']") : null;
          
          if (!oFileInput || !oFileInput.files || oFileInput.files.length === 0) {
            this._aSelectedFiles = [];
            // Disable preview button
            var oPreviewBtn = this.getView().byId("idPreviewSelectedGateInFiles");
            if (oPreviewBtn) {
              oPreviewBtn.setEnabled(false);
            }
            return;
          }
          
          // Store selected files
          this._aSelectedFiles = Array.from(oFileInput.files);
          
          // Enable preview button
          var oPreviewBtn = this.getView().byId("idPreviewSelectedGateInFiles");
          if (oPreviewBtn) {
            oPreviewBtn.setEnabled(true);
          }
        },
        onPreviewSelectedGateInFiles: function () {
          if (!this._aSelectedFiles || this._aSelectedFiles.length === 0) {
            MessageToast.show("Please select files first");
            return;
          }
          
          // Show preview for first file (or create a list to preview all)
          var oFile = this._aSelectedFiles[0];
          var sFileName = oFile.name;
          var sContentType = oFile.type || "application/octet-stream";
          
          // Read file as base64 for preview
          var oReader = new FileReader();
          oReader.onload = function (oEvent) {
            var sBase64Content = oEvent.target.result;
            // Remove data URL prefix
            var sBase64Data = sBase64Content.split(",")[1] || sBase64Content;
            
            // Create a temporary attachment object for preview
            var oTempAttachment = {
              fileName: sFileName,
              contentType: sContentType
            };
            
            // Show preview dialog
            this._showGateInPreviewDialog(oTempAttachment, sBase64Data, true);
          }.bind(this);
          
          oReader.onerror = function () {
            MessageToast.show("Failed to read file for preview");
          }.bind(this);
          
          oReader.readAsDataURL(oFile);
        },
        _uploadGateInAttachments: function (fnCallback) {
          if (!this._aSelectedFiles || this._aSelectedFiles.length === 0) {
            return;
          }

          var oGlobalModel = sap.ui.getCore().getModel("globalData");
          var sTripNumber = oGlobalModel?.getProperty("/TripNumber") || "";

          if (!sTripNumber) {
            MessageToast.show("Please open a trip first");
            return;
          }

          // Show busy indicator
          this.getView().setBusy(true);

          // Process each file
          var iTotalFiles = this._aSelectedFiles.length;
          var iProcessedFiles = 0;
          var iSuccessCount = 0;
          var iErrorCount = 0;

          var that = this;

          this._aSelectedFiles.forEach(function (oFile) {
            var sFileName = oFile.name;
            var sContentType = oFile.type || "application/octet-stream";

            // Read file as base64
            var oReader = new FileReader();
            oReader.onload = function (oEvent) {
              var sBase64Content = oEvent.target.result;
              // Remove data URL prefix (e.g., "data:image/jpeg;base64,")
              var sBase64Data = sBase64Content.split(",")[1] || sBase64Content;

              that._saveGateInAttachment(sTripNumber, sFileName, sContentType, sBase64Data, function (bSuccess) {
                iProcessedFiles++;
                if (bSuccess) {
                  iSuccessCount++;
                } else {
                  iErrorCount++;
                }

                // Check if all files are processed
                if (iProcessedFiles === iTotalFiles) {
                  that.getView().setBusy(false);
                  
                  // Clear file uploader
                  var oFileUploader = that.getView().byId("idGateInAttachments");
                  if (oFileUploader) {
                    oFileUploader.clear();
                  }
                  that._aSelectedFiles = [];
                  
                  // Disable preview button
                  var oPreviewBtn = that.getView().byId("idPreviewSelectedGateInFiles");
                  if (oPreviewBtn) {
                    oPreviewBtn.setEnabled(false);
                  }

                  // Call callback with success status
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
                MessageToast.show("Failed to read some files");
              }
            };

            oReader.readAsDataURL(oFile);
          });
        },
        _saveGateInAttachment: function (sTripNumber, sFileName, sContentType, sBase64Data, fnCallback) {
          var oService = this.oModel;
          
          // Function to generate slug from a string (e.g., trip number)
          function generateSlug(inputString) {
            return inputString
              .toLowerCase()  // Convert to lowercase
              .replace(/\s+/g, '-')  // Replace spaces with hyphens
              .replace(/[^\w\-]+/g, '')  // Remove non-alphanumeric characters
              .replace(/--+/g, '-')  // Replace multiple hyphens with a single one
              .trim();  // Remove leading and trailing spaces
          }
          
          // Generate a slug from the trip number
          var slug = generateSlug(sTripNumber);
          
          // Extract file extension from original filename or content type
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
          
          // Create filename with slug and stage prefix
          var sSlugFileName = "GateIn_" + sBaseFileName + "_" + slug + "." + sFileExtension;
          
          var oPayload = {
            TripNumber: sTripNumber,
            FileName: sSlugFileName,
            ContentType: sContentType,
            Content: sBase64Data
          };

          var that = this;

          // Try to create first (if exists, will get error and we'll update)
          oService.create("/Attachments", oPayload, {
            headers: {
              "X-Requested-With": "X",
              "X-Driver-Slug": slug  // Send the slug in the header
            },
            success: function () {
              if (fnCallback) {
                fnCallback(true);
              }
            },
            error: function (oError) {
              // If creation fails (entity exists), try update
              if (oError.statusCode === 409 || oError.statusCode === 400) {
                that._updateGateInAttachment(sTripNumber, sSlugFileName, sContentType, sBase64Data, fnCallback);
              } else {
                if (fnCallback) {
                  fnCallback(false);
                }
                // Upload error
              }
            }
          });
        },
        _updateGateInAttachment: function (sTripNumber, sFileName, sContentType, sBase64Data, fnCallback) {
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
        _loadGateInAttachments: function (bForce) {
          // Ensure attachments model is initialized
          if (!this._oGateInAttachmentsModel) {
            this._initGateInAttachmentsModel();
          }

          var oGlobalModel = sap.ui.getCore().getModel("globalData");
          var sTripNumber = oGlobalModel?.getProperty("/TripNumber") || "";

          if (!sTripNumber) {
            this._oGateInAttachmentsModel.setProperty("/attachments", []);
            this._sGateInAttachmentsTripLoading = "";
            return;
          }
          if (!bForce && this._sGateInAttachmentsTripLoading === sTripNumber) {
            return;
          }
          if (
            !bForce &&
            this._sGateInAttachmentsLastLoadedTrip === sTripNumber &&
            Date.now() - (this._iGateInAttachmentsLastLoadedAt || 0) < 1000
          ) {
            return;
          }
          this._sGateInAttachmentsTripLoading = sTripNumber;

          var oService = this.oModel;
          // Try to read as collection first
          oService.read("/Attachments", {
            filters: [
              new sap.ui.model.Filter("TripNumber", sap.ui.model.FilterOperator.EQ, sTripNumber)
            ],
            success: function (oData) {
              var aAttachments = [];
              if (oData && oData.results && Array.isArray(oData.results)) {
                // Filter for GateIn attachments
                oData.results.forEach(function(oAttachment) {
                  if (oAttachment.FileName && oAttachment.FileName.startsWith("GateIn_")) {
                    aAttachments.push({
                      tripNumber: oAttachment.TripNumber || sTripNumber,
                      fileName: oAttachment.FileName || "",
                      contentType: oAttachment.ContentType || ""
                    });
                  }
                });
              } else if (oData && oData.FileName && oData.FileName.startsWith("GateIn_")) {
                // Single entity response
                aAttachments.push({
                  tripNumber: oData.TripNumber || sTripNumber,
                  fileName: oData.FileName || "",
                  contentType: oData.ContentType || ""
                });
              }
              this._oGateInAttachmentsModel.setProperty("/attachments", aAttachments);
              this._sGateInAttachmentsLastLoadedTrip = sTripNumber;
              this._iGateInAttachmentsLastLoadedAt = Date.now();
              this._sGateInAttachmentsTripLoading = "";
            }.bind(this),
            error: function (oError) {
              // Try reading by key if collection read fails
              oService.read("/Attachments('" + sTripNumber + "')", {
                success: function (oData) {
                  var aAttachments = [];
                  if (oData && oData.FileName && oData.FileName.startsWith("GateIn_")) {
                    aAttachments.push({
                      tripNumber: oData.TripNumber || sTripNumber,
                      fileName: oData.FileName || "",
                      contentType: oData.ContentType || ""
                    });
                  }
                  this._oGateInAttachmentsModel.setProperty("/attachments", aAttachments);
                  this._sGateInAttachmentsLastLoadedTrip = sTripNumber;
                  this._iGateInAttachmentsLastLoadedAt = Date.now();
                  this._sGateInAttachmentsTripLoading = "";
                }.bind(this),
                error: function () {
                  this._oGateInAttachmentsModel.setProperty("/attachments", []);
                  this._sGateInAttachmentsTripLoading = "";
                }.bind(this)
              });
            }.bind(this)
          });
        },
        onPreviewGateInAttachment: function (oEvent) {
          var oSource = oEvent.getSource();
          var oListItem = oSource.getParent();
          
          // Try to find the CustomListItem parent
          var oParent = oSource.getParent();
          while (oParent) {
            if (oParent.getBindingContext && oParent.getBindingContext("gateInAttachmentsModel")) {
              oListItem = oParent;
              break;
            }
            oParent = oParent.getParent ? oParent.getParent() : null;
          }
          
          if (oListItem) {
            var oContext = oListItem.getBindingContext("gateInAttachmentsModel");
            if (oContext) {
              var oAttachment = oContext.getObject();
              this._previewGateInAttachment(oAttachment);
              return;
            }
          }
          
          MessageToast.show("Unable to load attachment");
        },
        _previewGateInAttachment: function (oAttachment) {
          var sTripNumber = oAttachment.tripNumber || sap.ui.getCore().getModel("globalData")?.getProperty("/TripNumber") || "";

          if (!sTripNumber) {
            MessageToast.show("Trip number not found");
            return;
          }

          var oService = this.oModel;
          // Try reading as collection first
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
                this._showGateInPreviewDialog(oAttachment, oAttachmentData.Content, false);
              } else {
                // Try reading by key
                oService.read("/Attachments('" + sTripNumber + "')", {
                  success: function (oDataByKey) {
                    if (oDataByKey && oDataByKey.Content) {
                      this._showGateInPreviewDialog(oAttachment, oDataByKey.Content, false);
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
                    this._showGateInPreviewDialog(oAttachment, oDataByKey.Content, false);
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
        _showGateInPreviewDialog: function (oAttachment, sBase64Content, bIsSelectedFile) {
          var that = this;
          
          // Create dialog if it doesn't exist
          if (!this._oGateInPreviewDialog) {
            this._oGateInPreviewDialog = new sap.m.Dialog({
              title: oAttachment.fileName,
              contentWidth: "90%",
              contentHeight: "85%",
              resizable: true,
              draggable: true,
              beginButton: new sap.m.Button({
                text: "Close",
                press: function () {
                  that._oGateInPreviewDialog.close();
                }
              }),
              endButton: new sap.m.Button({
                text: "Download",
                type: "Emphasized",
                icon: "sap-icon://download",
                press: function () {
                  that._downloadGateInAttachment(oAttachment, sBase64Content);
                }
              })
            });
            this.getView().addDependent(this._oGateInPreviewDialog);
          }

          // Update dialog title
          this._oGateInPreviewDialog.setTitle(oAttachment.fileName || "Preview");
          this._oGateInPreviewDialog.removeAllContent();

          var sContentType = oAttachment.contentType || "";
          var sBase64 = sBase64Content || "";

          if (!sBase64) {
            var oText = new sap.m.Text({
              text: "No content available for preview."
            });
            this._oGateInPreviewDialog.addContent(oText);
            this._oGateInPreviewDialog.open();
            return;
          }

          // Create data URL from base64 content
          var sDataUrl = "data:" + sContentType + ";base64," + sBase64;

          // Determine preview type based on content type
          if (sContentType.startsWith("image/")) {
            // Image preview
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
            this._oGateInPreviewDialog.addContent(oScrollContainer);
          } else if (sContentType === "application/pdf") {
            // PDF preview using iframe
            var oHTML = new sap.ui.core.HTML({
              content: '<iframe src="' + sDataUrl + '" style="width:100%;height:100%;border:none;"></iframe>'
            });
            this._oGateInPreviewDialog.addContent(oHTML);
          } else {
            // Other file types - show download option
            var oText = new sap.m.Text({
              text: "Preview not available for this file type. Please download to view."
            });
            this._oGateInPreviewDialog.addContent(oText);
          }

          this._oGateInPreviewDialog.open();
        },
        _downloadGateInAttachment: function (oAttachment, sBase64Content) {
          var sContentType = oAttachment.contentType || "application/octet-stream";
          var sFileName = oAttachment.fileName || "attachment";
          
          // Create data URL
          var sDataUrl = "data:" + sContentType + ";base64," + sBase64Content;
          
          // Create temporary link and trigger download
          var oLink = document.createElement("a");
          oLink.href = sDataUrl;
          oLink.download = sFileName;
          document.body.appendChild(oLink);
          oLink.click();
          document.body.removeChild(oLink);
        },

        _refreshHomeTripTableAfterGateSave: function () {
          this._eventBus.publish("HomePage", "RefreshTripTable");
        },

        _reloadTripDataAfterSave: function (sTripNumber, sEntryGateNumber, sDelayReasons) {
          
          var oModel = this.oModel;
          var that = this;
          this._updateBinTrolleyVisibility();
          var oUi = this.getView().getModel("ui");
          var bShowBinTrolley = !!(oUi && oUi.getProperty("/showBinTrolleyTracking"));
          var sExpand = "OrderDetails,ItemDetails,ActivityHistory" + (bShowBinTrolley ? ",EmptyBins" : "");
          var bRetriedWithoutEmptyBins = false;
          var fnApplyTripData = function (oData) {
            // Ensure EntryGateNum is set to the saved value
            oData.EntryGateNum = sEntryGateNumber;
            // Keep DelayReason from save request when backend read does not return it.
            if (sDelayReasons && !oData.DelayReason && !oData.DelayReasons) {
              oData.DelayReason = sDelayReasons;
              oData.DelayReasons = sDelayReasons;
            }
            
            // Map Weighment_Req (boolean) from backend to WeighmentRequired ("Y"/"N") for frontend
            if (oData.Weighment_Req !== undefined) {
              // Convert boolean to "Y"/"N" format for frontend
              oData.WeighmentRequired = oData.Weighment_Req === true || oData.Weighment_Req === "X" ? "Y" : "N";
            }
            if (oData.RefDocSkip === undefined || oData.RefDocSkip === null || oData.RefDocSkip === "") {
              oData.RefDocSkip = " ";
            }
            TripDataDocumentsVerified.applyDocumentsVerifiedToVerifiedDocs(oData);

            // Update global TripData model
            var oTripDataModel = new sap.ui.model.json.JSONModel(oData);
            sap.ui.getCore().setModel(oTripDataModel, "TripData");
            
            // Update view model
            that.getView().setModel(oTripDataModel, "TripData");
            
            // Publish event to notify other views with complete data
            that._eventBus.publish("TripData", "Updated");
          };
          var fnReadTripData = function () {
            oModel.read("/TripDetails('" + sTripNumber + "')", {
              urlParameters: {
                "$expand": sExpand
              },
              success: function (oData) {
                fnApplyTripData(oData);
              },
              error: function (oError) {
                if (bShowBinTrolley && !bRetriedWithoutEmptyBins) {
                  bRetriedWithoutEmptyBins = true;
                  sExpand = "OrderDetails,ItemDetails,ActivityHistory";
                  fnReadTripData();
                  return;
                }
                // Failed to reload TripData after Gate-In save
                
                // Fallback: just update the EntryGateNum property
                var oTripData = sap.ui.getCore().getModel("TripData");
                if (oTripData) {
                  oTripData.setProperty("/EntryGateNum", sEntryGateNumber);
                  that._eventBus.publish("TripData", "Updated");
                }
              }
            });
          };
          
          // Read complete TripDetails with expanded data
          fnReadTripData();
        },

        formatTrackingDifferenceText: function (vDifference) {
          var iDiff = Number(vDifference);
          if (isNaN(iDiff)) {
            return "0";
          }
          return String(Math.abs(iDiff));
        },

        formatTrackingDifferenceState: function (vDifference) {
          var iDiff = Number(vDifference);
          if (isNaN(iDiff) || iDiff === 0) {
            return "None";
          }
          return iDiff > 0 ? "Warning" : "Error";
        },

        formatTrackingStatusState: function (sStatus) {
          switch (String(sStatus || "").toLowerCase()) {
          case "returned":
            return "Success";
          case "partial":
            return "Warning";
          case "pending":
            return "Error";
          case "new entry":
            return "Information";
          case "excess":
            return "Error";
          default:
            return "None";
          }
        },

        formatTrackingQtyValueState: function (sStatus) {
          switch (String(sStatus || "").toLowerCase()) {
          case "returned":
            return "Success";
          case "partial":
            return "Warning";
          case "pending":
            return "Error";
          case "new entry":
            return "Information";
          case "excess":
            return "Error";
          default:
            return "None";
          }
        },

        formatTrackingTotalQtyOutLine: function (vTotalQtyOut) {
          return "Total Qty Out: " + (vTotalQtyOut == null ? "0" : String(vTotalQtyOut));
        },

        formatTrackingTotalQtyInLine: function (vTotalQtyIn) {
          return "Total Qty In (Manual): " + (vTotalQtyIn == null ? "0" : String(vTotalQtyIn));
        },

        formatTrackingTotalDifferenceLine: function (vDifference) {
          return "Total Difference: " + this.formatTrackingDifferenceText(vDifference);
        },

        formatTrackingTotalReturnStatusLine: function (sSummary) {
          return "Total Return Status: " + (String(sSummary || "").trim() || "No entries");
        },

        formatTrackingStatusIcon: function (sStatus) {
          if (!sStatus) {
            return "";
          }
          return "sap-icon://circle-task-2";
        },

        // User-role-based authorization for GateIn has been removed; buttons are
        // controlled purely by TripData state and standard UI logic.
      }
    );
  }
);

