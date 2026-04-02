sap.ui.define(
  [
    "sap/ui/core/mvc/Controller",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/odata/v2/ODataModel",
    "sap/ui/core/Fragment",
    "com/incresolZ_INC_PLMS/util/MovementScenarioIcons",
    "com/incresolZ_INC_PLMS/util/MovementScenarioConfig",
    "com/incresolZ_INC_PLMS/util/PanelAccordion",
  ],
  function (
    Controller,
    MessageToast,
    MessageBox,
    JSONModel,
    ODataModel,
    Fragment,
    MovementScenarioIcons,
    MovementScenarioConfig,
    PanelAccordion
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
          
          // Initialize selected files array
          this._aSelectedFiles = [];

          // Bin details local UI state (edit/save/cancel)
          if (!this.getView().getModel("binState")) {
            this.getView().setModel(
              new JSONModel({ binDetailsEditMode: false }),
              "binState"
            );
          }
          
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
        onAfterRendering: function () {
          try {
            // Get trip number from globalData model (safer approach)
            var oGlobalModel = sap.ui.getCore().getModel("globalData");
            this.tripNumber = oGlobalModel ? oGlobalModel.getProperty("/TripNumber") || "" : "";
            
            this.loadExitGateNumber();

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
            this._normalizeTripDataItemDetails();
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
          } else if (oExit && oExit.getValue) {
            sExitGateNumber = oExit.getValue() || "";
          }
          if (!sExitGateNumber) {
            sExitGateNumber = String(oTripData.getProperty("/ExitGateNum") || "").trim();
          }
          var sRemarks = oView.byId("idGateOutRemarks").getValue() || "";
          var sBinsReturned =
            (oView.byId("idBinsReturned") &&
              oView.byId("idBinsReturned").getValue()) ||
            "";

          var oRBGroup = oView.byId("idVerifiedDocs");
          var bVerifiedDocs = oRBGroup ? oRBGroup.getSelectedIndex() === 0 : false;

          var oGlobal = sap.ui.getCore().getModel("globalData");
          var sTripNumber =
            (oGlobal && oGlobal.getProperty("/TripNumber")) ||
            oTripData.getProperty("/TripNumber") ||
            "";

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

          var oShort = oView.byId("idShortQty");
          var sShortQtyVal = "";
          if (oShort) {
            var vSqCtrl = oShort.getValue();
            sShortQtyVal =
              vSqCtrl !== undefined && vSqCtrl !== null && vSqCtrl !== ""
                ? String(vSqCtrl).trim()
                : "";
          }
          if (sShortQtyVal === "") {
            var vSq = oTripData.getProperty("/ShortQty");
            if (vSq !== undefined && vSq !== null && vSq !== "") {
              sShortQtyVal = String(vSq).trim();
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
              ShortQty: sShortQtyVal,
              BillingDocument: sBillingDocument,
              ExitGateNumber: sExitGateNumber,
              TripNumber: sTripNumber,
              Remarks: sRemarks,
              VerifiedDocuments: bVerifiedDocs,
              BinsReturned: sBinsReturned,
            },
            headers: {
              "X-Requested-With": "X",
            },
            success: function () {
              var sMessage = bIsFirstTime
                ? "Gate Out information created successfully!"
                : "Gate Out information updated successfully!";

              var oTd = sap.ui.getCore().getModel("TripData");
              if (oTd) {
                oTd.setProperty("/ExitGateNum", sExitGateNumber);
                oTd.setProperty("/RefDocSkip", sRefdocSkip);
                oTd.setProperty("/VerifiedDocs", bVerifiedDocs ? 0 : 1);
                oTd.setProperty("/BinsReturned", sBinsReturned);
                oTd.setProperty("/BillingDocument", sBillingDocument);
                if (oShort) {
                  var vFinal = oShort.getValue();
                  if (vFinal !== undefined && vFinal !== null && vFinal !== "") {
                    oTd.setProperty("/ShortQty", vFinal);
                  }
                }
                this._eventBus.publish("TripData", "Updated");
              }

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

        /**
         * Used by bindings in GateOut.view.xml to show/hide "Bin Details".
         * TripData>/MovementScenarioItemKey must match outbound direct-sale key (O + scenario from ConfigID "09").
         */
        formatIsO09Scenario: function (sMovementScenarioItemKey) {
          return MovementScenarioIcons.isOutgoingDirectSaleScenarioItemKey(
            sMovementScenarioItemKey
          );
        },

        _getRefDocModel: function () {
          return (
            this.getView().getModel("refDocModel") ||
            sap.ui.getCore().getModel("refDocModel")
          );
        },

        _getTripDataModel: function () {
          return this.getView().getModel("TripData") || sap.ui.getCore().getModel("TripData");
        },

        _buildBinDetailsRowKey: function (oRow) {
          if (!oRow) return "";
          return [
            oRow.tripNumber || oRow.TripNumber || "",
            oRow.docType || oRow.DocType || "",
            oRow.refDocNo || oRow.RefDocNo || "",
            oRow.refDocItemNo || oRow.RefDocItemNo || "",
            oRow.materialCode || oRow.MaterialCode || "",
          ].join("|");
        },

        _snapshotBinDetailsBins: function () {
          var oRefModel = this._getRefDocModel();
          if (!oRefModel) return;

          var aFiltered = oRefModel.getProperty("/filteredMaterialDetails") || [];
          this._aBinDetailsOriginalBinsSnapshot = aFiltered.map(function (oRow) {
            return {
              key: this._buildBinDetailsRowKey(oRow),
              binsTrolleys: oRow.binsTrolleys,
            };
          }.bind(this));
        },

        _restoreBinDetailsBins: function () {
          var oRefModel = this._getRefDocModel();
          if (!oRefModel) return;

          if (!this._aBinDetailsOriginalBinsSnapshot) return;

          var aMaterials = oRefModel.getProperty("/materialDetails") || [];
          var aSnapshot = this._aBinDetailsOriginalBinsSnapshot;

          // Restore values by matching keys in materialDetails (shared objects with filtered list).
          aMaterials.forEach(function (oMat) {
            var sKey = this._buildBinDetailsRowKey(oMat);
            var oEntry = aSnapshot.find(function (e) {
              return e.key === sKey;
            });
            if (oEntry) {
              oMat.binsTrolleys = oEntry.binsTrolleys;
            }
          }.bind(this));

          // Force refresh to ensure bindings update.
          oRefModel.setProperty("/materialDetails", aMaterials, true);
        },

        _setBinInputsEditable: function (bEditable) {
          var oTable = this.getView().byId("idBinDetailsTable");
          if (!oTable) return;
          var aChildren = oTable.findAggregatedObjects(true) || [];
          aChildren.forEach(function (oCtrl) {
            if (oCtrl && oCtrl.isA && oCtrl.isA("sap.m.Input")) {
              if (oCtrl.setEditable) oCtrl.setEditable(!!bEditable);
              if (oCtrl.setEnabled) oCtrl.setEnabled(!!bEditable);
            }
          });
        },

        onEditBinDetails: function () {
          var oGlobalModel = sap.ui.getCore().getModel("globalData");
          if (
            oGlobalModel &&
            (oGlobalModel.getProperty("/IsScanningReporting") ||
              oGlobalModel.getProperty("/DisableRefDocMaterialsActions"))
          ) {
            MessageToast.show(
              "Editing bins is disabled for this movement scenario."
            );
            return;
          }

          this._snapshotBinDetailsBins();
          var oState = this.getView().getModel("binState");
          if (oState) {
            oState.setProperty("/binDetailsEditMode", true);
          }
          this._setBinInputsEditable(true);
        },

        onCancelBinDetails: function () {
          this._restoreBinDetailsBins();
          var oState = this.getView().getModel("binState");
          if (oState) {
            oState.setProperty("/binDetailsEditMode", false);
          }
          // No need to disable inputs explicitly; they become hidden.
          MessageToast.show("Bin details edit cancelled");
        },

        onSaveBinDetails: function () {
          var oTripData = this._getTripDataModel();
          var oRefModel = this._getRefDocModel();
          if (!oTripData || !oRefModel) {
            MessageToast.show("Unable to save bins (missing models).");
            return;
          }

          var aItems = oRefModel.getProperty("/filteredMaterialDetails") || [];
          var iTotalBins = 0;

          aItems.forEach(function (oRow) {
            var v = oRow && oRow.binsTrolleys;
            var n = v === null || v === undefined || v === "" ? 0 : Number(v);
            if (!isNaN(n)) {
              iTotalBins += n;
            }
          });

          // Keep GateOut payload consistent: it already sends `BinsReturned`.
          oTripData.setProperty("/BinsReturned", iTotalBins);

          var oState = this.getView().getModel("binState");
          if (oState) {
            oState.setProperty("/binDetailsEditMode", false);
          }

          MessageToast.show("Bins saved. Total updated.");
        },

        // User-role-based authorization for GateOut has been removed; buttons are
        // controlled purely by TripData state and standard UI logic.
      }
    );
  }
);
