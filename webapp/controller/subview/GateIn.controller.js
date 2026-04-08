sap.ui.define(
  [
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/odata/v2/ODataModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/ui/model/json/JSONModel",
    "com/incresolZ_INC_PLMS/util/PanelAccordion",
    "com/incresolZ_INC_PLMS/util/O02GateException",
  ],
  function (
    Controller,
    ODataModel,
    MessageToast,
    MessageBox,
    JSONModel,
    PanelAccordion,
    O02GateException
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
          this._eventBus = sap.ui.getCore().getEventBus();
          this._eventBus.subscribe("TripData", "Updated", this._onTripDataUpdate, this);
          this._eventBus.subscribe("Stage", "ClearAllTabs", this._clearAllData, this);
          this._bGateInEditMode = false;
          this._bGateInReadOnlyAfterSave = false;
          this._sGateInReadOnlyTripNumber = "";
          
          // Initialize weighment required if not set (default to "No")
          var oTripData = sap.ui.getCore().getModel("TripData");
          if (oTripData && !oTripData.getProperty("/WeighmentRequired")) {
            oTripData.setProperty("/WeighmentRequired", "N");
          }
          if (oTripData) {
            var vSkip = oTripData.getProperty("/RefDocSkip");
            if (vSkip === undefined || vSkip === null || vSkip === "") {
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

          this._initBinTrolleyTrackingModel();
          this._initBinTrolleyVisibilityModel();
          this._updateBinTrolleyVisibility();
          
          // Initialize selected files array
          this._aSelectedFiles = [];
          PanelAccordion.attach(this.getView());

        },

        _initBinTrolleyTrackingModel: function () {
          var oTrackingModel = new JSONModel({
            rows: [this._getEmptyTrackingRow()],
            totalQtyIn: 0,
            totalDifference: 0
          });
          this.getView().setModel(oTrackingModel, "binTrolleyTracking");
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
            "[BinTracking][GateIn] visibility",
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
            TripNumber: "",
            DocumentNumber: "",
            ItemNo: "",
            Customer: "",
            CusromerName: "",
            Material: "",
            BinTypes: "",
            QtyIn: "",
            QtyOut: "",
            Difference: "",
            ReturnStatus: ""
          };
        },

        onAddTrackingRow: function () {
          var oTrackingModel = this.getView().getModel("binTrolleyTracking");
          if (!oTrackingModel) {
            return;
          }
          var aRows = oTrackingModel.getProperty("/rows") || [];
          aRows.push(this._getEmptyTrackingRow());
          oTrackingModel.setProperty("/rows", aRows);
          this._recalculateTrackingTotals();
        },

        onTrackingFieldLiveChange: function () {
          this._recalculateTrackingTotals();
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

          var aRows = oTrackingModel.getProperty("/rows") || [];
          if (iIndex < 0 || iIndex >= aRows.length) {
            return;
          }

          aRows.splice(iIndex, 1);
          if (!aRows.length) {
            aRows.push(this._getEmptyTrackingRow());
          }

          oTrackingModel.setProperty("/rows", aRows);
          this._recalculateTrackingTotals();
        },

        _recalculateTrackingTotals: function () {
          var oTrackingModel = this.getView().getModel("binTrolleyTracking");
          if (!oTrackingModel) {
            return;
          }
          var aRows = oTrackingModel.getProperty("/rows") || [];
          var iTotalQty = 0;
          var iTotalDiff = 0;

          aRows.forEach(function (oRow) {
            var iQtyIn = Number(oRow.QtyIn);
            var iQtyOut = Number(oRow.QtyOut);
            var iDiff = !isNaN(iQtyOut) && !isNaN(iQtyIn) ? (iQtyOut - iQtyIn) : Number(oRow.Difference);

            if (!isNaN(iDiff)) {
              oRow.Difference = iDiff;
            }
            oRow.ReturnStatus = this._deriveTrackingStatus(iQtyIn, iQtyOut, iDiff, oRow.ReturnStatus);
            if (!isNaN(iQtyIn)) {
              iTotalQty += iQtyIn;
            }
            if (!isNaN(iDiff)) {
              iTotalDiff += iDiff;
            }
          }.bind(this));

          oTrackingModel.setProperty("/totalQtyIn", iTotalQty);
          oTrackingModel.setProperty("/totalDifference", iTotalDiff);
          oTrackingModel.refresh(true);
        },

        _deriveTrackingStatus: function (iQtyIn, iQtyOut, iDiff, sFallbackStatus) {
          if (isNaN(iQtyIn) || isNaN(iQtyOut)) {
            return String(sFallbackStatus || "");
          }
          if (iQtyIn === iQtyOut) {
            return "Returned";
          }
          if (iQtyIn === 0 && iQtyOut > 0) {
            return "Not Returned";
          }
          if (iQtyIn > iQtyOut || (!isNaN(iDiff) && iDiff < 0)) {
            return "Excess Return";
          }
          if (iQtyIn < iQtyOut) {
            return "Partial Return";
          }
          return String(sFallbackStatus || "");
        },
        _escapeODataKey: function (s) {
          return String(s == null ? "" : s).trim().replace(/'/g, "''");
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
              return {
                DocumentNumber: String(oRow.refDocNo || "").trim(),
                ItemNo: String(oRow.refDocItemNo || "").trim()
              };
            })
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

        _loadBinTrolleyTrackingData: function () {
          var oTrackingModel = this.getView().getModel("binTrolleyTracking");
          var sTripNumber = String(this._getTripNumber() || "").trim();
          if (!oTrackingModel || !this.oModel) {
            return;
          }
          var aKeys = this._getGateInEmptyBinsReadKeys();
          if (!aKeys.length) {
            oTrackingModel.setProperty("/rows", [this._getEmptyTrackingRow()]);
            this._recalculateTrackingTotals();
            return;
          }
          var mItemNosByDoc = {};
          aKeys.forEach(function (oKey) {
            if (!mItemNosByDoc[oKey.DocumentNumber]) {
              mItemNosByDoc[oKey.DocumentNumber] = {};
            }
            mItemNosByDoc[oKey.DocumentNumber][oKey.ItemNo] = true;
          });
          var aDocumentNumbers = Object.keys(mItemNosByDoc);
          var aReads = aDocumentNumbers.map(function (sDocumentNumber) {
            return new Promise(function (resolve) {
              this.oModel.read("/EmptyBins", {
                filters: [
                  new sap.ui.model.Filter("TripNumber", sap.ui.model.FilterOperator.EQ, sTripNumber),
                  new sap.ui.model.Filter("DocumentNumber", sap.ui.model.FilterOperator.EQ, sDocumentNumber)
                ],
                urlParameters: {
                  $format: "json"
                },
                success: function (oData) {
                  var aRows = (oData && oData.results) || [];
                  var aFiltered = aRows.filter(function (oRow) {
                    var sItemNo = String(oRow.ItemNo || "").trim();
                    return !!mItemNosByDoc[sDocumentNumber][sItemNo];
                  });
                  resolve(aFiltered);
                },
                error: function () {
                  resolve([]);
                }
              });
            }.bind(this));
          }.bind(this));
          Promise.all(aReads).then(function (aResults) {
            var aRows = (aResults || [])
              .reduce(function (aAll, aPart) {
                return aAll.concat(aPart || []);
              }, [])
              .map(function (r) {
                var iQtyIn = Number(r.QtyIn);
                var iQtyOut = Number(r.QtyOut);
                var iDiff = !isNaN(iQtyIn) && !isNaN(iQtyOut) ? (iQtyOut - iQtyIn) : "";
                return {
                  TripNumber: r.TripNumber || sTripNumber,
                  DocumentNumber: r.DocumentNumber || "",
                  ItemNo: r.ItemNo || "",
                  Customer: r.Customer || "",
                  CusromerName: r.CusromerName || r.CustomerName || "",
                  Material: r.Material || "",
                  BinTypes: r.BinTypes || r.BinType || "",
                  QtyIn: r.QtyIn,
                  QtyOut: r.QtyOut,
                  Difference: iDiff,
                  ReturnStatus: this._deriveTrackingStatus(iQtyIn, iQtyOut, iDiff, r.ReturnStatus),
                  _entityPath: this._buildEmptyBinsPath(
                    r.TripNumber != null ? r.TripNumber : sTripNumber,
                    r.DocumentNumber,
                    r.ItemNo
                  )
                };
              }.bind(this));
            oTrackingModel.setProperty("/rows", aRows.length ? aRows : [this._getEmptyTrackingRow()]);
            this._recalculateTrackingTotals();
          }.bind(this));
        },

        _sanitizeTrackingPayloadRow: function (oRow, sTripNumber) {
          var iQtyIn = Number(oRow.QtyIn);
          var iQtyOut = Number(oRow.QtyOut);
          return {
            TripNumber: sTripNumber,
            DocumentNumber: String(oRow.DocumentNumber || ""),
            ItemNo: String(oRow.ItemNo || ""),
            Customer: String(oRow.Customer || ""),
            CusromerName: String(oRow.CusromerName || oRow.CustomerName || ""),
            Material: String(oRow.Material || ""),
            BinTypes: String(oRow.BinTypes || oRow.BinType || ""),
            QtyIn: isNaN(iQtyIn) ? "0" : String(Math.trunc(iQtyIn)),
            QtyOut: isNaN(iQtyOut) ? "0" : String(Math.trunc(iQtyOut))
          };
        },

        onSaveTrackingRows: function () {
          var oTrackingModel = this.getView().getModel("binTrolleyTracking");
          if (!oTrackingModel || !this.oModel) {
            MessageBox.error("Tracking model is not available.");
            return;
          }

          var sTripNumber = String(this._getTripNumber() || "").trim();
          if (!sTripNumber) {
            MessageBox.error("Trip number is missing.");
            return;
          }

          var aRows = oTrackingModel.getProperty("/rows") || [];
          var aRowsToSave = aRows.filter(function (oRow) {
            var bHasMaterial = String(oRow.Material || "").trim() !== "";
            var bHasQty = String(oRow.QtyIn || "").trim() !== "";
            return bHasMaterial || bHasQty;
          });

          if (!aRowsToSave.length) {
            MessageToast.show("No Bin/Trolley rows to save.");
            return;
          }

          this.getView().setBusy(true);
          var oModel = this.oModel;
          var bPrevUseBatch = !!oModel.bUseBatch;
          if (typeof oModel.setUseBatch === "function") {
            oModel.setUseBatch(true);
          }
          var sGroupId = "emptyBinsQtyInBatch";
          var sChangeSetId = "emptyBinsQtyInChangeSet";
          oModel.setDeferredGroups([sGroupId]);

          var fnFinalize = function (iSuccess, iFailed) {
            if (typeof oModel.setUseBatch === "function") {
              oModel.setUseBatch(bPrevUseBatch);
            }
            this.getView().setBusy(false);
            if (iFailed === 0) {
              MessageBox.success("Bin / Trolley tracking saved successfully.");
              this._loadBinTrolleyTrackingData();
            } else if (iSuccess > 0) {
              MessageBox.warning(
                "Bin / Trolley tracking partially saved. Success: " +
                  iSuccess +
                  ", Failed: " +
                  iFailed
              );
            } else {
              MessageBox.error("Failed to save Bin / Trolley tracking.");
            }
          }.bind(this);

          var iQueued = 0;
          var iSkipped = 0;
          aRowsToSave.forEach(function (oRow) {
            var sEntityPath = String(oRow._entityPath || "").trim();
            // Empty Return updates existing Gate-Out created rows only.
            if (!sEntityPath) {
              iSkipped += 1;
              return;
            }
            var iQtyIn = Number(oRow.QtyIn);
            oModel.update(sEntityPath, {
              QtyIn: isNaN(iQtyIn) ? "0" : String(Math.trunc(iQtyIn))
            }, {
              groupId: sGroupId,
              changeSetId: sChangeSetId,
              merge: true,
              headers: {
                "Content-Type": "application/json",
                "X-Requested-With": "X"
              }
            });
            iQueued += 1;
          });

          if (!iQueued) {
            fnFinalize(0, aRowsToSave.length);
            return;
          }

          oModel.refreshSecurityToken(function () {
            oModel.submitChanges({
              groupId: sGroupId,
              success: function (oBatchResponse) {
                var aBatch = (oBatchResponse && oBatchResponse.__batchResponses) || [];
                var iFailed = 0;
                var iSuccess = 0;
                aBatch.forEach(function (oResp) {
                  var aChanges = oResp && oResp.__changeResponses;
                  if (!aChanges || !aChanges.length) {
                    return;
                  }
                  aChanges.forEach(function (oChange) {
                    var sCode = String(oChange && oChange.statusCode ? oChange.statusCode : "");
                    if (sCode && sCode.charAt(0) === "2") {
                      iSuccess += 1;
                    } else {
                      iFailed += 1;
                    }
                  });
                });
                iFailed += iSkipped;
                fnFinalize(iSuccess, iFailed);
              },
              error: function () {
                fnFinalize(0, iQueued + iSkipped);
              }
            });
          }, function () {
            fnFinalize(0, iQueued + iSkipped);
          }, true);
        },
        
        _initGateInAttachmentsModel: function () {
          if (!this._oGateInAttachmentsModel) {
            this._oGateInAttachmentsModel = new JSONModel({ attachments: [] });
            this.getView().setModel(this._oGateInAttachmentsModel, "gateInAttachmentsModel");
          }
        },
        onAfterRendering: function () {
          // Load delay reasons first; entry gates load in the same chain (avoids parallel OData races)
          this.loadDelayReason();
          this._loadBinTrolleyTrackingData();
          this._updateBinTrolleyVisibility();
          
          if (this._bGateInReadOnlyAfterSave) {
            this._setInputsEnabled(false);
          } else {
            this._setInputsEnabled(true);
          }
          
          // Removed: this._loadGateInAttachments(); - will be loaded via event subscription when TripData is available
        },
        onExit: function () {
          this._eventBus?.unsubscribe("TripData", "Updated", this._onTripDataUpdate, this);
          this._eventBus?.unsubscribe("Stage", "ClearAllTabs", this._clearAllData, this);
        },
        
        _clearAllData: function () {
          this._bGateInEditMode = false;
          this._bGateInReadOnlyAfterSave = false;
          this._sGateInReadOnlyTripNumber = "";
          // Clear attachments model
          if (this._oGateInAttachmentsModel) {
            this._oGateInAttachmentsModel.setData({ attachments: [] });
          }
          
          // Clear selected files
          this._aSelectedFiles = [];

          var oTrackingModel = this.getView().getModel("binTrolleyTracking");
          if (oTrackingModel) {
            oTrackingModel.setData({
              rows: [this._getEmptyTrackingRow()],
              totalQtyIn: 0,
              totalDifference: 0
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
        },
        _onTripDataUpdate: function () {
          var oTripData = sap.ui.getCore().getModel("TripData");
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
            this._syncEntryGateSelectionFromTripData();
            this._syncDelayReasonSelectionFromTripData();
            this._refreshGateSelectKeysFromModels();
            this._loadBinTrolleyTrackingData();
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
          if (sCode) {
            var bFound = aItems.some(function (i) {
              return String(i.ProductId) === String(sCode);
            });
            this._oDelayReasonSelectModel.setProperty("/SelectedDelayKey", bFound ? sCode : "");
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

          if (this._requiresMandatoryGateInBinDetails()) {
            var oTracking = this.getView().getModel("binTrolleyTracking");
            var aRows = oTracking ? oTracking.getProperty("/rows") || [] : [];
            var aValid = aRows.filter(function (oRow) {
              var bHasMaterial = String(oRow.Material || "").trim() !== "";
              var bHasQty = String(oRow.QtyIn || "").trim() !== "";
              return bHasMaterial || bHasQty;
            });
            if (!aValid.length) {
              MessageBox.error(
                "Bin / Trolley details are required. Enter and save bin tracking before completing Gate In."
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

          // Function Import Call with Custom Headers
          
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
                ? "Gate In information created successfully!" 
                : "Gate In information updated successfully!";
              console.info("[GateIn][SaveSuccess]", {
                tripNumber: sTripNumber,
                preferredTabKey: "gateIn",
                hasAttachments: !!(this._aSelectedFiles && this._aSelectedFiles.length > 0)
              });
              
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
                this._uploadGateInAttachments(function(bSuccess) {
                  if (bSuccess) {
                    MessageBox.success(sMessage + " Attachments uploaded successfully!");
                  } else {
                    MessageBox.success(sMessage);
                    MessageBox.warning("Some attachments failed to upload.");
                  }
                  this._setInputsEnabled(false);
                  // Reload attachments list
                  this._loadGateInAttachments();
                });
              } else {
                MessageBox.success(sMessage);
              }
            }.bind(this),
            error: function (oError) {
              this.getView().setBusy(false);

              let sMessage = "Failed to Gate In"; // default message

              try {
                // oError.responseText is JSON string from backend
                const oResponse = JSON.parse(oError.responseText);
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
          this._bGateInReadOnlyAfterSave = false;
          this._sGateInReadOnlyTripNumber = "";
          this._bGateInEditMode = true;
          this._setInputsEnabled(true);
          MessageToast.show("Edit mode activated");
        },
        _setInputsEnabled: function (bEnabled) {
          try {
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
              if (!bVehicleReported && sCtrlId) {
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
                  ctrl.setEditable(bEnabled);
                } catch (e) {
                  // Fallback to setEnabled if setEditable fails
                  if (ctrl.setEnabled) {
                    ctrl.setEnabled(bEnabled);
                  }
                }
              } else if (ctrl.setEnabled) {
                // For controls that only support setEnabled (like RadioButtonGroup)
                try {
                  ctrl.setEnabled(bEnabled);
                } catch (e) {
                  // Ignore errors
                }
              }
            });
            
            if (this._oEntryGateSelectModel) {
              var bGateEditable = !bVehicleReported ? true : bEnabled;
              this._oEntryGateSelectModel.setProperty("/Enabled", bGateEditable);
              this._oEntryGateSelectModel.setProperty("/Editable", bGateEditable);
            }

            if (this._oDelayReasonSelectModel) {
              var bDelayEditable = !bVehicleReported ? true : bEnabled;
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
        _loadGateInAttachments: function () {
          // Ensure attachments model is initialized
          if (!this._oGateInAttachmentsModel) {
            this._initGateInAttachmentsModel();
          }

          var oGlobalModel = sap.ui.getCore().getModel("globalData");
          var sTripNumber = oGlobalModel?.getProperty("/TripNumber") || "";

          if (!sTripNumber) {
            this._oGateInAttachmentsModel.setProperty("/attachments", []);
            return;
          }

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
                }.bind(this),
                error: function () {
                  this._oGateInAttachmentsModel.setProperty("/attachments", []);
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

        _reloadTripDataAfterSave: function (sTripNumber, sEntryGateNumber, sDelayReasons) {
          
          var oModel = this.oModel;
          var that = this;
          
          // Read complete TripDetails with expanded data
          oModel.read("/TripDetails('" + sTripNumber + "')", {
            urlParameters: {
              "$expand": "OrderDetails,ItemDetails,ActivityHistory"
            },
            success: function (oData) {
              
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
              
              // Update global TripData model
              var oTripDataModel = new sap.ui.model.json.JSONModel(oData);
              sap.ui.getCore().setModel(oTripDataModel, "TripData");
              
              // Update view model
              that.getView().setModel(oTripDataModel, "TripData");
              
              // Publish event to notify other views with complete data
              that._eventBus.publish("TripData", "Updated");
              
            },
            error: function (oError) {
              // Failed to reload TripData after Gate-In save
              
              // Fallback: just update the EntryGateNum property
              var oTripData = sap.ui.getCore().getModel("TripData");
              if (oTripData) {
                oTripData.setProperty("/EntryGateNum", sEntryGateNumber);
                that._eventBus.publish("TripData", "Updated");
              }
            }
          });
        },

        formatTrackingDifferenceText: function (vDifference) {
          var iDiff = Number(vDifference);
          if (isNaN(iDiff)) {
            return "0";
          }
          if (iDiff > 0) {
            return "+" + iDiff;
          }
          return String(iDiff);
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
          case "partial return":
            return "Warning";
          case "not returned":
            return "Error";
          case "excess return":
            return "Information";
          default:
            return "None";
          }
        },

        formatTrackingQtyValueState: function (sStatus) {
          switch (String(sStatus || "").toLowerCase()) {
          case "returned":
            return "Success";
          case "partial return":
            return "Warning";
          case "not returned":
            return "Error";
          case "excess return":
            return "Information";
          default:
            return "None";
          }
        },

        formatTrackingTotalLine: function (vTotalQty) {
          return "TOTAL  " + (vTotalQty == null ? "0" : String(vTotalQty));
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
