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

return Controller.extend("com.incresolZ_INC_PLMS.controller.subview.Loading", {

    onInit: function () {

        this.oModel = new ODataModel("/sap/opu/odata/sap/YIGP_PLMS_SRV/", {
            useBatch: false,
            defaultBindingMode: "TwoWay"
        });

        this.getView().setModel(this.oModel);

        // Create and set tableModel on the view (not just the table) so binding works
        var oTableModel = new JSONModel({ materials: [] });
        this.getView().setModel(oTableModel, "tableModel");
        
        // Create loadingModel for weighment enabled state
        var oLoadingModel = new JSONModel({ weighmentEnabled: false });
        this.getView().setModel(oLoadingModel, "loadingModel");
        
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
        this._initializeLoadingColumnVisibility();
    },

    onAfterRendering: function() {
        // Refresh data when view is rendered/becomes visible
        // Use setTimeout to ensure view is fully rendered
        setTimeout(function() {
            this._bindMaterialsFromRefDocs();
        }.bind(this), 200);
    },

    _initSuggestionModels: function () {
        // Create suggestion models for value help
        if (!this._oRefDocSuggestionsModel) {
            this._oRefDocSuggestionsModel = new JSONModel({ items: [] });
            this.getView().setModel(this._oRefDocSuggestionsModel, "refDocSuggestions");
        }
        if (!this._oMaterialSuggestionsModel) {
            this._oMaterialSuggestionsModel = new JSONModel({ items: [] });
            this.getView().setModel(this._oMaterialSuggestionsModel, "materialSuggestions");
        }
    },

    onExit: function () {
        this._eventBus?.unsubscribe("TripData", "Updated", this._onTripDataUpdated, this);
        this._eventBus?.unsubscribe("TripData", "WeighmentRequiredChanged", this._onWeighmentRequiredChanged, this);
        this._oLoadingColumnVisibilityDialog?.destroy();
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
    },

    // =====================================================================
    // Start Loading
    // =====================================================================
    onStartLoading: function () {

        var oView = this.getView();
        var sTripNumber = sap.ui.getCore().getModel("globalData").getProperty("/TripNumber");

        if (!sTripNumber) {
            MessageToast.show("Trip Number missing. Please open a trip first.");
            return;
        }

        oView.byId("btnStartLoading").setEnabled(false);
        oView.byId("btnEndLoading").setEnabled(true);

        oView.setBusy(true);

        // FunctionImport: StartLoading - GET method, returns Collection(ItemDetails)
        this.oModel.callFunction("/StartLoading", {
            method: "GET",
            urlParameters: {
                TripNumber: sTripNumber
            },
            headers: {
                "X-Requested-With": "X"
            },
            success: function (oData) {
                oView.setBusy(false);
                MessageToast.show("Loading started successfully.");

                // Handle Collection(ItemDetails) response
                if (oData && oData.results) {
                    this._applyMaterials(oData.results);
                } else if (oData && Array.isArray(oData)) {
                    this._applyMaterials(oData);
                } else if (oData) {
                    // Handle single object response
                    this._applyMaterials([oData]);
                }
            }.bind(this),
            error: function (oError) {
                oView.setBusy(false);

                let sMessage = "Failed to Start Loading";

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

                oView.byId("btnStartLoading").setEnabled(true);
                oView.byId("btnEndLoading").setEnabled(false);
            }.bind(this)
        });
    },

    // =====================================================================
    // End Loading
    // =====================================================================
    onEndLoading: function () {

        var oView = this.getView();
        var sTripNumber = sap.ui.getCore().getModel("globalData").getProperty("/TripNumber");

        if (!sTripNumber) {
            MessageToast.show("Trip Number missing. Please open a trip first.");
            return;
        }

        oView.byId("btnStartLoading").setEnabled(true);
        oView.byId("btnEndLoading").setEnabled(false);

        oView.setBusy(true);

        // FunctionImport: EndLoading - POST method, returns RegisterEvent
        this.oModel.callFunction("/EndLoading", {
            method: "POST",
            urlParameters: {
                TripNumber: sTripNumber
            },
            headers: {
                "X-Requested-With": "X"
            },
            success: function (oData) {
                oView.setBusy(false);
                MessageToast.show("Loading ended.");
                
                // Optional: Log the RegisterEvent response if needed
                if (oData) {
                    console.log("EndLoading response:", oData);
                }
            },
            error: function (oError) {
                oView.setBusy(false);

                let sMessage = "Failed to end loading";

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

                oView.byId("btnStartLoading").setEnabled(true);
                oView.byId("btnEndLoading").setEnabled(false);
            }.bind(this)
        });
    },


    // =====================================================================
    // BIND MATERIALS FROM REFERENCE DOCUMENTS
    // =====================================================================
    _bindMaterialsFromRefDocs: function () {
        console.log("=== Loading: Binding Materials from Reference Documents ===");
        
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
        console.log("=== Loading: Applying Materials ===");
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
        if (aMapped.length > 0) {
            console.log("First mapped material (full):", JSON.stringify(aMapped[0], null, 2));
            console.log("First mapped material properties:", Object.keys(aMapped[0]));
            console.log("RefDocNumber:", aMapped[0].RefDocNumber);
            console.log("MaterialCode:", aMapped[0].MaterialCode);
        }
        
        // Update the model using setData to ensure proper refresh
        oModel.setData({ materials: aMapped });
        
        // Verify the data was set
        var aSetMaterials = oModel.getProperty("/materials");
        console.log("Materials after setting:", aSetMaterials);
        console.log("Materials count after setting:", aSetMaterials ? aSetMaterials.length : 0);
        
        // Get table and verify binding
        var oTable = this.byId("idLoadingMaterialTable");
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
        // Map from Reference Documents material format to Loading table format
        return {
            RefDocNumber: oMaterial.refDocNo || "",
            RefDocItemNumber: oMaterial.refDocItemNo || "",
            MaterialCode: oMaterial.materialCode || "",
            MaterialDescription: oMaterial.materialDescription || "",
            Qty: oMaterial.qty || "",
            UoM: oMaterial.uom || "",
            LoadedQty: "", // Empty for Reference Documents materials
            GrossWt: "", // Empty for Reference Documents materials
            TareWt: "", // Empty for Reference Documents materials
            NetWt: "", // Calculated as GrossWt - TareWt
            CreatedBy: oMaterial.createdBy || "",
            CreatedOnDate: oMaterial.createdOnDate || "",
            CreatedOnTime: oMaterial.createdOnTime || ""
        };
    },

    _formatQuantity: function (vQty) {
        if (vQty === null || vQty === undefined || vQty === "") {
            return "";
        }
        return String(vQty);
    },

    _formatODataDate: function (vDate) {
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

    _formatODataTime: function (vTime) {
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
    // VALUE HELP FOR REF DOC NUMBER
    // =====================================================================
    onLoadingRefDocNoValueHelp: function () {
        var oTripData = sap.ui.getCore().getModel("TripData");
        if (!oTripData) {
            MessageToast.show("Please open a trip first");
            return;
        }

        var aOrderDetails = this._extractResults(oTripData.getProperty("/OrderDetails")) || [];
        // Filter out deleted records
        var aFilteredDocs = aOrderDetails.filter(function (oDoc) {
            return !oDoc.Deleted;
        });

        // Update suggestions
        this._oRefDocSuggestionsModel.setProperty("/items", aFilteredDocs);

        // Open value help dialog
        if (!this._oLoadingRefDocValueHelp) {
            this._createLoadingRefDocValueHelpDialog();
        }

        var oVHModel = this._oLoadingRefDocValueHelp.getModel("orderDetailsVH");
        oVHModel.setProperty("/items", aFilteredDocs || []);
        this._resetLoadingRefDocValueHelpFilters();
        this._oLoadingRefDocValueHelp.open();
    },

    _createLoadingRefDocValueHelpDialog: function () {
        this._oLoadingRefDocValueHelp = new SelectDialog({
            title: "Select Reference Document",
            search: this._onLoadingRefDocValueHelpSearch.bind(this),
            liveChange: this._onLoadingRefDocValueHelpSearch.bind(this),
            confirm: this._onLoadingRefDocValueHelpConfirm.bind(this),
            cancel: this._onLoadingRefDocValueHelpCancel.bind(this)
        });

        this._oLoadingRefDocValueHelp.setModel(new JSONModel({ items: [] }), "orderDetailsVH");
        this._oLoadingRefDocValueHelp.bindAggregation("items", {
            path: "orderDetailsVH>/items",
            template: new StandardListItem({
                title: "{orderDetailsVH>DocumentNumber}",
                description: "{orderDetailsVH>Name}",
                info: "{orderDetailsVH>DocType}"
            })
        });

        this.getView().addDependent(this._oLoadingRefDocValueHelp);
    },

    _onLoadingRefDocValueHelpSearch: function (oEvent) {
        var sValue = oEvent.getParameter("value") || "";
        var oBinding = oEvent.getSource().getBinding("items");

        if (!oBinding) {
            return;
        }

        var aFilters = [];
        if (sValue) {
            aFilters.push(new Filter({
                filters: [
                    new Filter("DocumentNumber", FilterOperator.Contains, sValue),
                    new Filter("DocType", FilterOperator.Contains, sValue),
                    new Filter("Name", FilterOperator.Contains, sValue)
                ],
                and: false
            }));
        }

        oBinding.filter(aFilters);
    },

    _onLoadingRefDocValueHelpConfirm: function (oEvent) {
        var oCtx = oEvent.getParameter("selectedContexts")?.[0];
        if (oCtx) {
            var oDoc = oCtx.getObject();
            this.byId("idDialogRefDocNo")?.setValue(oDoc.DocumentNumber || "");
            // Fetch ItemDetails for the selected reference document
            this._fetchItemDetailsForLoading(oDoc.DocumentNumber, oDoc.DocType);
        }
        this._resetLoadingRefDocValueHelpFilters();
    },

    _onLoadingRefDocValueHelpCancel: function () {
        this._resetLoadingRefDocValueHelpFilters();
    },

    _resetLoadingRefDocValueHelpFilters: function () {
        if (this._oLoadingRefDocValueHelp) {
            var oBinding = this._oLoadingRefDocValueHelp.getBinding("items");
            oBinding?.filter([]);
        }
    },

    onLoadingRefDocNoSuggestionSelected: function (oEvent) {
        var oItem = oEvent.getParameter("selectedItem");
        var oCtx = oItem?.getBindingContext("refDocSuggestions");
        if (oCtx) {
            var oDoc = oCtx.getObject();
            this.byId("idDialogRefDocNo")?.setValue(oDoc.DocumentNumber || "");
            this._fetchItemDetailsForLoading(oDoc.DocumentNumber, oDoc.DocType);
        }
    },

    onLoadingRefDocNoChange: function (oEvent) {
        var sRefDocNo = oEvent.getParameter("value") || "";
        if (!sRefDocNo) {
            return;
        }

        // Try to find the doc type from TripData
        var oTripData = sap.ui.getCore().getModel("TripData");
        if (oTripData) {
            var aOrderDetails = this._extractResults(oTripData.getProperty("/OrderDetails")) || [];
            var oFoundDoc = aOrderDetails.find(function (oDoc) {
                return oDoc.DocumentNumber === sRefDocNo && !oDoc.Deleted;
            });
            if (oFoundDoc) {
                this._fetchItemDetailsForLoading(sRefDocNo, oFoundDoc.DocType);
            }
        }
    },

    _fetchItemDetailsForLoading: function (sRefDocNo, sDocType) {
        if (!sRefDocNo || !sDocType) {
            return;
        }

        var oGlobalModel = sap.ui.getCore().getModel("globalData");
        var sTripNumber = oGlobalModel?.getProperty("/TripNumber") || "";

        if (!sTripNumber) {
            return;
        }

        var aFilters = [
            new Filter("TripNumber", FilterOperator.EQ, sTripNumber),
            new Filter("DocType", FilterOperator.EQ, sDocType),
            new Filter("RefDocNo", FilterOperator.EQ, sRefDocNo),
            new Filter("IsDeleted", FilterOperator.NE, "X")
        ];

        this.oModel.read("/ItemDetails", {
            filters: aFilters,
            success: function (oData) {
                var aItems = oData.results || [];
                // Update material suggestions
                this._oMaterialSuggestionsModel.setProperty("/items", aItems);

                if (aItems.length === 1) {
                    // Auto-populate if single item
                    this._populateLoadingFieldsFromItem(aItems[0]);
                } else if (aItems.length > 1) {
                    // Show value help if multiple items
                    this._showLoadingItemDetailsValueHelp(aItems);
                }
            }.bind(this),
            error: function () {
                // Silently fail
            }
        });
    },

    _populateLoadingFieldsFromItem: function (oItem) {
        if (!oItem) {
            return;
        }

        this.byId("idDialogRefDocItem")?.setValue(oItem.RefDocItemNo || "");
        this.byId("idDialogMaterialCode")?.setValue(oItem.MaterialCode || "");
        this.byId("idDialogMaterialDesc")?.setValue(oItem.MaterialDescription || "");
        var vQty = oItem.Quantity;
        var sQty = (vQty === null || vQty === undefined) ? "" : String(vQty);
        this.byId("idDialogQty")?.setValue(sQty);
        // Set UoM in Select
        var oUoM = this.byId("idDialogUoM");
        if (oUoM && oItem.UoM) {
            oUoM.setSelectedKey(oItem.UoM);
        }
    },

    _showLoadingItemDetailsValueHelp: function (aItems) {
        if (!this._oLoadingItemDetailsValueHelp) {
            this._createLoadingItemDetailsValueHelpDialog();
        }

        var oModel = this._oLoadingItemDetailsValueHelp.getModel("itemDetailsVH");
        oModel.setProperty("/items", aItems || []);
        this._resetLoadingItemDetailsValueHelpFilters();
        this._oLoadingItemDetailsValueHelp.open();
    },

    _createLoadingItemDetailsValueHelpDialog: function () {
        this._oLoadingItemDetailsValueHelp = new SelectDialog({
            title: "Select Material Item",
            search: this._onLoadingItemDetailsValueHelpSearch.bind(this),
            liveChange: this._onLoadingItemDetailsValueHelpSearch.bind(this),
            confirm: this._onLoadingItemDetailsValueHelpConfirm.bind(this),
            cancel: this._onLoadingItemDetailsValueHelpCancel.bind(this)
        });

        this._oLoadingItemDetailsValueHelp.setModel(new JSONModel({ items: [] }), "itemDetailsVH");
        this._oLoadingItemDetailsValueHelp.bindAggregation("items", {
            path: "itemDetailsVH>/items",
            template: new StandardListItem({
                title: "{itemDetailsVH>MaterialCode}",
                description: "{itemDetailsVH>MaterialDescription}",
                info: "{itemDetailsVH>RefDocItemNo}"
            })
        });

        this.getView().addDependent(this._oLoadingItemDetailsValueHelp);
    },

    _onLoadingItemDetailsValueHelpSearch: function (oEvent) {
        var sValue = oEvent.getParameter("value") || "";
        var oBinding = oEvent.getSource().getBinding("items");

        if (!oBinding) {
            return;
        }

        var aFilters = [];
        if (sValue) {
            aFilters.push(new Filter({
                filters: [
                    new Filter("MaterialCode", FilterOperator.Contains, sValue),
                    new Filter("MaterialDescription", FilterOperator.Contains, sValue),
                    new Filter("RefDocItemNo", FilterOperator.Contains, sValue)
                ],
                and: false
            }));
        }

        oBinding.filter(aFilters);
    },

    _onLoadingItemDetailsValueHelpConfirm: function (oEvent) {
        var oCtx = oEvent.getParameter("selectedContexts")?.[0];
        if (oCtx) {
            this._populateLoadingFieldsFromItem(oCtx.getObject());
        }
        this._resetLoadingItemDetailsValueHelpFilters();
    },

    _onLoadingItemDetailsValueHelpCancel: function () {
        this._resetLoadingItemDetailsValueHelpFilters();
    },

    _resetLoadingItemDetailsValueHelpFilters: function () {
        if (this._oLoadingItemDetailsValueHelp) {
            var oBinding = this._oLoadingItemDetailsValueHelp.getBinding("items");
            oBinding?.filter([]);
        }
    },

    // =====================================================================
    // VALUE HELP FOR MATERIAL CODE
    // =====================================================================
    onLoadingMaterialCodeValueHelp: function () {
        // Show materials from current suggestions (already loaded from Ref Doc selection)
        var aItems = this._oMaterialSuggestionsModel.getProperty("/items") || [];
        if (aItems.length === 0) {
            MessageToast.show("Please select a Reference Document first");
            return;
        }

        this._showLoadingItemDetailsValueHelp(aItems);
    },

    onLoadingMaterialCodeSuggestionSelected: function (oEvent) {
        var oItem = oEvent.getParameter("selectedItem");
        var oCtx = oItem?.getBindingContext("materialSuggestions");
        if (oCtx) {
            this._populateLoadingFieldsFromItem(oCtx.getObject());
        }
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
        
        var oLoadingModel = this.getView().getModel("loadingModel");
        if (oLoadingModel) {
            oLoadingModel.setProperty("/weighmentEnabled", bEnabled);
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
    // HELPER METHODS
    // =====================================================================
    _escapeODataValue: function (sValue) {
        // Escape single quotes in OData string values
        return (sValue || "").replace(/'/g, "''");
    },

    // =====================================================================
    // COLUMN VISIBILITY FUNCTIONS
    // =====================================================================
    _initializeLoadingColumnVisibility: function () {
        // Initialize Loading column settings
        var aLoadingColumns = [
            { id: "colLoadingRefDocNumber", label: "Ref Doc Number", visible: true },
            { id: "colLoadingRefDocItemNumber", label: "Ref Doc Item Number", visible: true },
            { id: "colLoadingMaterialCode", label: "Material Code", visible: true },
            { id: "colLoadingMaterialDescription", label: "Material Description", visible: true },
            { id: "colLoadingQty", label: "Qty", visible: true },
            { id: "colLoadingUoM", label: "UoM", visible: true },
            { id: "colLoadingLoadedQty", label: "Loaded Qty / Net Wt", visible: true },
            { id: "colLoadingGrossWt", label: "Gross Wt", visible: true },
            { id: "colLoadingTareWt", label: "Tare Wt", visible: true },
            { id: "colLoadingNetWt", label: "Net Wt", visible: true },
            { id: "colLoadingCreatedBy", label: "Created By", visible: false },
            { id: "colLoadingCreatedOnDate", label: "Created On Date", visible: false },
            { id: "colLoadingCreatedOnTime", label: "Created On Time", visible: false }
        ];

        // Create model for column settings
        this._oLoadingColumnSettingsModel = new JSONModel({
            columns: aLoadingColumns
        });
        this.getView().setModel(this._oLoadingColumnSettingsModel, "loadingColumnSettings");

        // Apply initial column visibility
        this._applyLoadingColumnVisibility();
    },

    _applyLoadingColumnVisibility: function () {
        var oTable = this.byId("idLoadingMaterialTable");
        if (!oTable) {
            return;
        }

        var aColumns = this._oLoadingColumnSettingsModel.getProperty("/columns");
        aColumns.forEach(function (oColumn) {
            var oCol = this.byId(oColumn.id);
            if (oCol) {
                oCol.setVisible(oColumn.visible);
            }
        }.bind(this));
    },

    onLoadingColumnSettings: function () {
        if (!this._oLoadingColumnVisibilityDialog) {
            this._oLoadingColumnVisibilityDialog = Fragment.load({
                id: this.getView().getId(),
                name: "com.incresolZ_INC_PLMS.fragments.VehicleLoadingFrags.LoadingColumnVisibilityDialog",
                controller: this
            }).then(function (oDialog) {
                this.getView().addDependent(oDialog);
                return oDialog;
            }.bind(this));
        }

        this._oLoadingColumnVisibilityDialog.then(function (oDialog) {
            oDialog.open();
        });
    },

    onLoadingColumnSwitchChanged: function (oEvent) {
        var oSwitch = oEvent.getSource();
        var oBindingContext = oSwitch.getBindingContext("loadingColumnSettings");
        if (oBindingContext) {
            var oColumn = oBindingContext.getObject();
            oColumn.visible = oSwitch.getState();
            this._applyLoadingColumnVisibility();
        }
    },

    onResetLoadingColumnVisibility: function () {
        var aDefaultColumns = [
            { id: "colLoadingRefDocNumber", label: "Ref Doc Number", visible: true },
            { id: "colLoadingRefDocItemNumber", label: "Ref Doc Item Number", visible: true },
            { id: "colLoadingMaterialCode", label: "Material Code", visible: true },
            { id: "colLoadingMaterialDescription", label: "Material Description", visible: true },
            { id: "colLoadingQty", label: "Qty", visible: true },
            { id: "colLoadingUoM", label: "UoM", visible: true },
            { id: "colLoadingLoadedQty", label: "Loaded Qty / Net Wt", visible: true },
            { id: "colLoadingGrossWt", label: "Gross Wt", visible: true },
            { id: "colLoadingTareWt", label: "Tare Wt", visible: true },
            { id: "colLoadingNetWt", label: "Net Wt", visible: true },
            { id: "colLoadingCreatedBy", label: "Created By", visible: false },
            { id: "colLoadingCreatedOnDate", label: "Created On Date", visible: false },
            { id: "colLoadingCreatedOnTime", label: "Created On Time", visible: false }
        ];

        this._oLoadingColumnSettingsModel.setProperty("/columns", aDefaultColumns);
        this._applyLoadingColumnVisibility();
    },

    onCloseLoadingColumnVisibilityDialog: function () {
        if (this._oLoadingColumnVisibilityDialog) {
            this._oLoadingColumnVisibilityDialog.then(function (oDialog) {
                oDialog.close();
            });
        }
    }
});
});
