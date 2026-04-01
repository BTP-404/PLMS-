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
    DateFormat
  ) {
    "use strict";
    var movementScenario;
    var Mtype;
    var movementType;
    return Controller.extend(
      "com.incresolZ_INC_PLMS.controller.subview.VehicleReportingTab",
      {
        /* ===========================================================
         * NO CHANGE: onInit (kept original, only comment added)
         * =========================================================== */
        onInit: function () {
          this._initService();
          this._loadVehicleSuggestions();
          this._loadVehicleTypeSuggestions();
          this._loadVehicleSizeSuggestions();
          this.getView().setModel(new JSONModel([]), "movementScenarioItems");
          this.getView().setModel(new JSONModel({ items: [] }), "poNumberSuggestions");
          this._loadMovementScenarioItems();

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
          // Unsubscribe from event bus to prevent memory leaks
          if (this._oEventBus) {
            this._oEventBus.unsubscribe("Stage", "ClearAllTabs", this._clearAllData, this);
            this._oEventBus.unsubscribe("TripData", "Updated", this._onTripDataUpdated, this);
          }
        },

        onAfterRendering: function () {
          // Use setTimeout to ensure controls exist before updating scanner visibility
          setTimeout(function() {
            this._updateScannerVisibility();
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
            
            this._loadTripDetails(sTripNumber);
            
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
        _loadTripDetailsForHeader: function (sTripNumber) {
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
                tripNumber: sTripNumber
              });

              // Also bind to this view
              that.getView().setModel(oTripDataModel, "TripData");

              movementScenario = oData.MovementScenario;
              Mtype = oData.MovementType;
            },
            error: function () {
              // Even if loading fails, try to update header with trip number
              sap.ui.getCore().getEventBus().publish("Stage", "TripCreated", {
                tripNumber: sTripNumber
              });
            },
          });
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
          const oModel = this.getView().getModel();

          if (!this._validateRequiredFields()) {
            MessageBox.warning(
              "Please fill all required fields before saving."
            );
            return;
          }

          // ADDED: Additional validation for CREATE and UPDATE modes
          const sMobile = this.byId("idDriverContact")?.getValue?.() || "";
          if (!this._isValidMobile(sMobile)) {
            this.byId("idDriverContact").setValueState("Error");
            this.byId("idDriverContact").setValueStateText(
              "Driver contact must be exactly 10 digits"
            );
            MessageBox.warning(
              "Please enter a valid driver contact number (exactly 10 digits)."
            );
            return;
          } else {
            // clear any previous error state
            this.byId("idDriverContact").setValueState("None");
          }

          if (this._mode === "CREATE") {
            this._createTrip(oModel);
          } else if (this._mode === "EDIT") {
            this._updateTrip(oModel);
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
          // TripDetails has no `VerifiedDocs` property in service metadata.
          // (VerifiedDocuments is only a GateOut function import parameter.)
          delete oData.VerifiedDocs;
          delete oData.MovementScenarioItemKey;

          oData.MovementScenario =
            movementScenario !== undefined && movementScenario !== null && movementScenario !== ""
              ? movementScenario
              : oData.MovementScenario;
          oData.MovementType =
            Mtype !== undefined && Mtype !== null && Mtype !== ""
              ? Mtype
              : oData.MovementType;
          //   oData.LR_Number = LRNumber;
          var oDate = this.byId("idLRDate").getDateValue(); // JS Date object
          if (oDate) {
            oData.LR_Date = oDate.toISOString().split(".")[0];
          } else {
            oData.LR_Date =  null;
          }

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
              
              // Load full trip details to populate TripData model and update header
              that._loadTripDetailsForHeader(sTripNumber);
              
              // Clear MovementType from globalData (TripData model will have it now)
              if (oGlobalModel) {
                oGlobalModel.setProperty("/MovementType", "");
                oGlobalModel.setProperty("/MovementTypeDesc", "");
              }
              
              this._clearForm();
              that._setFormEditable(false);
              that._setInputsEnabled(false);
            },

            error: function (oError) {
              that.getView().setBusy(false);

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
          // TripDetails has no `VerifiedDocs` property in service metadata.
          // (VerifiedDocuments is only a GateOut function import parameter.)
          delete oUpdateData.VerifiedDocs;

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

          oUpdateData.MovementScenario =
            movementScenario !== undefined && movementScenario !== null && movementScenario !== ""
              ? movementScenario
              : oUpdateData.MovementScenario;
          oUpdateData.MovementType =
            Mtype !== undefined && Mtype !== null && Mtype !== ""
              ? Mtype
              : oUpdateData.MovementType;
          
          // Handle LR_Date format (same as create)
          var oDate = this.byId("idLRDate").getDateValue(); // JS Date object
          if (oDate) {
            oUpdateData.LR_Date = oDate.toISOString().split(".")[0];
          } else {
            oUpdateData.LR_Date = null;
          }

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

              that._setFormEditable(false);
              that._setInputsEnabled(false);
            },
            error: function (oError) {
              that.getView().setBusy(false);

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
          
          const oVehicleSizeSuggestions = new JSONModel({ items: [] });
          this.getView().setModel(oVehicleSizeSuggestions, "vehicleSizeSuggestions");

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

          // Re-load suggestion sources after reset so type-ahead keeps working.
          this._loadVehicleSuggestions();
          this._loadVehicleTypeSuggestions();
          this._loadVehicleSizeSuggestions();

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
          });
          this.getView().setModel(oTripData, "TripData");

          const oMovementScenarioCb = this.byId("idMovementScenario");
          if (oMovementScenarioCb && oMovementScenarioCb.setSelectedKey) {
            oMovementScenarioCb.setSelectedKey("");
          }
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
            const oPanel = this.byId("reportingDetailsPanel");
            if (!oPanel) return;
            // the panel content -> VBox -> Grid -> layout:content -> VBoxes -> Inputs etc.
            const aChildren = oPanel.findAggregatedObjects(true); // deep search
            aChildren.forEach((ctrl) => {
              // ignore buttons and dialogs
              if (ctrl.isA && ctrl.isA("sap.m.Button")) return;
              if (ctrl.setEditable) {
                try {
                  ctrl.setEditable(bEnabled);
                } catch (e) {
                  // some controls might reject setEditable; fallback to setEnabled
                  if (ctrl.setEnabled) ctrl.setEnabled(bEnabled);
                }
              } else if (ctrl.setEnabled) {
                try {
                  ctrl.setEnabled(bEnabled);
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
          var oEditButton = this.byId("btnEditReporting");
          var oSaveButton = this.byId("btnSaveReporting");
          
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
         * - keeps your field list; marks fields with value state
         * =========================================================== */
        _validateRequiredFields: function () {
          const required = [
            "idMovementScenario",
            "idMovementType",
            "idVehicleNumber",
            "idVehicleType",
            "idTransporterName",
            "idDriverName",
            "idDriverContact",
            "idDriverLicense",
          ];

          let valid = true;
          required.forEach((id) => {
            const oCtrl = this.byId(id);
            if (!oCtrl) return;
            let val;
            if (oCtrl.getSelectedKey && typeof oCtrl.getSelectedKey === "function") {
              val = oCtrl.getSelectedKey();
            }
            if (
              (val === undefined || val === null || val === "") &&
              oCtrl.getValue &&
              typeof oCtrl.getValue === "function"
            ) {
              val = oCtrl.getValue();
            }
            if (!val && val !== 0) {
              oCtrl.setValueState("Error");
              valid = false;
            } else {
              oCtrl.setValueState("None");
            }
          });
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
          
          if (!sValue || sValue.trim() === "") {
            // Clear validation state if field is empty (required validation will handle it)
            oInput.setValueState("None");
            oInput.setValueStateText("");
            return;
          }
          
          // Validate on live change - check for exactly 10 digits
          const sTrimmed = sValue.trim();
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
          // Handle OData date format (/Date(...)/)
          else if (typeof vDate === "string" && vDate.indexOf("/Date") === 0) {
            var iTimestamp = parseInt(vDate.replace(/\D/g, ""), 10);
            if (!isNaN(iTimestamp)) {
              oDate = new Date(iTimestamp);
            } else {
              return "";
            }
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
        onValueHelpVehicleSize: function () {
          const oView = this.getView();

          if (!this._mValueHelps) {
            this._mValueHelps = {};
          }

          if (!this._mValueHelps.VHVehicleSize) {
            Fragment.load({
              id: oView.getId(),
              name: "com.incresolZ_INC_PLMS.fragments.VehicleReportingFrags.VHVehicleSize",
              controller: this,
            }).then(
              function (oDialog) {
                this._mValueHelps.VHVehicleSize = oDialog;
                oView.addDependent(oDialog);
                oDialog.open();
              }.bind(this)
            );
          } else {
            this._mValueHelps.VHVehicleSize.open();
          }
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
            },
            error: function () {
              MessageBox.error("Failed to load movement scenarios.");
            },
          });
        },

        _syncMovementScenarioItemKeyOnTripData: function (oTripDataModel) {
          if (!oTripDataModel) {
            return;
          }
          var mt = oTripDataModel.getProperty("/MovementType");
          var ms = oTripDataModel.getProperty("/MovementScenario");
          var sKey = MovementScenarioIcons.getMovementScenarioItemKey(mt, ms);
          oTripDataModel.setProperty("/MovementScenarioItemKey", sKey || "");
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

        /**

        /* ===========================================================
         * UPDATED: onSearchVH - handles search for MovementType and VehicleSize
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
            // Get list ID to determine which fields to search
            const sListId = oList.getId();
            let sListName = "";
            if (sListId.indexOf("VHMovementType") >= 0) {
              sListName = "MovementType";
            } else if (sListId.indexOf("VHVehicleSize") >= 0) {
              sListName = "VehicleSize";
            }

            if (sListName === "MovementType") {
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
            } else if (sListName === "VehicleSize") {
              aFilters = [
                new sap.ui.model.Filter({
                  filters: [
                    new sap.ui.model.Filter(
                      "VehicleSize",
                      sap.ui.model.FilterOperator.Contains,
                      sValue
                    ),
                    new sap.ui.model.Filter(
                      "VehicleSizeDesc",
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

            case this.getView().getId() + "--idVHVehicleSize":
              sField = "idVehicleSize";
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

        /**
         * Load Vehicle Size Suggestions
         */
        _loadVehicleSizeSuggestions: function () {
          const oModel = this.getView().getModel();
          const that = this;

          oModel.read("/VehicleSizeSet", {
            success: function (oData) {
              const oJSON = new sap.ui.model.json.JSONModel({
                items: oData.results || []
              });
              that.getView().setModel(oJSON, "vehicleSizeSuggestions");
            },
            error: function () {
              // Silently fail, suggestions just won't work
              that.getView().setModel(
                new sap.ui.model.json.JSONModel({ items: [] }),
                "vehicleSizeSuggestions"
              );
            },
          });
        },

        onSuggest: function (oEvent) {
          const sValue = (oEvent.getParameter("suggestValue") || "").trim();
          this._applyVehicleNumberSuggestions(sValue);
        },

        onVehicleNumberLiveChange: function (oEvent) {
          const sValue = (oEvent.getParameter("value") || "").trim();
          this._applyVehicleNumberSuggestions(sValue);
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
            oTripDataModel.setProperty("/VehicleSize", oVehicle.VehicleSize || "");
            oTripDataModel.setProperty("/TransporterName", oVehicle.TransporterName || "");
          }

          // Set Transporter Name (direct value)
          if (oVehicle.TransporterName) {
            this.byId("idTransporterName").setValue(oVehicle.TransporterName);
          }
          
          // Set Vehicle Size (direct value)
          if (oVehicle.VehicleSize) {
            this.byId("idVehicleSize").setValue(oVehicle.VehicleSize);
          }
          
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
            this.byId("idVehicleSize").setValue(oVehicle.VehicleSize);
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
        },

        /**
         * Vehicle Size Suggestion Handler
         */
        onVehicleSizeSuggest: function (oEvent) {
          const sValue = (oEvent.getParameter("suggestValue") || "").trim();
          const oInput = oEvent.getSource();
          const oBinding = oInput.getBinding("suggestionItems");

          if (!oBinding) {
            return;
          }

          if (sValue && sValue.length > 0) {
            oBinding.filter([
              new sap.ui.model.Filter({
                filters: [
                  new sap.ui.model.Filter(
                    "VehicleSize",
                    sap.ui.model.FilterOperator.Contains,
                    sValue
                  ),
                  new sap.ui.model.Filter(
                    "VehicleSizeDesc",
                    sap.ui.model.FilterOperator.Contains,
                    sValue
                  ),
                ],
                and: false,
              }),
            ]);
          } else {
            oBinding.filter([]);
          }
        },

        /**
         * Vehicle Size Suggestion Selected
         */
        onVehicleSizeSuggestionSelected: function (oEvent) {
          const oItem = oEvent.getParameter("selectedItem");
          if (!oItem) {
            return;
          }

          const sVehicleSize = oItem.getKey();
          this.byId("idVehicleSize").setValue(sVehicleSize);
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
          // Update scanner visibility when TripData changes
          // This ensures scanner shows/hides correctly when trip is loaded
          this._updateScannerVisibility();
          
          // Also update scanner visibility based on Movement Scenario from TripData
          var oTripData = sap.ui.getCore().getModel("TripData");
          if (oTripData) {
            this._syncMovementScenarioItemKeyOnTripData(oTripData);
            var oMovementScenarioCtrl = this.byId("idMovementScenario");
            if (oMovementScenarioCtrl && oMovementScenarioCtrl.setSelectedKey) {
              var sKey = oTripData.getProperty("/MovementScenarioItemKey");
              if (sKey && !oMovementScenarioCtrl.getSelectedKey()) {
                oMovementScenarioCtrl.setSelectedKey(sKey);
              }
            }
            this._updateScannerVisibility();
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
          if (!sPo) {
            MessageToast.show("Enter or select a PO number");
            return;
          }
          this._postAsnDetails(null, null, sPo);
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
              that._processScannedCode(sParsedCode);
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
              that._processScannedCode(sParsedCode);
            }, 500); // Wait 500ms after user stops typing
          }
        },

        _processScannedCode: function (sScannedCode) {
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
            this._postAsnDetails(sAsnId, sOrgId);
          } else {
            // ASN is not available - treat input as PO number
            var sPoNumber = sScannedCode.trim();
            
            // Validate PO number (basic validation - adjust as needed)
            if (sPoNumber && sPoNumber.length > 0) {
              this._postAsnDetails(null, null, sPoNumber);
            } else {
              MessageToast.show("Please enter a valid PO number");
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

        _postAsnDetails: function (sAsnId, sOrgId, sPoNumber) {
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
            // PO Number flow - include PoNumber
            oPayload = {
              PoNumber: sPoNumber
            };
          } else {
            MessageToast.show("Invalid input: Please provide either ASN details or PO number");
            this._clearAndRefocusScanner();
            return;
          }

          var oModel = this.getView().getModel();
          oModel.create("/AsnDetails", oPayload, {
            headers: {
              "X-Requested-With": "X"
            },
            success: function (oResponse) {
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
              
              // Immediately refresh UI state:
              // - reload trip details for the current Stage view
              // - trigger HomePage tripTable refresh (if HomePage is currently active)
              if (sTripNumber) {
                that._loadTripDetailsForHeader(sTripNumber);
              }
              sap.ui.getCore().getEventBus().publish("HomePage", "RefreshTripTable");

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

          // Check if there's data in Reporting Screen (TripData model)
          var oTripData = sap.ui.getCore().getModel("TripData");
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
          
          // If there's data, hide the scanner and show the form and save button
          if (bHasData) {
            oScannerVBox.setVisible(false);
            if (oPoSearchVBox) {
              oPoSearchVBox.setVisible(false);
            }
            if (oReportingPanel) {
              oReportingPanel.setVisible(true);
            }
            if (oSaveButton) {
              oSaveButton.setVisible(true);
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

          var oGlobalForMode = sap.ui.getCore().getModel("globalData");
          var bIncomingFlow =
            oGlobalForMode && oGlobalForMode.getProperty("/HasIncomingMaterials");
          var sIncomingMethod = oGlobalForMode
            ? oGlobalForMode.getProperty("/IncomingReportingMethod")
            : null;
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
            setTimeout(
              function () {
                var oPoInput = this.byId("idReportingPoSearchInput");
                if (oPoInput) {
                  oPoInput.focus();
                }
              }.bind(this),
              300
            );
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
          oScannerVBox.setVisible(bShowScanner);
          
          // Update form panel visibility - hide form when scanner is visible
          if (oReportingPanel) {
            oReportingPanel.setVisible(!bShowScanner);
          }
          
          // Update save button visibility - hide save button when scanner is visible
          if (oSaveButton) {
            oSaveButton.setVisible(!bShowScanner);
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
          
          // If scanner is visible, focus on input after a short delay
          if (bShowScanner) {
            setTimeout(function() {
              var oScannerInput = this.getView().byId("idReportingScannerInput");
              if (oScannerInput) {
                oScannerInput.focus();
              }
            }.bind(this), 300);
          }
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