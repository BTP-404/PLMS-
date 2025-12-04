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
          const oRouter = this.getOwnerComponent().getRouter();
          oRouter
            .getRoute("Stage")
            .attachPatternMatched(this._onRouteMatched, this);
          oRouter
            .getRoute("StagewithParam")
            .attachPatternMatched(this._onRouteMatched, this);
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
            // CREATE mode
            this._mode = "CREATE";
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
         * NO CHANGE with slight behavioral improvement: _loadTripDetails
         * - loads TripDetails and disables inputs for view mode
         * =========================================================== */
        _loadTripDetails: function (sTripNumber) {
          const oModel = this.getView().getModel();
          const that = this;
          // console.log(oModel.getdata());
          this._setButtonStates(true, true); // Ensure visible/enabled before load

          oModel.read("/TripDetails('" + sTripNumber + "')", {
            urlParameters: {
              "$expand": "OrderDetails,ItemDetails,Feeds"
            },
            success: function (oData) {
              // Create JSON model for trip data
              const oTripDataModel = new sap.ui.model.json.JSONModel(oData);

              //  Set as global model available across ALL views
              sap.ui.getCore().setModel(oTripDataModel, "TripData");
              sap.ui.getCore().getEventBus().publish("TripData", "Updated");

              // Also bind to this view (optional)
              that.getView().setModel(oTripDataModel, "TripData");

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
         * - added mobile validation for CREATE mode (exactly 10 digits)
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

          // ADDED: Additional validation only for CREATE
          if (this._mode === "CREATE") {
            const sMobile = this.byId("idDriverContact")?.getValue?.() || "";
            if (!this._isValidMobile(sMobile)) {
              this.byId("idDriverContact").setValueState("Error");
              this.byId("idDriverContact").setValueStateText(
                "Enter valid 10-digit mobile number"
              );
              MessageBox.warning(
                "Please enter a valid 10-digit mobile number."
              );
              return;
            } else {
              // clear any previous error state
              this.byId("idDriverContact").setValueState("None");
            }
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

          oData.MovementScenario = movementScenario;
          oData.MovementType = Mtype;
          //   oData.LR_Number = LRNumber;
          var oDate = this.byId("idLRDate").getDateValue(); // JS Date object
          if (oDate) {
            oData.LR_Date = oDate.toISOString().split(".")[0];
          } else {
            oData.LR_Date = oDate ? oDate : new Date();
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
          console.log("=== Trip Creation Payload ===");
          console.log("Plant (code only):", oData.Plant);
          console.log("CompanyCode (code only):", oData.CompanyCode);
          
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
              oGlobalModel.setProperty("/TripNumber", oResponse.TripNumber);

              that.getView().setBusy(false);
              var sFormattedTripNo = that.formatTripNumber(oResponse.TripNumber);
              that.getView().byId("idRelatedTripNumber").setValue(sFormattedTripNo);
              MessageToast.show(`Trip ( ${sFormattedTripNo} ) Created !`);
              
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
          console.log("=== TripDetails UPDATE payload ===");
          console.log("Plant (code only):", oUpdateData.Plant);
          console.log("CompanyCode (code only):", oUpdateData.CompanyCode);
          console.log(JSON.stringify(oUpdateData, null, 2));

          // Only update TripDetails('<TripNumber>') – no deep update
          this.getView().setBusy(true);

          oModel.update("/TripDetails('" + sTripNumber + "')", oUpdateData, {
            headers: {
              "X-Requested-With": "X",
            },
            success: function () {
              that.getView().setBusy(false);
              MessageToast.show("Trip updated successfully!");

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
              console.error("TripDetails UPDATE error:", oError);
              MessageBox.error(sMessage);
            },
          });
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
            "idVehicleSize",
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
         * ADDED: _isValidMobile
         * - ensures only digits and exactly 10 characters
         * =========================================================== */
        _isValidMobile: function (sMobile) {
          if (!sMobile) return false;
          const s = (sMobile + "").trim();
          const regex = /^[0-9]{10}$/;
          return regex.test(s);
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
         * NO CHANGE: Value Help entry points
         * =========================================================== */
        onValueHelpMovementScenario: function () {
          this._openMovementScenarioVH();
        },

        onValueHelpMovementType: function () {
          this._openVH("VHMovementType");
        },
        onValueHelpVehicleType: function () {
          this._openVH("VHVehicleType");
        },
        onValueHelpVehicleSize: function () {
          this._openVH("VHVehicleSize");
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
         * NO CHANGE: onSearchVH
         * =========================================================== */
        onSearchVH: function (oEvent) {
          const sValue =
            oEvent.getParameter("newValue") || oEvent.getParameter("query");
          const oList = oEvent.getSource().getParent().getItems()[1];

          let oBinding = oList.getBinding("items");

          let aFilters = [];
          if (sValue) {
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

          if (sField) {
            // safety: ensure control exists
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
                oDialog.open();
              }.bind(this)
            );
          } else {
            this._loadMovementScenarioData();
            this._oMovementScenarioFrag.open();
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
                    title: row.ShortText,
                    icon: sIcon,
                    // description: row.ShortText,
                    // info: row.LongText,
                    type: "Active",
                  }).data("row", row)
                );
              });
            },
            error: function (error) {
              console.error("MovementScenario VH Load Error:", error);
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
          this.byId("idMovementScenario").setValue(row.ShortText);
          if (row.MovementType === "O") {
            this.byId("idMovementType").setValue("Outward");
          } else if (row.MovementType === "I") {
            this.byId("idMovementType").setValue("Inward");
          }

          this.byId("idVHMovementScenario").close();
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

        onSuggest: function (oEvent) {
          const sValue = oEvent.getParameter("suggestValue");
          const oBinding = oEvent.getSource().getBinding("suggestionItems");

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
          const aVehicles = this.getView().getModel("VHModel").getData();

          // Find selected vehicle object
          const oVehicle = aVehicles.find(
            (v) => v.VehicleNumber === sVehicleNumber
          );

          if (oVehicle) {
            this.byId("idVehicleType").setValue(oVehicle.VehicleType);
            this.byId("idVehicleSize").setValue(oVehicle.VehicleSize);
            this.byId("idTransporterName").setValue(oVehicle.TransporterName);
          } else {
            console.error("Vehicle not found in VHModel");
          }
        }
        /**
         * SUGGEST: Live suggestions while typing Plant
         */,
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
        }
      }
    );
  }
);
