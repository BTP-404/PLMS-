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
    "com/incresolZ_INC_PLMS/util/TripDataDocumentsVerified",
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
    TripDataDocumentsVerified,
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
          this._eventBus.subscribe("RefDoc", "MaterialsUpdated", this._onRefDocMaterialsUpdated, this);
          this._eventBus.subscribe("Stage", "TripCreated", this._onStageTripCreated, this);
          this._eventBus.subscribe("GateOut", "ReloadFromTripExpand", this._onReloadFromTripExpand, this);
          this._eventBus.subscribe("GateOut", "RefDocSaved", this._onGateOutRefDocSavedManual, this);

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

          // Ensure Skip Document defaults to "No" even before TripData is loaded.
          // RadioButtonGroup binding uses formatRefDocSkipIndex: blank/missing => index 1 => "No".
          var oTripData = sap.ui.getCore().getModel("TripData");
          if (!oTripData) {
            oTripData = new JSONModel({ RefDocSkip: " " });
            sap.ui.getCore().setModel(oTripData, "TripData");
          }
          if (oTripData) {
            var vRefDocSkip = oTripData.getProperty("/RefDocSkip");
            if (
              vRefDocSkip === undefined ||
              vRefDocSkip === null ||
              String(vRefDocSkip).trim() === ""
            ) {
              oTripData.setProperty("/RefDocSkip", " ");
            }
          }
          
          // Initialize selected files array
          this._aSelectedFiles = [];
          this._sLastExitGateTripForLoad = "";
          this._sGateOutAttachmentsTripLoading = "";
          this._sGateOutAttachmentsLastLoadedTrip = "";
          this._iGateOutAttachmentsLastLoadedAt = 0;
          this._sLastGateOutBinReloadTrip = "";
          this._iLastGateOutBinReloadAt = 0;
          this._iGateOutBinTrolleyReloadTimer = null;

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
        _loadExitGateIfNeeded: function () {
          var sTripNumber = String(this._getTripNumber() || "").trim();
          if (/^\d+$/.test(sTripNumber)) {
            sTripNumber = sTripNumber.padStart(10, "0");
          }
          var sTripKey = sTripNumber || "__NO_TRIP__";
          if (this._sLastExitGateTripForLoad === sTripKey) {
            return;
          }
          this._sLastExitGateTripForLoad = sTripKey;
          this.loadExitGateNumber();
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

        _initGateOutAttachmentsModel: function () {
          if (!this._oGateOutAttachmentsModel) {
            this._oGateOutAttachmentsModel = new JSONModel({ attachments: [] });
            this.getView().setModel(this._oGateOutAttachmentsModel, "gateOutAttachmentsModel");
          }
        },
        _initGateOutBinTrolleyModel: function () {
          var oTrackingModel = sap.ui.getCore().getModel("binTrolleyTrackingGateOut");
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
            sap.ui.getCore().setModel(oTrackingModel, "binTrolleyTrackingGateOut");
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

        onRemoveTrackingRow: function (oEvent) {
          var oTrackingModel = this.getView().getModel("binTrolleyTracking");
          if (!oTrackingModel) {
            return;
          }
          var oContext = oEvent.getSource().getBindingContext("binTrolleyTracking");
          if (!oContext) {
            return;
          }
          var sPath = oContext.getPath();
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
            var sMaterial = String(oRow.Material || "").trim();
            if (!sTripNumber || !sMaterial) {
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
            var sEntityPath = this._buildEmptyBinsPath(sTripNumber, sMaterial);
            this.oModel.remove(sEntityPath, {
              headers: {
                "X-Requested-With": "X"
              },
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
            var iDiff = oRow.IsManual === true ? iQtyIn : (iQtyIn - iQtyOut);
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
          if (iQtyIn > iQtyOut || (!isNaN(iDiff) && iDiff > 0)) {
            return "Excess";
          }
          if (iQtyIn < iQtyOut) {
            return "Partial";
          }
          return String(sFallbackStatus || "Pending");
        },
        _buildTrackingRowsForBackend: function (sTripNumber) {
          var oTrackingModel = this.getView().getModel("binTrolleyTracking");
          var aRows = this._getTrackingItems(oTrackingModel);
          return aRows
            .filter(function (oRow) {
              return (
                String(oRow.DocumentNumber || "").trim() !== "" &&
                String(oRow.ItemNo || "").trim() !== ""
              );
            })
            .map(function (oRow) {
              var iQtyIn = this._coerceWholeBinQty(oRow.QtyIn);
              var iQtyOut = this._coerceWholeBinQty(oRow.QtyOut);
              var iActualQty = this._coerceWholeBinQty(oRow.ActualQty);
              return {
                TripNumber: String(oRow.TripNumber || sTripNumber || "").trim(),
                DocumentNumber: String(oRow.DocumentNumber || "").trim(),
                ItemNo: String(oRow.ItemNo || "").trim(),
                Customer: String(oRow.Customer || ""),
                Material: String(oRow.Material || ""),
                BinType: String(oRow.BinType || "").trim(),
                BintypeDesc: String(oRow.BinTypeDesc || oRow.BintypeDesc || oRow.BinTypeDescription || oRow.BinType || oRow.BinTypes || "").trim(),
                ActualQty: String(iActualQty),
                QtyIn: String(iQtyIn),
                QtyOut: String(iQtyOut)
              };
            }.bind(this));
        },

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
            var sKey =
              fnNorm(r.DocumentNumber) + "|" + fnNorm(r.ItemNo) + "|" + sBin;
            if (mSeen[sKey]) {
              return;
            }
            mSeen[sKey] = true;
            aOut.push(r);
          });
          return aOut;
        },

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
          return fnNorm(oRow.DocumentNumber) + "|" + fnNorm(oRow.ItemNo) + "|" + sBin;
        },

        _markGateOutBinJustSaved: function () {
          this._iGateOutBinSaveSuppressReloadUntil = Date.now() + 4000;
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
              var iDiff = iQtyIn - iQtyOut;
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
                that._markGateOutBinJustSaved();
                return oTripHeader;
              })
              .catch(function () {
                that._markGateOutBinJustSaved();
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
        _getTrackingStorageKey: function (sTripNumber) {
          return "binTracking_gateOut_" + String(sTripNumber || "").trim();
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
            var iDiff = iQtyIn - iQtyOut;
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
          var aRowsForBackend = this._buildTrackingRowsForBackend(sTripNumber);
          if (!aRowsForBackend.length) {
            MessageToast.show("No valid Bin/Trolley rows to save.");
            return;
          }
          this._saveEmptyBinsViaTripDetails(sTripNumber, aRowsForBackend)
            .then(function () {
              this._persistTrackingRows();
              oTrackingModel.setProperty("/isPosted", true);
              MessageBox.success("Bin / Trolley tracking saved.");
              if (iScrollY !== null) {
                setTimeout(function () {
                  window.scrollTo(0, iScrollY);
                }, 0);
              }
            }.bind(this))
            .catch(function (oError) {
              var sBackendMsg = this._extractErrorMessage(oError);
              var sErrorMessage =
                sBackendMsg && sBackendMsg !== "Something went wrong"
                  ? sBackendMsg
                  : "Failed to save Bin / Trolley tracking.";
              MessageBox.error(sErrorMessage);
              if (iScrollY !== null) {
                setTimeout(function () {
                  window.scrollTo(0, iScrollY);
                }, 0);
              }
            }.bind(this));
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
                enableGateOutRefSearchInward: false,
                showPanels: false,
                showGateOutRefSearchStrip: true
              }),
              "gateOutUi"
            );
          } else {
            var oUi = this.getView().getModel("gateOutUi");
            if (oUi.getProperty("/refDocSearchValue") === undefined) {
              oUi.setProperty("/refDocSearchValue", "");
            }
            if (oUi.getProperty("/enableGateOutRefSearchInward") === undefined) {
              oUi.setProperty("/enableGateOutRefSearchInward", false);
            }
            if (oUi.getProperty("/showPanels") === undefined) {
              oUi.setProperty("/showPanels", false);
            }
            if (oUi.getProperty("/showGateOutRefSearchStrip") === undefined) {
              oUi.setProperty("/showGateOutRefSearchStrip", true);
            }
          }
        },
        _updatePanelVisibility: function () {
          this._initGateOutUiModel();
          var oUi = this.getView().getModel("gateOutUi");
          if (!oUi) {
            return;
          }
          var sTripNumber = this._getTripNumber();
          var bShowPanels = !!sTripNumber;
          oUi.setProperty("/showPanels", bShowPanels);

          var oTripData = sap.ui.getCore().getModel("TripData");
          var sMovementType = String(
            (oTripData && oTripData.getProperty("/MovementType")) || ""
          ).toUpperCase();
          var bMovementAllowed = sMovementType !== "I";

          var sVtNorm =
            String((oTripData && oTripData.getProperty("/VehicleType")) || "")
              .trim()
              .replace(/^0+/, "") || "0";
          var sVtDesc = String(
            (oTripData && oTripData.getProperty("/VehicleTypeDesc")) || ""
          )
            .trim()
            .toLowerCase();
          var bExternalVt02OutboundHide =
            !!oTripData &&
            sMovementType === "O" &&
            sVtNorm === "2" &&
            sVtDesc === "external";
          var bO02Vt02HideTopSearch =
            (!!oTripData &&
              O02GateException.isO02FromTripData(oTripData) &&
              sVtNorm === "2") ||
            bExternalVt02OutboundHide;
          var bInward = sMovementType === "I";
          var bUserEnabledInward = !!oUi.getProperty("/enableGateOutRefSearchInward");
          var bPrevVisible = !!oUi.getProperty("/showGateOutRefSearchStrip");
          oUi.setProperty(
            "/showGateOutRefSearchStrip",
            !bO02Vt02HideTopSearch && (bInward ? bUserEnabledInward : bMovementAllowed)
          );
          var bNowVisible = !!oUi.getProperty("/showGateOutRefSearchStrip");
          if (bPrevVisible && !bNowVisible) {
            this._clearGateOutRefDocSearchField();
          }

        },

        onGateOutRefSearchInwardToggle: function () {
          // Re-evaluate visibility immediately when user toggles checkbox
          var oUi = this.getView().getModel("gateOutUi");
          var bEnabled = !!(oUi && oUi.getProperty("/enableGateOutRefSearchInward"));
          if (!bEnabled) {
            // If user disables the strip, clear typed value, suggestions and any previous ref-doc selection context.
            this._clearGateOutRefDocSearchField();
            this._clearGateOutPreviousSelectionState();
          }
          this._updatePanelVisibility();
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
        /**
         * Clears the Gate Out "Document Number" search field and suggestion list (model + control).
         */
        _clearGateOutRefDocSearchField: function () {
          var oVm = this.getView().getModel("gateOutUi");
          if (oVm) {
            oVm.setProperty("/refDocSearchValue", "");
          }
          var oRefInput = this.getView().byId("idGateOutRefDocSearchInput");
          if (oRefInput && typeof oRefInput.setValue === "function") {
            oRefInput.setValue("");
          }
          this._clearGateOutRefSuggestItems();
        },
        _clearGateOutPreviousSelectionState: function () {
          var oG = sap.ui.getCore().getModel("globalData");
          if (!oG) {
            oG = new JSONModel({});
            sap.ui.getCore().setModel(oG, "globalData");
          }
          oG.setProperty("/OutgoingBillingDocument", "");
          oG.setProperty("/OutgoingBillingDocType", "");
          oG.setProperty("/OutgoingPoNumber", "");
          oG.setProperty("/OutgoingRefDocDocType", "");

          var oTrip = sap.ui.getCore().getModel("TripData");
          if (oTrip) {
            oTrip.setProperty("/RefDocNo", "");
            oTrip.setProperty("/RefDocType", "");
            oTrip.setProperty("/PoNumber", "");
            oTrip.setProperty("/BillingDocument", "");
          }

          var oVm = this.getView().getModel("gateOutUi");
          if (oVm) {
            oVm.setProperty("/refDocSearchValue", "");
          }

          var oRefDocModel = sap.ui.getCore().getModel("refDocModel");
          if (oRefDocModel) {
            oRefDocModel.setProperty("/referenceDocs", []);
            oRefDocModel.setProperty("/materialDetails", []);
            oRefDocModel.setProperty("/filteredMaterialDetails", []);
            oRefDocModel.setProperty("/materialDocTypes", []);
            oRefDocModel.setProperty("/materialRefDocNumbers", []);
          }

          var oRefCtrl = this._getRefDocsControllerFromGateOut();
          if (oRefCtrl) {
            oRefCtrl._oSelectedOrderDetail = null;
            if (typeof oRefCtrl._clearSelectedReferenceDocFields === "function") {
              oRefCtrl._clearSelectedReferenceDocFields();
            }
          }
        },
        _escapeODataKey: function (s) {
          return String(s || "").trim().replace(/'/g, "''");
        },
        _parseDdMmYyyyDateLikeToIsoDate: function (v) {
          if (!v) return "";
          if (v instanceof Date && !isNaN(v.getTime())) {
            var y = v.getFullYear();
            var m = String(v.getMonth() + 1).padStart(2, "0");
            var d = String(v.getDate()).padStart(2, "0");
            return y + "-" + m + "-" + d;
          }
          var s = String(v || "").trim();
          // Common backend format seen in EwaybillDate: "23/02/2026 12:25:00 PM"
          var m1 = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s|$)/);
          if (m1) {
            return m1[3] + "-" + m1[2] + "-" + m1[1];
          }
          // ISO-like string (or any string Date can parse) → keep date only
          var o = new Date(s);
          if (!isNaN(o.getTime())) {
            var yy = o.getFullYear();
            var mm = String(o.getMonth() + 1).padStart(2, "0");
            var dd = String(o.getDate()).padStart(2, "0");
            return yy + "-" + mm + "-" + dd;
          }
          return "";
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
         * Create mode: ensure shared TripData exists for invoice/challan/PO prefill.
         */
        _ensureCoreTripDataForGateOutPrefill: function () {
          var oTrip = sap.ui.getCore().getModel("TripData");
          if (oTrip) {
            return oTrip;
          }
          var oEmb = this.getView().byId("idVehicleReportingEmbeddedGateOut");
          var oRepCtrl = oEmb && typeof oEmb.getController === "function" ? oEmb.getController() : null;
          var oViewTrip =
            oRepCtrl && oRepCtrl.getView && oRepCtrl.getView()
              ? oRepCtrl.getView().getModel("TripData")
              : null;
          if (oViewTrip) {
            sap.ui.getCore().setModel(oViewTrip, "TripData");
            return oViewTrip;
          }
          oTrip = new JSONModel({ RefDocSkip: " " });
          sap.ui.getCore().setModel(oTrip, "TripData");
          return oTrip;
        },

        _syncTripDataToEmbeddedReporting: function (oTrip) {
          oTrip = oTrip || sap.ui.getCore().getModel("TripData");
          if (!oTrip) {
            return;
          }
          var oEmb = this.getView().byId("idVehicleReportingEmbeddedGateOut");
          var oRepCtrl = oEmb && typeof oEmb.getController === "function" ? oEmb.getController() : null;
          if (!oRepCtrl || !oRepCtrl.getView) {
            return;
          }
          oRepCtrl.getView().setModel(oTrip, "TripData");
          var oUi = oRepCtrl.getView().getModel("reportingUi");
          if (oUi) {
            var sNo = String(oTrip.getProperty("/RefDocNo") || "").trim();
            if (sNo) {
              oUi.setProperty("/refDocSearchValue", sNo);
            }
          }
        },

        _hasExpandedOrderOrItemDetails: function (oTripData) {
          if (!oTripData) {
            return false;
          }
          var aOrder = this._extractResults(oTripData.getProperty("/OrderDetails"));
          var aItems = this._extractResults(oTripData.getProperty("/ItemDetails"));
          return (aOrder && aOrder.length > 0) || (aItems && aItems.length > 0);
        },

        /**
         * After Reporting Save: map ref docs + materials (+ bins) from TripDetails $expand.
         * Returns true when OrderDetails or ItemDetails were present on the trip.
         */
        _reloadRefDocsMaterialsBinsFromTripExpand: function (mOptions) {
          var sTrip = String(
            (mOptions && mOptions.tripNumber) || this._getTripNumber() || ""
          ).trim();
          if (!sTrip || !this.oModel) {
            return Promise.resolve(false);
          }

          var that = this;
          var fnApplyFromTripPayload = function (oData) {
            TripDataDocumentsVerified.applyDocumentsVerifiedToVerifiedDocs(oData);
            var oTripModel = oData instanceof JSONModel ? oData : new JSONModel(oData);
            sap.ui.getCore().setModel(oTripModel, "TripData");
            that.getView().setModel(oTripModel, "TripData");
            that._syncTripDataToEmbeddedReporting(oTripModel);
            that._updatePanelVisibility();
            that._updateBinTrolleyVisibility();
            that._eventBus.publish("TripData", "Updated");

            var bHasData = that._hasExpandedOrderOrItemDetails(oTripModel);
            var aOrder = that._extractResults(oTripModel.getProperty("/OrderDetails"));
            var sDoc = "";
            if (aOrder && aOrder.length) {
              sDoc = String(aOrder[0].DocumentNumber || "").trim();
            }
            if (!sDoc) {
              var oG = sap.ui.getCore().getModel("globalData");
              sDoc = String(
                (oG && oG.getProperty("/OutgoingBillingDocument")) ||
                  (oG && oG.getProperty("/OutgoingPoNumber")) ||
                  oTripModel.getProperty("/RefDocNo") ||
                  ""
              ).trim();
            }

            var oRefCtrl = that._getRefDocsControllerFromGateOut();
            var pChain = Promise.resolve();
            if (oRefCtrl) {
              if (typeof oRefCtrl._onTripDataUpdated === "function") {
                oRefCtrl._onTripDataUpdated();
              }
              if (typeof oRefCtrl._refreshMaterialsTable === "function") {
                pChain = oRefCtrl._refreshMaterialsTable({ documentNumber: sDoc });
              }
            }
            return pChain.then(function () {
              that._refreshGateOutBinsForSelectedDocument(sDoc);
              return bHasData;
            });
          };

          var oExisting = sap.ui.getCore().getModel("TripData");
          var sExistingTrip = String((oExisting && oExisting.getProperty("/TripNumber")) || "").trim();
          if (
            oExisting &&
            sExistingTrip === sTrip &&
            this._hasExpandedOrderOrItemDetails(oExisting)
          ) {
            return fnApplyFromTripPayload(oExisting.getData ? oExisting.getData() : oExisting);
          }

          return new Promise(function (resolve) {
            that.oModel.read("/TripDetails('" + that._escapeODataKey(sTrip) + "')", {
              urlParameters: {
                $expand: "OrderDetails,ItemDetails,Feeds,ActivityHistory",
              },
              success: function (oData) {
                fnApplyFromTripPayload(oData).then(resolve);
              },
              error: function () {
                resolve(false);
              },
            });
          });
        },

        _tryResolvePendingOutgoingRefDocAfterTrip: function () {
          var sTrip = String(this._getTripNumber() || "").trim();
          if (!sTrip) {
            return Promise.resolve();
          }
          var oG = sap.ui.getCore().getModel("globalData");
          if (!oG) {
            return Promise.resolve();
          }
          var sRefKey = String(oG.getProperty("/OutgoingReferenceByKey") || "INVOICE").toUpperCase();
          var sDocNo = "";
          if (sRefKey === "PO") {
            sDocNo = String(oG.getProperty("/OutgoingPoNumber") || "").trim();
          } else {
            sDocNo = String(oG.getProperty("/OutgoingBillingDocument") || "").trim();
          }
          if (!sDocNo) {
            return Promise.resolve();
          }
          return this.resolveRefDocumentFromReporting(sRefKey, sDocNo);
        },

        _onReloadFromTripExpand: function (sChannel, sEvent, oData) {
          var that = this;
          if (this._iReloadFromTripExpandTimer) {
            clearTimeout(this._iReloadFromTripExpandTimer);
          }
          this._iReloadFromTripExpandTimer = setTimeout(function () {
            that._iReloadFromTripExpandTimer = null;
            that._reloadRefDocsMaterialsBinsFromTripExpand(oData || {}).then(function (bHasData) {
              if (!bHasData) {
                that._tryResolvePendingOutgoingRefDocAfterTrip();
              }
            });
          }, 150);
        },

        _onStageTripCreated: function (sChannel, sEvent, oData) {
          var oStageUi = sap.ui.getCore().getModel("stageUi");
          var bReportingInGateOut = !!(
            oStageUi && oStageUi.getProperty("/showReportingInGateOut")
          );
          if (!bReportingInGateOut) {
            return;
          }
          this._onReloadFromTripExpand(sChannel, sEvent, oData);
        },

        /**
         * After OData read: push document + movement info into globalData for Reference Documents tab.
         */
        _applyGateOutRefDocGlobalFromRow: function (sMode, oRow) {
          var oG = sap.ui.getCore().getModel("globalData");
          var oTrip = this._ensureCoreTripDataForGateOutPrefill();
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
            if (oTrip && sBd) {
              // Always set reference doc fields for downstream panels.
              oTrip.setProperty("/BillingDocument", sBd);
              oTrip.setProperty("/RefDocNo", sBd);
              oTrip.setProperty("/RefDocType", sDt);

              // Auto-populate Reporting fields from Invoice SH response (do not overwrite non-empty values).
              var fnSetIfEmpty = function (sPath, vVal) {
                if (!oTrip || vVal === undefined || vVal === null) return;
                var sExisting = String(oTrip.getProperty(sPath) || "").trim();
                var sNew = String(vVal || "").trim();
                if (!sExisting && sNew) {
                  oTrip.setProperty(sPath, sNew);
                }
              };

              fnSetIfEmpty("/VehicleNumber", oRow.VehicleNumber);
              fnSetIfEmpty("/TransporterName", oRow.TransporterName);
              fnSetIfEmpty("/LR_Number", oRow.LR_Number);
              fnSetIfEmpty("/DriverName", oRow.DriverName);
              // Driver contact isn't returned in your sample payload; set only if present.
              fnSetIfEmpty("/DriverMobile", oRow.DriverMobile || oRow.DriverContact);

              // Map EWB fields (Reporting binds to EwbNo + EwbActStartDate).
              fnSetIfEmpty("/EwbNo", oRow.EwayBill);
              var sEwbIso = this._parseDdMmYyyyDateLikeToIsoDate(oRow.EwaybillDate || oRow.EwbActStartDate);
              if (!String(oTrip.getProperty("/EwbActStartDate") || "").trim() && sEwbIso) {
                oTrip.setProperty("/EwbActStartDate", sEwbIso);
              }

              // Invoice reference fields (only shown for Inward in UI, but safe to map if present).
              fnSetIfEmpty("/InvRefNo", oRow.InvRefNo);
              var sInvIso = this._parseDdMmYyyyDateLikeToIsoDate(oRow.InvRefDate);
              if (!String(oTrip.getProperty("/InvRefDate") || "").trim() && sInvIso) {
                oTrip.setProperty("/InvRefDate", sInvIso);
              }
            }
          } else if (sMode === "CHALLAN") {
            var sMd = oRow.MaterialDoc != null ? String(oRow.MaterialDoc).trim() : "";
            var sChDt = oRow.DocType != null ? String(oRow.DocType).trim() : "";
            oG.setProperty("/OutgoingBillingDocument", sMd);
            oG.setProperty("/OutgoingBillingDocType", sChDt);
            oG.setProperty("/OutgoingPoNumber", "");
            oG.setProperty("/OutgoingReferenceByKey", "CHALLAN");
            if (oTrip && sMd) {
              oTrip.setProperty("/RefDocNo", sMd);
              oTrip.setProperty("/RefDocType", sChDt);

              // Best-effort auto-population for Reporting fields if present on Challan SH.
              var fnSetIfEmptyCh = function (sPath, vVal) {
                if (!oTrip || vVal === undefined || vVal === null) return;
                var sExisting = String(oTrip.getProperty(sPath) || "").trim();
                var sNew = String(vVal || "").trim();
                if (!sExisting && sNew) {
                  oTrip.setProperty(sPath, sNew);
                }
              };
              fnSetIfEmptyCh("/VehicleNumber", oRow.VehicleNumber);
              fnSetIfEmptyCh("/TransporterName", oRow.TransporterName);
              fnSetIfEmptyCh("/LR_Number", oRow.LR_Number);
              fnSetIfEmptyCh("/DriverName", oRow.DriverName);
              fnSetIfEmptyCh("/DriverMobile", oRow.DriverMobile || oRow.DriverContact);
              fnSetIfEmptyCh("/EwbNo", oRow.EwayBill);
              var sEwbIsoCh = this._parseDdMmYyyyDateLikeToIsoDate(oRow.EwaybillDate || oRow.EwbActStartDate);
              if (!String(oTrip.getProperty("/EwbActStartDate") || "").trim() && sEwbIsoCh) {
                oTrip.setProperty("/EwbActStartDate", sEwbIsoCh);
              }
            }
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
            if (oTrip && sPo) {
              oTrip.setProperty("/PoNumber", sPo);
              oTrip.setProperty("/RefDocNo", sPo);
              oTrip.setProperty("/RefDocType", sPoDt);
            }
          }
          this._syncTripDataToEmbeddedReporting(oTrip);
          this._eventBus.publish("TripData", "Updated");
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
        /**
         * Gate Out search (Invoice / Challan): pull ItemDetails into the materials table
         * after OrderDetails is ensured — includes a delayed second pass for async backend rows.
         */
        _triggerGateOutMaterialsForRefDoc: function (sMode, sTypedValue, oRow) {
          var sResolvedMode = String(sMode || "").toUpperCase();
          if (sResolvedMode !== "INVOICE" && sResolvedMode !== "CHALLAN") {
            return;
          }
          var sDocType = "";
          var sDocumentNumber = "";
          if (sResolvedMode === "INVOICE") {
            sDocumentNumber = String(
              (oRow && oRow.BillingDoc != null ? oRow.BillingDoc : sTypedValue) || ""
            ).trim();
            sDocType = String(
              (oRow && (oRow.DocType != null ? oRow.DocType : oRow.BillingType)) || ""
            ).trim();
          } else {
            sDocumentNumber = String(
              (oRow && oRow.MaterialDoc != null ? oRow.MaterialDoc : sTypedValue) || ""
            ).trim();
            sDocType = String((oRow && oRow.DocType != null ? oRow.DocType : "") || "").trim();
          }
          if (!sDocType || !sDocumentNumber) {
            return;
          }
          var oRefCtrl = this._getRefDocsControllerFromGateOut();
          if (!oRefCtrl || typeof oRefCtrl._addAllMaterialsFromRefDoc !== "function") {
            return;
          }
          oRefCtrl._addAllMaterialsFromRefDoc(sDocType, sDocumentNumber);
          window.setTimeout(function () {
            oRefCtrl._addAllMaterialsFromRefDoc(sDocType, sDocumentNumber);
          }, 400);
        },
        _buildEmptyBinsPath: function (sTripNumber, sMaterial) {
          return (
            "/EmptyBins(TripNumber='" +
            this._escapeODataKey(sTripNumber) +
            "',Material='" +
            this._escapeODataKey(sMaterial) +
            "')"
          );
        },
        _getGateOutEmptyBinsReadKeys: function () {
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
                DocumentNumber: String(
                  oRow.refDocNo ||
                  oRow.RefDocNo ||
                  oRow.documentNumber ||
                  oRow.DocumentNumber ||
                  ""
                ).trim(),
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
        _buildGateOutBinRowsFromMaterialKeys: function (sTripNumber, fnKeyFilter) {
          var aKeys = this._getGateOutEmptyBinsReadKeys();
          if (typeof fnKeyFilter === "function") {
            aKeys = (aKeys || []).filter(fnKeyFilter);
          }
          return (aKeys || []).map(function (oKey) {
            var iQtyIn = 0;
            var iQtyOut = this._coerceWholeBinQty(oKey.QtyOut);
            var iDiff = iQtyIn - iQtyOut;
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
        _loadGateOutBinsByKeys: function (sTripNumber, sDocumentNumber, aItemNos) {
          var oModel = this.oModel;
          var oVm = this.getView().getModel("binTrolleyTracking");
          if (!oModel || !oVm) {
            return Promise.resolve();
          }
          var sTargetDoc = String(sDocumentNumber || "").trim();
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
          var aFilters = [new Filter("TripNumber", FilterOperator.EQ, sTripNumber)];
          return new Promise(
            function (resolve) {
              oModel.read("/EmptyBins", {
                filters: aFilters,
                urlParameters: {
                  $format: "json",
                },
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
                  var aMapped = (aDocRows || []).map(function (r) {
                    var iQtyOut = this._coerceWholeBinQty(r.QtyOut);
                    var iQtyIn = this._coerceWholeBinQty(r.QtyIn);
                    var iDiff = iQtyOut - iQtyIn;
                    return {
                      TripNumber: String(r.TripNumber || sTripNumber || "").trim(),
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
                  (aMapped || []).forEach(function (oRow) {
                    var sKey = String(oRow.DocumentNumber || "").trim() + "|" + String(oRow.ItemNo || "").trim();
                    if (sKey !== "|") {
                      mBackendByKey[sKey] = oRow;
                    }
                  });
                  var aCurrentRows = this._getTrackingItems(oVm);
                  var aMergedRows = (aCurrentRows || []).map(function (oRow) {
                    if (oRow.IsManual === true) {
                      return oRow;
                    }
                    var sKey = String(oRow.DocumentNumber || "").trim() + "|" + String(oRow.ItemNo || "").trim();
                    var oBackendRow = mBackendByKey[sKey];
                    if (!oBackendRow) {
                      return oRow;
                    }
                    return Object.assign({}, oRow, oBackendRow, { IsManual: false });
                  });
                  (aMapped || []).forEach(function (oBackendRow) {
                    var sKey = String(oBackendRow.DocumentNumber || "").trim() + "|" + String(oBackendRow.ItemNo || "").trim();
                    var bExists = (aMergedRows || []).some(function (oRow) {
                      var sRowKey = String(oRow.DocumentNumber || "").trim() + "|" + String(oRow.ItemNo || "").trim();
                      return sRowKey === sKey;
                    });
                    if (!bExists) {
                      aMergedRows.push(oBackendRow);
                    }
                  });
                  this._setTrackingItems(
                    oVm,
                    this._mergeWithPersistedRows(sTripNumber, aMergedRows)
                  );
                  oVm.setProperty("/isPosted", true);
                  this._recalculateTrackingTotals();
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
          var oVm = this.getView().getModel("binTrolleyTracking");
          if (!oVm) {
            return;
          }
          if (!sTripNumber) {
            if (this._iGateOutBinReloadTimer) {
              clearTimeout(this._iGateOutBinReloadTimer);
              this._iGateOutBinReloadTimer = null;
            }
            this._iGateOutBinReloadTimer = setTimeout(function () {
              this._refreshGateOutBinsForSelectedDocument(sDocNumber);
            }.bind(this), 150);
            return;
          }

          var sTargetDoc = String(sDocNumber || "").trim();
          var oModel = this.oModel || this.getView().getModel();
          if (!oModel) {
            return;
          }

          var sPath = "/TripDetails('" + this._escapeODataKey(sTripNumber) + "')";
          oModel.read(sPath, {
            urlParameters: { "$expand": "EmptyBins" },
            success: function (oData) {
              var vExpanded = oData && oData.EmptyBins;
              var aEmptyBins = Array.isArray(vExpanded)
                ? vExpanded
                : (vExpanded && vExpanded.results) || [];

              if (sTargetDoc) {
                aEmptyBins = (aEmptyBins || []).filter(function (r) {
                  return String(r.DocumentNumber || "").trim() === sTargetDoc;
                });
              }

              var aDeduped = this._dedupeEmptyBinsODataRows
                ? this._dedupeEmptyBinsODataRows(aEmptyBins || [])
                : (aEmptyBins || []);

              var aMappedRows = (aDeduped || []).map(function (r) {
                var iQtyOut = this._coerceWholeBinQty(r.QtyOut);
                var iQtyIn = this._coerceWholeBinQty(r.QtyIn);
                var iDiff = iQtyIn - iQtyOut;
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
                  BinType: String(
                    r.BinType ||
                      r.BinTypes ||
                      r.BinTypeDesc ||
                      r.BintypeDesc ||
                      r.BinTypeDescription ||
                      ""
                  ).trim(),
                  BinTypeDesc: String(
                    r.BinTypeDesc ||
                      r.BintypeDesc ||
                      r.BinTypeDescription ||
                      r.BinType ||
                      r.BinTypes ||
                      ""
                  ).trim(),
                  BintypeDesc: String(
                    r.BinTypeDesc ||
                      r.BintypeDesc ||
                      r.BinTypeDescription ||
                      r.BinType ||
                      r.BinTypes ||
                      ""
                  ).trim(),
                  QtyIn: iQtyIn,
                  QtyOut: iQtyOut,
                  Difference: iDiff,
                  ReturnStatus: this._deriveTrackingStatus(iQtyIn, iQtyOut, iDiff, "Pending", false),
                  IsManual: false
                };
              }.bind(this));

              // Gate Out: If backend has no EmptyBins rows, show no table rows.
              // Do not merge any persisted/local rows when backend is empty.
              if (!aMappedRows || !aMappedRows.length) {
                this._setTrackingItems(oVm, []);
              } else {
                this._setTrackingItems(
                  oVm,
                  this._mergeWithPersistedRows(sTripNumber, aMappedRows)
                );
              }
              oVm.setProperty("/isPosted", true);
              this._recalculateTrackingTotals();
            }.bind(this),
            error: function () {
              this._setTrackingItems(oVm, []);
              oVm.setProperty("/isPosted", true);
              this._recalculateTrackingTotals();
            }.bind(this)
          });
        },
        _ensureGateOutOrderDetailForReference: function (sMode, sTypedValue, oRow) {
          var oModel = this.oModel || this.getView().getModel();
          var oTrip = sap.ui.getCore().getModel("TripData");
          if (!oModel || !oTrip) {
            return Promise.resolve();
          }

          var sTripNumber = String(oTrip.getProperty("/TripNumber") || "").trim();
          if (!sTripNumber) {
            return Promise.resolve();
          }

          var sResolvedMode = String(sMode || "").toUpperCase();
          var sDocType = "";
          var sDocumentNumber = "";
          if (sResolvedMode === "INVOICE") {
            sDocumentNumber = String(
              (oRow && oRow.BillingDoc != null ? oRow.BillingDoc : sTypedValue) || ""
            ).trim();
            sDocType = String(
              (oRow && (oRow.DocType != null ? oRow.DocType : oRow.BillingType)) || ""
            ).trim();
          } else if (sResolvedMode === "CHALLAN") {
            sDocumentNumber = String(
              (oRow && oRow.MaterialDoc != null ? oRow.MaterialDoc : sTypedValue) || ""
            ).trim();
            sDocType = String((oRow && oRow.DocType != null ? oRow.DocType : "") || "").trim();
          } else if (sResolvedMode === "PO") {
            sDocumentNumber = String(
              (oRow && oRow.PoNumber != null ? oRow.PoNumber : sTypedValue) || ""
            ).trim();
            sDocType = String(
              (oRow && (oRow.DocType != null ? oRow.DocType : oRow.DocumentType)) || ""
            ).trim();
          }

          if (!sDocType || !sDocumentNumber) {
            return Promise.resolve();
          }

          var oPayload = {
            TripNumber: sTripNumber,
            DocType: sDocType,
            DocumentNumber: sDocumentNumber,
            MovmentInd: "GO",
            Vendor: "",
            Customer: "",
            Name: "",
            Deleted: false,
          };

          return new Promise(function (resolve) {
            oModel.read("/OrderDetails", {
              filters: [
                new Filter("TripNumber", FilterOperator.EQ, sTripNumber),
                new Filter("DocType", FilterOperator.EQ, sDocType),
                new Filter("DocumentNumber", FilterOperator.EQ, sDocumentNumber),
                new Filter("MovmentInd", FilterOperator.EQ, "GO"),
              ],
              urlParameters: {
                $top: "1",
                $skip: "0",
              },
              success: function (oData) {
                var aRows = (oData && oData.results) || [];
                if (aRows.length > 0) {
                  resolve();
                  return;
                }
                oModel.create("/OrderDetails", oPayload, {
                  headers: {
                    "X-Requested-With": "X",
                    "Content-Type": "application/json",
                  },
                  success: function () {
                    resolve();
                  },
                  error: function () {
                    resolve();
                  },
                });
              },
              error: function () {
                oModel.create("/OrderDetails", oPayload, {
                  headers: {
                    "X-Requested-With": "X",
                    "Content-Type": "application/json",
                  },
                  success: function () {
                    resolve();
                  },
                  error: function () {
                    resolve();
                  },
                });
              },
            });
          });
        },
        _afterGateOutRefDocResolved: function (sMode, sTypedValue, oRow) {
          var sDocNumber = this._getGateOutSelectedRefDocNumber(
            sMode,
            oRow,
            sTypedValue
          );
          this._ensureGateOutOrderDetailForReference(sMode, sTypedValue, oRow)
            .then(function () {
              this._triggerGateOutMaterialsForRefDoc(sMode, sTypedValue, oRow);
              return this._refreshGateOutRefDocAndMaterials(sDocNumber);
            }.bind(this))
            .then(
              function () {
                this._refreshGateOutBinsForSelectedDocument(sDocNumber);
              }.bind(this)
            )
            .then(function () {
              return this._gateOutSecondPassTripReconcile(sDocNumber);
            }.bind(this));
          this._eventBus.publish("TripData", "Updated");
        },

        /**
         * Second TripDetails read after invoice/challan/PO resolution so OrderDetails/ItemDetails
         * populated asynchronously on the gateway still reach the UI without manual refresh.
         */
        _gateOutSecondPassTripReconcile: function (sDocNumber) {
          var sTrip = String(this._getTripNumber() || "").trim();
          if (!sTrip || !this.oModel) {
            return Promise.resolve();
          }
          var that = this;
          return new Promise(function (resolve) {
            window.setTimeout(function () {
              that.oModel.read("/TripDetails('" + sTrip + "')", {
                urlParameters: {
                  "$expand": "OrderDetails,ItemDetails,Feeds,ActivityHistory",
                },
                success: function (oData) {
                  TripDataDocumentsVerified.applyDocumentsVerifiedToVerifiedDocs(oData);
                  var oTripDataModel = new JSONModel(oData);
                  sap.ui.getCore().setModel(oTripDataModel, "TripData");
                  that.getView().setModel(oTripDataModel, "TripData");
                  sap.ui.getCore().getEventBus().publish("TripData", "Updated");
                  var oRefCtrl = that._getRefDocsControllerFromGateOut();
                  if (oRefCtrl && typeof oRefCtrl._onTripDataUpdated === "function") {
                    oRefCtrl._onTripDataUpdated();
                  }
                  if (oRefCtrl && typeof oRefCtrl._refreshMaterialsTable === "function") {
                    oRefCtrl
                      ._refreshMaterialsTable({
                        documentNumber: String(sDocNumber || "").trim(),
                      })
                      .then(function () {
                        that._refreshGateOutBinsForSelectedDocument(sDocNumber);
                        resolve();
                      })
                      .catch(function () {
                        that._refreshGateOutBinsForSelectedDocument(sDocNumber);
                        resolve();
                      });
                    return;
                  }
                  that._refreshGateOutBinsForSelectedDocument(sDocNumber);
                  resolve();
                },
                error: function () {
                  resolve();
                },
              });
            }, 400);
          });
        },
        /**
         * Called from embedded Vehicle Reporting on Gate Out when user selects a reference document.
         * Reuses the same detail read + ref docs/materials refresh as the top search strip.
         * @param {string} sMode INVOICE|CHALLAN|PO
         * @param {string} sRawDocNo Selected document number
         * @returns {Promise}
         */
        resolveRefDocumentFromReporting: function (sMode, sRawDocNo) {
          this._initGateOutUiModel();
          var oVm = this.getView().getModel("gateOutUi");
          var sKey = String(sMode || "INVOICE").toUpperCase();
          if (oVm) {
            oVm.setProperty("/referenceByKey", sKey);
          }
          var oG = sap.ui.getCore().getModel("globalData");
          if (!oG) {
            oG = new JSONModel({});
            sap.ui.getCore().setModel(oG, "globalData");
          }
          oG.setProperty("/OutgoingReferenceByKey", sKey);
          return this._loadGateOutRefDocDetailRead(sRawDocNo);
        },

        _loadGateOutRefDocDetailRead: function (sRaw) {
          var sVal = String(sRaw || "").trim();
          var oVm = this.getView().getModel("gateOutUi");
          var sMode = oVm ? String(oVm.getProperty("/referenceByKey") || "INVOICE").toUpperCase() : "INVOICE";
          var oModel = this.oModel;
          if (!oModel || !sVal) {
            return Promise.resolve(null);
          }
          if (sMode === "INVOICE") {
            sVal = this._validateNumericDocNumber10(sVal, "Billing Doc", false);
          } else if (sMode === "CHALLAN") {
            sVal = this._validateNumericDocNumber10(sVal, "Material Doc", false);
          } else if (sMode === "PO") {
            sVal = this._validateNumericDocNumber10(sVal, "PO number", false);
          }
          if (!sVal) {
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
                error: function (oErr) {
                  var sM1 = that._extractErrorMessage(oErr);

                  var fnContinueWithFallback = function () {
                    oModel.read("/BillingDocSH", {
                      filters: [new Filter("BillingDoc", FilterOperator.EQ, sVal)],
                      urlParameters: { $top: "1" },
                      success: function (oData2) {
                        var a = (oData2 && oData2.results) || [];
                        that._applyGateOutRefDocGlobalFromRow("INVOICE", a[0] || null);
                        that._afterGateOutRefDocResolved("INVOICE", sVal, a[0] || null);
                        resolve(a[0] || null);
                      },
                      error: function (oErr2) {
                        var sM2 = that._extractErrorMessage(oErr2);
                        var sShow =
                          sM2 && sM2 !== "Something went wrong" ? sM2 : sM1;
                        MessageBox.error(sShow);
                        resolve(null);
                      },
                    });
                  };

                  // Show backend business message first, then continue with fallback read.
                  if (sM1 && sM1 !== "Something went wrong") {
                    MessageBox.error(sM1, {
                      onClose: function () {
                        fnContinueWithFallback();
                      },
                    });
                    return;
                  }

                  fnContinueWithFallback();
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
                error: function (oErr) {
                  oModel.read("/ChallanSh", {
                    filters: [new Filter("MaterialDoc", FilterOperator.EQ, sVal)],
                    urlParameters: { $top: "1" },
                    success: function (oData2) {
                      var a = (oData2 && oData2.results) || [];
                      that._applyGateOutRefDocGlobalFromRow("CHALLAN", a[0] || null);
                      that._afterGateOutRefDocResolved("CHALLAN", sVal, a[0] || null);
                      resolve(a[0] || null);
                    },
                    error: function (oErr2) {
                      var sM2 = that._extractErrorMessage(oErr2);
                      var sM1 = that._extractErrorMessage(oErr);
                      var sShow =
                        sM2 && sM2 !== "Something went wrong" ? sM2 : sM1;
                      MessageBox.error(sShow);
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
                  // Some services do not allow direct key addressing for search-help entities.
                  // Fall back to collection read for robust PO resolution.
                  oModel.read("/PoNumberSH", {
                    filters: [new Filter("PoNumber", FilterOperator.EQ, sVal)],
                    urlParameters: { $top: "1" },
                    success: function (oData2) {
                      var a = (oData2 && oData2.results) || [];
                      that._applyGateOutRefDocGlobalFromRow("PO", a[0] || null);
                      that._afterGateOutRefDocResolved("PO", sVal, a[0] || null);
                      resolve(a[0] || null);
                    },
                    error: function (oErr2) {
                      var sM2 = that._extractErrorMessage(oErr2);
                      var sM1 = that._extractErrorMessage(oErr);
                      var sShow =
                        sM2 && sM2 !== "Something went wrong" ? sM2 : sM1;
                      MessageBox.error(sShow);
                      resolve(null);
                    },
                  });
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
          var mModeConfig = {
            INVOICE: { path: "/BillingDocSH", field: "BillingDoc" },
            CHALLAN: { path: "/ChallanSh", field: "MaterialDoc" },
            PO: { path: "/PoNumberSH", field: "PoNumber" },
          };
          var oCfg = mModeConfig[sKey];
          if (!oCfg) {
            MessageBox.error("Invalid reference document type");
            oLocalModel.setProperty("/items", []);
            return;
          }

          var oFilter = new Filter(oCfg.field, FilterOperator.Contains, sValue);
          oModel.read(oCfg.path, {
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
              var sNeedle = sValue.toLowerCase();
              aItems = aItems.filter(function (oIt) {
                var sT = String((oIt && oIt.docText) || "").toLowerCase();
                var sD = String((oIt && oIt.docDescription) || "").toLowerCase();
                return sT.indexOf(sNeedle) !== -1 || sD.indexOf(sNeedle) !== -1;
              });
              oLocalModel.setProperty("/items", aItems);
            },
            error: function (oError) {
              MessageBox.error(
                this._extractErrorMessage(oError) || "Unable to load document suggestions"
              );
              oLocalModel.setProperty("/items", []);
            }.bind(this),
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
            this._loadGateOutRefDocDetailRead(sText).finally(
              function () {
                this._clearGateOutRefDocSearchField();
              }.bind(this)
            );
          }
        },
        onGateOutRefDocSearchChange: function (oEvent) {
          var sVal = String((oEvent.getParameter("value") || "")).trim();
          var oVm = this.getView().getModel("gateOutUi");
          if (oVm) {
            oVm.setProperty("/refDocSearchValue", sVal);
          }
          if (sVal) {
            this._loadGateOutRefDocDetailRead(sVal).finally(
              function () {
                this._clearGateOutRefDocSearchField();
              }.bind(this)
            );
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
          this._clearGateOutPreviousSelectionState();
          oG.setProperty("/OutgoingReferenceByKey", sKey || "INVOICE");
          var oVm = this.getView().getModel("gateOutUi");
          if (oVm) {
            oVm.setProperty("/referenceByKey", sKey || "INVOICE");
          }
          this._clearGateOutRefDocSearchField();
        },
        /**
         * Single expanded panel: Reporting when shown on Gate Out; otherwise Gate-Out details.
         */
        _applyGateOutTabDefaultPanelExpansion: function () {
          try {
            var oStageUi = sap.ui.getCore().getModel("stageUi");
            var oTripData = sap.ui.getCore().getModel("TripData");
            var bReportingHere =
              !!(oStageUi && oStageUi.getProperty("/showReportingInGateOut")) &&
              String((oTripData && oTripData.getProperty("/MovementType")) || "").toUpperCase() !== "I";
            var oEmb = this.getView().byId("idVehicleReportingEmbeddedGateOut");
            var oRep = oEmb && oEmb.byId("reportingDetailsPanel");
            var oGateOut = this.getView().byId("gateOutPanel");
            if (bReportingHere && oRep) {
              PanelAccordion.collapseAllExcept(this.getView(), oRep);
            } else if (oGateOut) {
              PanelAccordion.collapseAllExcept(this.getView(), oGateOut);
            }
          } catch (e) {
            // ignore
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
            // Keep data refresh on every render, but run one-time visual init only once.
            if (!this._bGateOutAfterRenderInitialized) {
              this._applyGateOutTabDefaultPanelExpansion();
              // Get trip number from globalData model (safer approach)
              var oGlobalModel = sap.ui.getCore().getModel("globalData");
              this.tripNumber = oGlobalModel ? oGlobalModel.getProperty("/TripNumber") || "" : "";
              
              this._loadExitGateIfNeeded();
              this._syncGateOutReferenceBy();
              this._bGateOutAfterRenderInitialized = true;
            }
            this._updatePanelVisibility();
            this._updateBinTrolleyVisibility();
            this._requestGateOutBinTrolleyReload(0);

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
          if (this._iGateOutRefDocReloadTimer) {
            clearTimeout(this._iGateOutRefDocReloadTimer);
            this._iGateOutRefDocReloadTimer = null;
          }
          if (this._iBinSyncReloadTimer) {
            clearTimeout(this._iBinSyncReloadTimer);
            this._iBinSyncReloadTimer = null;
          }
          if (this._iGateOutBinTrolleyReloadTimer) {
            clearTimeout(this._iGateOutBinTrolleyReloadTimer);
            this._iGateOutBinTrolleyReloadTimer = null;
          }
          if (this._iGateOutBinReloadTimer) {
            clearTimeout(this._iGateOutBinReloadTimer);
            this._iGateOutBinReloadTimer = null;
          }
          if (this._iReloadFromTripExpandTimer) {
            clearTimeout(this._iReloadFromTripExpandTimer);
            this._iReloadFromTripExpandTimer = null;
          }
          if (this._iPendingOutgoingRefDocResolveTimer) {
            clearTimeout(this._iPendingOutgoingRefDocResolveTimer);
            this._iPendingOutgoingRefDocResolveTimer = null;
          }
          this._eventBus?.unsubscribe("TripData", "Updated", this._onTripDataUpdate, this);
          this._eventBus?.unsubscribe("RefDoc", "MaterialsUpdated", this._onRefDocMaterialsUpdated, this);
          this._eventBus?.unsubscribe("Stage", "TripCreated", this._onStageTripCreated, this);
          this._eventBus?.unsubscribe("GateOut", "ReloadFromTripExpand", this._onReloadFromTripExpand, this);
          this._eventBus?.unsubscribe("GateOut", "RefDocSaved", this._onGateOutRefDocSavedManual, this);
        },
        /**
         * True when Gate Out top search strip is hidden (external vehicle O02+VT02, etc.).
         * Manual reference-document save uses trip reconcile instead of the search-strip flow.
         */
        _isGateOutManualRefDocMaterialReconcileNeeded: function () {
          this._initGateOutUiModel();
          var oUi = this.getView().getModel("gateOutUi");
          return !!(oUi && oUi.getProperty("/showGateOutRefSearchStrip") === false);
        },
        /**
         * After manual Add Document on Gate Out (no search strip): second-pass trip read for ItemDetails.
         */
        _onGateOutRefDocSavedManual: function (sChannel, sEvent, oData) {
          var oTrip = sap.ui.getCore().getModel("TripData");
          if (String(oTrip?.getProperty("/MovementType") || "").toUpperCase() === "I") {
            return;
          }
          if (!this._isGateOutManualRefDocMaterialReconcileNeeded()) {
            return;
          }
          var sDocNumber = String(oData?.documentNumber || "").trim();
          if (!sDocNumber) {
            return;
          }
          this._gateOutSecondPassTripReconcile(sDocNumber);
        },
        _onRefDocMaterialsUpdated: function () {
          this._prunePersistedTrackingRowsByRefDocs();
          // Wait one UI tick so refDocModel filtered materials are updated before rebuilding bin rows.
          if (this._iGateOutRefDocReloadTimer) {
            clearTimeout(this._iGateOutRefDocReloadTimer);
          }
          this._iGateOutRefDocReloadTimer = setTimeout(function () {
            var oVm = this.getView().getModel("gateOutUi");
            var sMode = oVm
              ? String(oVm.getProperty("/referenceByKey") || "INVOICE").toUpperCase()
              : "INVOICE";
            var sTypedDoc = oVm ? String(oVm.getProperty("/refDocSearchValue") || "").trim() : "";
            var sDocNumber = this._getGateOutSelectedRefDocNumber(sMode, null, sTypedDoc);
            this._refreshGateOutBinsForSelectedDocument(sDocNumber);
          }.bind(this), 0);
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

            this._loadExitGateIfNeeded();
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
            this._requestGateOutBinTrolleyReload(0);
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
        _loadGateOutBinTrolleyData: function () {
          var oVm = this.getView().getModel("binTrolleyTracking");
          this._iGateOutBinLoadSeq = (this._iGateOutBinLoadSeq || 0) + 1;
          var iRequestSeq = this._iGateOutBinLoadSeq;
          if (!oVm) {
            return;
          }
          if (
            this._iGateOutBinSaveSuppressReloadUntil &&
            Date.now() < this._iGateOutBinSaveSuppressReloadUntil
          ) {
            return;
          }
          // Keep backend reads aligned with Bin/Trolley applicability.
          // If panel is not applicable/visible, skip EmptyBins service calls.
          this._updateBinTrolleyVisibility();
          var oUi = this.getView().getModel("ui");
          var bShowBinTrolley = !!(oUi && oUi.getProperty("/showBinTrolleyTracking"));
          var sTripNumber = this._getTripNumber();
          if (!bShowBinTrolley) {
            this._setTrackingItems(oVm, this._mergeWithPersistedRows(sTripNumber, []));
            oVm.setProperty("/isPosted", true);
            this._recalculateTrackingTotals();
            return;
          }
          if (!sTripNumber) {
            this._setTrackingItems(oVm, this._mergeWithPersistedRows(sTripNumber, []));
            oVm.setProperty("/isPosted", true);
            this._recalculateTrackingTotals();
            return;
          }
          if (iRequestSeq !== this._iGateOutBinLoadSeq) {
            return;
          }
          this._refreshGateOutBinsForSelectedDocument();
        },
        _requestGateOutBinTrolleyReload: function (iDelay) {
          var iWait = typeof iDelay === "number" ? iDelay : 0;
          if (this._iGateOutBinTrolleyReloadTimer) {
            clearTimeout(this._iGateOutBinTrolleyReloadTimer);
            this._iGateOutBinTrolleyReloadTimer = null;
          }
          this._iGateOutBinTrolleyReloadTimer = setTimeout(
            function () {
              var sTrip = String(this._getTripNumber() || "").trim();
              var iNow = Date.now();
              if (
                sTrip &&
                this._sLastGateOutBinReloadTrip === sTrip &&
                iNow - (this._iLastGateOutBinReloadAt || 0) < 250
              ) {
                return;
              }
              this._sLastGateOutBinReloadTrip = sTrip;
              this._iLastGateOutBinReloadAt = iNow;
              this._loadGateOutBinTrolleyData();
            }.bind(this),
            iWait
          );
        },
        /**
         * Loads exit-gate ConfigValues for ConfigGroup ExitGate, always filtered by TripNumber when known.
         */
        loadExitGateNumber: function () {
          var sTripNumber = this._getTripNumber();
          if (/^\d+$/.test(sTripNumber)) {
            sTripNumber = sTripNumber.padStart(10, "0");
          }
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

              var oExitCombo = this.getView().byId("idExitGateNumber");
              var oTripData =
                this.getView().getModel("TripData") ||
                sap.ui.getCore().getModel("TripData");
              var sExistingExitGateNum = "";
              if (oTripData) {
                sExistingExitGateNum = String(oTripData.getProperty("/ExitGateNum") || "").trim();
              }

              if (this._ExitGateData.length > 0 && oExitCombo && oExitCombo.setSelectedKey) {
                var sFirstGate = this._ExitGateData[0].ConfigID;
                if (sFirstGate !== undefined && sFirstGate !== null) {
                  var sFirstGateKey = String(sFirstGate).trim();
                  var bHasExistingInList = !!this._ExitGateData.some(function (oGate) {
                    return String(oGate.ConfigID || "").trim() === sExistingExitGateNum;
                  });
                  var sUiKey = bHasExistingInList && sExistingExitGateNum ? sExistingExitGateNum : sFirstGateKey;
                  oExitCombo.setSelectedKey(sUiKey);
                }
              }
            }.bind(this),
            error: function (oError) {
              var sBackendMsg = this._extractErrorMessage(oError);
              var sErrorMessage =
                sBackendMsg && sBackendMsg !== "Something went wrong"
                  ? sBackendMsg
                  : "Failed to load Exit gates.";
              sap.m.MessageBox.error(sErrorMessage);
            }.bind(this),
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
        formatGateOutBinTypeText: function (oRow) {
          if (!oRow) {
            return "";
          }
          var sBinType = oRow.BinTypeDesc || oRow.BintypeDesc || oRow.BinTypeDescription || oRow.BinTypes || oRow.BinType || "";
          var sIcon = String(sBinType).toLowerCase().indexOf("plastic") >= 0 ? "ðŸ“¦" : "ðŸ›’";
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

          var oTrackingSaveCheck = this.getView().getModel("binTrolleyTracking");
          var aTrackingRows = this._getTrackingItems(oTrackingSaveCheck);
          var aTrackingRowsValid = aTrackingRows.filter(function (oRow) {
            return (
              String(oRow.DocumentNumber || "").trim() !== "" &&
              String(oRow.ItemNo || "").trim() !== ""
            );
          });
          var bGateOutBinPanelVisible =
            this.getView().getModel("ui") &&
            this.getView().getModel("ui").getProperty("/showBinTrolleyTracking");
          if (
            bGateOutBinPanelVisible &&
            aTrackingRowsValid.length &&
            !(oTrackingSaveCheck && oTrackingSaveCheck.getProperty("/isPosted"))
          ) {
            MessageBox.error(
              "Please save Bin / Trolley tracking to backend before completing Gate Out."
            );
            return;
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
                  VerifiedDocuments: bVerifiedDocs
                },
                headers: {
                  "X-Requested-With": "X",
                },
                success: function () {
                  var sMessage = bIsFirstTime
                    ? "Gate Out completed successfully for Trip " + sTripNumber + "."
                    : "Gate Out completed successfully for Trip " + sTripNumber + ".";
                  this._refreshTripFromBackend(sTripNumber);
                  this._eventBus.publish("Stage", "TripCreated", {
                    tripNumber: sTripNumber,
                    preferredTabKey: "gateout"
                  });

                  if (this._aSelectedFiles && this._aSelectedFiles.length > 0) {
                    this._uploadGateOutAttachments(
                      function (bSuccess) {
                        if (bSuccess) {
                          MessageBox.success(
                            sMessage + " Attachments uploaded successfully!",
                            {
                              onClose: function () {
                                this._navigateToHomeAfterGateSave();
                              }.bind(this),
                            }
                          );
                        } else {
                          MessageBox.success(sMessage, {
                            onClose: function () {
                              MessageBox.warning("Some attachments failed to upload.", {
                                onClose: function () {
                                  this._navigateToHomeAfterGateSave();
                                }.bind(this),
                              });
                            }.bind(this),
                          });
                        }
                        this._setInputsEnabled(false);
                        this._loadGateOutAttachments(true);
                      }.bind(this)
                    );
                  } else {
                    MessageBox.success(sMessage, {
                      onClose: function () {
                        this._navigateToHomeAfterGateSave();
                      }.bind(this),
                    });
                    this._setInputsEnabled(false);
                  }
                }.bind(this),
                error: function (oError) {
                  var sBackendMsg = this._extractErrorMessage(oError);
                  var sErrorMessage =
                    sBackendMsg && sBackendMsg !== "Something went wrong"
                      ? sBackendMsg
                      : "Failed Gate Out.";
                  MessageBox.error(sErrorMessage);
                }.bind(this),
              });
        },
        _navigateToHomeAfterGateSave: function () {
          this._eventBus.publish("HomePage", "RefreshTripTable");
          var oRouter = this.getOwnerComponent() && this.getOwnerComponent().getRouter();
          if (oRouter) {
            oRouter.navTo("HomePage");
          }
        },
        _refreshTripFromBackend: function (sTripNumber) {
          var sTrip = String(sTripNumber || "").trim();
          if (!sTrip) {
            return;
          }

          var sToken = Date.now().toString();
          this._sLastTripRefreshToken = sToken;

          this.oModel.read("/TripDetails('" + sTrip + "')", {
            urlParameters: {
              "$expand": "OrderDetails,ItemDetails,Feeds,ActivityHistory"
            },
            success: function (oData) {
              if (this._sLastTripRefreshToken !== sToken) {
                return;
              }
              TripDataDocumentsVerified.applyDocumentsVerifiedToVerifiedDocs(oData);
              var oTripDataModel = new JSONModel(oData);
              sap.ui.getCore().setModel(oTripDataModel, "TripData");
              this.getView().setModel(oTripDataModel, "TripData");
              sap.ui.getCore().getEventBus().publish("TripData", "Updated");
            }.bind(this),
            error: function () {
              // No-op: write operation already succeeded.
            }
          });
        },
        onEditGateOut: function () {
          var bTripLocked = !!(sap.ui.getCore().getModel("globalData")?.getProperty("/TripLocked"));
          if (bTripLocked) {
            MessageToast.show("Trip is completed. Editing is disabled.");
            this._setInputsEnabled(false);
            return;
          }
          // Enable inputs for edit mode (authorization checks removed)
          this._setInputsEnabled(true);
          MessageToast.show("Edit mode activated");
        },
        _setInputsEnabled: function (bEnabled) {
          try {
            var bTripLocked = !!(sap.ui.getCore().getModel("globalData")?.getProperty("/TripLocked"));
            var bEffectiveEnabled = !!bEnabled && !bTripLocked;
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
                if (ctrl.setEnabled) ctrl.setEnabled(bEffectiveEnabled);
                if (ctrl.setEditable) ctrl.setEditable(bEffectiveEnabled);
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
                  ctrl.setEnabled(bEffectiveEnabled);
                }
                return;
              }
              
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
                // For controls that only support setEnabled (like RadioButtonGroup, FileUploader)
                try {
                  ctrl.setEnabled(bEffectiveEnabled);
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
        _loadGateOutAttachments: function (bForce) {
          // Ensure attachments model is initialized
          if (!this._oGateOutAttachmentsModel) {
            this._initGateOutAttachmentsModel();
          }

          var oGlobalModel = sap.ui.getCore().getModel("globalData");
          var sTripNumber = oGlobalModel?.getProperty("/TripNumber") || "";

          if (!sTripNumber) {
            this._oGateOutAttachmentsModel.setProperty("/attachments", []);
            this._sGateOutAttachmentsTripLoading = "";
            return;
          }
          if (!bForce && this._sGateOutAttachmentsTripLoading === sTripNumber) {
            return;
          }
          if (
            !bForce &&
            this._sGateOutAttachmentsLastLoadedTrip === sTripNumber &&
            Date.now() - (this._iGateOutAttachmentsLastLoadedAt || 0) < 1000
          ) {
            return;
          }
          this._sGateOutAttachmentsTripLoading = sTripNumber;

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
              this._sGateOutAttachmentsLastLoadedTrip = sTripNumber;
              this._iGateOutAttachmentsLastLoadedAt = Date.now();
              this._sGateOutAttachmentsTripLoading = "";
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
                  this._sGateOutAttachmentsLastLoadedTrip = sTripNumber;
                  this._iGateOutAttachmentsLastLoadedAt = Date.now();
                  this._sGateOutAttachmentsTripLoading = "";
                }.bind(this),
                error: function () {
                  this._oGateOutAttachmentsModel.setProperty("/attachments", []);
                  this._sGateOutAttachmentsTripLoading = "";
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

