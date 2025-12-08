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
    "sap/ui/model/FilterOperator"
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
    FilterOperator
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
        
        // Check initial weighment required state
        this._updateWeighmentEnabledState();
        
        // Initial load - wait a bit to ensure refDocModel is available
        setTimeout(function() {
            this._bindMaterialsFromRefDocs();
        }.bind(this), 100);
        
        // Initialize column visibility
        this._initializeUnloadingColumnVisibility();
        
        // Initialize button states based on TripDetails
        this._updateUnloadingButtonStates();
    },

    onAfterRendering: function() {
        // Refresh data when view is rendered/becomes visible
        // Use setTimeout to ensure view is fully rendered
        setTimeout(function() {
            this._bindMaterialsFromRefDocs();
        }.bind(this), 200);
    },

    onExit: function () {
        this._eventBus?.unsubscribe("TripData", "Updated", this._onTripDataUpdated, this);
        this._eventBus?.unsubscribe("TripData", "WeighmentRequiredChanged", this._onWeighmentRequiredChanged, this);
        this._oUnloadingColumnVisibilityDialog?.destroy();
    },

    _onTripDataUpdated: function () {
        // Update TripData model on view
        var oTripData = sap.ui.getCore().getModel("TripData");
        if (oTripData) {
            this.getView().setModel(oTripData, "TripData");
        }
        // Update weighment enabled state
        this._updateWeighmentEnabledState();
        // Bind materials
        this._bindMaterialsFromRefDocs();
        // Update button states based on TripDetails status
        this._updateUnloadingButtonStates();
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
                    console.error("Error parsing response:", e);
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
                
                // Optional: Log the RegisterEvent response if needed
                if (oData) {
                    console.log("EndUnloading response:", oData);
                }
                
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
                    console.error("Error parsing response:", e);
                }

                MessageBox.error(sMessage);

                // Reload TripData to restore correct button states
                this._reloadTripDataAndUpdateButtons();
            }.bind(this)
        });
    },


    // =====================================================================
    // BIND MATERIALS FROM REFERENCE DOCUMENTS
    // =====================================================================
    _bindMaterialsFromRefDocs: function () {
        console.log("=== Unloading: Binding Materials from Reference Documents ===");
        
        // Get materials from Reference Documents refDocModel
        var oRefDocModel = sap.ui.getCore().getModel("refDocModel");
        console.log("refDocModel:", oRefDocModel);
        
        if (!oRefDocModel) {
            console.log("refDocModel not found, trying TripData");
            // If refDocModel doesn't exist, try to get from TripData
            var oTripData = sap.ui.getCore().getModel("TripData");
            if (oTripData) {
                var aItems = this._extractResults(oTripData.getProperty("/ItemDetails"));
                console.log("Items from TripData:", aItems);
                if (aItems && aItems.length > 0) {
                    this._applyMaterials(aItems);
                } else {
                    // Clear table if no items
                    var oModel = this.getView().getModel("tableModel");
                    if (oModel) {
                        oModel.setProperty("/materials", []);
                    }
                }
            } else {
                // Clear table if no TripData
                var oModel = this.getView().getModel("tableModel");
                if (oModel) {
                    oModel.setProperty("/materials", []);
                }
            }
            return;
        }
        
        // Get materialDetails from refDocModel
        var aMaterials = oRefDocModel.getProperty("/materialDetails") || [];
        console.log("Materials from refDocModel:", aMaterials);
        console.log("Materials count:", aMaterials.length);
        
        if (aMaterials && aMaterials.length > 0) {
            console.log("Found materials, applying to table");
            this._applyMaterials(aMaterials);
        } else {
            console.log("No materials found in refDocModel, clearing table");
            // Clear table if no materials
            var oModel = this.getView().getModel("tableModel");
            if (oModel) {
                oModel.setProperty("/materials", []);
            }
        }
    },

    _applyMaterials: function (aMaterials) {
        console.log("=== Unloading: Applying Materials ===");
        console.log("Input materials:", aMaterials);
        
        var oModel = this.getView().getModel("tableModel");
        if (!oModel) {
            console.log("tableModel not found, creating new one");
            oModel = new JSONModel({ materials: [] });
            this.getView().setModel(oModel, "tableModel");
        }
        
        var aMapped = (aMaterials || []).map(this._mapMaterialDetail, this);
        console.log("Mapped materials:", aMapped);
        console.log("Mapped count:", aMapped.length);
        
        // Update the model using setData to ensure proper refresh
        oModel.setData({ materials: aMapped });
        
        // Verify the data was set
        var aSetMaterials = oModel.getProperty("/materials");
        console.log("Materials after setting:", aSetMaterials);
        console.log("Materials count after setting:", aSetMaterials ? aSetMaterials.length : 0);
        
        // Get table and verify binding
        var oTable = this.byId("idUnloadingMaterialTable");
        console.log("Table control:", oTable);
        if (oTable) {
            var oBinding = oTable.getBinding("items");
            console.log("Table binding:", oBinding);
            if (oBinding) {
                // Refresh the binding
                oBinding.refresh();
                console.log("Binding refreshed");
            } else {
                console.error("Table binding not found!");
            }
        } else {
            console.error("Table control not found!");
        }
        
        // Also update bindings on the view
        this.getView().getBindingContext();
        this.getView().updateBindings(false);
    },

    _mapMaterialDetail: function (oMaterial) {
        // Map from Reference Documents material format to Unloading table format
        return {
            RefDocNumber: oMaterial.refDocNo || "",
            RefDocItemNumber: oMaterial.refDocItemNo || "",
            MaterialCode: oMaterial.materialCode || "",
            MaterialDescription: oMaterial.materialDescription || "",
            Qty: oMaterial.qty || "",
            UoM: oMaterial.uom || "",
            UnloadedQty: "", // Empty for Reference Documents materials
            GrossWt: "", // Empty for Reference Documents materials
            TareWt: "", // Empty for Reference Documents materials
            NetWt: "", // Calculated field
            CreatedBy: oMaterial.createdBy || "",
            CreatedOnDate: oMaterial.createdOnDate || "",
            CreatedOnTime: oMaterial.createdOnTime || ""
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
        
        var oMaterial = oBindingContext.getObject();
        var sGrossWt = oMaterial.GrossWt || "";
        var sTareWt = oMaterial.TareWt || "";
        
        // Calculate Net Wt = Gross Wt - Tare Wt
        if (sGrossWt && sTareWt) {
            var fGrossWt = parseFloat(sGrossWt);
            var fTareWt = parseFloat(sTareWt);
            if (!isNaN(fGrossWt) && !isNaN(fTareWt)) {
                var fNetWt = fGrossWt - fTareWt;
                oBindingContext.getModel().setProperty(oBindingContext.getPath() + "/NetWt", fNetWt.toFixed(2));
            }
        }
    },

    // =====================================================================
    // COLUMN VISIBILITY FUNCTIONS
    // =====================================================================
    _initializeUnloadingColumnVisibility: function () {
        // Initialize Unloading column settings
        var aUnloadingColumns = [
            { id: "colUnloadingRefDocNumber", label: "Ref Doc Number", visible: true },
            { id: "colUnloadingRefDocItemNumber", label: "Ref Doc Item Number", visible: true },
            { id: "colUnloadingMaterialCode", label: "Material Code", visible: true },
            { id: "colUnloadingMaterialDescription", label: "Material Description", visible: true },
            { id: "colUnloadingQty", label: "Qty", visible: true },
            { id: "colUnloadingUoM", label: "UoM", visible: true },
            { id: "colUnloadingUnloadedQty", label: "Unloaded Qty / Net Wt", visible: true },
            { id: "colUnloadingGrossWt", label: "Gross Wt", visible: true },
            { id: "colUnloadingTareWt", label: "Tare Wt", visible: true },
            { id: "colUnloadingNetWt", label: "Net Wt", visible: true },
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
            { id: "colUnloadingMaterialCode", label: "Material Code", visible: true },
            { id: "colUnloadingMaterialDescription", label: "Material Description", visible: true },
            { id: "colUnloadingQty", label: "Qty", visible: true },
            { id: "colUnloadingUoM", label: "UoM", visible: true },
            { id: "colUnloadingUnloadedQty", label: "Unloaded Qty / Net Wt", visible: true },
            { id: "colUnloadingGrossWt", label: "Gross Wt", visible: true },
            { id: "colUnloadingTareWt", label: "Tare Wt", visible: true },
            { id: "colUnloadingNetWt", label: "Net Wt", visible: true },
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
        
        var bStartStarted = (sStartUnloading === "X" || sStartUnloading === "x");
        var bEndCompleted = (sEndUnloading === "X" || sEndUnloading === "x");
        
        var oBtnStart = oView.byId("btnStartUnloading");
        var oBtnEnd = oView.byId("btnEndUnloading");
        
        if (!oBtnStart || !oBtnEnd) {
            return;
        }
        
        // Logic:
        // 1. If started but not completed: Start disabled, End enabled
        // 2. If both started and completed: Both enabled
        // 3. If neither started: Start enabled, End disabled
        
        if (bStartStarted && !bEndCompleted) {
            // Started but not completed
            oBtnStart.setEnabled(false);
            oBtnEnd.setEnabled(true);
        } else if (bStartStarted && bEndCompleted) {
            // Both started and completed
            oBtnStart.setEnabled(true);
            oBtnEnd.setEnabled(true);
        } else {
            // Neither started (default)
            oBtnStart.setEnabled(true);
            oBtnEnd.setEnabled(false);
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
                "$expand": "OrderDetails,ItemDetails,Feeds"
            },
            success: function (oData) {
                var oTripDataModel = new sap.ui.model.json.JSONModel(oData);
                sap.ui.getCore().setModel(oTripDataModel, "TripData");
                sap.ui.getCore().getEventBus().publish("TripData", "Updated");
                this.getView().setModel(oTripDataModel, "TripData");
            }.bind(this),
            error: function () {
                // Silently fail - button states will remain as set
            }
        });
    }
});
});

