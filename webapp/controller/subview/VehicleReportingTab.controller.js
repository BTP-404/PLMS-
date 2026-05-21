sap.ui.define(
  [
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/odata/v2/ODataModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/ui/model/json/JSONModel",
    "sap/ui/core/Fragment",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/ndc/BarcodeScanner",
    "com/incresolZ_INC_PLMS/util/MovementScenarioIcons",
    "com/incresolZ_INC_PLMS/util/MovementScenarioConfig",
    "com/incresolZ_INC_PLMS/util/TripDataDocumentsVerified",
    "sap/ui/core/format/DateFormat",
  ],
  function (
    Controller,
    ODataModel,
    MessageToast,
    MessageBox,
    JSONModel,
    Fragment,
    Filter,
    FilterOperator,
    BarcodeScanner,
    MovementScenarioIcons,
    MovementScenarioConfig,
    TripDataDocumentsVerified,
    DateFormat
  ) {
    "use strict";
    var movementScenario;
    var Mtype;
    var movementType;
    return Controller.extend(
      "com.incresolZ_INC_PLMS.controller.subview.VehicleReportingTab",
      {
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

        /* ===========================================================
         * NO CHANGE: onInit (kept original, only comment added)
         * =========================================================== */
        onInit: function () {
          this._initService();
          this._bReportingSaveInFlight = false;
          this._loadVehicleSuggestions();
          this._loadVehicleTypeSuggestions();
          this.getView().setModel(new JSONModel([]), "movementScenarioItems");
          this.getView().setModel(new JSONModel({ items: [] }), "poNumberSuggestions");
          // Reporting "Reference Document" search-by style UI state + suggestions
          this.getView().setModel(
            new JSONModel({
              // ConfigID selected from /ConfigValues (ConfigGroup = "DocType")
              referenceByKey: "",
              // Internal suggestion mode (INVOICE/CHALLAN/PO) derived from selected doc type
              referenceByMode: "INVOICE",
              refDocSearchValue: "",
            }),
            "reportingUi"
          );
          this.getView().setModel(new JSONModel({ items: [] }), "reportingRefSuggest");
          this.getView().setModel(new JSONModel({ items: [] }), "docTypeItems");
          this._loadMovementScenarioItems();
          this._syncOutgoingDirectSaleScenarioFromConfig();

          const oRouter = this.getOwnerComponent().getRouter();
          oRouter
            .getRoute("Stage")
            .attachPatternMatched(this._onRouteMatched, this);
          oRouter
            .getRoute("StagewithParam")
            .attachPatternMatched(this._onRouteMatched, this);
          
          // Subscribe to event to clear all data when reporting new vehicle
          this._oEventBus = sap.ui.getCore().getEventBus();
          this._oEventBus.subscribe("Stage", "ClearAllTabs", this._clearAllData, this);
          this._oEventBus.subscribe("TripData", "Updated", this._onTripDataUpdated, this);
        },

        onExit: function () {
          if (this._iPoSuggestTimeout) {
            clearTimeout(this._iPoSuggestTimeout);
            this._iPoSuggestTimeout = null;
          }
          if (this._iReportingRefSuggestTimeout) {
            clearTimeout(this._iReportingRefSuggestTimeout);
            this._iReportingRefSuggestTimeout = null;
          }
          // Unsubscribe from event bus to prevent memory leaks
          if (this._oEventBus) {
            this._oEventBus.unsubscribe("Stage", "ClearAllTabs", this._clearAllData, this);
            this._oEventBus.unsubscribe("TripData", "Updated", this._onTripDataUpdated, this);
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

        onAfterRendering: function () {
          // Use setTimeout to ensure controls exist before updating scanner visibility
          setTimeout(function() {
            this._updateScannerVisibility();
            this._setButtonStates(true, true);
          }.bind(this), 200);
        },

        /* ===========================================================
         * NO CHANGE: _initService
         * =========================================================== */
        _initService: function () {
          const oModel = new ODataModel("/sap/opu/odata/sap/YIGP_PLMS_SRV/", {
            useBatch: false,
            defaultBindingMode: "TwoWay",
          });
          this.getView().setModel(oModel);
        },

        /* ===========================================================
         * NO CHANGE with small enhancement: Route Handling
         * - uses existing logic but ensures input enabling/disabling
         * =========================================================== */
        _onRouteMatched: function (oEvent) {
          const sRoute = oEvent.getParameter("name");
          const oArgs = oEvent.getParameter("arguments") || {};

          if (sRoute === "Stage") {
            // CREATE mode - clear all data first
            this._mode = "CREATE";
            
            this._clearAllData();
            this._clearForm();

            // ADDED: make sure inputs are enabled in CREATE
            this._setInputsEnabled(true); // ADDED
            this._setFormEditable(true);
            this._setButtonStates(true, true); // both visible and enabled
            this.getView().byId("changeHistoryPanel").setVisible(false);
            MessageToast.show("New Vehicle Reporting ");

            // Update scanner visibility when route is matched
            setTimeout(function() {
              this._updateScannerVisibility();
            }.bind(this), 300);
          } else if (sRoute === "StagewithParam") {
            // DISPLAY mode
            this._mode = "DISPLAY";
            const sTripNumber = oArgs.tripNo;
            // Change History shown only once at end of merged Gate In screen (GateIn.view.xml)
            this.getView().byId("changeHistoryPanel").setVisible(false);

            var fnNormalizeTrip = function (sTrip) {
              var sVal = String(sTrip || "").trim();
              return /^\d+$/.test(sVal) ? sVal.padStart(10, "0") : sVal;
            };
            var sReqTrip = fnNormalizeTrip(sTripNumber);
            var oCoreTripData = sap.ui.getCore().getModel("TripData");
            var sCoreTrip = oCoreTripData
              ? fnNormalizeTrip(oCoreTripData.getProperty("/TripNumber"))
              : "";
            if (oCoreTripData && sReqTrip && sReqTrip === sCoreTrip) {
              // Trip is already loaded by Stage route loader; reuse model and avoid duplicate backend read.
              this._hydrateReportingUiAliases(oCoreTripData.getData());
              TripDataDocumentsVerified.applyDocumentsVerifiedToVerifiedDocs(
                oCoreTripData.getData()
              );
              this._syncMovementScenarioItemKeyOnTripData(oCoreTripData);
              oCoreTripData.refresh(true);
              this.getView().setModel(oCoreTripData, "TripData");
              this._setInputsEnabled(false);
              this._setButtonStates(true, true);
            } else {
              this._loadTripDetails(sTripNumber);
            }
            
            // Update scanner visibility when trip details are loaded
            setTimeout(function() {
              this._updateScannerVisibility();
            }.bind(this), 300);
          }
        },

        /* ===========================================================
         * ADDED: _loadTripDetailsForHeader
         * - loads TripDetails after creation to update header
         * - does not disable inputs or change form state
         * =========================================================== */
        _loadTripDetailsForHeader: function (sTripNumber, sPreferredTabKey) {
          const oModel = this.getView().getModel();
          const that = this;

          oModel.read("/TripDetails('" + sTripNumber + "')", {
            urlParameters: {
              "$expand": "OrderDetails,ItemDetails,Feeds,ActivityHistory"
            },
            success: function (oData) {
              // Map Weighment_Req (boolean) from backend to WeighmentRequired ("Y"/"N") for frontend
              if (oData.Weighment_Req !== undefined) {
                // Convert boolean to "Y"/"N" format for frontend
                oData.WeighmentRequired = oData.Weighment_Req === true || oData.Weighment_Req === "X" ? "Y" : "N";
              }
              that._hydrateReportingUiAliases(oData);
              TripDataDocumentsVerified.applyDocumentsVerifiedToVerifiedDocs(oData);

              // Create JSON model for trip data
              const oTripDataModel = new sap.ui.model.json.JSONModel(oData);
              that._syncMovementScenarioItemKeyOnTripData(oTripDataModel);

              // Set as global model available across ALL views
              sap.ui.getCore().setModel(oTripDataModel, "TripData");
              
              // Publish event to update header in Stage controller
              sap.ui.getCore().getEventBus().publish("TripData", "Updated");
              
              // Publish custom event to notify Stage controller that trip was created
              // This will update _bCreateMode and _sCurrentTripNumber in Stage controller
              sap.ui.getCore().getEventBus().publish("Stage", "TripCreated", {
                tripNumber: sTripNumber,
                preferredTabKey: sPreferredTabKey || ""
              });

              // Also bind to this view
              that.getView().setModel(oTripDataModel, "TripData");

              movementScenario = oData.MovementScenario;
              Mtype = oData.MovementType;

              if (that._shouldSyncOutgoingDirectSaleConfig(oData.MovementType)) {
                MovementScenarioConfig.syncOutgoingDirectSaleFromConfig(
                  oModel,
                  sTripNumber,
                  that.getView()
                );
              }
            },
            error: function () {
              // Even if loading fails, try to update header with trip number
              sap.ui.getCore().getEventBus().publish("Stage", "TripCreated", {
                tripNumber: sTripNumber,
                preferredTabKey: sPreferredTabKey || ""
              });
            },
          });
        },

        _getCurrentStageTabKey: function () {
          var oNode = this.getView();
          while (oNode && !oNode.byId) {
            oNode = oNode.getParent ? oNode.getParent() : null;
          }

          var oIconTabBar = oNode && oNode.byId ? oNode.byId("iconTabBar") : null;
          if (oIconTabBar && oIconTabBar.getSelectedKey) {
            return String(oIconTabBar.getSelectedKey() || "").trim();
          }

          var oRootControl = this.getOwnerComponent && this.getOwnerComponent().getRootControl
            ? this.getOwnerComponent().getRootControl()
            : null;
          oIconTabBar = oRootControl && oRootControl.byId ? oRootControl.byId("iconTabBar") : null;
          if (oIconTabBar && oIconTabBar.getSelectedKey) {
            return String(oIconTabBar.getSelectedKey() || "").trim();
          }
          return "";
        },

        /* ===========================================================
         * NO CHANGE with slight behavioral improvement: _loadTripDetails
         * - loads TripDetails and disables inputs for view mode
         * =========================================================== */
        _loadTripDetails: function (sTripNumber) {
          const oModel = this.getView().getModel();
          const that = this;
          this._setButtonStates(true, true); // Ensure visible/enabled before load

          oModel.read("/TripDetails('" + sTripNumber + "')", {
            urlParameters: {
              "$expand": "OrderDetails,ItemDetails,Feeds,ActivityHistory"
            },
            success: function (oData) {
              // Map Weighment_Req (boolean) from backend to WeighmentRequired ("Y"/"N") for frontend
              if (oData.Weighment_Req !== undefined) {
                // Convert boolean to "Y"/"N" format for frontend
                oData.WeighmentRequired = oData.Weighment_Req === true || oData.Weighment_Req === "X" ? "Y" : "N";
              }
              that._hydrateReportingUiAliases(oData);
              TripDataDocumentsVerified.applyDocumentsVerifiedToVerifiedDocs(oData);

              // Create JSON model for trip data
              const oTripDataModel = new sap.ui.model.json.JSONModel(oData);
              that._syncMovementScenarioItemKeyOnTripData(oTripDataModel);

              //  Set as global model available across ALL views
              sap.ui.getCore().setModel(oTripDataModel, "TripData");
              sap.ui.getCore().getEventBus().publish("TripData", "Updated");

              // Also bind to this view (optional)
              that.getView().setModel(oTripDataModel, "TripData");

              movementScenario = oData.MovementScenario;
              Mtype = oData.MovementType;

              // UPDATED: call inputs helper to properly disable inputs
              that._setInputsEnabled(false); // UPDATED (was _setFormEditable(false))
              that._setButtonStates(true, true); // Re-enable after load
              MessageToast.show("Trip data loaded for: " + sTripNumber);
              
              // Update scanner visibility after trip data is loaded
              setTimeout(function() {
                that._updateScannerVisibility();
              }, 500);

              if (that._shouldSyncOutgoingDirectSaleConfig(oData.MovementType)) {
                MovementScenarioConfig.syncOutgoingDirectSaleFromConfig(
                  oModel,
                  sTripNumber,
                  that.getView()
                );
              }
            },
            error: function () {
              that._setButtonStates(true, true); // Still re-enable even on error
              MessageBox.error("Failed to load trip data for " + sTripNumber);
            },
          });
        },

        /* ===========================================================
         * UPDATED: onEditReporting
         * - originally called _setFormEditable(false) which disabled inputs.
         * - corrected so Edit enables inputs.
         * =========================================================== */
        onEditReporting: function () {
          var bTripLocked = !!(sap.ui.getCore().getModel("globalData")?.getProperty("/TripLocked"));
          if (bTripLocked) {
            MessageToast.show("Trip is completed. Editing is disabled.");
            return;
          }
          this._mode = "EDIT";

          this._setInputsEnabled(true);
          this._setFormEditable(true);

          MessageToast.show("Edit mode activated");
        },

        /* ===========================================================
         * UPDATED: onSaveReporting
         * - added mobile validation for CREATE and UPDATE modes (minimum 10 characters)
         * - keeps existing required field validation and create/update flows
         * =========================================================== */
        onSaveReporting: function () {
          if (this._bReportingSaveInFlight) {
            return;
          }
          var bTripLocked = !!(sap.ui.getCore().getModel("globalData")?.getProperty("/TripLocked"));
          if (bTripLocked) {
            MessageToast.show("Trip is completed. Save is not available.");
            return;
          }
          this._setReportingSaveInFlight(true);
          const oModel = this.getView().getModel();
          const oTripDataModel = this.getView().getModel("TripData");
          if (!oTripDataModel) {
            this._setReportingSaveInFlight(false);
            MessageBox.error("Trip data model not found.");
            return;
          }
          this._syncPendingReportingInputsBeforeSave();
          if (!this._validateRequiredFields()) {
            this._setReportingSaveInFlight(false);
            // Ensure users can SEE and FIX the invalid fields:
            // - expand the panel (often collapsed)
            // - enable inputs (valueState styling is subtle on non-editable controls)
            try {
              var oPanel = this.byId("reportingDetailsPanel");
              if (oPanel && oPanel.setExpanded) {
                oPanel.setExpanded(true);
              }
              this._setInputsEnabled(true);

              // Focus the first control currently in Error state
              var aCandidateIds = [
                "idMovementScenario",
                "idVehicleType",
                "idTransporterName",
                "idDriverName",
                "idDriverContact",
                "idMovementType"
              ];
              // IMPORTANT: Apply changes before opening MessageBox so the red ValueState
              // border is painted first (MessageBox can block the repaint).
              if (sap && sap.ui && sap.ui.getCore && sap.ui.getCore().applyChanges) {
                sap.ui.getCore().applyChanges();
              }

              setTimeout(
                function () {
                  for (var i = 0; i < aCandidateIds.length; i++) {
                    var oCtrl = this.byId(aCandidateIds[i]);
                    if (
                      oCtrl &&
                      oCtrl.getValueState &&
                      oCtrl.getValueState() === "Error" &&
                      oCtrl.focus
                    ) {
                      oCtrl.focus();
                      break;
                    }
                  }
                  MessageBox.warning(
                    "Please fill all required fields before saving."
                  );
                }.bind(this),
                0
              );
            } catch (e) {
              // ignore; keep warning message behavior unchanged
            }
            return;
          }

          // ADDED: Additional validation for CREATE and UPDATE modes
          const sMobile =
            this.getView().getModel("TripData")?.getProperty("/DriverMobile") || "";
          if (!this._isValidMobile(sMobile)) {
            this._setReportingSaveInFlight(false);
            var oDriverContact = this.byId("idDriverContact");
            if (oDriverContact) {
              oDriverContact.setValueState("Error");
              oDriverContact.setValueStateText(
                "Driver contact must be exactly 10 digits"
              );
            }
            MessageBox.warning(
              "Please enter a valid driver contact number (exactly 10 digits)."
            );
            return;
          } else {
            // clear any previous error state
            var oDriverContactOk = this.byId("idDriverContact");
            if (oDriverContactOk) {
              oDriverContactOk.setValueState("None");
              if (oDriverContactOk.setValueStateText) {
                oDriverContactOk.setValueStateText("");
              }
            }
          }

          var sMode = this._mode;
          if (sMode !== "CREATE" && sMode !== "EDIT") {
            // Derive a safe fallback mode so first click doesn't get ignored
            // when route/view lifecycle leaves mode as DISPLAY or undefined.
            var sTripNumber = String(this._getTripNumber() || "").trim();
            sMode = sTripNumber ? "EDIT" : "CREATE";
            this._mode = sMode;
          }

          if (sMode === "CREATE") {
            this._createTrip(oModel);
          } else if (sMode === "EDIT") {
            this._updateTrip(oModel);
          } else {
            this._setReportingSaveInFlight(false);
          }
        },

        _setReportingSaveInFlight: function (bInFlight) {
          this._bReportingSaveInFlight = !!bInFlight;
          var oSaveButton = this.byId("btnSaveReporting");
          if (oSaveButton) {
            oSaveButton.setEnabled(!bInFlight);
          }
        },

        _syncPendingReportingInputsBeforeSave: function () {
          var oTripDataModel = this.getView().getModel("TripData");
          if (!oTripDataModel) {
            return;
          }

          var aInputMappings = [
            { id: "idVehicleNumber", path: "/VehicleNumber" },
            { id: "idTransporterName", path: "/TransporterName" },
            { id: "idBillOfLading", path: "/BillofLading" },
            { id: "idDriverName", path: "/DriverName" },
            { id: "idDriverContact", path: "/DriverMobile" },
            { id: "idDriverLicense", path: "/DriverLicence" }
          ];
          aInputMappings.forEach(function (oMap) {
            var oControl = this.byId(oMap.id);
            if (oControl && oControl.getValue) {
              var sInputValue = String(oControl.getValue() || "").trim();
              if (oMap.id === "idVehicleNumber" || oMap.id === "idDriverLicense") {
                sInputValue = sInputValue.toUpperCase();
                if (oControl.setValue && oControl.getValue() !== sInputValue) {
                  oControl.setValue(sInputValue);
                }
              }
              oTripDataModel.setProperty(
                oMap.path,
                sInputValue
              );
            }
          }.bind(this));

          var oMovementScenario = this.byId("idMovementScenario");
          var sScenarioKey = oMovementScenario && oMovementScenario.getSelectedKey
            ? String(oMovementScenario.getSelectedKey() || "").trim()
            : "";
          var sScenarioValue = oMovementScenario && oMovementScenario.getValue
            ? String(oMovementScenario.getValue() || "").trim()
            : "";
          var oItemsModel = this.getView().getModel("movementScenarioItems");
          var aRows = (oItemsModel && oItemsModel.getData()) || [];
          var oRow = null;
          if (sScenarioKey) {
            oRow = aRows.find(function (r) {
              return r && r.ItemKey === sScenarioKey;
            }) || null;
          }
          if (!oRow && sScenarioValue) {
            var sNeedle = sScenarioValue.toLowerCase();
            oRow = aRows.find(function (r) {
              if (!r) {
                return false;
              }
              var sLong = String(r.LongText || "").trim().toLowerCase();
              var sShort = String(r.ShortText || "").trim().toLowerCase();
              var sScenario = String(r.MovementScenario || "").trim().toLowerCase();
              return sLong === sNeedle || sShort === sNeedle || sScenario === sNeedle;
            }) || null;
          }
          if (oRow) {
            this._syncMovementScenarioFromRow(oRow);
          }

          // Vehicle type can remain pending in control until blur/change fires.
          // Force-update TripData from current combo value before validation/save.
          var oVehicleType = this.byId("idVehicleType");
          if (oVehicleType) {
            var sVehicleTypeKey = oVehicleType.getSelectedKey
              ? String(oVehicleType.getSelectedKey() || "").trim()
              : "";
            var sVehicleTypeVal = oVehicleType.getValue
              ? String(oVehicleType.getValue() || "").trim()
              : "";
            // If the combo shows a description but selectedKey is still empty (timing / typing),
            // resolve ConfigID from the suggestion list so validation does not fail on VehicleType.
            var oVehicleTypeItemsModel = this.getView().getModel("vehicleTypeSuggestions");
            if (!sVehicleTypeKey && sVehicleTypeVal && oVehicleTypeItemsModel) {
              var aVtRows =
                (oVehicleTypeItemsModel.getProperty &&
                  oVehicleTypeItemsModel.getProperty("/items")) ||
                [];
              var oVtRow = aVtRows.find(function (r) {
                if (!r) {
                  return false;
                }
                var sDesc = String(r.Description || "").trim().toLowerCase();
                return sDesc && sDesc === sVehicleTypeVal.toLowerCase();
              });
              if (oVtRow && oVtRow.ConfigID) {
                sVehicleTypeKey = String(oVtRow.ConfigID).trim();
                if (oVehicleType.setSelectedKey) {
                  oVehicleType.setSelectedKey(sVehicleTypeKey);
                }
              }
            }
            if (sVehicleTypeKey) {
              oTripDataModel.setProperty("/VehicleType", sVehicleTypeKey);
            } else {
              oTripDataModel.setProperty("/VehicleType", "");
            }
            if (sVehicleTypeVal) {
              oTripDataModel.setProperty("/VehicleTypeDesc", sVehicleTypeVal);
            } else {
              oTripDataModel.setProperty("/VehicleTypeDesc", "");
            }
          }

          this._ensureMovementTypeDescFromMovementType(oTripDataModel);

          sap.ui.getCore().applyChanges();
        },

        /**
         * Ensures TripData has MovementTypeDesc when MovementType is set (e.g. OData load omits it).
         * Does not recompute MovementScenarioItemKey — avoid clearing a valid key before save validation.
         */
        _ensureMovementTypeDescFromMovementType: function (oTripDataModel) {
          if (!oTripDataModel) {
            return;
          }
          var sMtd = oTripDataModel.getProperty("/MovementTypeDesc");
          if (String(sMtd || "").trim() !== "") {
            return;
          }
          var sMtU = String(oTripDataModel.getProperty("/MovementType") || "")
            .trim()
            .toUpperCase();
          if (sMtU === "I") {
            oTripDataModel.setProperty("/MovementTypeDesc", "Inward");
          } else if (sMtU === "O") {
            oTripDataModel.setProperty("/MovementTypeDesc", "Outward");
          }
        },

        /* ===========================================================
         * NO CHANGE: _createTrip
         * - uses _collectFormData which returns TripData model content
         * =========================================================== */
        _createTrip: function (oModel) {
          const oData = this._collectFormData();

          // Store driver photo separately in Attachments, not in TripDetails
          var sDriverPhoto = oData.DriverPhoto;
          delete oData.DriverPhoto; // Remove from TripDetails payload
          // Do not send DocumentsVerified / UI-only VerifiedDocs on TripDetails create.
          delete oData.DocumentsVerified;
          delete oData.VerifiedDocs;
          // TripDetails does not expose weighment properties in metadata.
          // Keep this only in UI model; do not send in create payload.
          delete oData.WeighmentRequired;
          delete oData.Weighment_Req;
          delete oData.MovementScenarioItemKey;
          // Billing reference may exist on TripData from outgoing prefill/UI; omit from POST /TripDetails create.
          delete oData.BillingDocument;
          this._applyReportingFieldsToTripPayload(oData);

          oData.MovementScenario =
            movementScenario !== undefined && movementScenario !== null && movementScenario !== ""
              ? movementScenario
              : oData.MovementScenario;
          oData.MovementType =
            Mtype !== undefined && Mtype !== null && Mtype !== ""
              ? Mtype
              : oData.MovementType;
          //   oData.LR_Number = LRNumber;
          oData.LR_Date = this._getNormalizedDateTimeForPayload("idLRDate", "/LR_Date");

          const that = this;

          // ADDED: show busy while creating (non-invasive)
          this.getView().setBusy(true);

          oModel.create("/TripDetails", oData, {
            headers: {
              "X-Requested-With": "X",
            },
            success: function (oResponse) {
              // Check if global model already exists
              var oGlobalModel = sap.ui.getCore().getModel("globalData");

              if (!oGlobalModel) {
                oGlobalModel = new sap.ui.model.json.JSONModel({
                  TripNumber: "",
                });
                sap.ui.getCore().setModel(oGlobalModel, "globalData");
              }

              // Store the trip number globally
              var sTripNumber = oResponse.TripNumber;
              oGlobalModel.setProperty("/TripNumber", sTripNumber);

              that.getView().setBusy(false);
              var sFormattedTripNo = that.formatTripNumber(sTripNumber);
              that.getView().byId("idRelatedTripNumber").setValue(sFormattedTripNo);
              MessageToast.show(`Trip ( ${sFormattedTripNo} ) Created !`);
              
              // Save driver photo separately in Attachments if exists
              if (sDriverPhoto) {
                that._saveDriverPhotoToAttachments(sTripNumber, sDriverPhoto, oData.DriverName);
              }
              
              // Keep users on the same stage tab after reporting save.
              var sPreferredTabKey = that._getCurrentStageTabKey();
              if (!sPreferredTabKey) {
                var oStageUi = sap.ui.getCore().getModel("stageUi");
                var bReportingInGateOut = !!(
                  oStageUi && oStageUi.getProperty("/showReportingInGateOut")
                );
                sPreferredTabKey = bReportingInGateOut ? "gateout" : "gateIn";
              }
              // Load full trip details to populate TripData model and update header.
              that._loadTripDetailsForHeader(sTripNumber, sPreferredTabKey);
              
              // Clear MovementType from globalData (TripData model will have it now)
              if (oGlobalModel) {
                oGlobalModel.setProperty("/MovementType", "");
                oGlobalModel.setProperty("/MovementTypeDesc", "");
              }
              
              that._clearForm();
              that._setFormEditable(false);
              that._setInputsEnabled(false);
              that._setReportingSaveInFlight(false);
            },

            error: function (oError) {
              that.getView().setBusy(false);
              that._setReportingSaveInFlight(false);

              let sMessage = "Failed to create trip"; // default message

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
            },
          });
        },

        /* ===========================================================
         * UPDATED: _updateTrip
         * - Only updates TripDetails (no deep update / $expand payload)
         * - Strips navigation properties and __metadata before sending
         * =========================================================== */
        _updateTrip: function (oModel) {
          const oData = this._collectFormData();
          const sTripNumber = oData.TripNumber;
          const that = this;

          // Build a flat payload with only TripDetails fields (no nav props)
          const oUpdateData = Object.assign({}, oData);

          // Store driver photo separately in Attachments, not in TripDetails
          var sDriverPhoto = oUpdateData.DriverPhoto;
          var sDriverName = oUpdateData.DriverName;
          delete oUpdateData.DriverPhoto; // Remove from TripDetails payload
          // Do not send DocumentsVerified / UI-only VerifiedDocs on TripDetails update.
          delete oUpdateData.DocumentsVerified;
          delete oUpdateData.VerifiedDocs;

          // Delay reason: do not send DelayReason/DelayReasons (invalid TripDetails props).
          delete oUpdateData.DelayReason;
          delete oUpdateData.DelayReasons;

          // Remove navigation properties / deferred / collections
          delete oUpdateData.ActivityHistory;
          delete oUpdateData.Attachments;
          delete oUpdateData.OrderDetails;
          delete oUpdateData.ItemDetails;
          delete oUpdateData.Feeds;

          // Remove metadata
          delete oUpdateData.__metadata;

          // Remove WeighmentRequired and Weighment_Req from update payload
          // Weighment is managed separately (e.g., in GateIn screen), not in Vehicle Reporting update
          delete oUpdateData.WeighmentRequired;
          delete oUpdateData.Weighment_Req;
          delete oUpdateData.MovementScenarioItemKey;
          this._applyReportingFieldsToTripPayload(oUpdateData);

          oUpdateData.MovementScenario =
            movementScenario !== undefined && movementScenario !== null && movementScenario !== ""
              ? movementScenario
              : oUpdateData.MovementScenario;
          oUpdateData.MovementType =
            Mtype !== undefined && Mtype !== null && Mtype !== ""
              ? Mtype
              : oUpdateData.MovementType;
          
          // Handle LR_Date format (same as create)
          oUpdateData.LR_Date = this._getNormalizedDateTimeForPayload("idLRDate", "/LR_Date");

          // Only update TripDetails('<TripNumber>') – no deep update
          this.getView().setBusy(true);

          oModel.update("/TripDetails('" + sTripNumber + "')", oUpdateData, {
            headers: {
              "X-Requested-With": "X",
            },
            success: function () {
              that.getView().setBusy(false);
              MessageToast.show("Trip updated successfully!");
              
              // Save driver photo separately in Attachments if exists
              if (sDriverPhoto) {
                that._saveDriverPhotoToAttachments(sTripNumber, sDriverPhoto, sDriverName);
              }

              if (sTripNumber) {
                that._loadTripDetailsForHeader(sTripNumber, that._getCurrentStageTabKey() || "gateIn");
              }

              that._setFormEditable(false);
              that._setInputsEnabled(false);
              that._setReportingSaveInFlight(false);
            },
            error: function (oError) {
              that.getView().setBusy(false);
              that._setReportingSaveInFlight(false);

              // Try to surface backend error message
              let sMessage = "Failed to update trip.";
              try {
                if (oError && oError.responseText) {
                  const oResp = JSON.parse(oError.responseText);
                  if (oResp.error && oResp.error.message && oResp.error.message.value) {
                    sMessage = oResp.error.message.value;
                  }
                }
              } catch (e) {
                // ignore parse errors, keep default message
              }
              MessageBox.error(sMessage);
            },
          });
        },

        /* ===========================================================
         * ADDED: _clearAllData
         * - comprehensive clearing of all models and UI state
         * - called when navigating from home page to report new vehicle
         * =========================================================== */
        _clearAllData: function () {
          // Clear form data
          this._clearForm();
          
          // Clear reporting "Reference Document" UI state (this is not bound to TripData)
          const oReportingUi = this.getView().getModel("reportingUi");
          if (oReportingUi) {
            oReportingUi.setProperty("/refDocSearchValue", "");
            // Keep selection consistent with a fresh trip; user can choose again.
            oReportingUi.setProperty("/referenceByKey", "");
            oReportingUi.setProperty("/referenceByMode", "INVOICE");
          }
          const oReportingRefSuggest = this.getView().getModel("reportingRefSuggest");
          if (oReportingRefSuggest) {
            oReportingRefSuggest.setProperty("/items", []);
          }

          // Clear all suggestion models
          const oVHModel = new JSONModel([]);
          this.getView().setModel(oVHModel, "VHModel");
          this.getView().setModel(
            new JSONModel({ items: [] }),
            "vehicleNumberSuggestions"
          );
          this._aAllVehicleSuggestions = [];
          
          const oVehicleTypeSuggestions = new JSONModel({ items: [] });
          this.getView().setModel(oVehicleTypeSuggestions, "vehicleTypeSuggestions");

          const oSuggestions = new JSONModel({ MovementScenarioSuggestions: [] });
          this.getView().setModel(oSuggestions, "suggestions");
          
          // Clear driver photo preview visibility
          this.byId("idPreviewDriverPhoto")?.setVisible(false);
          this.byId("idDriverPhotoPreview")?.setVisible(false);
          
          // Clear file uploader if it exists
          const oFileUploader = this.byId("idDriverPhotoUploader");
          if (oFileUploader) {
            oFileUploader.clear();
          }
          
          // Reset global variables
          movementScenario = undefined;
          Mtype = undefined;
          movementType = undefined;
          
          // Clear value help dialog models if they exist
          if (this._mValueHelps) {
            Object.keys(this._mValueHelps).forEach(function(sKey) {
              var oDialog = this._mValueHelps[sKey];
              if (oDialog && oDialog.setModel) {
                oDialog.setModel(null, "VHModel");
              }
            }.bind(this));
          }

          // Reload Vehicle Type suggestions after reset because this controller
          // instance is reused and onInit does not run on every "Report Vehicle".
          this._loadVehicleTypeSuggestions();

          // Keep VehicleDetails de-duplicated (loaded on demand / initial startup).

          const oPoSugg = this.getView().getModel("poNumberSuggestions");
          if (oPoSugg) {
            oPoSugg.setData({ items: [] });
          }
          const oPoInput = this.byId("idReportingPoSearchInput");
          if (oPoInput) {
            oPoInput.setValue("");
          }
        },

        /* ===========================================================
         * NO CHANGE: _clearForm
         * - reserves the bindings shape that your view expects
         * =========================================================== */
        _clearForm: function () {
          const oTripData = new JSONModel({
            MovementScenario: "",
            MovementScenarioItemKey: "",
            MovementType: "",
            VehicleNumber: "",
            VehicleType: "",
            VehicleSize: "",
            TransporterName: "",
            LR_Number: "",
            LR_Date: "",
            DriverName: "",
            DriverMobile: "",
            DriverLicence: "",
            TripNumber: "",
            AdditionalInfo: "",
            RefDocType: "",
            RefDocNo: "",
            EwbNo: "",
            EwbActStartDate: "",
            InvRefNo: "",
            InvRefDate: "",
          });
          this.getView().setModel(oTripData, "TripData");
          this._syncMovementScenarioItemKeyOnTripData(oTripData);

          const oMovementScenarioCb = this.byId("idMovementScenario");
          if (oMovementScenarioCb && oMovementScenarioCb.setSelectedKey) {
            oMovementScenarioCb.setSelectedKey("");
          }
          const oVehicleSizeSelect = this.byId("idVehicleSize");
          if (oVehicleSizeSelect && oVehicleSizeSelect.setSelectedKey) {
            oVehicleSizeSelect.setSelectedKey("");
          }

          [
            "idMovementScenario",
            "idMovementType",
            "idVehicleNumber",
            "idVehicleType",
            "idTransporterName",
            "idDriverName",
            "idDriverContact",
            "idDriverLicense",
          ].forEach(
            function (sId) {
              var oC = this.byId(sId);
              if (oC && oC.setValueState) {
                oC.setValueState("None");
                if (oC.setValueStateText) {
                  oC.setValueStateText("");
                }
              }
            }.bind(this)
          );
        },

        /* ===========================================================
         * UPDATED: _setFormEditable
         * - kept your original intent but simplified to call our new helper
         * - this function remains for compatibility with other calls
         * =========================================================== */
        _setFormEditable: function (bEditable) {
          // UPDATED: delegate to new helper that works across inputs and controls
          this._setInputsEnabled(bEditable);

          // Keep buttons always enabled (as before)
          this._setButtonStates(true, true);
        },

        /* ===========================================================
         * ADDED: _setInputsEnabled(bEnabled)
         * - reliable way to toggle edit/enable state of inputs used in this View
         * - iterates aggregated controls in the reportingDetailsPanel
         * - sets setEditable for controls that support it, otherwise sets enabled
         * =========================================================== */
        _setInputsEnabled: function (bEnabled) {
          // ADDED
          try {
            var bTripLocked = !!(sap.ui.getCore().getModel("globalData")?.getProperty("/TripLocked"));
            var bEffective = !!bEnabled && !bTripLocked;
            const oPanel = this.byId("reportingDetailsPanel");
            if (!oPanel) return;
            var oMovementScenarioCombo = this.byId("idMovementScenario");
            // the panel content -> VBox -> Grid -> layout:content -> VBoxes -> Inputs etc.
            const aChildren = oPanel.findAggregatedObjects(true); // deep search
            aChildren.forEach((ctrl) => {
              // Movement scenario: keep usable when unlocked; fully read-only when trip is completed.
              if (oMovementScenarioCombo && ctrl === oMovementScenarioCombo) {
                if (ctrl.setEnabled) {
                  ctrl.setEnabled(!bTripLocked);
                }
                return;
              }
              // ignore buttons and dialogs
              if (ctrl.isA && ctrl.isA("sap.m.Button")) return;
              if (ctrl.setEditable) {
                try {
                  ctrl.setEditable(bEffective);
                } catch (e) {
                  // some controls might reject setEditable; fallback to setEnabled
                  if (ctrl.setEnabled) ctrl.setEnabled(bEffective);
                }
              } else if (ctrl.setEnabled) {
                try {
                  ctrl.setEnabled(bEffective);
                } catch (e) {
                  // ignore
                }
              }
            });

            // Button enablement is controlled by standard UI logic; no user-role authorization.
          } catch (e) {
            // don't break if something unexpected happens
            jQuery.sap.log.error("Error in _setInputsEnabled: " + e);
          }
        },

        /* ===========================================================
         * UPDATED: _setButtonStates - Hide Edit button in CREATE mode
         * =========================================================== */
        _setButtonStates: function (bEditEnabled, bSaveEnabled) {
          var bTripLocked = !!(sap.ui.getCore().getModel("globalData")?.getProperty("/TripLocked"));
          var oEditButton = this.byId("btnEditReporting");
          var oSaveButton = this.byId("btnSaveReporting");

          if (bTripLocked) {
            if (oEditButton) {
              oEditButton.setVisible(false);
            }
            if (oSaveButton) {
              oSaveButton.setVisible(false);
            }
            return;
          }

          if (oEditButton) {
            // Hide Edit button in CREATE mode, show in DISPLAY mode
            if (this._mode === "CREATE") {
              oEditButton.setVisible(false);
            } else {
              oEditButton.setVisible(true);
              oEditButton.setEnabled(bEditEnabled !== false);
            }
          }
          
          if (oSaveButton) {
            oSaveButton.setEnabled(bSaveEnabled !== false);
          }
        },

        /* ===========================================================
         * UPDATED: _validateRequiredFields
         * - keeps your field list; marks fields with value state + message
         * =========================================================== */
        _validateRequiredFields: function () {
          const oTripDataModel = this.getView().getModel("TripData");
          const oData =
            (oTripDataModel && oTripDataModel.getData && oTripDataModel.getData()) || {};

          const requiredFields = [
            "MovementScenarioItemKey",
            "MovementTypeDesc",
            "VehicleType",
            "TransporterName",
            "DriverName",
            "DriverMobile",
          ];
          const isEditMode = this._mode === "EDIT";
          const requiredInCurrentMode = isEditMode
            ? requiredFields.filter(function (f) {
                return f !== "VehicleType" && f !== "DriverName";
              })
            : requiredFields;

          const mFieldToControl = {
            MovementScenarioItemKey: "idMovementScenario",
            MovementTypeDesc: "idMovementType",
            VehicleNumber: "idVehicleNumber",
            VehicleType: "idVehicleType",
            TransporterName: "idTransporterName",
            DriverName: "idDriverName",
            DriverMobile: "idDriverContact",
            DriverLicence: "idDriverLicense",
          };

          const mFieldValueStateText = {
            MovementScenarioItemKey: "Select a movement scenario",
            MovementTypeDesc: "Movement type is required",
            VehicleType: "Select a vehicle type",
            TransporterName: "Enter transporter name",
            DriverName: "Enter driver name",
            DriverMobile: "Enter driver contact",
          };

          const fnClearValueState = function (oCtrl) {
            if (!oCtrl || !oCtrl.setValueState) {
              return;
            }
            oCtrl.setValueState("None");
            if (oCtrl.setValueStateText) {
              oCtrl.setValueStateText("");
            }
          };

          const fnSetErrorValueState = function (oCtrl, sText) {
            if (!oCtrl || !oCtrl.setValueState) {
              return;
            }
            oCtrl.setValueState("Error");
            if (oCtrl.setValueStateText) {
              oCtrl.setValueStateText(sText || "This field is required");
            }
          };

          let valid = true;
          requiredInCurrentMode.forEach(
            function (field) {
              const val = oData[field];
              const bMissing =
                val === undefined || val === null || String(val).trim() === "";
              const sCtrlId = mFieldToControl[field];
              const oCtrl = sCtrlId ? this.byId(sCtrlId) : null;
              if (bMissing) {
                valid = false;
                fnSetErrorValueState(
                  oCtrl,
                  mFieldValueStateText[field]
                );
              } else {
                fnClearValueState(oCtrl);
              }
            }.bind(this)
          );

          if (!valid) {
            Object.keys(mFieldToControl).forEach(
              function (field) {
                if (requiredInCurrentMode.indexOf(field) !== -1) {
                  return;
                }
                fnClearValueState(this.byId(mFieldToControl[field]));
              }.bind(this)
            );
          }
          return valid;
        },

        /* ===========================================================
         * UPDATED: _isValidMobile
         * - ensures only digits and exactly 10 characters
         * =========================================================== */
        _isValidMobile: function (sMobile) {
          if (!sMobile) return false;
          const s = (sMobile + "").trim();
          // Check if it contains only digits and has exactly 10 characters
          const regex = /^[0-9]{10}$/;
          return regex.test(s);
        },

        /* ===========================================================
         * ADDED: onDriverContactLiveChange
         * - validates driver contact on live change (exactly 10 characters)
         * =========================================================== */
        onDriverContactLiveChange: function (oEvent) {
          const sValue = oEvent.getParameter("value") || "";
          const oInput = oEvent.getSource();
          const sDigitsOnly = sValue.replace(/\D/g, "");

          // Keep only numeric characters in the field.
          if (sValue !== sDigitsOnly) {
            oInput.setValue(sDigitsOnly);
          }
          
          if (!sDigitsOnly || sDigitsOnly.trim() === "") {
            // Clear validation state if field is empty (required validation will handle it)
            oInput.setValueState("None");
            oInput.setValueStateText("");
            return;
          }
          
          // Validate on live change - check for exactly 10 digits
          const sTrimmed = sDigitsOnly.trim();
          if (sTrimmed.length < 10) {
            oInput.setValueState("Error");
            oInput.setValueStateText("Driver contact must be exactly 10 digits");
          } else if (sTrimmed.length > 10) {
            oInput.setValueState("Error");
            oInput.setValueStateText("Driver contact cannot be more than 10 digits");
          } else if (!/^[0-9]{10}$/.test(sTrimmed)) {
            oInput.setValueState("Error");
            oInput.setValueStateText("Driver contact must contain only digits");
          } else {
            oInput.setValueState("None");
            oInput.setValueStateText("");
          }
        },

        onDriverLicenseLiveChange: function (oEvent) {
          const oInput = oEvent.getSource();
          const sRawValue = oEvent.getParameter("value") || "";
          const sUpperValue = sRawValue.toUpperCase();

          if (oInput && oInput.setValue && sRawValue !== sUpperValue) {
            oInput.setValue(sUpperValue);
          }

          const oTripDataModel = this.getView().getModel("TripData");
          if (oTripDataModel) {
            oTripDataModel.setProperty("/DriverLicence", String(sUpperValue || "").trim());
          }
        },

        /* ===========================================================
         * FORMATTERS: CreatedOn / CreatedTime (Change History)
         * =========================================================== */
        formatTripDate: function (vDate) {
          if (!vDate) {
            return "";
          }
          var oDate;
          if (vDate instanceof Date) {
            oDate = vDate;
          } else if (typeof vDate === "string" && vDate.indexOf("/Date") === 0) {
            var iTimestamp = parseInt(vDate.replace(/\D/g, ""), 10);
            if (!isNaN(iTimestamp)) {
              oDate = new Date(iTimestamp);
            }
          } else if (typeof vDate === "string" && /^\d{4}-\d{2}-\d{2}/.test(vDate)) {
            var p = vDate.slice(0, 10).split("-");
            oDate = new Date(
              parseInt(p[0], 10),
              parseInt(p[1], 10) - 1,
              parseInt(p[2], 10)
            );
          } else {
            return vDate;
          }
          if (!oDate || isNaN(oDate.getTime())) {
            return "";
          }
          return DateFormat.getDateInstance({ style: "medium" }).format(oDate);
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

        formatTripNumber: function (sTripNumber) {
          if (!sTripNumber) {
            return "";
          }
          // Convert to string and remove leading zeros
          var sStr = String(sTripNumber);
          // Remove leading zeros but keep at least one digit (e.g., "0000000014" -> "14", "0" -> "0")
          return sStr.replace(/^0+/, "") || "0";
        },

        _hydrateReportingUiAliases: function (oData) {
          if (!oData || typeof oData !== "object") {
            return;
          }

          // Backend persists canonical names; reporting UI binds to these aliases.
          if (!oData.RefDocType && oData.DocType) {
            oData.RefDocType = oData.DocType;
          }
          if (!oData.RefDocNo && oData.DocumentNumber) {
            oData.RefDocNo = oData.DocumentNumber;
          }
          if (!oData.EwbNo && oData.EwayBill) {
            oData.EwbNo = oData.EwayBill;
          }
          if (!oData.EwbActStartDate && oData.EwaybillDate) {
            oData.EwbActStartDate = oData.EwaybillDate;
          }
        },

        /**
         * Format LR Date to show only date, month, and year (no time)
         */
        formatLRDate: function (vDate) {
          if (!vDate) {
            return "";
          }
          
          var oDate;
          
          // Handle Date object
          if (vDate instanceof Date) {
            oDate = vDate;
          }
          // Handle OData date format (/Date(...)/)
          else if (typeof vDate === "string" && vDate.indexOf("/Date") === 0) {
            var iTimestamp = parseInt(vDate.replace(/\D/g, ""), 10);
            if (!isNaN(iTimestamp)) {
              oDate = new Date(iTimestamp);
            } else {
              return "";
            }
          }
          // Handle string date (e.g., "2023-12-31T10:30:00" or "2023-12-31")
          else if (typeof vDate === "string") {
            // If string contains time, extract only date part
            if (vDate.indexOf("T") > 0) {
              vDate = vDate.split("T")[0];
            }
            // If string contains space (e.g., "2023-12-31 10:30:00")
            if (vDate.indexOf(" ") > 0) {
              vDate = vDate.split(" ")[0];
            }
            oDate = new Date(vDate);
          }
          else {
            return "";
          }
          
          // Check if date is valid
          if (!oDate || isNaN(oDate.getTime())) {
            return "";
          }
          
          // Format as YYYY-MM-DD (date only, no time)
          var sYear = oDate.getFullYear();
          var sMonth = String(oDate.getMonth() + 1).padStart(2, "0");
          var sDay = String(oDate.getDate()).padStart(2, "0");
          return sYear + "-" + sMonth + "-" + sDay;
        },

        _getNormalizedDateTimeForPayload: function (sControlId, sTripDataPath) {
          var oCtrl = this.byId(sControlId);
          var oDate = oCtrl && oCtrl.getDateValue ? oCtrl.getDateValue() : null;

          if (!oDate) {
            var oTripDataModel = this.getView().getModel("TripData");
            var vRaw = oTripDataModel ? oTripDataModel.getProperty(sTripDataPath) : null;
            oDate = this._parseDateLikeValue(vRaw);
          }

          if (!oDate || isNaN(oDate.getTime())) {
            return null;
          }

          var sYear = oDate.getFullYear();
          var sMonth = String(oDate.getMonth() + 1).padStart(2, "0");
          var sDay = String(oDate.getDate()).padStart(2, "0");
          return sYear + "-" + sMonth + "-" + sDay + "T00:00:00";
        },

        _applyReportingFieldsToTripPayload: function (oPayload) {
          if (!oPayload) {
            return;
          }

          var oTripDataModel = this.getView().getModel("TripData");
          var sMovementType = String(oTripDataModel?.getProperty("/MovementType") || "")
            .trim()
            .toUpperCase();
          var bIsInward = sMovementType === "I";
          if (bIsInward) {
            oPayload.MovmentInd = "GI";
          } else if (sMovementType === "O") {
            oPayload.MovmentInd = "GO";
          }

          var sRefDocType = String(oPayload.RefDocType || "").trim();
          var sRefDocNo = String(oPayload.RefDocNo || "").trim();
          var sEwbNo = String(oPayload.EwbNo || "").trim();
          var sInvRefNo = String(oPayload.InvRefNo || "").trim();
          var sEwbDate = this._getNormalizedDateTimeForPayload("idEwbDate", "/EwbActStartDate");
          var sInvRefDate = this._getNormalizedDateTimeForPayload("idInvDcDate", "/InvRefDate");

          if (sRefDocType) {
            oPayload.DocType = sRefDocType;
          }
          if (sRefDocNo) {
            oPayload.DocumentNumber = sRefDocNo;
          }
          if (sEwbNo) {
            oPayload.EwayBill = sEwbNo;
          }
          if (bIsInward && sInvRefNo) {
            oPayload.InvRefNo = sInvRefNo;
          } else {
            delete oPayload.InvRefNo;
          }
          if (sEwbDate) {
            oPayload.EwaybillDate = sEwbDate;
          }
          if (bIsInward && sInvRefDate) {
            oPayload.InvRefDate = sInvRefDate;
          } else {
            delete oPayload.InvRefDate;
          }

          // Keep UI-only aliases out of TripDetails CRUD payload.
          delete oPayload.RefDocType;
          delete oPayload.RefDocNo;
          delete oPayload.EwbNo;
          delete oPayload.EwbActStartDate;

          // TripDetails / OData expects DelayReasons; TripData from Gate-In uses DelayReason and aliases.
          var sDelayForTrip =
            String(oPayload.DelayReasons || "").trim() ||
            String(oPayload.DelayReason || "").trim() ||
            String(oPayload.DelayReasonCode || "").trim();
          if (sDelayForTrip) {
            oPayload.DelayReasons = sDelayForTrip;
          } else {
            delete oPayload.DelayReasons;
          }
          delete oPayload.DelayReason;
          delete oPayload.DelayReasonCode;
          delete oPayload.DelayReasonDesc;
          delete oPayload.DelayReasonsDesc;
          delete oPayload.DelayReasonText;
        },

        _parseDateLikeValue: function (vDate) {
          if (!vDate) {
            return null;
          }

          if (vDate instanceof Date) {
            return isNaN(vDate.getTime()) ? null : vDate;
          }

          if (typeof vDate !== "string") {
            return null;
          }

          var sVal = vDate.trim();
          if (!sVal) {
            return null;
          }

          if (sVal.indexOf("/Date") === 0) {
            var iTimestamp = parseInt(sVal.replace(/\D/g, ""), 10);
            if (!isNaN(iTimestamp)) {
              var oFromOData = new Date(iTimestamp);
              return isNaN(oFromOData.getTime()) ? null : oFromOData;
            }
            return null;
          }

          if (sVal.indexOf("T") > 0) {
            sVal = sVal.split("T")[0];
          } else if (sVal.indexOf(" ") > 0) {
            sVal = sVal.split(" ")[0];
          }

          var oFromString = new Date(sVal);
          return isNaN(oFromString.getTime()) ? null : oFromString;
        },

        /* ===========================================================
         * NO CHANGE: _collectFormData
         * - returns the TripData model data (same as before)
         * =========================================================== */
        _collectFormData: function () {
          return this.getView().getModel("TripData").getData();
        },

        /* ===========================================================
         * Driver Photo Upload and Preview
         * =========================================================== */
        onDriverPhotoChange: function (oEvent) {
          var oFileUploader = oEvent.getSource();
          
          // Get files from the native file input element
          var oDomRef = oFileUploader.getDomRef();
          var oFileInput = oDomRef ? oDomRef.querySelector("input[type='file']") : null;
          
          if (!oFileInput || !oFileInput.files || oFileInput.files.length === 0) {
            this._oDriverPhotoFile = null;
            return;
          }
          
          var oFile = oFileInput.files[0];
          
          // Validate file type
          var sFileType = oFile.type || "";
          if (!sFileType.startsWith("image/")) {
            MessageToast.show("Please select an image file (JPG, PNG)");
            oFileUploader.clear();
            return;
          }
          
          // Validate file size (max 5MB)
          if (oFile.size > 5 * 1024 * 1024) {
            MessageToast.show("File size should be less than 5MB");
            oFileUploader.clear();
            return;
          }
          
          this._oDriverPhotoFile = oFile;
          
          // Read and preview the image
          var oReader = new FileReader();
          oReader.onload = function (oEvent) {
            var sBase64Content = oEvent.target.result;
            // Store base64 data URL directly for preview
            var oTripDataModel = this.getView().getModel("TripData");
            oTripDataModel.setProperty("/DriverPhoto", sBase64Content);
            
            // Show preview button and image
            this.byId("idPreviewDriverPhoto")?.setVisible(true);
            this.byId("idDriverPhotoPreview")?.setVisible(true);
          }.bind(this);
          
          oReader.onerror = function () {
            MessageToast.show("Failed to read photo");
          };
          
          oReader.readAsDataURL(oFile);
        },

        onPreviewDriverPhoto: function () {
          var oTripDataModel = this.getView().getModel("TripData");
          var sDriverPhoto = oTripDataModel?.getProperty("/DriverPhoto");
          
          if (!sDriverPhoto) {
            MessageToast.show("No driver photo available");
            return;
          }
          
          // Create preview dialog
          if (!this._oDriverPhotoDialog) {
            this._oDriverPhotoDialog = new sap.m.Dialog({
              title: "Driver Photo",
              contentWidth: "60%",
              contentHeight: "70%",
              resizable: true,
              draggable: true,
              beginButton: new sap.m.Button({
                text: "Close",
                press: function () {
                  this._oDriverPhotoDialog.close();
                }.bind(this)
              })
            });
            this.getView().addDependent(this._oDriverPhotoDialog);
          }
          
          this._oDriverPhotoDialog.removeAllContent();
          
          var oScrollContainer = new sap.m.ScrollContainer({
            width: "100%",
            height: "100%",
            vertical: true,
            horizontal: true,
            content: [
              new sap.m.Image({
                src: sDriverPhoto,
                densityAware: false,
                width: "100%",
                height: "auto"
              })
            ]
          });
          
          this._oDriverPhotoDialog.addContent(oScrollContainer);
          this._oDriverPhotoDialog.open();
        },

        /* ===========================================================
         * Save Driver Photo to Attachments Entity
         * =========================================================== */
        // _saveDriverPhotoToAttachments: function (sTripNumber, sDriverPhoto) {
        //   // Convert data URL to base64 string if needed
        //   var sBase64Data = sDriverPhoto;
        //   if (sDriverPhoto.startsWith("data:")) {
        //     sBase64Data = sDriverPhoto.split(",")[1] || sDriverPhoto;
        //   }

        //   var oService = this.getView().getModel();
        //   var oPayload = {
        //     TripNumber: sTripNumber,
        //     FileName: "DriverPhoto.jpg",
        //     ContentType: "image/jpeg",
        //     Content: sBase64Data
        //   };

          

        //   // Try to create first (if exists, will get error and we'll update)
        //   oService.create("/Attachments", oPayload, {
        //     headers: {
        //       "X-Requested-With": "X"
        //     },
        //     success: function () {
        //       MessageToast.show("Driver photo saved successfully");
        //     }.bind(this),
        //     error: function (oError) {
        //       // If creation fails (entity exists), try update
        //       if (oError.statusCode === 409 || oError.statusCode === 400) {
        //         this._updateDriverPhotoInAttachments(sTripNumber, sBase64Data);
        //       } else {
        //         var sMessage = "Failed to save driver photo";
        //         try {
        //           var oResponse = JSON.parse(oError.responseText);
        //           if (oResponse.error?.message?.value) {
        //             sMessage = oResponse.error.message.value;
        //           }
        //         } catch (e) {}
        //         MessageToast.show(sMessage);
        //       }
        //     }.bind(this)
        //   });
        // },

        // _updateDriverPhotoInAttachments: function (sTripNumber, sBase64Data) {
        //   var oService = this.getView().getModel();
        //   var sPath = "/Attachments('" + sTripNumber + "')";
          
        //   var oPayload = {
        //     FileName: "DriverPhoto.jpg",
        //     ContentType: "image/jpeg",
        //     Content: sBase64Data
        //   };

        //   oService.update(sPath, oPayload, {
        //     headers: {
        //       "X-Requested-With": "X"
        //     },
        //     success: function () {
        //       MessageToast.show("Driver photo updated successfully");
        //     }.bind(this),
        //     error: function (oError) {
        //       var sMessage = "Failed to update driver photo";
        //       try {
        //         var oResponse = JSON.parse(oError.responseText);
        //         if (oResponse.error?.message?.value) {
        //           sMessage = oResponse.error.message.value;
        //         }
        //       } catch (e) {}
        //       MessageToast.show(sMessage);
        //     }.bind(this)
        //   });
        // },
        _saveDriverPhotoToAttachments: function (sTripNumber, sDriverPhoto, sDriverName) {
          // Convert data URL to base64 string if needed
          var sBase64Data = sDriverPhoto;
          var sContentType = "image/jpeg"; // Default content type
          
          if (sDriverPhoto.startsWith("data:")) {
              // Extract content type from the data URL (e.g., "image/jpeg" or "image/png")
              var sMimeType = sDriverPhoto.split(";")[0].split(":")[1];
              sContentType = sMimeType || sContentType;  // Fallback to "image/jpeg" if mime type is not available
              sBase64Data = sDriverPhoto.split(",")[1] || sDriverPhoto;
          }
      
          // Function to generate slug from a string (e.g., driver name or trip number)
          function generateSlug(inputString) {
              return inputString
                  .toLowerCase()  // Convert to lowercase
                  .replace(/\s+/g, '-')  // Replace spaces with hyphens
                  .replace(/[^\w\-]+/g, '')  // Remove non-alphanumeric characters
                  .replace(/--+/g, '-')  // Replace multiple hyphens with a single one
                  .trim();  // Remove leading and trailing spaces
          }
      
          // Generate a slug from the driver's name (or trip number if needed)
          var slug = generateSlug(sTripNumber);  // You can use either name or trip number here
      
          var oService = this.getView().getModel();
          var sFileName = "DriverPhoto_" + slug + "." + sContentType.split("/")[1];  // Dynamically set the file name based on the slug and content type
      
          var oPayload = {
              TripNumber: sTripNumber,
              FileName: sFileName,  // Use the slug in the file name
              ContentType: sContentType,  // Use the dynamic content type
              Content: sBase64Data
          };
      
          // Creating the header parameter for the slug
          var oHeaderParameter = new sap.ui.unified.FileUploaderParameter({
              name: "slug",
              value: slug
          });
      
          // Send the slug in the header and content in the body
          oService.create("/Attachments", oPayload, {
              headers: {
                  "X-Requested-With": "X",
                  "X-Driver-Slug": slug  // Send the slug in the header (same as FileUploader)
              },
              success: function () {
                  MessageToast.show("Driver photo saved successfully");
              }.bind(this),
              error: function (oError) {
                  // If creation fails (entity exists), try update
                  if (oError.statusCode === 409 || oError.statusCode === 400) {
                      this._updateDriverPhotoInAttachments(sTripNumber, sBase64Data);
                  } else {
                      var sMessage = "Failed to save driver photo";
                      try {
                          var oResponse = JSON.parse(oError.responseText);
                          if (oResponse.error?.message?.value) {
                              sMessage = oResponse.error.message.value;
                          }
                      } catch (e) {}
                      MessageToast.show(sMessage);
                      // Save driver photo error
                  }
              }.bind(this)
          });
      }
,      

_updateDriverPhotoInAttachments: function (sTripNumber, sDriverPhoto, sDriverName) {
  // Convert data URL to base64 string if needed
  var sBase64Data = sDriverPhoto;
  var sContentType = "image/jpeg"; // Default content type
  
  if (sDriverPhoto.startsWith("data:")) {
      // Extract content type from the data URL (e.g., "image/jpeg" or "image/png")
      var sMimeType = sDriverPhoto.split(";")[0].split(":")[1];
      sContentType = sMimeType || sContentType;  // Fallback to "image/jpeg" if mime type is not available
      sBase64Data = sDriverPhoto.split(",")[1] || sDriverPhoto;
  }

  // Function to generate slug from a string (e.g., driver name or trip number)
  function generateSlug(inputString) {
      return inputString
          .toLowerCase()  // Convert to lowercase
          .replace(/\s+/g, '-')  // Replace spaces with hyphens
          .replace(/[^\w\-]+/g, '')  // Remove non-alphanumeric characters
          .replace(/--+/g, '-')  // Replace multiple hyphens with a single one
          .trim();  // Remove leading and trailing spaces
  }

  // Generate a slug from the driver's name (or trip number if needed)
  var slug = generateSlug(sDriverName || sTripNumber);  // You can use either name or trip number here

  var oService = this.getView().getModel();
  var sPath = "/Attachments('" + sTripNumber + "')";
  var sFileName = "DriverPhoto_" + slug + "." + sContentType.split("/")[1];  // Dynamically set the file name based on the slug and content type

  var oPayload = {
      FileName: sFileName,  // Use the slug in the file name
      ContentType: sContentType,  // Use the dynamic content type
      Content: sBase64Data,
      DriverSlug: slug  // Add the slug to the payload if needed
  };

  oService.update(sPath, oPayload, {
      headers: {
          "X-Requested-With": "X"
      },
      success: function () {
          MessageToast.show("Driver photo updated successfully");
      }.bind(this),
      error: function (oError) {
          var sMessage = "Failed to update driver photo";
          try {
              var oResponse = JSON.parse(oError.responseText);
              if (oResponse.error?.message?.value) {
                  sMessage = oResponse.error.message.value;
              }
          } catch (e) {}
          MessageToast.show(sMessage);
          // Update driver photo error
      }.bind(this)
  });
},

        /* ===========================================================
         * Load Driver Photo from Attachments Entity
         * =========================================================== */
        _loadDriverPhotoFromAttachments: function (sTripNumber) {
          var oService = this.getView().getModel();
          var sPath = "/Attachments('" + sTripNumber + "')";
          
          oService.read(sPath, {
            success: function (oData) {
              if (oData && oData.Content && oData.FileName === "DriverPhoto.jpg") {
                // Convert base64 to data URL for display
                var sDataUrl = "data:" + (oData.ContentType || "image/jpeg") + ";base64," + oData.Content;
                var oTripDataModel = this.getView().getModel("TripData");
                if (oTripDataModel) {
                  oTripDataModel.setProperty("/DriverPhoto", sDataUrl);
                  this.byId("idPreviewDriverPhoto")?.setVisible(true);
                  this.byId("idDriverPhotoPreview")?.setVisible(true);
                }
              } else {
                // No driver photo attachment found, hide preview
                this.byId("idPreviewDriverPhoto")?.setVisible(false);
                this.byId("idDriverPhotoPreview")?.setVisible(false);
              }
            }.bind(this),
            error: function () {
              // No driver photo attachment found, hide preview
              this.byId("idPreviewDriverPhoto")?.setVisible(false);
              this.byId("idDriverPhotoPreview")?.setVisible(false);
            }.bind(this)
          });
        },

        onValueHelpMovementType: function () {
          const oView = this.getView();

          if (!this._mValueHelps) {
            this._mValueHelps = {};
          }

          if (!this._mValueHelps.VHMovementType) {
            Fragment.load({
              id: oView.getId(),
              name: "com.incresolZ_INC_PLMS.fragments.VehicleReportingFrags.VHMovementType",
              controller: this,
            }).then(
              function (oDialog) {
                this._mValueHelps.VHMovementType = oDialog;
                oView.addDependent(oDialog);
                oDialog.open();
              }.bind(this)
            );
          } else {
            this._mValueHelps.VHMovementType.open();
          }
        },
        onValueHelpVehicleType: function () {
          var oView = this.getView();

          if (!this._mValueHelps) this._mValueHelps = {};

          if (!this._mValueHelps.VHVehicleType) {
            Fragment.load({
              id: oView.getId(),
              name: "com.incresolZ_INC_PLMS.fragments.VehicleReportingFrags.VHVehicleType",
              controller: this,
            }).then(
              function (oDialog) {
                this._mValueHelps.VHVehicleType = oDialog;
                oView.addDependent(oDialog);

                this._loadVehicleTypeData().then(() => {
                  oDialog.open();
                });
              }.bind(this)
            );
          } else {
            this._loadVehicleTypeData();
            this._mValueHelps.VHVehicleType.open();
          }
        },
        _syncOutgoingDirectSaleScenarioFromConfig: function () {
          var oModel = this.getView().getModel();
          var oTripData = this.getView().getModel("TripData");
          var sMovementType = "";
          if (oTripData) {
            sMovementType = oTripData.getProperty("/MovementType") || "";
          }
          if (!sMovementType) {
            sMovementType = Mtype || "";
          }
          if (!this._shouldSyncOutgoingDirectSaleConfig(sMovementType)) {
            return;
          }
          MovementScenarioConfig.syncOutgoingDirectSaleFromConfig(
            oModel,
            this._getTripNumber(),
            this.getView()
          );
        },
        _shouldSyncOutgoingDirectSaleConfig: function (sMovementType) {
          return String(sMovementType || "").trim().toUpperCase() === "O";
        },

        _loadMovementScenarioItems: function () {
          const oModel = this.getView().getModel();
          if (!oModel) {
            return;
          }
          const that = this;
          oModel.read("/OrderTypeSH", {
            success: function (oData) {
              var aEnriched = MovementScenarioIcons.enrichOrderTypeRows(
                oData.results || []
              );
              aEnriched.sort(function (a, b) {
                var g = (a.Group || "").localeCompare(b.Group || "");
                if (g !== 0) {
                  return g;
                }
                return (a.LongText || "").localeCompare(b.LongText || "");
              });
              that
                .getView()
                .setModel(new JSONModel(aEnriched), "movementScenarioItems");
              that._syncComboSelectionByKey("idMovementScenario", "/MovementScenarioItemKey");
            },
            error: function () {
              MessageBox.error("Failed to load movement scenarios.");
            },
          });
        },
        _syncComboSelectionByKey: function (sComboId, sTripDataPath) {
          var oCombo = this.byId(sComboId);
          var oTripData = this.getView().getModel("TripData");
          if (!oCombo || !oTripData) {
            return;
          }

          var sKey = String(oTripData.getProperty(sTripDataPath) || "").trim();
          if (!sKey) {
            return;
          }

          var fnApply = function () {
            var oItem = oCombo.getItemByKey(sKey);
            if (oItem) {
              oCombo.setSelectedKey(sKey);
              if (oCombo.setSelectedItem) {
                oCombo.setSelectedItem(oItem);
              }
            }
          };

          var oBinding = oCombo.getBinding("items");
          if (oBinding) {
            oBinding.attachEventOnce("change", fnApply);
          }
          fnApply();
        },

        _syncMovementScenarioItemKeyOnTripData: function (oTripDataModel) {
          if (!oTripDataModel) {
            return;
          }
          var mt = oTripDataModel.getProperty("/MovementType");
          var ms = oTripDataModel.getProperty("/MovementScenario");
          var sKey = MovementScenarioIcons.getMovementScenarioItemKey(mt, ms);
          oTripDataModel.setProperty("/MovementScenarioItemKey", sKey || "");
          // TripDetails from OData often has MovementType (I/O) but no MovementTypeDesc;
          // validation uses MovementTypeDesc, so derive it when missing.
          var sMtd = oTripDataModel.getProperty("/MovementTypeDesc");
          if (String(sMtd || "").trim() === "") {
            var sMtU = String(mt || "").trim().toUpperCase();
            if (sMtU === "I") {
              oTripDataModel.setProperty("/MovementTypeDesc", "Inward");
            } else if (sMtU === "O") {
              oTripDataModel.setProperty("/MovementTypeDesc", "Outward");
            }
          }
        },

        _syncMovementScenarioFromRow: function (row) {
          if (!row) {
            return;
          }
          Mtype = row.MovementType;
          movementScenario = row.MovementScenario;

          const oScenario = this.byId("idMovementScenario");
          var sItemKey = MovementScenarioIcons.getMovementScenarioItemKey(
            row.MovementType,
            row.MovementScenario
          );
          if (oScenario && oScenario.setSelectedKey) {
            oScenario.setSelectedKey(sItemKey || "");
          }

          let sMovementTypeDesc = "";
          if (row.MovementType === "O") {
            this.byId("idMovementType").setValue("Outward");
            sMovementTypeDesc = "Outward";
          } else if (row.MovementType === "I") {
            this.byId("idMovementType").setValue("Inward");
            sMovementTypeDesc = "Inward";
          }

          const oTripDataModel = this.getView().getModel("TripData");
          if (oTripDataModel) {
            oTripDataModel.setProperty("/MovementScenario", row.MovementScenario);
            oTripDataModel.setProperty("/MovementScenarioItemKey", sItemKey || "");
            oTripDataModel.setProperty("/MovementScenarioDesc", row.LongText || "");
            oTripDataModel.setProperty("/MovementType", row.MovementType);
            if (sMovementTypeDesc) {
              oTripDataModel.setProperty("/MovementTypeDesc", sMovementTypeDesc);
            }
          }

          let oGlobalModel = sap.ui.getCore().getModel("globalData");
          if (!oGlobalModel) {
            oGlobalModel = new JSONModel({
              TripNumber: "",
              MovementType: "",
              MovementTypeDesc: "",
            });
            sap.ui.getCore().setModel(oGlobalModel, "globalData");
          }
          oGlobalModel.setProperty("/MovementType", row.MovementType);
          oGlobalModel.setProperty("/MovementTypeDesc", sMovementTypeDesc);

          sap.ui.getCore().getEventBus().publish("TripData", "MovementTypeChanged", {
            movementType: row.MovementType,
          });

          this._updateScannerVisibility();
        },

        onMovementScenarioComboChange: function (oEvent) {
          const sKey = oEvent.getSource().getSelectedKey();
          const oItems = this.getView().getModel("movementScenarioItems");
          const aRows = (oItems && oItems.getData()) || [];
          const oRow = aRows.find(function (r) {
            return r && r.ItemKey === sKey;
          });
          if (oRow) {
            this._syncMovementScenarioFromRow(oRow);
          } else {
            movementScenario = undefined;
            Mtype = undefined;
            this._updateScannerVisibility();
          }
        },

        /**
         * Helper function to get TripNumber from globalData or TripData model
         */
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
          return sTripNumber;
        },

        /**
         * Load Vehicle Type from ConfigValues
         */
        _loadVehicleTypeData: function () {
          const oModel = this.getView().getModel();
          const that = this;
          const sTripNumber = this._getTripNumber();
          var aBaseFilters = [
            new sap.ui.model.Filter(
              "ConfigGroup",
              sap.ui.model.FilterOperator.EQ,
              "VehicleType"
            ),
          ];
          var aTripFilters = aBaseFilters.slice();
          if (sTripNumber) {
            aTripFilters.push(
              new sap.ui.model.Filter(
                "TripNumber",
                sap.ui.model.FilterOperator.EQ,
                sTripNumber
              )
            );
          }

          var fnReadConfigValues = function (aFilters) {
            return new Promise(function (resolve) {
              oModel.read("/ConfigValues", {
                filters: aFilters,
                success: function (oData) {
                  resolve(oData.results || []);
                },
                error: function () {
                  resolve([]);
                },
              });
            });
          };

          return new Promise(function (resolve) {
            fnReadConfigValues(aTripFilters).then(function (aResults) {
              if (aResults.length > 0 || !sTripNumber) {
                const oJSON = new sap.ui.model.json.JSONModel(aResults);
                if (that._mValueHelps && that._mValueHelps.VHVehicleType) {
                  that._mValueHelps.VHVehicleType.setModel(oJSON, "VHModel");
                }
                resolve();
                return;
              }

              // Fallback: some backends do not provide vehicle types per trip.
              fnReadConfigValues(aBaseFilters).then(function (aFallbackResults) {
                const oJSON = new sap.ui.model.json.JSONModel(aFallbackResults);
                if (that._mValueHelps && that._mValueHelps.VHVehicleType) {
                  that._mValueHelps.VHVehicleType.setModel(oJSON, "VHModel");
                }
                resolve();
              });
            });
          });
        },

        /**
         * Search Vehicle Type
         */
        onSearchVehicleType: function (oEvent) {
          var sValue = (oEvent.getParameter("value") || oEvent.getParameter("newValue") || "").trim();

          var oList = this.byId("idVHVehicleTypeList");

          if (!oList) {
            return;
          }

          var oBinding = oList.getBinding("items");
          
          if (!oBinding) {
            return;
          }

          var aFilters = [];

          if (sValue && sValue.length > 0) {
            aFilters.push(
              new sap.ui.model.Filter({
                filters: [
                  new sap.ui.model.Filter(
                    "ConfigID",
                    sap.ui.model.FilterOperator.Contains,
                    sValue
                  ),
                  new sap.ui.model.Filter(
                    "Description",
                    sap.ui.model.FilterOperator.Contains,
                    sValue
                  ),
                ],
                and: false,
              })
            );
          }

          oBinding.filter(aFilters);
        },

        /* ===========================================================
         * onSearchVH — MovementType value help list filter
         * =========================================================== */
        onSearchVH: function (oEvent) {
          const sValue = (oEvent.getParameter("newValue") || oEvent.getParameter("value") || oEvent.getParameter("query") || "").trim();
          const oList = oEvent.getSource().getParent().getItems()[1];

          if (!oList) {
            return;
          }

          let oBinding = oList.getBinding("items");

          if (!oBinding) {
            return;
          }

          let aFilters = [];
          if (sValue && sValue.length > 0) {
            const sListId = oList.getId();
            if (sListId.indexOf("VHMovementType") >= 0) {
              aFilters = [
                new sap.ui.model.Filter({
                  filters: [
                    new sap.ui.model.Filter(
                      "MovementType",
                      sap.ui.model.FilterOperator.Contains,
                      sValue
                    ),
                    new sap.ui.model.Filter(
                      "MovementDesc",
                      sap.ui.model.FilterOperator.Contains,
                      sValue
                    ),
                    new sap.ui.model.Filter(
                      "MovementCategory",
                      sap.ui.model.FilterOperator.Contains,
                      sValue
                    ),
                  ],
                  and: false,
                }),
              ];
            }
          }

          oBinding.filter(aFilters);
        },

        /* ===========================================================
         * NO CHANGE: onConfirmVH
         * - kept your switch-case and behavior; minor safety checks added
         * =========================================================== */
        onConfirmVH: function (oEvent) {
          const oSelected = oEvent.getSource().getSelectedItem();
          if (!oSelected) return;

          const oDialog = oEvent.getSource().getParent().getParent();
          const sId = oDialog.getId(); // e.g. idVHMovementType

          let sField = "";

          switch (sId) {
            case this.getView().getId() + "--idVHMovementScenario":
              sField = "idMovementScenario";
              break;

            case this.getView().getId() + "--idVHMovementType":
              sField = "idMovementType";
              break;

            case this.getView().getId() + "--idVHVehicleType":
              sField = "idVehicleType";
              // Get selected item row
              const oVehicleTypeRow =
                oSelected.data("row") ||
                (oSelected.getBindingContext("VHModel") &&
                  oSelected.getBindingContext("VHModel").getObject());
              if (oVehicleTypeRow) {
                // Check if ConfigID is 99 for manual input
                if (oVehicleTypeRow.ConfigID === "99") {
                  // Close the dialog first
                  oDialog.close();
                  // Open manual input dialog for Vehicle Type
                  this._openManualVehicleTypeInput();
                  return; // Exit early to prevent normal processing
                }
                
                // Store ConfigID in TripData model (for backend)
                const oTripDataModel = this.getView().getModel("TripData");
                if (oTripDataModel) {
                  oTripDataModel.setProperty("/VehicleType", oVehicleTypeRow.ConfigID);
                  oTripDataModel.setProperty("/VehicleTypeDesc", oVehicleTypeRow.Description || "");
                }
                // Display Description in the input field
                const oFieldCtrl = this.byId(sField);
                if (oFieldCtrl) {
                  oFieldCtrl.setValue(oVehicleTypeRow.Description || "");
                }
              }
              break;
          }

          if (
            sField &&
            sId !== this.getView().getId() + "--idVHVehicleType" &&
            sId !== this.getView().getId() + "--idVHMovementScenario"
          ) {
            const oFieldCtrl = this.byId(sField);
            if (oFieldCtrl && oSelected.getTitle) {
              oFieldCtrl.setValue(oSelected.getTitle());
            }
          }

          oDialog.close();
        },

        /* ===========================================================
         * NO CHANGE: onCancelVH
         * =========================================================== */
        onCancelVH: function (oEvent) {
          const oDialog = oEvent.getSource().getParent();
          oDialog.close();
        },

        /* ===========================================================
         * NO CHANGE: Movement Scenario VH helpers
         * =========================================================== */
        onValueHelpMovementScenario: function () {
          this._openMovementScenarioVH();
        },

        _openMovementScenarioVH: function () {
          const oView = this.getView();

          if (!this._oMovementScenarioFrag) {
            Fragment.load({
              id: oView.getId(),
              name: "com.incresolZ_INC_PLMS.fragments.VehicleReportingFrags.VHMovementScenario",
              controller: this,
            }).then(
              function (oDialog) {
                this._oMovementScenarioFrag = oDialog;
                oView.addDependent(oDialog);
                this._loadMovementScenarioData();
                this._resetMovementScenarioSearch();
                oDialog.open();
              }.bind(this)
            );
          } else {
            this._loadMovementScenarioData();
            this._resetMovementScenarioSearch();
            this._oMovementScenarioFrag.open();
          }
        },

        _resetMovementScenarioSearch: function () {
          // Clear the search field
          const oSearchField = this.byId("idSearchMovementScenario");
          if (oSearchField) {
            oSearchField.setValue("");
          }

          // Reset list visibility - show all items
          const oList = this.byId("idVHMovementScenarioList");
          if (oList) {
            oList.getItems().forEach((item) => {
              item.setVisible(true);
            });
          }
        },

        _loadMovementScenarioData: function () {
          const oModel = this.getView().getModel();
          const oList = this.byId("idVHMovementScenarioList");

          oList.destroyItems(); // clear old items

          oModel.read("/OrderTypeSH", {
            success: function (oData) {
              oData.results.forEach((row) => {
                // Do not set movementScenario/movementType here — would overwrite with last list row.
                // Globals are set only on user selection (value help / suggestion).

                var sItemKey = MovementScenarioIcons.getMovementScenarioItemKey(
                  row.MovementType,
                  row.MovementScenario
                );
                var sIcon = MovementScenarioIcons.getIconForItemKey(sItemKey);

                oList.addItem(
                  new sap.m.StandardListItem({
                    title: row.LongText,
                    description: row.ShortText,
                    icon: sIcon,
                    type: "Active",
                  }).data("row", row)
                );
              });
            },
            error: function (error) {
              // MovementScenario VH Load Error
              sap.m.MessageBox.error(
                "Failed to load Movement Scenario value help."
              );
            },
          });
        },

        onSearchVHMovementScenario: function (oEvent) {
          const sValue = (oEvent.getParameter("newValue") || "").toLowerCase();
          const oList = this.byId("idVHMovementScenarioList");

          oList.getItems().forEach((item) => {
            const row = item.data("row");
            const match =
              row.MovementScenario.toLowerCase().includes(sValue) ||
              row.ShortText.toLowerCase().includes(sValue) ||
              row.LongText.toLowerCase().includes(sValue);

            item.setVisible(match);
          });
        },

        onSelectMovementScenario: function (oEvent) {
          const oItem = oEvent.getParameter("listItem");
          const row = oItem && oItem.data("row");
          this._syncMovementScenarioFromRow(row);
          const oDlg = this.byId("idVHMovementScenario");
          if (oDlg && oDlg.close) {
            oDlg.close();
          }
        },

        onMovementScenarioSuggest: function (oEvent) {
          const sValue = (oEvent.getParameter("suggestValue") || "").trim();
          const oInput = oEvent.getSource();
          const oModel = this.getView().getModel();
          const that = this;

          // Clear suggestions if input is empty (similar to value help reset behavior)
          if (!sValue || sValue.length < 2) {
            oInput.destroySuggestionItems();
            return;
          }

          const sLowerValue = sValue.toLowerCase();
          oModel.read("/OrderTypeSH", {
            success: function (oData) {
              const aFilteredData = oData.results.filter(function (item) {
                return (
                  item.LongText.toLowerCase().includes(sLowerValue) ||
                  item.ShortText.toLowerCase().includes(sLowerValue) ||
                  item.MovementScenario.toLowerCase().includes(sLowerValue)
                );
              });

              const oSuggestionModel = new sap.ui.model.json.JSONModel({
                MovementScenarioSuggestions: aFilteredData
              });
              that.getView().setModel(oSuggestionModel, "suggestions");
              
              // Update the binding path for suggestions
              oInput.bindAggregation("suggestionItems", {
                path: "suggestions>/MovementScenarioSuggestions",
                template: new sap.ui.core.Item({
                  key: "{suggestions>ShortText}",
                  text: "{suggestions>LongText}",
                  additionalText: "{suggestions>ShortText}"
                })
              });
            },
            error: function (error) {
              // Movement Scenario Suggestion Error
            }
          });
        },

        onMovementScenarioSuggestionSelected: function (oEvent) {
          const oItem = oEvent.getParameter("selectedItem");
          if (!oItem) return;

          // Get the selected item's key (ShortText)
          const sSelectedKey = oItem.getKey();
          
          // Find the full row data from the suggestions model
          const oSuggestionsModel = this.getView().getModel("suggestions");
          if (!oSuggestionsModel) return;

          const aSuggestions = oSuggestionsModel.getData().MovementScenarioSuggestions || [];
          const oSelectedRow = aSuggestions.find(function (item) {
            return item.ShortText === sSelectedKey;
          });

          if (oSelectedRow) {
            this._syncMovementScenarioFromRow(oSelectedRow);
          }
        },

        onValueHelpVehicleNumber: function () {
          const oView = this.getView();

          if (!this._mValueHelps) {
            this._mValueHelps = {};
          }

          if (!this._mValueHelps.VehNo) {
            Fragment.load({
              id: oView.getId(),
              name: "com.incresolZ_INC_PLMS.fragments.VehicleReportingFrags.VHVehicleNumber",
              controller: this,
            }).then(
              function (oDialog) {
                this._mValueHelps.VehNo = oDialog;
                oView.addDependent(oDialog);

                this.loadVehicleDetails().then(() => oDialog.open());
              }.bind(this)
            );
          } else {
            this.loadVehicleDetails().then(() => {
              this._mValueHelps.VehNo.open();
            });
          }
        },

        loadVehicleDetails: function () {
          const oModel = this.getView().getModel();

          return new Promise((resolve) => {
            oModel.read("/VehicleDetails", {
              success: (oData) => {
                const oJSON = new sap.ui.model.json.JSONModel(oData.results);

                if (this._mValueHelps?.VehNo) {
                  this._mValueHelps.VehNo.setModel(oJSON, "VHModel");
                }
                resolve();
              },
              error: () => {
                sap.m.MessageBox.error("Failed to load vehicle details");
                resolve();
              },
            });
          });
        },

        // =====================================================
        // SUGGEST
        // =====================================================
        _loadVehicleSuggestions: function () {
          if (this._bVehicleSuggestionLoadInProgress) {
            return;
          }

          this._bVehicleSuggestionLoadInProgress = true;
          const oModel = this.getView().getModel();

          oModel.read("/VehicleDetails", {
            success: (oData) => {
              const aVehicles = oData.results || [];
              this._aAllVehicleSuggestions = aVehicles.slice();
              this.getView().setModel(
                new sap.ui.model.json.JSONModel(aVehicles),
                "VHModel"
              );
              this.getView().setModel(
                new sap.ui.model.json.JSONModel({ items: aVehicles }),
                "vehicleNumberSuggestions"
              );
              this._bVehicleSuggestionLoadInProgress = false;

              // If user already typed while loading, re-apply immediately.
              if (this._sPendingVehicleSuggestValue !== undefined) {
                const sPendingValue = this._sPendingVehicleSuggestValue;
                this._sPendingVehicleSuggestValue = undefined;
                this._applyVehicleNumberSuggestions(sPendingValue);

                // Re-fire suggest so popup opens without requiring backspace/next key.
                const oVehicleInput = this.byId("idVehicleNumber");
                if (oVehicleInput && sPendingValue) {
                  oVehicleInput.fireSuggest({ suggestValue: sPendingValue });
                }
              }
            },
            error: () => {
              this._aAllVehicleSuggestions = [];
              this.getView().setModel(
                new sap.ui.model.json.JSONModel([]),
                "VHModel"
              );
              this.getView().setModel(
                new sap.ui.model.json.JSONModel({ items: [] }),
                "vehicleNumberSuggestions"
              );
              this._bVehicleSuggestionLoadInProgress = false;
              this._sPendingVehicleSuggestValue = undefined;
            },
          });
        },

        /**
         * Load Vehicle Type Suggestions
         */
        _loadVehicleTypeSuggestions: function () {
          const oModel = this.getView().getModel();
          const that = this;
          const sTripNumber = this._getTripNumber();
          var aBaseFilters = [
            new sap.ui.model.Filter(
              "ConfigGroup",
              sap.ui.model.FilterOperator.EQ,
              "VehicleType"
            ),
          ];
          var aTripFilters = aBaseFilters.slice();
          if (sTripNumber) {
            aTripFilters.push(
              new sap.ui.model.Filter(
                "TripNumber",
                sap.ui.model.FilterOperator.EQ,
                sTripNumber
              )
            );
          }

          var fnSetSuggestionModel = function (aItems) {
            that.getView().setModel(
              new sap.ui.model.json.JSONModel({ items: aItems || [] }),
              "vehicleTypeSuggestions"
            );
            var oTripDataModel = that.getView().getModel("TripData");
            var sCurrentVehicleType = oTripDataModel
              ? String(oTripDataModel.getProperty("/VehicleType") || "").trim()
              : "";
            if (
              oTripDataModel &&
              !sCurrentVehicleType &&
              Array.isArray(aItems) &&
              aItems.length > 1
            ) {
              oTripDataModel.setProperty("/VehicleType", aItems[1].ConfigID || "");
              oTripDataModel.setProperty(
                "/VehicleTypeDesc",
                aItems[1].Description || ""
              );
            }
            that._syncComboSelectionByKey("idVehicleType", "/VehicleType");
          };

          var fnReadConfigValues = function (aFilters, fnSuccess, fnError) {
            oModel.read("/ConfigValues", {
              filters: aFilters,
              success: fnSuccess,
              error: fnError,
            });
          };

          fnReadConfigValues(
            aTripFilters,
            function (oData) {
              var aItems = oData.results || [];
              if (aItems.length > 0 || !sTripNumber) {
                fnSetSuggestionModel(aItems);
                return;
              }
              // Fallback for services where VehicleType is not trip-specific.
              fnReadConfigValues(
                aBaseFilters,
                function (oFallbackData) {
                  fnSetSuggestionModel(oFallbackData.results || []);
                },
                function () {
                  fnSetSuggestionModel([]);
                }
              );
            },
            function () {
              // Silently fail, suggestions just won't work
              fnSetSuggestionModel([]);
            }
          );
        },

        onSuggest: function (oEvent) {
          const sValue = (oEvent.getParameter("suggestValue") || "").trim();
          this._applyVehicleNumberSuggestions(sValue);
        },

        onVehicleNumberLiveChange: function (oEvent) {
          const oInput = oEvent.getSource();
          const sRawValue = oEvent.getParameter("value") || "";
          const sUpperValue = sRawValue.toUpperCase();
          if (oInput && oInput.setValue && sRawValue !== sUpperValue) {
            oInput.setValue(sUpperValue);
          }

          const oTripDataModel = this.getView().getModel("TripData");
          if (oTripDataModel) {
            oTripDataModel.setProperty("/VehicleNumber", String(sUpperValue || "").trim());
          }

          this._applyVehicleNumberSuggestions(String(sUpperValue || "").trim());
        },

        _applyVehicleNumberSuggestions: function (sValue) {
          const oSuggestionModel = this.getView().getModel("vehicleNumberSuggestions");
          const aAllVehicles = this._aAllVehicleSuggestions || [];

          if (!oSuggestionModel || aAllVehicles.length === 0) {
            this._sPendingVehicleSuggestValue = sValue || "";
            this._loadVehicleSuggestions();
            return;
          }

          if (!sValue) {
            oSuggestionModel.setData({ items: aAllVehicles.slice() });
            oSuggestionModel.refresh(true);
            return;
          }

          const fnNormalize = function (sText) {
            return (sText || "")
              .toString()
              .toLowerCase()
              .replace(/[^a-z0-9]/g, "");
          };
          const sNeedle = fnNormalize(sValue);
          const aFilteredVehicles = aAllVehicles.filter(function (oVehicle) {
            const sVehNo = fnNormalize(oVehicle.VehicleNumber);
            return sVehNo.includes(sNeedle);
          });

          oSuggestionModel.setData({ items: aFilteredVehicles });
          oSuggestionModel.refresh(true);
        },

        // =====================================================
        // WHEN USER SELECTS VEHICLE NUMBER → AUTO FILL FIELDS
        // =====================================================
        onSuggestionItemSelected: function (oEvent) {
          const oItem = oEvent.getParameter("selectedItem");
          if (!oItem) return;

          // Selected vehicle number
          const sVehNo = oItem.getText();

          // Set in input
          const oInput = oEvent.getSource();
          oInput.setValue(sVehNo);

          // Find full vehicle object in VHModel
          const aVehicles = this._aAllVehicleSuggestions || [];
          const oVehicle = aVehicles.find((v) => v.VehicleNumber === sVehNo);

          if (oVehicle) {
            this._setVehicleAutoFields(oVehicle);
          }
        },

        // =====================================================
        // SET THE 3 AUTO FIELDS
        // =====================================================
        _setVehicleAutoFields: function (oVehicle) {
          const oTripDataModel = this.getView().getModel("TripData");

          // Keep TripData in sync with selected VehicleDetails entity.
          if (oTripDataModel) {
            oTripDataModel.setProperty("/VehicleNumber", oVehicle.VehicleNumber || "");
            oTripDataModel.setProperty("/VehicleType", oVehicle.VehicleType || "");
            oTripDataModel.setProperty("/VehicleSize", "");
            oTripDataModel.setProperty("/TransporterName", oVehicle.TransporterName || "");
          }

          // Set Transporter Name (direct value)
          if (oVehicle.TransporterName) {
            this.byId("idTransporterName").setValue(oVehicle.TransporterName);
          }
          
          // Keep Vehicle Size unselected in Reporting.
          this.byId("idVehicleSize").setSelectedKey("");
          
          // Set Vehicle Type - need to get description if VehicleType is a code
          if (oVehicle.VehicleType) {
            // Check if VehicleTypeDesc is available in the vehicle object
            if (oVehicle.VehicleTypeDesc) {
              // Use description directly if available
              this.byId("idVehicleType").setValue(oVehicle.VehicleTypeDesc);
              // Update TripData model
              if (oTripDataModel) {
                oTripDataModel.setProperty("/VehicleType", oVehicle.VehicleType);
                oTripDataModel.setProperty("/VehicleTypeDesc", oVehicle.VehicleTypeDesc);
              }
            } else {
              // Look up description from vehicle type suggestions
              const oVehicleTypeModel = this.getView().getModel("vehicleTypeSuggestions");
              if (oVehicleTypeModel) {
                const aVehicleTypes = oVehicleTypeModel.getProperty("/items") || [];
                const oVehicleType = aVehicleTypes.find(function(item) {
                  return item.ConfigID === oVehicle.VehicleType;
                });
                
                if (oVehicleType && oVehicleType.Description) {
                  this.byId("idVehicleType").setValue(oVehicleType.Description);
                  // Update TripData model
                  if (oTripDataModel) {
                    oTripDataModel.setProperty("/VehicleType", oVehicle.VehicleType);
                    oTripDataModel.setProperty("/VehicleTypeDesc", oVehicleType.Description);
                  }
                } else {
                  // Fallback: set the code if description not found
                  this.byId("idVehicleType").setValue(oVehicle.VehicleType);
                  if (oTripDataModel) {
                    oTripDataModel.setProperty("/VehicleType", oVehicle.VehicleType);
                  }
                }
              } else {
                // Fallback: set the code if model not available
                this.byId("idVehicleType").setValue(oVehicle.VehicleType);
                if (oTripDataModel) {
                  oTripDataModel.setProperty("/VehicleType", oVehicle.VehicleType);
                }
              }
            }
          }
        },
        onConfirmVHVehicleNumber: function (oEvent) {
          const oItem = oEvent.getParameter("selectedItem");
          if (!oItem) return;

          // Vehicle Number (title in your fragment)
          const sVehicleNumber = oItem.getTitle();

          // Put the number on the VehicleNumber input field
          this.byId("idVehicleNumber").setValue(sVehicleNumber);

          // Get VHModel data
          const oVHModel = this.getView().getModel("VHModel");
          if (!oVHModel) {
            // VHModel not found
            return;
          }

          const aVehicles = oVHModel.getData();

          // Find selected vehicle object
          const oVehicle = aVehicles.find(
            (v) => v.VehicleNumber === sVehicleNumber
          );

          if (oVehicle) {
            this.byId("idVehicleType").setValue(oVehicle.VehicleType);
            this.byId("idVehicleSize").setSelectedKey("");
            this.byId("idTransporterName").setValue(oVehicle.TransporterName);
          } else {
            // Vehicle not found in VHModel
          }

          // Close the dialog
          if (this._mValueHelps?.VehNo) {
            this._mValueHelps.VehNo.close();
          }
        },

        onSearchVHVehicleNumber: function (oEvent) {
          const sValue = (oEvent.getParameter("value") || "").trim();
          const oDialog = oEvent.getSource();
          
          // Get the binding from the SelectDialog's items aggregation
          const oBinding = oDialog.getBinding("items");

          if (!oBinding) {
            // Binding not found for Vehicle Number search
            return;
          }

          if (sValue && sValue.length > 0) {
            // Use custom filter function for case-insensitive search with JSONModel
            const sLowerValue = sValue.toLowerCase();
            oBinding.filter([
              new sap.ui.model.Filter({
                test: function (oContext) {
                  try {
                    // Handle different JSONModel binding scenarios
                    let oData;
                    if (oContext && typeof oContext.getObject === "function") {
                      oData = oContext.getObject();
                    } else if (oContext && typeof oContext === "object") {
                      // Sometimes the context itself is the data object
                      oData = oContext;
                    } else {
                      return false;
                    }
                    
                    if (!oData || typeof oData !== "object") {
                      return false;
                    }
                    
                    const sVehicleNumber = (oData.VehicleNumber || "").toLowerCase();
                    const sTransporterName = (oData.TransporterName || "").toLowerCase();
                    
                    return sVehicleNumber.includes(sLowerValue) || 
                           sTransporterName.includes(sLowerValue);
                  } catch (e) {
                    // Error in Vehicle Number filter
                    return false;
                  }
                }
              })
            ]);
          } else {
            // Clear filter if search value is empty
            oBinding.filter([]);
          }
        },

        onCancelVHVehicleNumber: function (oEvent) {
          if (this._mValueHelps?.VehNo) {
            this._mValueHelps.VehNo.close();
          }
        },

        /* ===========================================================
         * Manual Vehicle Type Input Dialog
         * Opens when user selects ConfigID 99 from Vehicle Type value help
         * =========================================================== */
        _openManualVehicleTypeInput: function () {
          const that = this;
          
          if (!this._oManualVehicleTypeDialog) {
            this._oManualVehicleTypeDialog = new sap.m.Dialog({
              title: "Enter Vehicle Type Manually",
              contentWidth: "400px",
              contentHeight: "200px",
              draggable: true,
              resizable: true,
              content: [
                new sap.m.VBox({
                  class: "sapUiMediumMargin",
                  items: [
                    new sap.m.Label({
                      text: "Vehicle Type:",
                      design: "Bold",
                      required: true
                    }),
                    new sap.m.Input({
                      id: this.createId("idManualVehicleTypeInput"),
                      width: "100%",
                      placeholder: "Enter vehicle type...",
                      maxLength: 50,
                      liveChange: function(oEvent) {
                        const sValue = oEvent.getParameter("value");
                        const oOkButton = that._oManualVehicleTypeDialog.getBeginButton();
                        oOkButton.setEnabled(!!sValue && sValue.trim().length > 0);
                      }
                    })
                  ]
                })
              ],
              beginButton: new sap.m.Button({
                text: "OK",
                type: "Emphasized",
                enabled: false,
                press: function () {
                  that._onConfirmManualVehicleType();
                }
              }),
              endButton: new sap.m.Button({
                text: "Cancel",
                press: function () {
                  that._oManualVehicleTypeDialog.close();
                }
              })
            });
            
            this.getView().addDependent(this._oManualVehicleTypeDialog);
          }
          
          // Clear previous input and reset button state
          const oInput = this.byId("idManualVehicleTypeInput");
          if (oInput) {
            oInput.setValue("");
            oInput.setValueState("None");
          }
          this._oManualVehicleTypeDialog.getBeginButton().setEnabled(false);
          
          this._oManualVehicleTypeDialog.open();
        },

        /* ===========================================================
         * Confirm Manual Vehicle Type Input
         * Validates and saves the manually entered vehicle type
         * =========================================================== */
        _onConfirmManualVehicleType: function () {
          const oInput = this.byId("idManualVehicleTypeInput");
          const sManualVehicleType = oInput.getValue().trim();
          
          if (!sManualVehicleType) {
            oInput.setValueState("Error");
            oInput.setValueStateText("Please enter a vehicle type");
            return;
          }
          
          // Store the manual vehicle type in TripData model
          const oTripDataModel = this.getView().getModel("TripData");
          if (oTripDataModel) {
            // Use ConfigID 99 to indicate manual entry, but store the actual description
            oTripDataModel.setProperty("/VehicleType", "99");
            oTripDataModel.setProperty("/VehicleTypeDesc", sManualVehicleType);
            this._syncTripDataToCoreAndNotify(oTripDataModel);
          }
          
          // Update the Vehicle Type input field with the manual entry
          const oVehicleTypeField = this.byId("idVehicleType");
          if (oVehicleTypeField) {
            oVehicleTypeField.setValue(sManualVehicleType);
          }
          
          // Clear value state and close dialog
          oInput.setValueState("None");
          this._oManualVehicleTypeDialog.close();
          
          sap.m.MessageToast.show("Manual vehicle type entered: " + sManualVehicleType);
        },

        _syncTripDataToCoreAndNotify: function (oTripDataModel) {
          if (!oTripDataModel) {
            return;
          }
          sap.ui.getCore().setModel(oTripDataModel, "TripData");
          sap.ui.getCore().getEventBus().publish("TripData", "Updated");
        },

        _setVehicleTypeFromItem: function (oSelectedItem) {
          if (!oSelectedItem) {
            return;
          }

          if (oSelectedItem.ConfigID === "99") {
            this._openManualVehicleTypeInput();
            return;
          }

          const oTripDataModel = this.getView().getModel("TripData");
          if (oTripDataModel) {
            oTripDataModel.setProperty("/VehicleType", oSelectedItem.ConfigID);
            oTripDataModel.setProperty("/VehicleTypeDesc", oSelectedItem.Description || "");
            this._syncTripDataToCoreAndNotify(oTripDataModel);
          }

          const oVehicleType = this.byId("idVehicleType");
          if (oVehicleType) {
            oVehicleType.setSelectedKey(oSelectedItem.ConfigID || "");
            oVehicleType.setValue(oSelectedItem.Description || "");
          }
        },

        onVehicleTypeSelectionChange: function (oEvent) {
          const oItem = oEvent.getParameter("selectedItem");
          if (!oItem) {
            return;
          }

          this._setVehicleTypeFromItem({
            ConfigID: oItem.getKey(),
            Description: oItem.getText(),
          });
        },

        onVehicleTypeChange: function (oEvent) {
          const oCombo = oEvent.getSource();
          const sValue = (oCombo.getValue() || "").trim();
          const oTripDataModel = this.getView().getModel("TripData");

          if (!oTripDataModel) {
            return;
          }

          const sSelectedKey = oCombo.getSelectedKey ? (oCombo.getSelectedKey() || "") : "";
          if (sSelectedKey === "03") {
            oTripDataModel.setProperty("/VehicleType", "03");
            oTripDataModel.setProperty("/VehicleTypeDesc", sValue);
            this._syncTripDataToCoreAndNotify(oTripDataModel);
            return;
          }

          if (sSelectedKey) {
            const aItems = (this.getView().getModel("vehicleTypeSuggestions")?.getProperty("/items")) || [];
            const oSelectedItem = aItems.find(function (item) {
              return item.ConfigID === sSelectedKey;
            });
            if (oSelectedItem) {
              this._setVehicleTypeFromItem(oSelectedItem);
            }
            return;
          }

          const aItems = (this.getView().getModel("vehicleTypeSuggestions")?.getProperty("/items")) || [];
          const oMatchedItem = aItems.find(function (item) {
            return (item.Description || "").toLowerCase() === sValue.toLowerCase();
          });

          if (oMatchedItem) {
            this._setVehicleTypeFromItem(oMatchedItem);
            return;
          }

          oTripDataModel.setProperty("/VehicleType", "99");
          oTripDataModel.setProperty("/VehicleTypeDesc", sValue);
          this._syncTripDataToCoreAndNotify(oTripDataModel);
        },

        /**
         * Load TripNumber from ConfigValues
         */
        _loadTripNumberData: function () {
          const oModel = this.getView().getModel();
          const that = this;
          const sTripNumber = this._getTripNumber();

          var aFilters = [
            new sap.ui.model.Filter(
              "ConfigGroup",
              sap.ui.model.FilterOperator.EQ,
              "TripNumber"
            ),
          ];

          // Add TripNumber filter if available
          if (sTripNumber) {
            aFilters.push(
              new sap.ui.model.Filter(
                "TripNumber",
                sap.ui.model.FilterOperator.EQ,
                sTripNumber
              )
            );
          }

          return new Promise(function (resolve) {
            oModel.read("/ConfigValues", {
              filters: aFilters,
              success: function (oData) {
                const oJSON = new sap.ui.model.json.JSONModel(oData.results);
                if (that._mValueHelps && that._mValueHelps.VHTripNumber) {
                  that._mValueHelps.VHTripNumber.setModel(oJSON, "VHModel");
                }
                resolve();
              },
              error: function () {
                sap.m.MessageBox.error("Failed to load Trip Number.");
                resolve();
              },
            });
          });
        },

        /**
         * Search TripNumber
         */
        onSearchTripNumber: function (oEvent) {
          const sValue = (oEvent.getParameter("value") || "").trim();
          const oList = this.byId("idVHTripNumberList");

          if (!oList) {
            return;
          }

          const oBinding = oList.getBinding("items");

          if (!oBinding) {
            return;
          }

          const aFilters = [];
          if (sValue && sValue.length > 0) {
            aFilters.push(
              new sap.ui.model.Filter({
                filters: [
                  new sap.ui.model.Filter(
                    "ConfigID",
                    sap.ui.model.FilterOperator.Contains,
                    sValue
                  ),
                  new sap.ui.model.Filter(
                    "Description",
                    sap.ui.model.FilterOperator.Contains,
                    sValue
                  ),
                ],
                and: false,
              })
            );
          }

          oBinding.filter(aFilters);
        },

        // User-role-based authorization for Vehicle Reporting has been removed; 
        // edit/save button states are controlled by view mode and validation only.

        /**
         * Handle TripData updates to refresh scanner visibility
         */
        _onTripDataUpdated: function () {
          this._updateScannerVisibility();

          var oTripData = sap.ui.getCore().getModel("TripData");
          if (oTripData) {
            this._syncMovementScenarioItemKeyOnTripData(oTripData);

            // Propagate core TripData to this view so bindings resolve correctly
            this.getView().setModel(oTripData, "TripData");
            this._loadReportingDocTypes();
            this._syncReportingDocTypeFromTrip(oTripData);
            this._syncReportingRefDocNoFromTrip(oTripData);

            var oMovementScenarioCtrl = this.byId("idMovementScenario");
            if (oMovementScenarioCtrl && oMovementScenarioCtrl.setSelectedKey) {
              var sKey = oTripData.getProperty("/MovementScenarioItemKey");
              if (sKey) {
                oMovementScenarioCtrl.setSelectedKey(sKey);
              }
            }
            this._updateScannerVisibility();
          }
          this._setInputsEnabled(this._mode === "EDIT" || this._mode === "CREATE");
          this._setButtonStates(true, true);
        },

        _syncReportingRefDocNoFromTrip: function (oTripDataModel) {
          var oUi = this.getView().getModel("reportingUi");
          if (!oUi) {
            return;
          }
          var sNo = String(oTripDataModel?.getProperty("/RefDocNo") || "").trim();
          if (sNo) {
            oUi.setProperty("/refDocSearchValue", sNo);
          }
        },

        _normalizeTripNumber10: function (sTripNumber) {
          var sTrip = sTripNumber != null ? String(sTripNumber).trim() : "";
          if (/^\d+$/.test(sTrip)) {
            sTrip = sTrip.padStart(10, "0");
          }
          return sTrip;
        },

        _loadReportingDocTypes: function () {
          var oModel = this.getView().getModel();
          var oDocTypeModel = this.getView().getModel("docTypeItems");
          if (!oModel || !oDocTypeModel) {
            return;
          }

          var oGlobal = sap.ui.getCore().getModel("globalData");
          var sTrip = this._normalizeTripNumber10(oGlobal ? oGlobal.getProperty("/TripNumber") : "");

          var aFilters = [new Filter("ConfigGroup", FilterOperator.EQ, "DocType")];
          if (sTrip) {
            aFilters.push(new Filter("TripNumber", FilterOperator.EQ, sTrip));
          }

          oModel.read("/ConfigValues", {
            filters: aFilters,
            success: function (oData) {
              oDocTypeModel.setProperty("/items", (oData && oData.results) || []);
              this._syncReportingDocTypeFromTrip(this.getView().getModel("TripData"));
            }.bind(this),
            error: function () {
              oDocTypeModel.setProperty("/items", []);
            },
          });
        },

        _mapDocTypeToSuggestMode: function (sConfigId, sDescription) {
          var sId = String(sConfigId || "").toUpperCase().trim();
          var sDesc = String(sDescription || "").toUpperCase().trim();
          var s = (sId + " " + sDesc).trim();
          if (s.indexOf("PO") !== -1) return "PO";
          if (s.indexOf("CHALLAN") !== -1) return "CHALLAN";
          if (s.indexOf("INVOICE") !== -1 || s.indexOf("BILL") !== -1) return "INVOICE";
          // fallback keeps existing behaviour
          return "INVOICE";
        },

        _syncReportingDocTypeFromTrip: function (oTripDataModel) {
          var oUi = this.getView().getModel("reportingUi");
          var oDocTypeModel = this.getView().getModel("docTypeItems");
          if (!oUi || !oDocTypeModel) {
            return;
          }

          // TripData may come from the "Report Vehicle" popup with a DocType code (e.g. "PO")
          // while the Reporting dropdown expects a ConfigID from /ConfigValues (ConfigGroup="DocType").
          // So we try: exact ConfigID match first, then match by Description/ID containing the trip code.
          var sTripConfigId = String(oTripDataModel?.getProperty("/RefDocType") || "").trim();
          var sTripNeedle = String(sTripConfigId || "").toUpperCase().trim();
          var aItems = oDocTypeModel.getProperty("/items") || [];

          // Pick trip value if present; else first available config id
          var oMatch = null;
          if (sTripConfigId) {
            oMatch = (aItems || []).find(function (o) {
              return String(o?.ConfigID || "").trim() === sTripConfigId;
            });
          }
          if (!oMatch && sTripNeedle) {
            oMatch = (aItems || []).find(function (o) {
              var sId = String(o?.ConfigID || "").toUpperCase().trim();
              var sDesc = String(o?.Description || "").toUpperCase().trim();
              return sId === sTripNeedle || sDesc === sTripNeedle;
            });
          }
          if (!oMatch && sTripNeedle) {
            oMatch = (aItems || []).find(function (o) {
              var sId = String(o?.ConfigID || "").toUpperCase().trim();
              var sDesc = String(o?.Description || "").toUpperCase().trim();
              return sId.indexOf(sTripNeedle) !== -1 || sDesc.indexOf(sTripNeedle) !== -1;
            });
          }
          if (!oMatch && aItems && aItems.length) {
            oMatch = aItems[0];
            sTripConfigId = String(oMatch?.ConfigID || "").trim();
          }

          if (sTripConfigId) {
            if (oMatch && String(oMatch?.ConfigID || "").trim()) {
              sTripConfigId = String(oMatch.ConfigID).trim();
              // Normalize TripData to ConfigID so save payload sends ConfigID to backend.
              try {
                oTripDataModel?.setProperty?.("/RefDocType", sTripConfigId);
              } catch (e) {
                // ignore
              }
            }
            oUi.setProperty("/referenceByKey", sTripConfigId);
            oUi.setProperty(
              "/referenceByMode",
              this._mapDocTypeToSuggestMode(sTripConfigId, oMatch?.Description)
            );
          }
        },

        //---------------------------------------------
        // REPORTING — REFERENCE DOCUMENT (Search-by style suggestions)
        //---------------------------------------------
        onReportingReferenceByChange: function (oEvent) {
          var oSel = oEvent.getSource();
          var sKey = oSel && oSel.getSelectedKey ? oSel.getSelectedKey() : "";
          sKey = String(sKey || "").trim();
          var oItem = oEvent.getParameter("selectedItem");
          var sDesc = oItem && oItem.getText ? oItem.getText() : "";

          var oUi = this.getView().getModel("reportingUi");
          if (oUi) {
            oUi.setProperty("/referenceByKey", sKey);
            oUi.setProperty("/referenceByMode", this._mapDocTypeToSuggestMode(sKey, sDesc));
            oUi.setProperty("/refDocSearchValue", "");
          }
          this._clearReportingRefSuggestItems();

          // Keep TripData in sync (what user selected as type)
          var oTripData = sap.ui.getCore().getModel("TripData");
          if (oTripData) {
            oTripData.setProperty("/RefDocType", sKey);
            oTripData.setProperty("/RefDocNo", "");
          }
        },

        onReportingRefDocSuggest: function (oEvent) {
          var sValue = (oEvent.getParameter("suggestValue") || "").trim();
          if (this._iReportingRefSuggestTimeout) {
            clearTimeout(this._iReportingRefSuggestTimeout);
          }
          var that = this;
          this._iReportingRefSuggestTimeout = setTimeout(function () {
            that._loadReportingRefSuggestions(sValue);
          }, 300);
        },

        _loadReportingRefSuggestions: function (sTerm) {
          var oM = this.getView().getModel("reportingRefSuggest");
          var oUi = this.getView().getModel("reportingUi");
          if (!oM || !oUi) {
            return;
          }
          var sMode = String(oUi.getProperty("/referenceByMode") || "INVOICE").toUpperCase();
          this._fetchReportingReferenceSuggestions(sTerm, sMode, oM);
        },

        _fetchReportingReferenceSuggestions: function (sTerm, sKey, oLocalModel) {
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
            error: function () {
              oLocalModel.setProperty("/items", []);
            },
          });
        },

        onReportingRefDocSuggestionSelected: function (oEvent) {
          var oItem = oEvent.getParameter("selectedItem");
          var sText = oItem ? String(oItem.getText() || "").trim() : "";

          var oUi = this.getView().getModel("reportingUi");
          if (oUi) {
            oUi.setProperty("/refDocSearchValue", sText);
          }
          this._clearReportingRefSuggestItems();

          var oTripData = sap.ui.getCore().getModel("TripData");
          if (oTripData) {
            oTripData.setProperty("/RefDocNo", sText);
          }
        },

        onReportingRefDocSearchChange: function (oEvent) {
          var sVal = String(oEvent.getParameter("value") || "").trim();
          var oUi = this.getView().getModel("reportingUi");
          if (oUi) {
            oUi.setProperty("/refDocSearchValue", sVal);
          }
          this._clearReportingRefSuggestItems();

          var oTripData = sap.ui.getCore().getModel("TripData");
          if (oTripData) {
            oTripData.setProperty("/RefDocNo", sVal);
          }
        },

        _clearReportingRefSuggestItems: function () {
          var oM = this.getView().getModel("reportingRefSuggest");
          if (oM) {
            oM.setProperty("/items", []);
          }
        },

        //---------------------------------------------
        // INCOMING — PO SEARCH (OrderDetails suggestions)
        //---------------------------------------------
        onPoNumberSuggest: function (oEvent) {
          var sValue = (oEvent.getParameter("suggestValue") || "").trim();
          if (this._iPoSuggestTimeout) {
            clearTimeout(this._iPoSuggestTimeout);
          }
          var that = this;
          this._iPoSuggestTimeout = setTimeout(function () {
            that._loadPoNumberSuggestions(sValue);
          }, 300);
        },

        _loadPoNumberSuggestions: function (sTerm) {
          var oModel = this.getView().getModel();
          var oSuggModel = this.getView().getModel("poNumberSuggestions");
          if (!oModel || !oSuggModel) {
            return;
          }
          if (!sTerm || sTerm.length < 1) {
            oSuggModel.setProperty("/items", []);
            return;
          }

          var aFilters = [
            new Filter("MovementType", FilterOperator.EQ, "I"),
            new Filter("MovmentInd", FilterOperator.EQ, "GI"),
            new Filter({
              filters: [
                new Filter("DocumentNumber", FilterOperator.Contains, sTerm),
                new Filter("Name", FilterOperator.Contains, sTerm),
              ],
              and: false,
            }),
          ];

          oModel.read("/OrderDetails", {
            filters: aFilters,
            urlParameters: { $top: "40" },
            success: function (oData) {
              var a = oData.results || [];
              var mSeen = {};
              var aItems = [];
              a.forEach(function (o) {
                var n =
                  (o.DocumentNumber && String(o.DocumentNumber).trim()) || "";
                if (n && !mSeen[n]) {
                  mSeen[n] = true;
                  aItems.push({
                    DocumentNumber: n,
                    Name: o.Name || "",
                  });
                }
              });
              oSuggModel.setProperty("/items", aItems);
            },
            error: function () {
              oSuggModel.setProperty("/items", []);
            },
          });
        },

        onPoNumberSuggestionSelected: function (oEvent) {
          var oItem = oEvent.getParameter("selectedItem");
          if (!oItem) {
            return;
          }
          var sPo = oItem.getText();
          var oInput = oEvent.getSource();
          oInput.setValue(sPo);
          this._submitPoNumberFromSearch(sPo);
        },

        onPoNumberSubmitPress: function () {
          var oInput = this.byId("idReportingPoSearchInput");
          var sPo = oInput ? (oInput.getValue() || "").trim() : "";
          this._submitPoNumberFromSearch(sPo);
        },

        _submitPoNumberFromSearch: function (sPo) {
          var sPoValidated = this._validateNumericDocNumber10(sPo, "PO number", true);
          if (!sPoValidated) {
            return;
          }
          this._postAsnDetails(null, null, sPoValidated);
        },

        //---------------------------------------------
        // SCANNER LOGIC
        //---------------------------------------------
        onScanSuccess: function () {
          var that = this;
          BarcodeScanner.scan(
            function (oResult) {
              if (oResult.cancelled) {
                that._clearAndRefocusScanner(false);
                return;
              }
              var sScannedCode = oResult.text;
              // Parse code if it contains pipe separator (e.g., "GATE001|Entry Gate 1")
              var sParsedCode = sScannedCode.split("|")[0];
              that._processScannedCode(sParsedCode, false);
            }.bind(this),
            function (oError) {
              MessageToast.show("Scan failed: " + (oError.message || oError));
              that._clearAndRefocusScanner(false);
            }.bind(this)
          );
        },

        onScanLiveupdate: function (oEvent) {
          var sText = oEvent.getParameter("newValue");
          var oScannerInput = this.getView().byId("idReportingScannerInput");
          if (oScannerInput) {
            oScannerInput.setValue(sText);
          }
          
          // Clear any existing timeout
          if (this._scanTimeout) {
            clearTimeout(this._scanTimeout);
          }
          
          // Process scanned code after user stops typing (500ms delay)
          // This prevents processing on every keystroke for manual PO entry
          if (sText && sText.trim() !== "") {
            var that = this;
            this._scanTimeout = setTimeout(function() {
              var sParsedCode = sText.split("|")[0];
              that._processScannedCode(sParsedCode, true);
            }, 500); // Wait 500ms after user stops typing
          }
        },

        /**
         * @param {boolean} [bSkipPostSuccessModelRefresh] When true (debounced manual typing),
         *   skip TripData reload and HomePage OData trip list refresh after /AsnDetails succeeds.
         */
        _processScannedCode: function (sScannedCode, bSkipPostSuccessModelRefresh) {
          if (!sScannedCode || sScannedCode.trim() === "") {
            MessageToast.show("Invalid scan code");
            this._clearAndRefocusScanner();
            return;
          }

          // Try to parse scanned code as JSON first
          var oScannedData = null;
          try {
            oScannedData = JSON.parse(sScannedCode);
          } catch (e) {
            // If not JSON, try to parse as comma-separated key-value pairs
            oScannedData = this._parseKeyValueString(sScannedCode);
          }

          // Check if ASN data is available (has asnId and orgId)
          var sAsnId = oScannedData ? oScannedData.asnId : null;
          var sOrgId = oScannedData ? oScannedData.orgId : null;
          
          if (sAsnId && sOrgId) {
            // ASN is available - use ASN flow
            this._postAsnDetails(sAsnId, sOrgId, null, bSkipPostSuccessModelRefresh);
          } else {
            // ASN is not available - treat input as PO number
            var sPoNumber = sScannedCode.trim();
            
            // For debounced manual typing, avoid toasts on partial values.
            sPoNumber = this._validateNumericDocNumber10(sPoNumber, "PO number", !bSkipPostSuccessModelRefresh);
            if (sPoNumber) {
              this._postAsnDetails(null, null, sPoNumber, bSkipPostSuccessModelRefresh);
            } else if (!bSkipPostSuccessModelRefresh) {
              this._clearAndRefocusScanner();
            }
          }
        },

        _parseKeyValueString: function (sString) {
          try {
            // Parse format like: "vendorCode=I0141,asnId=ASN5a8faad3,poNum=2000000294,orgId=a039ec0a-df8c-4b0b-abb5-7f41b2190fc6"
            var oResult = {};
            var aPairs = sString.split(',');
            aPairs.forEach(function(sPair) {
              var aKeyValue = sPair.split('=');
              if (aKeyValue.length === 2) {
                var sKey = aKeyValue[0].trim();
                var sValue = aKeyValue[1].trim();
                oResult[sKey] = sValue;
              }
            });
            return oResult;
          } catch (e) {
            return null;
          }
        },

        /**
         * @param {boolean} [bClear=true] When false, only refocus (e.g. after camera cancel or error toast).
         */
        _clearAndRefocusScanner: function (bClear) {
          var oScannerInput = this.getView().byId("idReportingScannerInput");
          if (oScannerInput) {
            if (bClear !== false) {
              oScannerInput.setValue("");
            }
            setTimeout(function() {
              oScannerInput.focus();
            }, 100);
          }
        },

        _postAsnDetails: function (sAsnId, sOrgId, sPoNumber, bSkipPostSuccessModelRefresh) {
          var that = this;
          var oPayload = {};
          
          // Build payload based on what's available
          if (sAsnId && sOrgId) {
            // ASN flow - include AsnId and OrgId
            oPayload = {
              AsnId: sAsnId,
              OrgId: sOrgId
            };
          } else if (sPoNumber) {
            var sPoValidated = this._validateNumericDocNumber10(
              sPoNumber,
              "PO number",
              !bSkipPostSuccessModelRefresh
            );
            if (!sPoValidated) {
              if (!bSkipPostSuccessModelRefresh) {
                this._clearAndRefocusScanner();
              }
              return;
            }
            // PO Number flow - include PoNumber
            oPayload = {
              PoNumber: sPoValidated
            };
          } else {
            MessageToast.show("Invalid input: Please provide either ASN details or PO number");
            this._clearAndRefocusScanner();
            return;
          }

          // Attach additional reporting fields when available.
          var oTripDataModel = this.getView().getModel("TripData");
          var sMovementType = String(oTripDataModel?.getProperty("/MovementType") || "")
            .trim()
            .toUpperCase();
          var bIsInward = sMovementType === "I";
          var sRefDocType = String(oTripDataModel?.getProperty("/RefDocType") || "").trim();
          var sRefDocNo = String(oTripDataModel?.getProperty("/RefDocNo") || "").trim();
          var sEwbNo = String(oTripDataModel?.getProperty("/EwbNo") || "").trim();
          var sInvRefNo = String(oTripDataModel?.getProperty("/InvRefNo") || "").trim();
          var oEwbDateCtrl = this.byId("idEwbDate");
          var oInvDateCtrl = this.byId("idInvDcDate");
          var oEwbDate = oEwbDateCtrl?.getDateValue?.();
          var oInvRefDate = oInvDateCtrl?.getDateValue?.();

          if (sRefDocType) {
            oPayload.InvRefDocType = sRefDocType;
          }
          if (sRefDocNo) {
            oPayload.PoIbdNumber = sRefDocNo;
          }
          if (sEwbNo) {
            oPayload.EwbNo = sEwbNo;
          }
          if (bIsInward && sInvRefNo) {
            oPayload.InvRefNo = sInvRefNo;
          }
          if (oEwbDate && !isNaN(oEwbDate.getTime())) {
            oPayload.EwbActStartDate = oEwbDate.toISOString().split(".")[0];
          }
          if (bIsInward && oInvRefDate && !isNaN(oInvRefDate.getTime())) {
            oPayload.InvRefDate = oInvRefDate.toISOString().split(".")[0];
          }

          var oModel = this.getView().getModel();
          oModel.create("/AsnDetails", oPayload, {
            headers: {
              "X-Requested-With": "X"
            },
            success: function (oResponse) {
              var oScannerVBox = that.getView().byId("idReportingScannerVBox");
              if (oScannerVBox) {
                oScannerVBox.setVisible(false);
              }
              var oScannerInput = that.getView().byId("idReportingScannerInput");
              if (oScannerInput) {
                oScannerInput.setValue("");
              }
              var oGlobalModel = sap.ui.getCore().getModel("globalData");
              if (oGlobalModel) {
                oGlobalModel.setProperty("/IsScanningReporting", false);
              }

              // Hide the form panel since reporting is done through scanner
              var oReportingPanel = that.getView().byId("reportingDetailsPanel");
              if (oReportingPanel) {
                oReportingPanel.setVisible(false);
              }
              
              // Get TripNumber from response or TripData model
              var sTripNumber = oResponse.TripNumber || 
                               (sap.ui.getCore().getModel("TripData")?.getProperty("/TripNumber"));
              
              // Format trip number (remove leading zeros)
              var sFormattedTripNumber = sTripNumber ? String(sTripNumber).replace(/^0+/, "") || "0" : "";
              
              // After camera scan: reload TripData + refresh trip list. Skip when the user typed
              // the code (debounced) to avoid redundant OData/model refresh during manual entry.
              if (!bSkipPostSuccessModelRefresh) {
                if (sTripNumber) {
                  that._loadTripDetailsForHeader(sTripNumber);
                }
                sap.ui.getCore().getEventBus().publish("HomePage", "RefreshTripTable");
              }

              var sMessage = sTripNumber
                ? "Trip created with Trip Number: " + sFormattedTripNumber
                : "Trip created successfully";
              MessageToast.show(sMessage);
            },
            error: function (oError) {
              var sErrorMessage = sAsnId 
                ? "Failed to post ASN Details"
                : "Failed to post PO Number";
              
              try {
                var oResponse = JSON.parse(oError.responseText);
                if (
                  oResponse.error &&
                  oResponse.error.message &&
                  oResponse.error.message.value
                ) {
                  sErrorMessage = oResponse.error.message.value;
                } else if (oResponse.error && oResponse.error.message) {
                  sErrorMessage = oResponse.error.message;
                }
              } catch (e) {
                if (oError.message && oError.message.value) {
                  sErrorMessage = oError.message.value;
                } else if (oError.message) {
                  sErrorMessage += ": " + oError.message;
                }
              }
              
              MessageBox.error(sErrorMessage, {
                onClose: function () {
                  that._clearAndRefocusScanner();
                },
              });
            }
          });
        },

        _updateScannerVisibility: function () {
          var oScannerVBox = this.getView().byId("idReportingScannerVBox");
          var oPoSearchVBox = this.getView().byId("idReportingPoSearchVBox");

          if (!oScannerVBox) {
            return;
          }

          // Get the form panel and save button
          var oReportingPanel = this.getView().byId("reportingDetailsPanel");
          var oSaveButton = this.getView().byId("btnSaveReporting");
          // Snapshot UI before updates — TripData/Updated fires from Gate In / Ref Docs too.
          // Avoid redundant expand/focus that scroll the page back to Reporting.
          var bPrevScannerVBoxVisible = !!oScannerVBox.getVisible();
          var bPrevPoSearchVisible = !!(oPoSearchVBox && oPoSearchVBox.getVisible());
          var oTripData = sap.ui.getCore().getModel("TripData");
          var bTripLocked = !!(sap.ui.getCore().getModel("globalData")?.getProperty("/TripLocked"));

          var oGlobalForMode = sap.ui.getCore().getModel("globalData");
          var bIncomingFlow =
            oGlobalForMode && oGlobalForMode.getProperty("/HasIncomingMaterials");
          var sIncomingMethod = oGlobalForMode
            ? oGlobalForMode.getProperty("/IncomingReportingMethod")
            : null;
          var sIncomingRefDocSkip = oGlobalForMode
            ? oGlobalForMode.getProperty("/IncomingRefDocSkip")
            : "";
          var bIncomingSkipDocument = String(sIncomingRefDocSkip || "")
            .trim()
            .toUpperCase() === "X";

          var sCurrentItemKey = "";
          if (oTripData) {
            sCurrentItemKey = oTripData.getProperty("/MovementScenarioItemKey") || "";
          }
          if (!sCurrentItemKey) {
            var sMtCurrent =
              (oTripData && oTripData.getProperty("/MovementType")) || Mtype || "";
            var sMsCurrent =
              movementScenario !== undefined && movementScenario !== null && movementScenario !== ""
                ? movementScenario
                : oTripData
                  ? oTripData.getProperty("/MovementScenario")
                  : "";
            sCurrentItemKey = MovementScenarioIcons.getMovementScenarioItemKey(
              sMtCurrent,
              sMsCurrent
            );
          }
          var bIsScannerScenario =
            MovementScenarioIcons.isScannerMovementScenarioItemKey(sCurrentItemKey);
          var bForceScannerForIncomingSkip =
            !!bIncomingFlow &&
            String(sIncomingMethod || "").toUpperCase() === "PO" &&
            bIncomingSkipDocument &&
            bIsScannerScenario;

          // Check if there's data in Reporting Screen (TripData model)
          var bHasData = false;
          
          if (oTripData) {
            var sTripNumber = oTripData.getProperty("/TripNumber") || "";
            var sVehicleNumber = oTripData.getProperty("/VehicleNumber") || "";
            var sMovementScenarioDesc = oTripData.getProperty("/MovementScenarioDesc") || "";
            var sMovementTypeDesc = oTripData.getProperty("/MovementTypeDesc") || "";
            
            // If any key field has data, consider that data exists
            if (sTripNumber || sVehicleNumber || sMovementScenarioDesc || sMovementTypeDesc) {
              bHasData = true;
            }
          }
          
          // If scanner mode must be forced for incoming skip-document + I01/I02/I03,
          // keep scanner visible even when TripData is already present.
          if (bForceScannerForIncomingSkip) {
            oScannerVBox.setVisible(true);
            if (oPoSearchVBox) {
              oPoSearchVBox.setVisible(false);
            }
            if (oReportingPanel) {
              oReportingPanel.setVisible(false);
            }
            if (oSaveButton) {
              oSaveButton.setVisible(false);
            }
            if (!oGlobalForMode) {
              oGlobalForMode = new sap.ui.model.json.JSONModel({});
              sap.ui.getCore().setModel(oGlobalForMode, "globalData");
            }
            oGlobalForMode.setProperty("/IsScanningReporting", true);
            oGlobalForMode.setProperty("/DisableRefDocMaterialsActions", false);
            if (!bPrevScannerVBoxVisible) {
              setTimeout(
                function () {
                  var oScannerInput = this.getView().byId("idReportingScannerInput");
                  if (oScannerInput) {
                    oScannerInput.focus();
                  }
                }.bind(this),
                300
              );
            }
            return;
          }

          // If there's data, hide the scanner and show the form and save button
          if (bHasData) {
            oScannerVBox.setVisible(false);
            if (oPoSearchVBox) {
              oPoSearchVBox.setVisible(false);
            }
            if (oReportingPanel) {
              if (!oReportingPanel.getVisible()) {
                oReportingPanel.setVisible(true);
              }
            }
            if (oSaveButton) {
              oSaveButton.setVisible(!bTripLocked);
            }

            // In this case reporting is not done via scanner
            var oGlobalModelHasData = sap.ui.getCore().getModel("globalData");
            if (!oGlobalModelHasData) {
              oGlobalModelHasData = new sap.ui.model.json.JSONModel({});
              sap.ui.getCore().setModel(oGlobalModelHasData, "globalData");
            }
            oGlobalModelHasData.setProperty("/IsScanningReporting", false);

            var sItemKeyHasData = oTripData.getProperty("/MovementScenarioItemKey") || "";
            if (!sItemKeyHasData) {
              var sMtHas =
                (oTripData && oTripData.getProperty("/MovementType")) || Mtype || "";
              var sMsHas =
                movementScenario !== undefined && movementScenario !== null && movementScenario !== ""
                  ? movementScenario
                  : oTripData
                    ? oTripData.getProperty("/MovementScenario")
                    : "";
              sItemKeyHasData = MovementScenarioIcons.getMovementScenarioItemKey(sMtHas, sMsHas);
            }
            var bScannerTrip =
              MovementScenarioIcons.isScannerMovementScenarioItemKey(sItemKeyHasData);
            oGlobalModelHasData.setProperty("/DisableRefDocMaterialsActions", !!bScannerTrip);

            return;
          }

          var bPoSearchMode =
            !!bIncomingFlow && sIncomingMethod === "PO_SEARCH";

          if (bPoSearchMode) {
            oScannerVBox.setVisible(false);
            if (oPoSearchVBox) {
              oPoSearchVBox.setVisible(true);
            }
            if (oReportingPanel) {
              oReportingPanel.setVisible(false);
            }
            if (oSaveButton) {
              oSaveButton.setVisible(false);
            }
            if (oGlobalForMode) {
              oGlobalForMode.setProperty("/IsScanningReporting", false);
              oGlobalForMode.setProperty("/DisableRefDocMaterialsActions", false);
            }
            if (!bPrevPoSearchVisible) {
              setTimeout(
                function () {
                  var oPoInput = this.byId("idReportingPoSearchInput");
                  if (oPoInput) {
                    oPoInput.focus();
                  }
                }.bind(this),
                300
              );
            }
            return;
          }

          if (oPoSearchVBox) {
            oPoSearchVBox.setVisible(false);
          }

          // Scanner mode: scanner-enabled ASN scenarios, same as bar-code icon mapping
          var sItemKey = "";
          if (oTripData) {
            sItemKey = oTripData.getProperty("/MovementScenarioItemKey") || "";
          }
          if (!sItemKey) {
            var sMt =
              (oTripData && oTripData.getProperty("/MovementType")) || Mtype || "";
            var sMs =
              movementScenario !== undefined && movementScenario !== null && movementScenario !== ""
                ? movementScenario
                : oTripData
                  ? oTripData.getProperty("/MovementScenario")
                  : "";
            sItemKey = MovementScenarioIcons.getMovementScenarioItemKey(sMt, sMs);
          }

          var bShowScanner =
            MovementScenarioIcons.isScannerMovementScenarioItemKey(sItemKey);

          // Update scanner visibility
          if (!!oScannerVBox.getVisible() !== !!bShowScanner) {
            oScannerVBox.setVisible(bShowScanner);
          }
          
          // Update form panel visibility - hide form when scanner is visible
          if (oReportingPanel) {
            var bWantReportingVisible = !bShowScanner;
            if (!!oReportingPanel.getVisible() !== !!bWantReportingVisible) {
              oReportingPanel.setVisible(bWantReportingVisible);
            }
          }
          
          // Update save button visibility - hide save button when scanner is visible
          if (oSaveButton) {
            oSaveButton.setVisible(!bShowScanner && !bTripLocked);
          }

          // Store scanner reporting mode in globalData model so other tabs can react
          var oGlobalModel = sap.ui.getCore().getModel("globalData");
          if (!oGlobalModel) {
            oGlobalModel = new sap.ui.model.json.JSONModel({});
            sap.ui.getCore().setModel(oGlobalModel, "globalData");
          }
          oGlobalModel.setProperty("/IsScanningReporting", !!bShowScanner);
          // Trip not yet reported: ref-doc restrictions for I02 come from IsScanningReporting; clear stale flag
          oGlobalModel.setProperty("/DisableRefDocMaterialsActions", false);
          
          // Focus scanner only when newly shown (avoids scroll steal on TripData refresh from Gate In / Ref Docs)
          if (bShowScanner && !bPrevScannerVBoxVisible) {
            setTimeout(function() {
              var oScannerInput = this.getView().byId("idReportingScannerInput");
              if (oScannerInput) {
                oScannerInput.focus();
              }
            }.bind(this), 300);
          }
        },
        onCancelReportingScanner: function () {
          var oTripData = sap.ui.getCore().getModel("TripData");
          if (oTripData) {
            oTripData.setProperty("/MovementScenarioItemKey", "");
            oTripData.setProperty("/MovementScenario", "");
            oTripData.setProperty("/MovementScenarioDesc", "");
            oTripData.setProperty("/MovementType", "");
            oTripData.setProperty("/MovementTypeDesc", "");
          }
          movementScenario = "";
          Mtype = "";

          var oScenarioCtrl = this.byId("idMovementScenario");
          if (oScenarioCtrl && oScenarioCtrl.setSelectedKey) {
            oScenarioCtrl.setSelectedKey("");
          }
          var oMovementTypeCtrl = this.byId("idMovementType");
          if (oMovementTypeCtrl && oMovementTypeCtrl.setValue) {
            oMovementTypeCtrl.setValue("");
          }

          var oGlobal = sap.ui.getCore().getModel("globalData");
          if (oGlobal) {
            oGlobal.setProperty("/IsScanningReporting", false);
            oGlobal.setProperty("/DisableRefDocMaterialsActions", false);
          }

          var oScannerInput = this.byId("idReportingScannerInput");
          if (oScannerInput) {
            oScannerInput.setValue("");
          }
          this._updateScannerVisibility();
        },

        /**
         * Select TripNumber
         */
        onSelectTripNumber: function (oEvent) {
          const oItem = oEvent.getParameter("listItem");
          if (!oItem) {
            return;
          }

          const oData = oItem.getBindingContext("VHModel").getObject();
          const sTripNumberDisplay = `${oData.ConfigID}-${oData.Description}`;

          // Set selected value - show description in UI
          this.byId("idRelatedTripNumber").setValue(sTripNumberDisplay);

          // Update TripData model with TripNumber
          const oTripDataModel = this.getView().getModel("TripData");
          if (oTripDataModel) {
            oTripDataModel.setProperty("/TripNumber", oData.ConfigID);
          }

          // Update global model
          var oGlobalModel = sap.ui.getCore().getModel("globalData");
          if (oGlobalModel) {
            oGlobalModel.setProperty("/TripNumber", oData.ConfigID);
          }

          // Close dialog
          if (this._mValueHelps && this._mValueHelps.VHTripNumber) {
            this._mValueHelps.VHTripNumber.close();
          }
        }
      }
    );
  }
);