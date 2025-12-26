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
  ],
  function (
    Controller,
    ODataModel,
    MessageToast,
    MessageBox,
    JSONModel,
    Fragment,
    Filter,
    FilterOperator
  ) {
    "use strict";
    var movementScenario;
    var Mtype;
    var PlantCode;
    var CompanyCod;
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
          this._loadCompanyCodeSuggestions();
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
        },

        onExit: function () {
          // Unsubscribe from event bus to prevent memory leaks
          if (this._oEventBus) {
            this._oEventBus.unsubscribe("Stage", "ClearAllTabs", this._clearAllData, this);
          }
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
          } else if (sRoute === "StagewithParam") {
            // DISPLAY mode
            this._mode = "DISPLAY";
            const sTripNumber = oArgs.tripNo;
            this.getView().byId("changeHistoryPanel").setVisible(true);
            this._loadTripDetails(sTripNumber);
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
              "$expand": "OrderDetails,ItemDetails,Feeds"
            },
            success: function (oData) {
              // Map Weighment_Req (boolean) from backend to WeighmentRequired ("Y"/"N") for frontend
              if (oData.Weighment_Req !== undefined) {
                // Convert boolean to "Y"/"N" format for frontend
                oData.WeighmentRequired = oData.Weighment_Req === true || oData.Weighment_Req === "X" ? "Y" : "N";
              }
              
              // Create JSON model for trip data
              const oTripDataModel = new sap.ui.model.json.JSONModel(oData);

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

              // Load driver photo from Attachments entity separately
              that._loadDriverPhotoFromAttachments(sTripNumber);
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
              "$expand": "OrderDetails,ItemDetails,Feeds"
            },
            success: function (oData) {
              // Map Weighment_Req (boolean) from backend to WeighmentRequired ("Y"/"N") for frontend
              if (oData.Weighment_Req !== undefined) {
                // Convert boolean to "Y"/"N" format for frontend
                oData.WeighmentRequired = oData.Weighment_Req === true || oData.Weighment_Req === "X" ? "Y" : "N";
              }
              
              // Create JSON model for trip data
              const oTripDataModel = new sap.ui.model.json.JSONModel(oData);

              //  Set as global model available across ALL views
              sap.ui.getCore().setModel(oTripDataModel, "TripData");
              sap.ui.getCore().getEventBus().publish("TripData", "Updated");

              // Also bind to this view (optional)
              that.getView().setModel(oTripDataModel, "TripData");

              // Load driver photo from Attachments entity separately
              that._loadDriverPhotoFromAttachments(sTripNumber);

              // UPDATED: call inputs helper to properly disable inputs
              that._setInputsEnabled(false); // UPDATED (was _setFormEditable(false))
              that._setButtonStates(true, true); // Re-enable after load
              MessageToast.show("Trip data loaded for: " + sTripNumber);
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
          // UPDATED: enable inputs for edit
          this._setInputsEnabled(true); // ADDED
          this._setFormEditable(true); // keep compatibility

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
          } else if (this._mode === "DISPLAY") {
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

          oData.MovementScenario = movementScenario;
          oData.MovementType = Mtype;
          //   oData.LR_Number = LRNumber;
          var oDate = this.byId("idLRDate").getDateValue(); // JS Date object
          if (oDate) {
            oData.LR_Date = oDate.toISOString().split(".")[0];
          } else {
            oData.LR_Date =  null;
          }
          // Extract only the code part from Plant (remove description if present)
          // Priority: PlantCode variable > input field value > model data
          var sPlantInput = this.byId("idPlant")?.getValue() || "";
          var sPlant = PlantCode || sPlantInput || oData.Plant || "";
          // If Plant contains a dash, extract only the part before the dash
          if (sPlant && sPlant.indexOf("-") > 0) {
            sPlant = sPlant.split("-")[0].trim();
          }
          oData.Plant = sPlant;
          
          // Extract only the code part from CompanyCode (remove description if present)
          // Priority: CompanyCod variable > input field value > model data
          var sCompanyCodeInput = this.byId("idCompanyCode")?.getValue() || "";
          var sCompanyCode = CompanyCod || sCompanyCodeInput || oData.CompanyCode || "";
          // If CompanyCode contains a dash, extract only the part before the dash
          if (sCompanyCode && sCompanyCode.indexOf("-") > 0) {
            sCompanyCode = sCompanyCode.split("-")[0].trim();
          }
          oData.CompanyCode = sCompanyCode;
          
          // Log for debugging
          
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

          // Remove navigation properties / deferred / collections
          delete oUpdateData.ActivityHistory;
          delete oUpdateData.Attachments;
          delete oUpdateData.OrderDetails;
          delete oUpdateData.ItemDetails;
          delete oUpdateData.Feeds;

          // Remove metadata
          delete oUpdateData.__metadata;

          // Extract only the code part from Plant (remove description if present)
          // Priority: PlantCode variable > input field value > model data
          var sPlantInput = this.byId("idPlant")?.getValue() || "";
          var sPlant = PlantCode || sPlantInput || oUpdateData.Plant || "";
          // If Plant contains a dash, extract only the part before the dash
          if (sPlant && sPlant.indexOf("-") > 0) {
            sPlant = sPlant.split("-")[0].trim();
          }
          oUpdateData.Plant = sPlant;
          
          // Extract only the code part from CompanyCode (remove description if present)
          // Priority: CompanyCod variable > input field value > model data
          var sCompanyCodeInput = this.byId("idCompanyCode")?.getValue() || "";
          var sCompanyCode = CompanyCod || sCompanyCodeInput || oUpdateData.CompanyCode || "";
          // If CompanyCode contains a dash, extract only the part before the dash
          if (sCompanyCode && sCompanyCode.indexOf("-") > 0) {
            sCompanyCode = sCompanyCode.split("-")[0].trim();
          }
          oUpdateData.CompanyCode = sCompanyCode;

          // Optional: log what we are sending to backend for debugging

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
          
          const oVehicleTypeSuggestions = new JSONModel({ items: [] });
          this.getView().setModel(oVehicleTypeSuggestions, "vehicleTypeSuggestions");
          
          const oVehicleSizeSuggestions = new JSONModel({ items: [] });
          this.getView().setModel(oVehicleSizeSuggestions, "vehicleSizeSuggestions");
          
          const oCompanyCodeSuggestions = new JSONModel({ items: [] });
          this.getView().setModel(oCompanyCodeSuggestions, "companyCodeSuggestions");
          
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
          PlantCode = undefined;
          CompanyCod = undefined;
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
        },

        /* ===========================================================
         * NO CHANGE: _clearForm
         * - reserves the bindings shape that your view expects
         * =========================================================== */
        _clearForm: function () {
          const oTripData = new JSONModel({
            MovementScenario: "",
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
            CompanyCode: "",
            Plant: "",
            TripNumber: "",
            AdditionalInfo: "",
          });
          this.getView().setModel(oTripData, "TripData");
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

            // Ensure Save/Edit buttons remain enabled
            if (this.byId("btnEditReporting"))
              this.byId("btnEditReporting").setEnabled(true);
            if (this.byId("btnSaveReporting"))
              this.byId("btnSaveReporting").setEnabled(true);
          } catch (e) {
            // don't break if something unexpected happens
            jQuery.sap.log.error("Error in _setInputsEnabled: " + e);
          }
        },

        /* ===========================================================
         * NO CHANGE: _setButtonStates (kept behavior)
         * =========================================================== */
        _setButtonStates: function (bEditEnabled, bSaveEnabled) {
          this.byId("btnEditReporting").setEnabled(true);
          this.byId("btnSaveReporting").setEnabled(true);
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
            "idCompanyCode",
            "idPlant",
          ];

          let valid = true;
          required.forEach((id) => {
            const oCtrl = this.byId(id);
            if (!oCtrl) return;
            const val = oCtrl.getValue
              ? oCtrl.getValue()
              : oCtrl.getSelectedKey
              ? oCtrl.getSelectedKey()
              : undefined;
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

        formatTripNumber: function (sTripNumber) {
          if (!sTripNumber) {
            return "";
          }
          // Convert to string and remove leading zeros
          var sStr = String(sTripNumber);
          // Remove leading zeros but keep at least one digit (e.g., "0000000014" -> "14", "0" -> "0")
          return sStr.replace(/^0+/, "") || "0";
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
          debugger;
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

        /* ===========================================================
         * NO CHANGE: Value Help entry points
         * =========================================================== */
        onValueHelpMovementScenario: function () {
          this._openMovementScenarioVH();
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

        /* ===========================================================
         * NO CHANGE: onValueHelpPlant (keeps your fragment logic)
         * =========================================================== */
        onValueHelpPlant: function () {
          var oView = this.getView();

          if (!this._mValueHelps) this._mValueHelps = {};

          if (!this._mValueHelps.VHPlant) {
            Fragment.load({
              id: oView.getId(),
              name: "com.incresolZ_INC_PLMS.fragments.VehicleReportingFrags.VHPlant",
              controller: this,
            }).then(
              function (oDialog) {
                this._mValueHelps.VHPlant = oDialog;
                oView.addDependent(oDialog);

                this._loadPlants().then(() => {
                  oDialog.open();
                });
              }.bind(this)
            );
          } else {
            this._loadPlants();
            this._mValueHelps.VHPlant.open();
          }
        },

        /**
         * Load Plants from ConfigValues
         * NO CHANGE
         */
        _loadPlants: function () {
          const oModel = this.getView().getModel();
          const that = this;

          return new Promise(function (resolve) {
            oModel.read("/ConfigValues", {
              filters: [
                new sap.ui.model.Filter(
                  "ConfigGroup",
                  sap.ui.model.FilterOperator.EQ,
                  "Plant"
                ),
              ],
              success: function (oData) {
                PlantCode = oData.results[0].ConfigID;
                CompanyCod = oData.results[0].ParentConfig;
                const oJSON = new sap.ui.model.json.JSONModel(oData.results);
                that._mValueHelps.VHPlant.setModel(oJSON, "VHModel");
                resolve();
              },
              error: function () {
                sap.m.MessageBox.error("Failed to load Plant.");
                resolve();
              },
            });
          });
        },

        /**
         * Load Vehicle Type from ConfigValues
         */
        _loadVehicleTypeData: function () {
          const oModel = this.getView().getModel();
          const that = this;

          return new Promise(function (resolve) {
            oModel.read("/ConfigValues", {
              filters: [
                new sap.ui.model.Filter(
                  "ConfigGroup",
                  sap.ui.model.FilterOperator.EQ,
                  "VehicleType"
                ),
              ],
              success: function (oData) {
                const oJSON = new sap.ui.model.json.JSONModel(oData.results);
                if (that._mValueHelps && that._mValueHelps.VHVehicleType) {
                  that._mValueHelps.VHVehicleType.setModel(oJSON, "VHModel");
                }
                resolve();
              },
              error: function () {
                sap.m.MessageBox.error("Failed to load Vehicle Type.");
                resolve();
              },
            });
          });
        },

        /**
         * Search Vehicle Type
         */
        onSearchVehicleType: function (oEvent) {
          var sValue = (oEvent.getParameter("value") || oEvent.getParameter("newValue") || "").trim();
          
          // Use the same approach as Plant search - direct byId access
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
            // Use the same filter syntax as Plant search (which works)
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
         * NO CHANGE: onSearchPlant
         */
        onSearchPlant: function (oEvent) {
          var sValue = oEvent.getParameter("value");
          var oList = this.byId("idVHPlantList");

          var oBinding = oList.getBinding("items");
          var aFilters = [];

          if (sValue) {
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
         * NO CHANGE: onSelectPlant
         * - sets idPlant and idCompanyCode as before
         */
        onSelectPlant: function (oEvent) {
          var oItem = oEvent.getParameter("listItem");
          var oData = oItem.getBindingContext("VHModel").getObject();
          var plant = `${oData.ConfigID}-${oData.Description}`;
          
          // Store code values in global variables (code only, no description)
          PlantCode = oData.ConfigID;
          CompanyCod = oData.ParentConfig || "";
          
          // Build CompanyCode display value with description (for UI)
          // Check if Val01 contains the CompanyCode description
          var sCompanyCodeDisplay = oData.ParentConfig || "";
          if (oData.Val01) {
            sCompanyCodeDisplay = `${oData.ParentConfig}-${oData.Val01}`;
          }
          
          // Set selected values - show descriptions in UI
          this.byId("idPlant").setValue(plant);
          this.byId("idCompanyCode").setValue(sCompanyCodeDisplay);

          // Close dialog
          this._mValueHelps.VHPlant.close();
        },

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

            case this.getView().getId() + "--idVHPlant":
              sField = "idPlant";

              // Get selected item row
              const oCompanyRow =
                oSelected.data("row") ||
                (oSelected.getBindingContext("VHModel") &&
                  oSelected.getBindingContext("VHModel").getObject());
              const sPlant =
                (oCompanyRow && oCompanyRow.ConfigID) || oSelected.getTitle();

              // Set company code
              this.byId("idCompanyCode").setValue(sPlant);

              // Auto-fetch plants
              this._fetchPlantsForCompany(sPlant);
              break;

            case this.getView().getId() + "--idVHPlant":
              sField = "idPlant";
              break;
          }

          if (sField && sId !== this.getView().getId() + "--idVHVehicleType") {
            // safety: ensure control exists
            // Skip VehicleType as it's handled in the switch case above
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
                movementScenario = row.MovementScenario;
                movementType = row.movementType;
                Mtype = row.movementType;
                
                // Determine icon based on movement type
                var sIcon = "";
                if (row.MovementType === "O") {
                  sIcon = "sap-icon://outbox"; // Outward icon
                } else if (row.MovementType === "I") {
                  sIcon = "sap-icon://inbox"; // Inward icon
                }
                
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
          const row = oItem.data("row");
          Mtype = row.MovementType;
          movementScenario = row.MovementScenario;
          
          // Set Movement Scenario value to Long Text
          this.byId("idMovementScenario").setValue(row.LongText);
          
          // Set Movement Type value based on MovementType
          if (row.MovementType === "O") {
            this.byId("idMovementType").setValue("Outward");
          } else if (row.MovementType === "I") {
            this.byId("idMovementType").setValue("Inward");
          }

          this.byId("idVHMovementScenario").close();
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
            // Update global variables
            movementScenario = oSelectedRow.MovementScenario;
            Mtype = oSelectedRow.MovementType;
            
            // Set Movement Scenario value to Long Text (same as value help behavior)
            this.byId("idMovementScenario").setValue(oSelectedRow.LongText);
            
            // Set Movement Type value based on MovementType
            if (oSelectedRow.MovementType === "O") {
              this.byId("idMovementType").setValue("Outward");
            } else if (oSelectedRow.MovementType === "I") {
              this.byId("idMovementType").setValue("Inward");
            }
          }
        },

        _fetchPlantsForCompany: function (sPlant) {
          const oModel = this.getView().getModel();
          const that = this;

          oModel.read("/ConfigValues", {
            filters: [
              new sap.ui.model.Filter(
                "ConfigGroup",
                sap.ui.model.FilterOperator.EQ,
                "Plant"
              ),
              new sap.ui.model.Filter(
                "ParentConfig",
                sap.ui.model.FilterOperator.EQ,
                sPlant
              ),
            ],

            success: function (oData) {
              if (oData.results.length === 1) {
                const oPlant = oData.results[0];
                // Store code in global variable (code only)
                CompanyCod = oPlant.ConfigID || "";
                // Build CompanyCode display value with description (for UI)
                var sCompanyCodeDisplay = oPlant.ConfigID || "";
                if (oPlant.Description) {
                  sCompanyCodeDisplay = `${oPlant.ConfigID}-${oPlant.Description}`;
                }
                that.byId("idCompanyCode").setValue(sCompanyCodeDisplay);
              } else if (oData.results.length > 1) {
                const oJSON = new sap.ui.model.json.JSONModel(oData.results);
                const oDialog = that._mValueHelps?.VHPlant;

                if (oDialog) {
                  oDialog.setModel(oJSON, "VHModel");
                  oDialog.open();
                }
              } else {
                MessageToast.show("No Company Code found for Plant " + sPlant);
                CompanyCod = "";
                that.byId("idCompanyCode").setValue("");
              }
            },

            error: function () {
              MessageBox.error("Error Company Code found for Plant " + sPlant);
              that.byId("idCompanyCode").setValue("");
            },
          });
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
          const oModel = this.getView().getModel();

          oModel.read("/VehicleDetails", {
            success: (oData) => {
              const oJSON = new sap.ui.model.json.JSONModel(oData.results);
              this.getView().setModel(oJSON, "VHModel");
            },
          });
        },

        /**
         * Load Vehicle Type Suggestions
         */
        _loadVehicleTypeSuggestions: function () {
          const oModel = this.getView().getModel();
          const that = this;

          oModel.read("/ConfigValues", {
            filters: [
              new sap.ui.model.Filter(
                "ConfigGroup",
                sap.ui.model.FilterOperator.EQ,
                "VehicleType"
              ),
            ],
            success: function (oData) {
              const oJSON = new sap.ui.model.json.JSONModel({
                items: oData.results || []
              });
              that.getView().setModel(oJSON, "vehicleTypeSuggestions");
            },
            error: function () {
              // Silently fail, suggestions just won't work
              that.getView().setModel(
                new sap.ui.model.json.JSONModel({ items: [] }),
                "vehicleTypeSuggestions"
              );
            },
          });
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

        /**
         * Load Company Code Suggestions
         */
        _loadCompanyCodeSuggestions: function () {
          const oModel = this.getView().getModel();
          const that = this;

          oModel.read("/ConfigValues", {
            filters: [
              new sap.ui.model.Filter(
                "ConfigGroup",
                sap.ui.model.FilterOperator.EQ,
                "CompanyCode"
              ),
            ],
            success: function (oData) {
              const oJSON = new sap.ui.model.json.JSONModel({
                items: oData.results || []
              });
              that.getView().setModel(oJSON, "companyCodeSuggestions");
            },
            error: function () {
              // Silently fail, suggestions just won't work
              that.getView().setModel(
                new sap.ui.model.json.JSONModel({ items: [] }),
                "companyCodeSuggestions"
              );
            },
          });
        },

        onSuggest: function (oEvent) {
          const sValue = oEvent.getParameter("suggestValue");
          const oInput = oEvent.getSource();
          const oBinding = oInput.getBinding("suggestionItems");

          // Check if binding exists
          if (!oBinding) {
            // If binding doesn't exist, ensure VHModel is loaded
            const oVHModel = this.getView().getModel("VHModel");
            const aData = oVHModel ? oVHModel.getData() : null;
            if (!oVHModel || !aData || (Array.isArray(aData) && aData.length === 0)) {
              this._loadVehicleSuggestions();
            }
            return;
          }

          // Apply filter to the binding
          if (sValue && sValue.trim().length > 0) {
            oBinding.filter([
              new sap.ui.model.Filter({
                filters: [
                  new sap.ui.model.Filter(
                    "VehicleNumber",
                    sap.ui.model.FilterOperator.Contains,
                    sValue
                  ),
                  new sap.ui.model.Filter(
                    "TransporterName",
                    sap.ui.model.FilterOperator.Contains,
                    sValue
                  ),
                ],
                and: false,
              }),
            ]);
          } else {
            // Clear filter if search value is empty
            oBinding.filter([]);
          }
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
          const aVehicles = this.getView().getModel("VHModel").getData();
          const oVehicle = aVehicles.find((v) => v.VehicleNumber === sVehNo);

          if (oVehicle) {
            this._setVehicleAutoFields(oVehicle);
          }
        },

        // =====================================================
        // SET THE 3 AUTO FIELDS
        // =====================================================
        _setVehicleAutoFields: function (oVehicle) {
          this.byId("idVehicleType").setValue(oVehicle.VehicleType);
          this.byId("idVehicleSize").setValue(oVehicle.VehicleSize);
          this.byId("idTransporterName").setValue(oVehicle.TransporterName);
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

        /**
         * SUGGEST: Live suggestions while typing Plant
         */
        onPlantSuggest: function (oEvent) {
          const sValue = oEvent.getParameter("suggestValue") || "";
          const oInput = this.byId("idPlant");
          const oModel = this.getView().getModel();

          if (!sValue) {
            oInput.destroySuggestionItems();
            return;
          }

          // Read matching plants from ConfigValues
          oModel.read("/ConfigValues", {
            filters: [
              new Filter("ConfigGroup", FilterOperator.EQ, "Plant"),
              new Filter("ConfigID", FilterOperator.Contains, sValue),
            ],
            success: function (oData) {
              oInput.destroySuggestionItems();
              oData.results.forEach((plant) => {
                oInput.addSuggestionItem(
                  new sap.ui.core.Item({
                    key: plant.ConfigID,
                    text: plant.ConfigID + " - " + plant.Description,
                    customData: [
                      new sap.ui.core.CustomData({
                        key: "CompanyCode",
                        value: plant.ParentConfig,
                      }),
                    ],
                  })
                );
              });
            },
            error: function () {
              MessageBox.error("Failed to fetch plants for suggestion");
            },
          });
        },

        /**
         * When user selects a Plant from suggestions
         * - Set plant value
         * - Fetch and set company code automatically
         */
        onPlantSuggestionSelected: function (oEvent) {
          const oItem = oEvent.getParameter("selectedItem");
          if (!oItem) return;

          // Extract plant code from key (key contains just the code)
          const sPlantKey = oItem.getKey() || "";
          const sPlantText = oItem.getText() || ""; // Contains "Code - Description"
          
          // Store code values in global variables (code only, no description)
          PlantCode = sPlantKey;
          
          // Fetch Company Code from customData (should already be code only)
          const sCompanyCode =
            oItem.data("CompanyCode") ||
            oItem.getCustomData()[0]?.getValue() ||
            "";
          CompanyCod = sCompanyCode;
          
          // Fetch CompanyCode description to display in UI
          const that = this;
          if (sCompanyCode) {
            const oModel = this.getView().getModel();
            oModel.read("/ConfigValues", {
              filters: [
                new sap.ui.model.Filter("ConfigGroup", sap.ui.model.FilterOperator.EQ, "CompanyCode"),
                new sap.ui.model.Filter("ConfigID", sap.ui.model.FilterOperator.EQ, sCompanyCode)
              ],
              success: function (oData) {
                if (oData.results && oData.results.length > 0) {
                  const oCompanyCode = oData.results[0];
                  // Build CompanyCode display value with description (for UI)
                  var sCompanyCodeDisplay = oCompanyCode.ConfigID || sCompanyCode;
                  if (oCompanyCode.Description) {
                    sCompanyCodeDisplay = `${oCompanyCode.ConfigID}-${oCompanyCode.Description}`;
                  }
                  that.byId("idCompanyCode").setValue(sCompanyCodeDisplay);
                } else {
                  // Fallback: just show code if description not found
                  that.byId("idCompanyCode").setValue(sCompanyCode);
                }
              },
              error: function () {
                // Fallback: just show code if error fetching description
                that.byId("idCompanyCode").setValue(sCompanyCode);
              }
            });
          } else {
            this.byId("idCompanyCode").setValue("");
          }
          
          // Set Plant input (can show description for user)
          this.byId("idPlant").setValue(sPlantText);
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

        /* ===========================================================
         * Vehicle Type Live Change Handler
         * Handles manual editing of Vehicle Type field
         * =========================================================== */
        onVehicleTypeLiveChange: function (oEvent) {
          const sValue = oEvent.getParameter("value");
          const oTripDataModel = this.getView().getModel("TripData");
          
          if (oTripDataModel) {
            // If user is manually typing, set ConfigID to 99 and update description
            oTripDataModel.setProperty("/VehicleType", "99");
            oTripDataModel.setProperty("/VehicleTypeDesc", sValue);
          }
        },

        /**
         * Vehicle Type Suggestion Handler
         */
        onVehicleTypeSuggest: function (oEvent) {
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
              }),
            ]);
          } else {
            oBinding.filter([]);
          }
        },

        /**
         * Vehicle Type Suggestion Selected
         */
        onVehicleTypeSuggestionSelected: function (oEvent) {
          const oItem = oEvent.getParameter("selectedItem");
          if (!oItem) {
            return;
          }

          const sConfigID = oItem.getKey();
          const oSuggestionsModel = this.getView().getModel("vehicleTypeSuggestions");
          if (!oSuggestionsModel) {
            return;
          }

          const aItems = oSuggestionsModel.getData().items || [];
          const oSelectedItem = aItems.find(function (item) {
            return item.ConfigID === sConfigID;
          });

          if (oSelectedItem) {
            // Check if ConfigID is 99 for manual input
            if (oSelectedItem.ConfigID === "99") {
              // Open manual input dialog
              this._openManualVehicleTypeInput();
              return;
            }

            // Store ConfigID in TripData model (for backend)
            const oTripDataModel = this.getView().getModel("TripData");
            if (oTripDataModel) {
              oTripDataModel.setProperty("/VehicleType", oSelectedItem.ConfigID);
              oTripDataModel.setProperty("/VehicleTypeDesc", oSelectedItem.Description || "");
            }

            // Set the description in the input field
            this.byId("idVehicleType").setValue(oSelectedItem.Description || "");
          }
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
         * Company Code Suggestion Handler
         */
        onCompanyCodeSuggest: function (oEvent) {
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
              }),
            ]);
          } else {
            oBinding.filter([]);
          }
        },

        /**
         * Company Code Suggestion Selected
         */
        onCompanyCodeSuggestionSelected: function (oEvent) {
          const oItem = oEvent.getParameter("selectedItem");
          if (!oItem) {
            return;
          }

          const sConfigID = oItem.getKey();
          const oSuggestionsModel = this.getView().getModel("companyCodeSuggestions");
          if (!oSuggestionsModel) {
            return;
          }

          const aItems = oSuggestionsModel.getData().items || [];
          const oSelectedItem = aItems.find(function (item) {
            return item.ConfigID === sConfigID;
          });

          if (oSelectedItem) {
            // Store code value in global variable (code only, no description)
            CompanyCod = oSelectedItem.ConfigID;

            // Build CompanyCode display value with description (for UI)
            const sCompanyCodeDisplay = `${oSelectedItem.ConfigID}-${oSelectedItem.Description}`;

            // Set selected value - show description in UI
            this.byId("idCompanyCode").setValue(sCompanyCodeDisplay);
          }
        },

        /* ===========================================================
         * Company Code Value Help
         * =========================================================== */
        onValueHelpCompanyCode: function () {
          const oView = this.getView();

          if (!this._mValueHelps) {
            this._mValueHelps = {};
          }

          if (!this._mValueHelps.VHCompanyCode) {
            Fragment.load({
              id: oView.getId(),
              name: "com.incresolZ_INC_PLMS.fragments.VehicleReportingFrags.VHCompanyCode",
              controller: this,
            }).then(
              function (oDialog) {
                this._mValueHelps.VHCompanyCode = oDialog;
                oView.addDependent(oDialog);

                this._loadCompanyCodeData().then(() => {
                  oDialog.open();
                });
              }.bind(this)
            );
          } else {
            this._loadCompanyCodeData();
            this._mValueHelps.VHCompanyCode.open();
          }
        },

        /**
         * Load Company Codes from ConfigValues
         */
        _loadCompanyCodeData: function () {
          const oModel = this.getView().getModel();
          const that = this;

          return new Promise(function (resolve) {
            oModel.read("/ConfigValues", {
              filters: [
                new sap.ui.model.Filter(
                  "ConfigGroup",
                  sap.ui.model.FilterOperator.EQ,
                  "CompanyCode"
                ),
              ],
              success: function (oData) {
                const oJSON = new sap.ui.model.json.JSONModel(oData.results);
                if (that._mValueHelps && that._mValueHelps.VHCompanyCode) {
                  that._mValueHelps.VHCompanyCode.setModel(oJSON, "VHModel");
                }
                resolve();
              },
              error: function () {
                sap.m.MessageBox.error("Failed to load Company Code.");
                resolve();
              },
            });
          });
        },

        /**
         * Search Company Code
         */
        onSearchCompanyCode: function (oEvent) {
          const sValue = (oEvent.getParameter("value") || "").trim();
          const oList = this.byId("idVHCompanyCodeList");

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

        /**
         * Select Company Code
         */
        onSelectCompanyCode: function (oEvent) {
          const oItem = oEvent.getParameter("listItem");
          if (!oItem) {
            return;
          }

          const oData = oItem.getBindingContext("VHModel").getObject();
          const sCompanyCodeDisplay = `${oData.ConfigID}-${oData.Description}`;

          // Store code value in global variable (code only, no description)
          CompanyCod = oData.ConfigID;

          // Set selected value - show description in UI
          this.byId("idCompanyCode").setValue(sCompanyCodeDisplay);

          // Close dialog
          if (this._mValueHelps && this._mValueHelps.VHCompanyCode) {
            this._mValueHelps.VHCompanyCode.close();
          }
        }
      }
    );
  }
);