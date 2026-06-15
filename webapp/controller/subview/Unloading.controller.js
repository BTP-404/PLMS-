sap.ui.define(
[
    "sap/ui/core/mvc/Controller",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/odata/v2/ODataModel",
    "sap/ui/core/Fragment",
    "sap/m/SelectDialog",
    "sap/m/StandardListItem",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "com/incresolZ_INC_PLMS/util/PanelAccordion",
    "com/incresolZ_INC_PLMS/util/TripDataDocumentsVerified"
],
function (
    Controller,
    MessageToast,
    MessageBox,
    JSONModel,
    ODataModel,
    Fragment,
    SelectDialog,
    StandardListItem,
    Filter,
    FilterOperator,
    PanelAccordion,
    TripDataDocumentsVerified
) {
"use strict";

return Controller.extend("com.incresolZ_INC_PLMS.controller.subview.Unloading", {

    onInit: function () {

        this.oModel = new ODataModel("/sap/opu/odata/sap/YIGP_PLMS_SRV/", {
            useBatch: false,
            defaultBindingMode: "TwoWay"
        });

        this.getView().setModel(this.oModel);

        // Create and set tableModel on the view (not just the table) so binding works
        var oTableModel = new JSONModel({ materials: [] });
        this.getView().setModel(oTableModel, "tableModel");
        
        // Create unloadingModel for weighment enabled state
        var oUnloadingModel = new JSONModel({ weighmentEnabled: false });
        this.getView().setModel(oUnloadingModel, "unloadingModel");
        
        // Set TripData model on view for bindings
        var oTripData = sap.ui.getCore().getModel("TripData");
        if (oTripData) {
            this.getView().setModel(oTripData, "TripData");
        }
        
        // Subscribe to TripData updates to populate materials from Reference Documents
        this._eventBus = sap.ui.getCore().getEventBus();
        this._eventBus.subscribe("TripData", "Updated", this._onTripDataUpdated, this);
        this._eventBus.subscribe("TripData", "WeighmentRequiredChanged", this._onWeighmentRequiredChanged, this);
        this._eventBus.subscribe("Stage", "ClearAllTabs", this._clearAllData, this);
        
        // Check initial weighment required state
        this._updateWeighmentEnabledState();
        
        // Initial load - wait a bit to ensure refDocModel is available
        setTimeout(function() {
            this._bindMaterialsFromRefDocs();
        }.bind(this), 100);
        
        // Initialize column visibility
        this._initializeUnloadingColumnVisibility();
        PanelAccordion.attach(this.getView());
        
        // DISABLED: Button enable/disable logic removed
        // Initialize button states based on TripDetails
        // this._updateUnloadingButtonStates();
    },

    onAfterRendering: function() {
        // Refresh data when view is rendered/becomes visible
        // Use setTimeout to ensure view is fully rendered
        setTimeout(function() {
            this._bindMaterialsFromRefDocs();
            // Update button states when view is rendered
            this._updateUnloadingButtonStates();
            // DISABLED: Button enable/disable logic removed
            // this._applyUnloadingAuthorization();
        }.bind(this), 200);
    },

    onExit: function () {
        this._eventBus?.unsubscribe("TripData", "Updated", this._onTripDataUpdated, this);
        this._eventBus?.unsubscribe("TripData", "WeighmentRequiredChanged", this._onWeighmentRequiredChanged, this);
        this._eventBus?.unsubscribe("Stage", "ClearAllTabs", this._clearAllData, this);
        this._oUnloadingColumnVisibilityDialog?.destroy();
    },
    
    _clearAllData: function () {
        // Clear table model
        var oTableModel = this.getView().getModel("tableModel");
        if (oTableModel) {
            oTableModel.setData({ materials: [] });
        }
        
        // Clear unloading model
        var oUnloadingModel = this.getView().getModel("unloadingModel");
        if (oUnloadingModel) {
            oUnloadingModel.setData({ weighmentEnabled: false });
        }
    },

    _onTripDataUpdated: function () {
        // Update TripData model on view
        var oTripData = sap.ui.getCore().getModel("TripData");
        if (oTripData) {
            this.getView().setModel(oTripData, "TripData");
        }
        // Update button states
        this._updateUnloadingButtonStates();
        // Update weighment enabled state
        this._updateWeighmentEnabledState();
        // Bind materials
        this._bindMaterialsFromRefDocs();
        // Re-apply authorization when TripData changes (plant might have changed)
        // this._applyUnloadingAuthorization();
    },

    // =====================================================================
    // Start Unloading
    // =====================================================================
    onStartUnloading: function () {

        var oView = this.getView();
        var sTripNumber = sap.ui.getCore().getModel("globalData").getProperty("/TripNumber");

        if (!sTripNumber) {
            MessageToast.show("Trip Number missing. Please open a trip first.");
            return;
        }

        oView.setBusy(true);

        // FunctionImport: StartUnloading - GET method, returns Collection(ItemDetails)
        this.oModel.callFunction("/StartUnloading", {
            method: "GET",
            urlParameters: {
                TripNumber: sTripNumber
            },
            headers: {
                "X-Requested-With": "X"
            },
            success: function (oData) {
                oView.setBusy(false);
                MessageToast.show("Unloading started successfully.");

                // Handle Collection(ItemDetails) response
                if (oData && oData.results) {
                    this._applyMaterials(oData.results);
                } else if (oData && Array.isArray(oData)) {
                    this._applyMaterials(oData);
                } else if (oData) {
                    // Handle single object response
                    this._applyMaterials([oData]);
                }
                
                // Reload TripData to get updated status fields
                this._reloadTripDataAndUpdateButtons();
                
                // Update weighment enabled state to ensure weight fields are enabled if weighment is required
                this._updateWeighmentEnabledState();
            }.bind(this),
            error: function (oError) {
                oView.setBusy(false);

                let sMessage = "Failed to Start Unloading";

                try {
                    if (oError && oError.responseText) {
                        const oResponse = JSON.parse(oError.responseText);
                        if (oResponse.error?.message?.value) {
                            sMessage = oResponse.error.message.value;
                        } else if (oResponse.error?.message) {
                            sMessage = oResponse.error.message;
                        }
                    } else if (oError && oError.message) {
                        sMessage = oError.message.value || oError.message;
                    }
                } catch (e) {
                    // Error parsing response
                }

                MessageBox.error(sMessage);

                // Reload TripData to restore correct button states
                this._reloadTripDataAndUpdateButtons();
            }.bind(this)
        });
    },

    // =====================================================================
    // End Unloading
    // =====================================================================
    onEndUnloading: function () {

        var oView = this.getView();
        var sTripNumber = sap.ui.getCore().getModel("globalData").getProperty("/TripNumber");

        if (!sTripNumber) {
            MessageToast.show("Trip Number missing. Please open a trip first.");
            return;
        }

        // Always save weights first (if there are any to save), then call event
        oView.setBusy(true);
        
        // Check if there are materials with weight values to save
        var oTableModel = this.getView().getModel("tableModel");
        var aMaterials = oTableModel ? (oTableModel.getProperty("/materials") || []) : [];
        var bHasWeightsToSave = false;
        
        aMaterials.forEach(function (oMaterial) {
            var sGrossWt = oMaterial.GrossWt || "";
            var sTareWt = oMaterial.TareWt || "";
            var sUnloadedWeight = oMaterial.UnloadedWeight || "";
            var sNetWt = oMaterial.NetWt || "";
            var sRemark = oMaterial.Remark || "";
            
            if (sGrossWt || sTareWt || sUnloadedWeight || sNetWt || sRemark) {
                bHasWeightsToSave = true;
            }
        });

        // If there are weights to save, validate and save them first
        if (bHasWeightsToSave) {
            // Validate weight fields for zero values before saving
            if (!this._validateWeightFields()) {
                oView.setBusy(false);
                var sErrorMessage = "Please enter valid values:\n";
                if (this._aValidationErrors && this._aValidationErrors.length > 0) {
                    sErrorMessage += this._aValidationErrors.join("\n");
                } else {
                    sErrorMessage += "Unloaded Quantity and weights cannot be zero.";
                }
                MessageBox.warning(sErrorMessage);
                return;
            }
            
            this._updateAllItemDetailsWithWeights(false).then(function() {
                // After save is successful, call the EndUnloading event
                this._callEndUnloadingEvent(sTripNumber);
            }.bind(this)).catch(function(oError) {
                oView.setBusy(false);
                // If save fails, show error and don't proceed with event
                var sMessage = "Failed to save weights. Please try again.";
                if (oError && oError.message) {
                    sMessage = oError.message;
                }
                MessageBox.error(sMessage);
            }.bind(this));
        } else {
            // No weights to save, directly call the event
            this._callEndUnloadingEvent(sTripNumber);
        }
    },

    // =====================================================================
    // Save Unloading (without ending unloading)
    // =====================================================================
    onSaveUnloading: function () {
        // Authorization checks based on UserRoles have been removed; saving is always allowed.
        var oTableModel = this.getView().getModel("tableModel");
        var aMaterials = oTableModel ? (oTableModel.getProperty("/materials") || []) : [];
        var bHasExistingData = false;
        
        // Check if any material has existing data
        aMaterials.forEach(function (oMaterial) {
            if (oMaterial.GrossWt || oMaterial.TareWt || oMaterial.LoadedWeight || oMaterial.NetWt) {
                bHasExistingData = true;
            }
        });
        var oView = this.getView();
        var sTripNumber = sap.ui.getCore().getModel("globalData").getProperty("/TripNumber");

        if (!sTripNumber) {
            MessageToast.show("Trip Number missing. Please open a trip first.");
            return;
        }

        oView.setBusy(true);

        // Check if there are materials with values to save
        var oTableModel = this.getView().getModel("tableModel");
        var aMaterials = oTableModel ? (oTableModel.getProperty("/materials") || []) : [];
        var bHasDataToSave = false;

        aMaterials.forEach(function (oMaterial) {
            var sGrossWt = oMaterial.GrossWt || "";
            var sTareWt = oMaterial.TareWt || "";
            var sUnloadedWeight = oMaterial.UnloadedWeight || "";
            var sNetWt = oMaterial.NetWt || "";
            var sRemark = oMaterial.Remark || "";

            if (sGrossWt || sTareWt || sUnloadedWeight || sNetWt || sRemark) {
                bHasDataToSave = true;
            }
        });

        if (!bHasDataToSave) {
            oView.setBusy(false);
            MessageToast.show("Nothing to save.");
            return;
        }

        // Validate before saving
        if (!this._validateWeightFields()) {
            oView.setBusy(false);
            var sErrorMessage = "Please enter valid values:\n";
            if (this._aValidationErrors && this._aValidationErrors.length > 0) {
                sErrorMessage += this._aValidationErrors.join("\n");
            } else {
                sErrorMessage += "Unloaded Quantity and weights cannot be zero.";
            }
            MessageBox.warning(sErrorMessage);
            return;
        }

        this._updateAllItemDetailsWithWeights(true).then(function () {
            oView.setBusy(false);
            MessageToast.show("Saved successfully.");
            // Button states may depend on trip status; refresh them
            this._reloadTripDataAndUpdateButtons();
        }.bind(this)).catch(function (oError) {
            oView.setBusy(false);
            var sMessage = "Failed to save. Please try again.";
            if (oError && oError.message) {
                sMessage = oError.message;
            }
            MessageBox.error(sMessage);
        });
    },

    // =====================================================================
    // Call EndUnloading Event (internal method)
    // =====================================================================
    _callEndUnloadingEvent: function (sTripNumber) {
        var oView = this.getView();
        oView.setBusy(true);

        // FunctionImport: EndUnloading - POST method, returns RegisterEvent
        this.oModel.callFunction("/EndUnloading", {
            method: "POST",
            urlParameters: {
                TripNumber: sTripNumber
            },
            headers: {
                "X-Requested-With": "X"
            },
            success: function (oData) {
                oView.setBusy(false);
                MessageToast.show("Unloading ended.");
                
                // Reload TripData to get updated status fields
                this._reloadTripDataAndUpdateButtons();
            }.bind(this),
            error: function (oError) {
                oView.setBusy(false);

                let sMessage = "Failed to end unloading";

                try {
                    if (oError && oError.responseText) {
                        const oResponse = JSON.parse(oError.responseText);
                        if (oResponse.error?.message?.value) {
                            sMessage = oResponse.error.message.value;
                        } else if (oResponse.error?.message) {
                            sMessage = oResponse.error.message;
                        }
                    } else if (oError && oError.message) {
                        sMessage = oError.message.value || oError.message;
                    }
                } catch (e) {
                    // Error parsing response
                }

                MessageBox.error(sMessage);

                // Reload TripData to restore correct button states
                this._reloadTripDataAndUpdateButtons();
            }.bind(this)
        });
    },

    // =====================================================================
    // ReStart Unloading (calls ReOpen function)
    // =====================================================================
    onReStartUnloading: function () {
        var oView = this.getView();
        var sTripNumber = sap.ui.getCore().getModel("globalData").getProperty("/TripNumber");

        if (!sTripNumber) {
            MessageToast.show("Trip Number missing. Please open a trip first.");
            return;
        }

        // Confirm with user before reopening
        MessageBox.confirm(
            "Are you sure you want to restart unloading? This will allow you to continue unloading operations.",
            {
                title: "ReStart Unloading",
                actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
                emphasizedAction: MessageBox.Action.OK,
                onClose: function (sAction) {
                    if (sAction === MessageBox.Action.OK) {
                        oView.setBusy(true);

                        // FunctionImport: ReOpen - POST method, returns RegisterEvent
                        this.oModel.callFunction("/ReOpen", {
                            method: "POST",
                            urlParameters: {
                                TripNumber: sTripNumber
                            },
                            headers: {
                                "X-Requested-With": "X"
                            },
                            success: function (oData) {
                                oView.setBusy(false);
                                MessageToast.show("Unloading restarted successfully.");

                                // DISABLED: Button enable/disable logic removed
                                // After restart, disable ReStart button and enable End button
                                // var oBtnReStart = oView.byId("btnReStartUnloading");
                                // var oBtnEnd = oView.byId("btnEndUnloading");
                                // if (oBtnReStart) {
                                //     oBtnReStart.setEnabled(false);
                                // }
                                // if (oBtnEnd) {
                                //     oBtnEnd.setEnabled(true);
                                // }
                                
                                // Reload TripData to get updated status fields
                                this._reloadTripDataAndUpdateButtons();
                            }.bind(this),
                            error: function (oError) {
                                oView.setBusy(false);

                                let sMessage = "Failed to restart unloading";

                                try {
                                    if (oError && oError.responseText) {
                                        const oResponse = JSON.parse(oError.responseText);
                                        if (oResponse.error?.message?.value) {
                                            sMessage = oResponse.error.message.value;
                                        } else if (oResponse.error?.message) {
                                            sMessage = oResponse.error.message;
                                        }
                                    } else if (oError && oError.message) {
                                        sMessage = oError.message.value || oError.message;
                                    }
                                } catch (e) {
                                    // Error parsing response
                                }

                                MessageBox.error(sMessage);

                                // Reload TripData to restore correct button states
                                this._reloadTripDataAndUpdateButtons();
                            }.bind(this)
                        });
                    }
                }.bind(this)
            }
        );
    },


    // =====================================================================
    // BIND MATERIALS FROM REFERENCE DOCUMENTS
    // =====================================================================
    _bindMaterialsFromRefDocs: function (bForceFromTripData) {
        // Always prefer TripData ItemDetails for Unloading view (has weight data)
        // Only fallback to refDocModel if TripData ItemDetails is not available
        var oTripData = sap.ui.getCore().getModel("TripData");
        if (oTripData || bForceFromTripData) {
            var aItems = this._extractResults(oTripData ? oTripData.getProperty("/ItemDetails") : null);
            if (aItems && aItems.length > 0) {
                this._applyMaterials(aItems);
                return;
            }
        }
        
        // Fallback to refDocModel if TripData ItemDetails is not available
        var oRefDocModel = sap.ui.getCore().getModel("refDocModel");
        
        if (oRefDocModel) {
            var aMaterials = oRefDocModel.getProperty("/materialDetails") || [];
            
            if (aMaterials && aMaterials.length > 0) {
                this._applyMaterials(aMaterials);
                return;
            }
        }
        
        // Clear table if no materials found
        var oModel = this.getView().getModel("tableModel");
        if (oModel) {
            oModel.setProperty("/materials", []);
        }
    },

    _applyMaterials: function (aMaterials) {
        var oModel = this.getView().getModel("tableModel");
        if (!oModel) {
            oModel = new JSONModel({ materials: [] });
            this.getView().setModel(oModel, "tableModel");
        }
        
        var aMapped = (aMaterials || []).map(this._mapMaterialDetail, this);
        
        // Update the model using setData to ensure proper refresh
        oModel.setData({ materials: aMapped });
        
        // Get table and verify binding
        var oTable = this.byId("idUnloadingMaterialTable");
        if (oTable) {
            var oBinding = oTable.getBinding("items");
            if (oBinding) {
                // Refresh the binding
                oBinding.refresh();
            }
        }
        
        // Also update bindings on the view
        this.getView().getBindingContext();
        this.getView().updateBindings(false);
    },

    _mapMaterialDetail: function (oMaterial) {
        // Map from Reference Documents material format to Unloading table format
        // Also handle ItemDetails format from StartUnloading response (uppercase properties)
        // Backend API returns: GrossWeight, TareWeight, NetWeight, UnloadedWeight
        // Frontend model uses: GrossWt, TareWt, NetWt, UnloadedWeight
        
        // Helper function to clean and extract weight value
        var fnCleanWeight = function(sValue) {
            if (!sValue || sValue === null || sValue === undefined) {
                return "";
            }
            // Convert to string and trim whitespace
            var sCleaned = String(sValue).trim();
            // Remove trailing minus sign if present (handle "34.000-" format)
            if (sCleaned.endsWith("-")) {
                sCleaned = sCleaned.slice(0, -1);
            }
            // Return empty string if result is empty or just whitespace
            return sCleaned || "";
        };
        
        // Map weight fields - handle both backend field names (GrossWeight, TareWeight) and frontend (GrossWt, TareWt)
        // Use explicit null/undefined checks to handle 0 values correctly
        var sGrossWt = "";
        if (oMaterial.GrossWeight !== null && oMaterial.GrossWeight !== undefined) {
            sGrossWt = fnCleanWeight(oMaterial.GrossWeight);
        } else if (oMaterial.GrossWt !== null && oMaterial.GrossWt !== undefined) {
            sGrossWt = fnCleanWeight(oMaterial.GrossWt);
        }
        
        var sTareWt = "";
        if (oMaterial.TareWeight !== null && oMaterial.TareWeight !== undefined) {
            sTareWt = fnCleanWeight(oMaterial.TareWeight);
        } else if (oMaterial.TareWt !== null && oMaterial.TareWt !== undefined) {
            sTareWt = fnCleanWeight(oMaterial.TareWt);
        }
        
        var sNetWt = "";
        if (oMaterial.NetWeight !== null && oMaterial.NetWeight !== undefined) {
            sNetWt = fnCleanWeight(oMaterial.NetWeight);
        } else if (oMaterial.NetWt !== null && oMaterial.NetWt !== undefined) {
            sNetWt = fnCleanWeight(oMaterial.NetWt);
        }
        
        var sUnloadedWeight = "";
        if (oMaterial.UnloadedWeight !== null && oMaterial.UnloadedWeight !== undefined) {
            sUnloadedWeight = fnCleanWeight(oMaterial.UnloadedWeight);
        } else if (oMaterial.UnloadedQty !== null && oMaterial.UnloadedQty !== undefined) {
            sUnloadedWeight = fnCleanWeight(oMaterial.UnloadedQty);
        }
        
        // Calculate missing weights:
        // 1. If NetWt and TareWt are present, calculate GrossWt = NetWt + TareWt
        // 2. If GrossWt and TareWt are present, calculate NetWt = GrossWt - TareWt
        // 3. If NetWt has trailing minus, recalculate it
        
        // Calculate GrossWt if NetWt and TareWt are present but GrossWt is not
        if (sNetWt && sTareWt && !sGrossWt) {
            var fNetWt = parseFloat(sNetWt);
            var fTareWt = parseFloat(sTareWt);
            if (!isNaN(fNetWt) && !isNaN(fTareWt)) {
                var fGrossWt = fNetWt + fTareWt;
                sGrossWt = fGrossWt.toFixed(3);
            }
        }
        
        // Calculate NetWt if GrossWt and TareWt are present but NetWt is not, or if NetWt has trailing minus
        if (sGrossWt && sTareWt) {
            var fGrossWt = parseFloat(sGrossWt);
            var fTareWt = parseFloat(sTareWt);
            if (!isNaN(fGrossWt) && !isNaN(fTareWt)) {
                // Recalculate NetWt if it's missing or has trailing minus
                if (!sNetWt || sNetWt.endsWith("-")) {
                    var fNetWt = fGrossWt - fTareWt;
                    sNetWt = fNetWt.toFixed(3); // Use 3 decimal places to match display format
                }
            }
        }
        
        // Values are already strings from fnCleanWeight, but ensure they're not empty
        sGrossWt = sGrossWt || "";
        sTareWt = sTareWt || "";
        sNetWt = sNetWt || "";
        sUnloadedWeight = sUnloadedWeight || "";
        
        return {
            DocType: oMaterial.DocType || oMaterial.docType || "",
            TripNumber: oMaterial.TripNumber || oMaterial.tripNumber || "",
            RefDocNumber: oMaterial.RefDocNo || oMaterial.refDocNo || "",
            RefDocItemNumber: oMaterial.RefDocItemNo || oMaterial.refDocItemNo || "",
            ScheduleItem: oMaterial.SheduleItem || oMaterial.ScheduleItem || oMaterial.scheduleItem || "",
            SheduleItem: oMaterial.SheduleItem || oMaterial.ScheduleItem || oMaterial.scheduleItem || "",
            MaterialCode: oMaterial.MaterialCode || oMaterial.materialCode || "",
            MaterialDescription: oMaterial.MaterialDescription || oMaterial.materialDescription || "",
            Qty: oMaterial.Quantity || oMaterial.qty || "",
            UoM: oMaterial.UoM || oMaterial.uom || "",
            ConfirmQty: oMaterial.ConfirmQty || oMaterial.confirmQty || "",
            UnloadedWeight: sUnloadedWeight,
            GrossWt: sGrossWt, // Map from backend GrossWeight to frontend GrossWt
            TareWt: sTareWt, // Map from backend TareWeight to frontend TareWt
            NetWt: sNetWt, // Map from backend NetWeight to frontend NetWt (or calculate if missing)
            Remark: oMaterial.Remark || oMaterial.remark || oMaterial.Remarks || "",
            CreatedBy: oMaterial.CreatedBy || oMaterial.createdBy || "",
            CreatedOnDate: oMaterial.CreatedOnDate || oMaterial.createdOnDate || "",
            CreatedOnTime: oMaterial.CreatedOnTime || oMaterial.createdOnTime || ""
        };
    },

    _extractResults: function (vData) {
        if (!vData) {
            return null;
        }
        if (Array.isArray(vData)) {
            return vData;
        }
        if (Array.isArray(vData.results)) {
            return vData.results;
        }
        if (vData.__deferred) {
            return null;
        }
        return [];
    },

    // =====================================================================
    // WEIGHMENT REQUIRED HANDLERS
    // =====================================================================
    _onWeighmentRequiredChanged: function (oEvent, sChannel, oData) {
        this._updateWeighmentEnabledState();
    },
    
    _updateWeighmentEnabledState: function () {
        var oTripData = sap.ui.getCore().getModel("TripData");
        var bEnabled = false;
        
        if (oTripData) {
            var sWeighmentRequired = oTripData.getProperty("/WeighmentRequired");
            
            // Default to "N" if not set, null, or undefined
            if (!sWeighmentRequired || sWeighmentRequired === null || sWeighmentRequired === undefined || sWeighmentRequired === "") {
                sWeighmentRequired = "N";
                oTripData.setProperty("/WeighmentRequired", "N");
            }
            
            bEnabled = (sWeighmentRequired === "Y" || sWeighmentRequired === "Yes");
        }
        
        var oUnloadingModel = this.getView().getModel("unloadingModel");
        if (oUnloadingModel) {
            oUnloadingModel.setProperty("/weighmentEnabled", bEnabled);
        }
    },
    
    onWeightFieldChange: function (oEvent) {
        // Calculate Net Wt when Gross Wt or Tare Wt changes
        var oInput = oEvent.getSource();
        var sValue = oInput.getValue();
        var oBindingContext = oInput.getBindingContext("tableModel");
        
        if (!oBindingContext) {
            return;
        }
        
        // Check if weighment is required - skip validation for weight fields if not required
        var oTripData = sap.ui.getCore().getModel("TripData");
        var bWeighmentRequired = false;
        if (oTripData) {
            var sWeighmentRequired = oTripData.getProperty("/WeighmentRequired");
            bWeighmentRequired = (sWeighmentRequired === "Y" || sWeighmentRequired === "Yes");
        }
        
        // Get the input field ID to determine which field is being validated
        var sInputId = oInput.getId() || "";
        var bIsWeightField = sInputId.indexOf("GrossWt") !== -1 || 
                            sInputId.indexOf("TareWt") !== -1 || 
                            sInputId.indexOf("NetWt") !== -1;
        
        // Skip validation for weight fields if weighment is not required
        if (bIsWeightField && !bWeighmentRequired) {
            oInput.setValueState("None");
            oInput.setValueStateText("");
            return;
        }
        
        // Validation - check for blank, null, zero, and negative values
        var sTrimmedValue = sValue ? String(sValue).trim() : "";
        
        // Check if value is blank, null, or undefined
        if (sValue === "" || sValue === null || sValue === undefined || sTrimmedValue === "") {
            oInput.setValueState("None");
            oInput.setValueStateText("");
            return; // Allow blank values (user can clear the field)
        }
        
        // Check for valid numeric value
        var fValue = parseFloat(sTrimmedValue);
        if (isNaN(fValue)) {
            oInput.setValueState("Error");
            var sErrorMessage = sInputId && sInputId.indexOf("UnloadedWeight") !== -1 
                ? "Unloaded Quantity must be a valid number" 
                : "Weight must be a valid number";
            oInput.setValueStateText(sErrorMessage);
            return;
        }
        
        // Check for zero value
        if (fValue === 0) {
            oInput.setValueState("Error");
            var sErrorMessage = sInputId && sInputId.indexOf("UnloadedWeight") !== -1 
                ? "Unloaded Quantity cannot be zero" 
                : "Weight cannot be zero";
            oInput.setValueStateText(sErrorMessage);
            return;
        }
        
        // Check for negative value
        if (fValue < 0) {
            oInput.setValueState("Error");
            oInput.setValueStateText("Value cannot be negative");
            return;
        }
        
        // Valid value
        oInput.setValueState("None");
        oInput.setValueStateText("");
        
        var oMaterial = oBindingContext.getObject();
        var sGrossWt = oMaterial.GrossWt || "";
        var sTareWt = oMaterial.TareWt || "";
        
        // Calculate Net Wt = Gross Wt - Tare Wt (only if weighment is required)
        if (bWeighmentRequired && sGrossWt && sTareWt) {
            var fGrossWt = parseFloat(sGrossWt);
            var fTareWt = parseFloat(sTareWt);
            if (!isNaN(fGrossWt) && !isNaN(fTareWt) && fGrossWt !== 0 && fTareWt !== 0) {
                var fNetWt = fGrossWt - fTareWt;
                oBindingContext.getModel().setProperty(oBindingContext.getPath() + "/NetWt", fNetWt.toFixed(2));
            }
        }
    },
    
    // =====================================================================
    // UPDATE WEIGHTS BUTTON HANDLER
    // =====================================================================
    onUpdateWeights: function () {
        // Validate weight fields for zero values before saving
        if (!this._validateWeightFields()) {
            var sErrorMessage = "Please enter valid values:\n";
            if (this._aValidationErrors && this._aValidationErrors.length > 0) {
                sErrorMessage += this._aValidationErrors.join("\n");
            } else {
                sErrorMessage += "Unloaded Quantity and weights cannot be zero.";
            }
            MessageBox.warning(sErrorMessage);
            return;
        }
        
        var oView = this.getView();
        oView.setBusy(true);
        
        this._updateAllItemDetailsWithWeights(false).then(function() {
            oView.setBusy(false);
        }.bind(this)).catch(function(oError) {
            oView.setBusy(false);
        });
    },
    
    // =====================================================================
    // VALIDATE WEIGHT FIELDS FOR ZERO VALUES
    // =====================================================================
    _validateWeightFields: function () {
        var oTripData = sap.ui.getCore().getModel("TripData");
        var bWeighmentRequired = false;
        if (oTripData) {
            var sWeighmentRequired = oTripData.getProperty("/WeighmentRequired");
            bWeighmentRequired = (sWeighmentRequired === "Y" || sWeighmentRequired === "Yes");
        }

        var oTableModel = this.getView().getModel("tableModel");
        if (!oTableModel) {
            return true;
        }
        
        var aMaterials = oTableModel.getProperty("/materials") || [];
        var bIsValid = true;
        var aErrors = [];
        
        aMaterials.forEach(function (oMaterial, iIndex) {
            var sGrossWt = oMaterial.GrossWt;
            var sTareWt = oMaterial.TareWt;
            var sUnloadedWeight = oMaterial.UnloadedWeight;
            var sNetWt = oMaterial.NetWt;
            var sMaterialCode = oMaterial.MaterialCode || "";
            
            // Helper function to check if value is blank/null/undefined
            var fnIsBlank = function(sVal) {
                return sVal === null || sVal === undefined || sVal === "" || String(sVal).trim() === "";
            };
            
            // Helper function to validate numeric value
            var fnValidateNumeric = function(sVal, sFieldName) {
                if (fnIsBlank(sVal)) {
                    return { valid: false, error: sFieldName + " cannot be blank or null" };
                }
                var fVal = parseFloat(String(sVal).trim());
                if (isNaN(fVal)) {
                    return { valid: false, error: sFieldName + " must be a valid number" };
                }
                if (fVal === 0) {
                    return { valid: false, error: sFieldName + " cannot be zero" };
                }
                if (fVal < 0) {
                    return { valid: false, error: sFieldName + " cannot be negative" };
                }
                return { valid: true };
            };
            
            // Validate Unloaded Quantity (if entered, must be valid) - always validate
            if (!fnIsBlank(sUnloadedWeight)) {
                var oValidation = fnValidateNumeric(sUnloadedWeight, "Unloaded Quantity");
                if (!oValidation.valid) {
                    bIsValid = false;
                    aErrors.push("Material " + sMaterialCode + ": " + oValidation.error);
                }
            }
            
            // Validate weight fields (if entered, must be valid) - only if weighment is required
            if (bWeighmentRequired) {
                if (!fnIsBlank(sGrossWt)) {
                    var oValidation = fnValidateNumeric(sGrossWt, "Gross Weight");
                    if (!oValidation.valid) {
                        bIsValid = false;
                        aErrors.push("Material " + sMaterialCode + ": " + oValidation.error);
                    }
                }
                
                if (!fnIsBlank(sTareWt)) {
                    var oValidation = fnValidateNumeric(sTareWt, "Tare Weight");
                    if (!oValidation.valid) {
                        bIsValid = false;
                        aErrors.push("Material " + sMaterialCode + ": " + oValidation.error);
                    }
                }
                
                if (!fnIsBlank(sNetWt)) {
                    var oValidation = fnValidateNumeric(sNetWt, "Net Weight");
                    if (!oValidation.valid) {
                        bIsValid = false;
                        aErrors.push("Material " + sMaterialCode + ": " + oValidation.error);
                    }
                }
            }
        });
        
        // Store errors for display
        if (!bIsValid && aErrors.length > 0) {
            this._aValidationErrors = aErrors;
        }
        
        return bIsValid;
    },
    
    // =====================================================================
    // UPDATE ALL ITEMDETAILS WITH WEIGHT FIELDS
    // =====================================================================
    _updateAllItemDetailsWithWeights: function (bShowSuccessToast) {
        var oTableModel = this.getView().getModel("tableModel");
        if (!oTableModel) {
            return;
        }
        
        var aMaterials = oTableModel.getProperty("/materials") || [];
        var sTripNumber = sap.ui.getCore().getModel("globalData")?.getProperty("/TripNumber");
        
        if (!sTripNumber || aMaterials.length === 0) {
            return;
        }
        
        // Update each material that has weight values or confirm qty
        var aUpdatePromises = [];
        var iTotalUpdates = 0;
        aMaterials.forEach(function (oMaterial) {
            // Check if material has weight values, remark, or confirm qty to update
            var sGrossWt = oMaterial.GrossWt || "";
            var sTareWt = oMaterial.TareWt || "";
            var sUnloadedWeight = oMaterial.UnloadedWeight || "";
            var sNetWt = oMaterial.NetWt || "";
            var sRemark = oMaterial.Remark || "";
            var sConfirmQty = oMaterial.ConfirmQty || "";
            
            // Update if at least one weight field, remark, or confirm qty has a value
            if (sGrossWt || sTareWt || sUnloadedWeight || sNetWt || sRemark || sConfirmQty) {
                iTotalUpdates++;
                var oUpdatePromise = this._updateItemDetailWeight(oMaterial, sTripNumber);
                if (oUpdatePromise) {
                    aUpdatePromises.push(oUpdatePromise);
                }
            }
        }.bind(this));
        
        // Wait for all updates to complete
        if (aUpdatePromises.length > 0) {
            // Track success and failure counts
            var iSuccessCount = 0;
            var iFailureCount = 0;
            var aErrorMessages = [];
            
            return Promise.allSettled(aUpdatePromises).then(function (aResults) {
                aResults.forEach(function (oResult) {
                    if (oResult.status === "fulfilled" && oResult.value !== null) {
                        iSuccessCount++;
                    } else {
                        iFailureCount++;
                        if (oResult.reason) {
                            var sErrorMsg = this._extractErrorMessage(oResult.reason);
                            if (sErrorMsg) {
                                aErrorMessages.push(sErrorMsg);
                            }
                        }
                    }
                }.bind(this));
                
                // Show success message only if all updates succeeded
                if (iFailureCount === 0 && iSuccessCount > 0) {
                    if (bShowSuccessToast) {
                        MessageToast.show("Weight fields updated successfully");
                    }
                    // Reload TripData to fetch updated weights from backend
                    // Use setTimeout to ensure the reload happens after the current promise chain
                    setTimeout(function() {
                        this._reloadTripDataAndRefreshMaterials();
                    }.bind(this), 100);
                } else if (iSuccessCount > 0 && iFailureCount > 0) {
                    // Some succeeded, some failed
                    var sErrorMessage = iFailureCount + " of " + iTotalUpdates + " updates failed";
                    if (aErrorMessages.length > 0) {
                        sErrorMessage = aErrorMessages[0]; // Show first error message
                    }
                    MessageToast.show(sErrorMessage, {
                        duration: 5000
                    });
                } else if (iFailureCount > 0) {
                    // All failed
                    var sErrorMessage = "All weight updates failed";
                    if (aErrorMessages.length > 0) {
                        sErrorMessage = aErrorMessages[0]; // Show first error message
                    }
                    MessageToast.show(sErrorMessage, {
                        duration: 5000
                    });
                }
            }.bind(this));
        } else {
            MessageToast.show("No weight values found to update");
            return Promise.resolve();
        }
    },
    
    // =====================================================================
    // UPDATE SINGLE ITEMDETAIL WITH WEIGHT FIELDS
    // =====================================================================
    _updateItemDetailWeight: function (oMaterial, sTripNumber) {
        // Get fields from material - handle both uppercase (from ItemDetails) and lowercase (from Reference Documents)
        var sDocType = oMaterial.DocType || oMaterial.docType || "";
        var sRefDocNo = oMaterial.RefDocNumber || oMaterial.RefDocNo || oMaterial.refDocNo || "";
        var sRefDocItemNo = oMaterial.RefDocItemNumber || oMaterial.RefDocItemNo || oMaterial.refDocItemNo || "";
        var fnSchedStr = function (o) {
            if (!o) {
                return "";
            }
            var v = o.scheduleItem || o.ScheduleItem || o.SheduleItem || o.sheduleItem;
            return String(v == null ? "" : v).trim();
        };
        var sSchedMat = fnSchedStr(oMaterial);

        // If DocType is missing, get it from TripData ItemDetails using RefDocNo and RefDocItemNo
        if (!sDocType && sRefDocNo && sRefDocItemNo) {
            var oTripData = sap.ui.getCore().getModel("TripData");
            if (oTripData) {
                var aItemDetails = this._extractResults(oTripData.getProperty("/ItemDetails")) || [];
                var oFoundItem = aItemDetails.find(function(oItem) {
                    var bRef = (oItem.RefDocNo === sRefDocNo || oItem.RefDocNo === oMaterial.RefDocNumber);
                    var bItem = (oItem.RefDocItemNo === sRefDocItemNo || oItem.RefDocItemNo === oMaterial.RefDocItemNumber);
                    if (!bRef || !bItem) {
                        return false;
                    }
                    if (!sSchedMat) {
                        return true;
                    }
                    return fnSchedStr(oItem) === sSchedMat;
                });
                if (oFoundItem) {
                    sDocType = oFoundItem.DocType || "";
                }
            }
        }

        // Also try to get from refDocModel if still missing
        if (!sDocType && sRefDocNo) {
            var oRefDocModel = sap.ui.getCore().getModel("refDocModel");
            if (oRefDocModel) {
                var aRefDocMaterials = oRefDocModel.getProperty("/materialDetails") || [];
                var oFoundRefDocMaterial = aRefDocMaterials.find(function(oMat) {
                    var bRef = (oMat.refDocNo === sRefDocNo || oMat.RefDocNo === sRefDocNo);
                    var bItem = (oMat.refDocItemNo === sRefDocItemNo || oMat.RefDocItemNo === sRefDocItemNo);
                    if (!bRef || !bItem) {
                        return false;
                    }
                    if (!sSchedMat) {
                        return true;
                    }
                    return fnSchedStr(oMat) === sSchedMat;
                });
                if (oFoundRefDocMaterial) {
                    sDocType = oFoundRefDocMaterial.DocType || oFoundRefDocMaterial.docType || "";
                }
            }
        }

        if (!sDocType || !sRefDocNo || !sRefDocItemNo || !sTripNumber) {
            return null;
        }

        // Escape OData values
        var sEscapedDocType = this._escapeODataValue(sDocType);
        var sEscapedTripNumber = this._escapeODataValue(sTripNumber);
        var sEscapedRefDocNo = this._escapeODataValue(sRefDocNo);
        var sEscapedRefDocItemNo = this._escapeODataValue(sRefDocItemNo);

        // Build OData entity key path
        var sEntityPath = "/ItemDetails(DocType='" + sEscapedDocType +
            "',TripNumber='" + sEscapedTripNumber +
            "',RefDocNo='" + sEscapedRefDocNo +
            "',RefDocItemNo='" + sEscapedRefDocItemNo + "')";

        // Get current ItemDetails from TripData ItemDetails collection (since GET_ENTITY is not supported)
        var oTripData2 = sap.ui.getCore().getModel("TripData");
        var oCurrentData = null;

        if (oTripData2) {
            var aItemDetails2 = this._extractResults(oTripData2.getProperty("/ItemDetails")) || [];
            oCurrentData = aItemDetails2.find(function(oItem) {
                if (oItem.DocType !== sDocType ||
                    oItem.TripNumber !== sTripNumber ||
                    oItem.RefDocNo !== sRefDocNo ||
                    oItem.RefDocItemNo !== sRefDocItemNo) {
                    return false;
                }
                if (!sSchedMat) {
                    return true;
                }
                return fnSchedStr(oItem) === sSchedMat;
            });
        }

        // Build update payload with existing fields from TripData + weight fields from material
        var oUpdatePayload = {
            TripNumber: sTripNumber,
            DocType: sDocType,
            RefDocNo: sRefDocNo,
            RefDocItemNo: sRefDocItemNo,
            MaterialCode: (oCurrentData && oCurrentData.MaterialCode) || oMaterial.MaterialCode || "",
            MaterialDescription: (oCurrentData && oCurrentData.MaterialDescription) || oMaterial.MaterialDescription || "",
            Quantity: (oCurrentData && oCurrentData.Quantity) || parseFloat(oMaterial.Qty) || 0,
            UoM: (oCurrentData && oCurrentData.UoM) || oMaterial.UoM || "",
            IsDeleted: (oCurrentData && oCurrentData.IsDeleted) || "",
            IsSplitActive: (oCurrentData && oCurrentData.IsSplitActive !== undefined) ? oCurrentData.IsSplitActive : false,
            SheduleItem: fnSchedStr(oCurrentData) || sSchedMat || ""
        };
        
                // Add weight fields if they have values - use correct property names from metadata
                // Weight fields are String type in metadata
                if (oMaterial.GrossWt) {
                    oUpdatePayload.GrossWeight = String(parseFloat(oMaterial.GrossWt) || 0);
                }
                if (oMaterial.TareWt) {
                    oUpdatePayload.TareWeight = String(parseFloat(oMaterial.TareWt) || 0);
                }
                if (oMaterial.NetWt) {
                    oUpdatePayload.NetWeight = String(parseFloat(oMaterial.NetWt) || 0);
                }
        // Add Unloaded Weight to payload
        if (oMaterial.UnloadedWeight) {
            oUpdatePayload.UnloadedWeight = String(parseFloat(oMaterial.UnloadedWeight) || 0);
        }
        // Add Remarks to payload
        if (oMaterial.Remark !== undefined && oMaterial.Remark !== null) {
            oUpdatePayload.Remarks = String(oMaterial.Remark || "");
        }

        // Add ConfirmQty to payload (X when checked, empty otherwise)
        if (oMaterial.ConfirmQty !== undefined && oMaterial.ConfirmQty !== null) {
            oUpdatePayload.ConfirmQty = oMaterial.ConfirmQty ? "X" : "";
        } else if (oCurrentData && oCurrentData.ConfirmQty !== undefined) {
            oUpdatePayload.ConfirmQty = oCurrentData.ConfirmQty;
        }
        
        // Update ItemDetails using the same pattern as Reference Documents
        return new Promise(function (resolve, reject) {
            this.oModel.update(sEntityPath, oUpdatePayload, {
                merge: false,
                headers: {
                    "X-Requested-With": "X"
                },
                success: function (oData) {
                    resolve(oData);
                }.bind(this),
                error: function (oError) {
                    // Don't show individual error toasts - will show summary at end
                    // Reject the promise so Promise.allSettled can track failures
                    reject(oError);
                }.bind(this)
            });
        }.bind(this));
    },
    
    _escapeODataValue: function (sValue) {
        // Escape single quotes in OData string values
        return (sValue || "").replace(/'/g, "''");
    },
    
    _extractErrorMessage: function (oError) {
        var sErrorMessage = "Failed to update weight";
        try {
            if (oError && oError.responseText) {
                var oResponse = JSON.parse(oError.responseText);
                if (oResponse.error && oResponse.error.message) {
                    // Handle both formats: {message: {value: "..."}} and {message: "..."}
                    if (oResponse.error.message.value) {
                        sErrorMessage = oResponse.error.message.value;
                    } else if (typeof oResponse.error.message === "string") {
                        sErrorMessage = oResponse.error.message;
                    }
                }
                // Also check innererror for additional details
                if (oResponse.error.innererror && oResponse.error.innererror.errordetails && 
                    oResponse.error.innererror.errordetails.length > 0) {
                    var sInnerMessage = oResponse.error.innererror.errordetails[0].message;
                    if (sInnerMessage) {
                        sErrorMessage = sInnerMessage;
                    }
                }
            } else if (oError && oError.message) {
                // Fallback to oError.message
                sErrorMessage = oError.message.value || oError.message;
            }
        } catch (e) {
            // Keep default message
        }
        return sErrorMessage;
    },

    // =====================================================================
    // COLUMN VISIBILITY FUNCTIONS
    // =====================================================================
    _initializeUnloadingColumnVisibility: function () {
        // Initialize Unloading column settings
        var aUnloadingColumns = [
            { id: "colUnloadingRefDocNumber", label: "Ref Doc Number", visible: true },
            { id: "colUnloadingRefDocItemNumber", label: "Ref Doc Item Number", visible: true },
            { id: "colUnloadingScheduleLine", label: "Schedule line", visible: true },
            { id: "colUnloadingMaterialCode", label: "Material Code", visible: true },
            { id: "colUnloadingMaterialDescription", label: "Material Description", visible: true },
            { id: "colUnloadingQty", label: "Qty", visible: true },
            { id: "colUnloadingUoM", label: "UoM", visible: true },
            { id: "colUnloadingUnloadedWeight", label: "Unloaded Weight / Net Wt", visible: true },
            { id: "colUnloadingGrossWt", label: "Gross Wt", visible: true },
            { id: "colUnloadingTareWt", label: "Tare Wt", visible: true },
            { id: "colUnloadingNetWt", label: "Net Wt", visible: true },
            { id: "colUnloadingRemark", label: "Remark", visible: true },
            { id: "colUnloadingCreatedBy", label: "Created By", visible: false },
            { id: "colUnloadingCreatedOnDate", label: "Created On Date", visible: false },
            { id: "colUnloadingCreatedOnTime", label: "Created On Time", visible: false }
        ];

        // Create model for column settings
        this._oUnloadingColumnSettingsModel = new JSONModel({
            columns: aUnloadingColumns
        });
        this.getView().setModel(this._oUnloadingColumnSettingsModel, "unloadingColumnSettings");

        // Apply initial column visibility
        this._applyUnloadingColumnVisibility();
    },

    _applyUnloadingColumnVisibility: function () {
        var oTable = this.byId("idUnloadingMaterialTable");
        if (!oTable) {
            return;
        }

        var aColumns = this._oUnloadingColumnSettingsModel.getProperty("/columns");
        aColumns.forEach(function (oColumn) {
            var oCol = this.byId(oColumn.id);
            if (oCol) {
                oCol.setVisible(oColumn.visible);
            }
        }.bind(this));
    },

    onUnloadingColumnSettings: function () {
        if (!this._oUnloadingColumnVisibilityDialog) {
            this._oUnloadingColumnVisibilityDialog = Fragment.load({
                id: this.getView().getId(),
                name: "com.incresolZ_INC_PLMS.fragments.VehicleUnloadingFrags.UnloadingColumnVisibilityDialog",
                controller: this
            }).then(function (oDialog) {
                this.getView().addDependent(oDialog);
                return oDialog;
            }.bind(this));
        }

        this._oUnloadingColumnVisibilityDialog.then(function (oDialog) {
            oDialog.open();
        });
    },

    onUnloadingColumnSwitchChanged: function (oEvent) {
        var oSwitch = oEvent.getSource();
        var oBindingContext = oSwitch.getBindingContext("unloadingColumnSettings");
        if (oBindingContext) {
            var oColumn = oBindingContext.getObject();
            oColumn.visible = oSwitch.getState();
            this._applyUnloadingColumnVisibility();
        }
    },

    onResetUnloadingColumnVisibility: function () {
        var aDefaultColumns = [
            { id: "colUnloadingRefDocNumber", label: "Ref Doc Number", visible: true },
            { id: "colUnloadingRefDocItemNumber", label: "Ref Doc Item Number", visible: true },
            { id: "colUnloadingScheduleLine", label: "Schedule line", visible: true },
            { id: "colUnloadingMaterialCode", label: "Material Code", visible: true },
            { id: "colUnloadingMaterialDescription", label: "Material Description", visible: true },
            { id: "colUnloadingQty", label: "Qty", visible: true },
            { id: "colUnloadingUoM", label: "UoM", visible: true },
            { id: "colUnloadingUnloadedWeight", label: "Unloaded Weight / Net Wt", visible: true },
            { id: "colUnloadingGrossWt", label: "Gross Wt", visible: true },
            { id: "colUnloadingTareWt", label: "Tare Wt", visible: true },
            { id: "colUnloadingNetWt", label: "Net Wt", visible: true },
            { id: "colUnloadingRemark", label: "Remark", visible: true },
            { id: "colUnloadingCreatedBy", label: "Created By", visible: false },
            { id: "colUnloadingCreatedOnDate", label: "Created On Date", visible: false },
            { id: "colUnloadingCreatedOnTime", label: "Created On Time", visible: false }
        ];

        this._oUnloadingColumnSettingsModel.setProperty("/columns", aDefaultColumns);
        this._applyUnloadingColumnVisibility();
    },

    onCloseUnloadingColumnVisibilityDialog: function () {
        if (this._oUnloadingColumnVisibilityDialog) {
            this._oUnloadingColumnVisibilityDialog.then(function (oDialog) {
                oDialog.close();
            });
        }
    },

    // =====================================================================
    // UPDATE UNLOADING BUTTON STATES BASED ON TRIPDETAILS STATUS
    // =====================================================================
    _updateUnloadingButtonStates: function () {
        var oTripData = sap.ui.getCore().getModel("TripData");
        var oView = this.getView();
        
        if (!oTripData || !oView) {
            return;
        }
        
        var sStartUnloading = oTripData.getProperty("/Start_Unloading") || "";
        var sEndUnloading = oTripData.getProperty("/End_Unloading") || "";
        var sTripStatus = (oTripData.getProperty("/TripStatus") || "").trim();
        var sLowerStatus = sTripStatus.toLowerCase();
        var bIsUnloadingReopened = sLowerStatus === "unloading reopened" || sLowerStatus === "unloading-reopened";
        
        var bStartStarted = (sStartUnloading === "X" || sStartUnloading === "x");
        var bEndCompleted = (sEndUnloading === "X" || sEndUnloading === "x");
        
        var oBtnStart = oView.byId("btnStartUnloading");
        var oBtnReStart = oView.byId("btnReStartUnloading");
        var oBtnSave = oView.byId("btnSaveUnloading");
        var oBtnEnd = oView.byId("btnEndUnloading");
        
        if (!oBtnStart || !oBtnEnd) {
            return;
        }
        
        // Logic:
        // 1. If started but not completed (or after reopen if End flag cleared): Start hidden, ReStart hidden, Save enabled, End visible and enabled
        // 2. If both started and completed (before reopen or after reopen if End flag kept): Start hidden, ReStart visible and enabled, Save disabled, End visible and enabled
        // 3. If neither started: Start visible and enabled, ReStart hidden, Save disabled, End visible but disabled
        // 4. If TripStatus is "Unloading Reopened": Hide ReStart button regardless of other conditions
        
        if (bStartStarted && !bEndCompleted) {
            // Started but not completed (or after restart)
            if (oBtnStart) {
                oBtnStart.setVisible(false);
            }
            if (oBtnReStart) {
                oBtnReStart.setVisible(false);
            }
            if (oBtnSave) {
                oBtnSave.setEnabled(true);
            }
            if (oBtnEnd) {
                oBtnEnd.setVisible(true);
                oBtnEnd.setEnabled(true);
            }
        } else if (bStartStarted && bEndCompleted) {
            // Unloading ended - Hide Start, Show Restart and End (End visible after restart)
            if (oBtnStart) {
                oBtnStart.setVisible(false);
            }
            if (oBtnReStart) {
                // Hide ReStart button if TripStatus is "Unloading Reopened"
                oBtnReStart.setVisible(!bIsUnloadingReopened);
                if (!bIsUnloadingReopened) {
                    oBtnReStart.setEnabled(true);
                }
            }
            if (oBtnSave) {
                oBtnSave.setEnabled(false);
            }
            if (oBtnEnd) {
                oBtnEnd.setVisible(true);
                oBtnEnd.setEnabled(true);
            }
        } else {
            // Neither started (default)
            if (oBtnStart) {
                oBtnStart.setVisible(true);
                oBtnStart.setEnabled(true);
            }
            if (oBtnReStart) {
                oBtnReStart.setVisible(false);
            }
            if (oBtnSave) {
                oBtnSave.setEnabled(false);
            }
            if (oBtnEnd) {
                oBtnEnd.setVisible(true);
                oBtnEnd.setEnabled(false);
            }
        }
    },

    // =====================================================================
    // RELOAD TRIPDATA AND UPDATE BUTTON STATES
    // =====================================================================
    _reloadTripDataAndUpdateButtons: function () {
        var sTripNumber = sap.ui.getCore().getModel("globalData")?.getProperty("/TripNumber");
        if (!sTripNumber) {
            return;
        }
        
        this.oModel.read("/TripDetails('" + sTripNumber + "')", {
            urlParameters: {
                "$expand": "OrderDetails,ItemDetails,Feeds,ActivityHistory"
            },
            success: function (oData) {
                TripDataDocumentsVerified.applyDocumentsVerifiedToVerifiedDocs(oData);
                var oTripDataModel = new sap.ui.model.json.JSONModel(oData);
                sap.ui.getCore().setModel(oTripDataModel, "TripData");
                sap.ui.getCore().getEventBus().publish("TripData", "Updated");
                this.getView().setModel(oTripDataModel, "TripData");
            }.bind(this),
            error: function () {
                // Silently fail - button states will remain as set
            }
        });
    },

    
    // =====================================================================
    // RELOAD TRIPDATA AND REFRESH MATERIALS (for weight updates)
    // =====================================================================
    _reloadTripDataAndRefreshMaterials: function () {
        var sTripNumber = sap.ui.getCore().getModel("globalData")?.getProperty("/TripNumber");
        if (!sTripNumber) {
            return;
        }
        
        var oView = this.getView();
        oView.setBusy(true);
        
        this.oModel.read("/TripDetails('" + sTripNumber + "')", {
            urlParameters: {
                "$expand": "OrderDetails,ItemDetails,Feeds,ActivityHistory"
            },
            success: function (oData) {
                TripDataDocumentsVerified.applyDocumentsVerifiedToVerifiedDocs(oData);
                var oTripDataModel = new sap.ui.model.json.JSONModel(oData);
                sap.ui.getCore().setModel(oTripDataModel, "TripData");
                this.getView().setModel(oTripDataModel, "TripData");
                
                // Refresh materials directly from TripData ItemDetails to show updated weights
                this._bindMaterialsFromRefDocs(true);
                
                // Update weighment enabled state
                this._updateWeighmentEnabledState();
                // DISABLED: Button enable/disable logic removed
                // Update button states based on TripDetails status
                // this._updateUnloadingButtonStates();
                
                // Publish event for other subscribers
                sap.ui.getCore().getEventBus().publish("TripData", "Updated");
                
                oView.setBusy(false);
            }.bind(this),
            error: function () {
                oView.setBusy(false);
                // Silently fail - materials will remain as they were
            }
        });
    }
});
});

