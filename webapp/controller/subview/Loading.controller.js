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
        this._eventBus.subscribe("Stage", "ClearAllTabs", this._clearAllData, this);
        
        // Check initial weighment required state
        this._updateWeighmentEnabledState();
        
        // Initial load - wait a bit to ensure refDocModel is available
        setTimeout(function() {
            this._bindMaterialsFromRefDocs();
        }.bind(this), 100);
        
        // Initialize column visibility
        this._initializeLoadingColumnVisibility();
        
        // Initialize button states based on TripDetails
        this._updateLoadingButtonStates();
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
        this._eventBus?.unsubscribe("Stage", "ClearAllTabs", this._clearAllData, this);
        this._oLoadingColumnVisibilityDialog?.destroy();
    },
    
    _clearAllData: function () {
        // Clear table model
        var oTableModel = this.getView().getModel("tableModel");
        if (oTableModel) {
            oTableModel.setData({ materials: [] });
        }
        
        // Clear loading model
        var oLoadingModel = this.getView().getModel("loadingModel");
        if (oLoadingModel) {
            oLoadingModel.setData({ weighmentEnabled: false });
        }
        
        // Clear suggestion models
        if (this._oRefDocSuggestionsModel) {
            this._oRefDocSuggestionsModel.setData({ items: [] });
        }
        if (this._oMaterialSuggestionsModel) {
            this._oMaterialSuggestionsModel.setData({ items: [] });
        }
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
        this._updateLoadingButtonStates();
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
                
                // Reload TripData to get updated status fields
                this._reloadTripDataAndUpdateButtons();
                
                // Update weighment enabled state to ensure weight fields are enabled if weighment is required
                this._updateWeighmentEnabledState();
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
                    // Error parsing response
                }

                MessageBox.error(sMessage);

                // Reload TripData to restore correct button states
                this._reloadTripDataAndUpdateButtons();
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
                
                // Reload TripData to get updated status fields
                this._reloadTripDataAndUpdateButtons();
            }.bind(this),
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
                    // Error parsing response
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
    _bindMaterialsFromRefDocs: function (bForceFromTripData) {
        // Always prefer TripData ItemDetails for Loading view (has weight data)
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
        var oTable = this.byId("idLoadingMaterialTable");
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
        // Map from Reference Documents material format to Loading table format
        // Also handle ItemDetails format from StartLoading response (uppercase properties)
        // Backend API returns: GrossWeight, TareWeight, NetWeight, LoadedWeight
        // Frontend model uses: GrossWt, TareWt, NetWt, LoadedWeight
        
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
        
        var sLoadedWeight = "";
        if (oMaterial.LoadedWeight !== null && oMaterial.LoadedWeight !== undefined) {
            sLoadedWeight = fnCleanWeight(oMaterial.LoadedWeight);
        } else if (oMaterial.LoadedQty !== null && oMaterial.LoadedQty !== undefined) {
            sLoadedWeight = fnCleanWeight(oMaterial.LoadedQty);
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
        
        // Convert weight values to strings for display, preserving decimal places
        sGrossWt = sGrossWt ? String(sGrossWt) : "";
        sTareWt = sTareWt ? String(sTareWt) : "";
        sNetWt = sNetWt ? String(sNetWt) : "";
        sLoadedWeight = sLoadedWeight ? String(sLoadedWeight) : "";
        
        return {
            DocType: oMaterial.DocType || oMaterial.docType || "",
            TripNumber: oMaterial.TripNumber || oMaterial.tripNumber || "",
            RefDocNumber: oMaterial.RefDocNo || oMaterial.refDocNo || "",
            RefDocItemNumber: oMaterial.RefDocItemNo || oMaterial.refDocItemNo || "",
            MaterialCode: oMaterial.MaterialCode || oMaterial.materialCode || "",
            MaterialDescription: oMaterial.MaterialDescription || oMaterial.materialDescription || "",
            Qty: oMaterial.Quantity || oMaterial.qty || "",
            UoM: oMaterial.UoM || oMaterial.uom || "",
            LoadedWeight: sLoadedWeight,
            GrossWt: sGrossWt, // Map from backend GrossWeight to frontend GrossWt
            TareWt: sTareWt, // Map from backend TareWeight to frontend TareWt
            NetWt: sNetWt, // Map from backend NetWeight to frontend NetWt (or calculate if missing)
            Remark: oMaterial.Remark || oMaterial.remark || "",
            CreatedBy: oMaterial.CreatedBy || oMaterial.createdBy || "",
            CreatedOnDate: oMaterial.CreatedOnDate || oMaterial.createdOnDate || "",
            CreatedOnTime: oMaterial.CreatedOnTime || oMaterial.createdOnTime || ""
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
            var sLowerValue = sValue.toLowerCase();
            aFilters.push(new Filter({
                filters: [
                    new Filter({
                        path: "DocumentNumber",
                        operator: function(sDocNum) {
                            return sDocNum && sDocNum.toString().toLowerCase().indexOf(sLowerValue) !== -1;
                        }
                    }),
                    new Filter({
                        path: "DocType",
                        operator: function(sDocType) {
                            return sDocType && sDocType.toString().toLowerCase().indexOf(sLowerValue) !== -1;
                        }
                    }),
                    new Filter({
                        path: "Name",
                        operator: function(sName) {
                            return sName && sName.toString().toLowerCase().indexOf(sLowerValue) !== -1;
                        }
                    })
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
            var sLowerValue = sValue.toLowerCase();
            aFilters.push(new Filter({
                filters: [
                    new Filter({
                        path: "MaterialCode",
                        operator: function(sMatCode) {
                            return sMatCode && sMatCode.toString().toLowerCase().indexOf(sLowerValue) !== -1;
                        }
                    }),
                    new Filter({
                        path: "MaterialDescription",
                        operator: function(sMatDesc) {
                            return sMatDesc && sMatDesc.toString().toLowerCase().indexOf(sLowerValue) !== -1;
                        }
                    }),
                    new Filter({
                        path: "RefDocItemNo",
                        operator: function(sRefDocItemNo) {
                            return sRefDocItemNo && sRefDocItemNo.toString().toLowerCase().indexOf(sLowerValue) !== -1;
                        }
                    })
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
        
        // Zero validation - prevent zero values
        if (sValue !== "" && sValue !== null && sValue !== undefined) {
            var fValue = parseFloat(sValue);
            if (!isNaN(fValue) && fValue === 0) {
                oInput.setValueState("Error");
                oInput.setValueStateText("Weight cannot be zero");
                return;
            } else {
                oInput.setValueState("None");
                oInput.setValueStateText("");
            }
        }
        
        var oMaterial = oBindingContext.getObject();
        var sGrossWt = oMaterial.GrossWt || "";
        var sTareWt = oMaterial.TareWt || "";
        
        // Calculate Net Wt = Gross Wt - Tare Wt
        if (sGrossWt && sTareWt) {
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
        var oView = this.getView();
        oView.setBusy(true);
        
        this._updateAllItemDetailsWithWeights().then(function() {
            oView.setBusy(false);
        }.bind(this)).catch(function(oError) {
            oView.setBusy(false);
        });
    },
    
    // =====================================================================
    // UPDATE ALL ITEMDETAILS WITH WEIGHT FIELDS
    // =====================================================================
    _updateAllItemDetailsWithWeights: function () {
        var oTableModel = this.getView().getModel("tableModel");
        if (!oTableModel) {
            return;
        }
        
        var aMaterials = oTableModel.getProperty("/materials") || [];
        var sTripNumber = sap.ui.getCore().getModel("globalData")?.getProperty("/TripNumber");
        
        if (!sTripNumber || aMaterials.length === 0) {
            return;
        }
        
        // Update each material that has weight values
        var aUpdatePromises = [];
        var iTotalUpdates = 0;
        aMaterials.forEach(function (oMaterial) {
            // Check if material has weight values or remark to update
            var sGrossWt = oMaterial.GrossWt || "";
            var sTareWt = oMaterial.TareWt || "";
            var sLoadedWeight = oMaterial.LoadedWeight || "";
            var sNetWt = oMaterial.NetWt || "";
            var sRemark = oMaterial.Remark || "";
            
            // Update if at least one weight field or remark has a value
            if (sGrossWt || sTareWt || sLoadedWeight || sNetWt || sRemark) {
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
                    MessageToast.show("Weight fields updated successfully");
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
        
        // If DocType is missing, get it from TripData ItemDetails using RefDocNo and RefDocItemNo
        if (!sDocType && sRefDocNo && sRefDocItemNo) {
            var oTripData = sap.ui.getCore().getModel("TripData");
            if (oTripData) {
                var aItemDetails = this._extractResults(oTripData.getProperty("/ItemDetails")) || [];
                var oFoundItem = aItemDetails.find(function(oItem) {
                    return (oItem.RefDocNo === sRefDocNo || oItem.RefDocNo === oMaterial.RefDocNumber) && 
                           (oItem.RefDocItemNo === sRefDocItemNo || oItem.RefDocItemNo === oMaterial.RefDocItemNumber);
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
                    return (oMat.refDocNo === sRefDocNo || oMat.RefDocNo === sRefDocNo) && 
                           (oMat.refDocItemNo === sRefDocItemNo || oMat.RefDocItemNo === sRefDocItemNo);
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
        var oTripData = sap.ui.getCore().getModel("TripData");
        var oCurrentData = null;
        
        if (oTripData) {
            var aItemDetails = this._extractResults(oTripData.getProperty("/ItemDetails")) || [];
            oCurrentData = aItemDetails.find(function(oItem) {
                return oItem.DocType === sDocType &&
                       oItem.TripNumber === sTripNumber &&
                       oItem.RefDocNo === sRefDocNo &&
                       oItem.RefDocItemNo === sRefDocItemNo;
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
            IsSplitActive: (oCurrentData && oCurrentData.IsSplitActive !== undefined) ? oCurrentData.IsSplitActive : false
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
                // Add Loaded Weight to payload
                if (oMaterial.LoadedWeight) {
                    oUpdatePayload.LoadedWeight = String(parseFloat(oMaterial.LoadedWeight) || 0);
                }
                // Add Remarks to payload
                if (oMaterial.Remark !== undefined && oMaterial.Remark !== null) {
                    oUpdatePayload.Remarks = String(oMaterial.Remark || "");
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

    // =====================================================================
    // HELPER METHODS
    // =====================================================================
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
    _initializeLoadingColumnVisibility: function () {
        // Initialize Loading column settings
        var aLoadingColumns = [
            { id: "colLoadingRefDocNumber", label: "Ref Doc Number", visible: true },
            { id: "colLoadingRefDocItemNumber", label: "Ref Doc Item Number", visible: true },
            { id: "colLoadingMaterialCode", label: "Material Code", visible: true },
            { id: "colLoadingMaterialDescription", label: "Material Description", visible: true },
            { id: "colLoadingQty", label: "Qty", visible: true },
            { id: "colLoadingUoM", label: "UoM", visible: true },
            { id: "colLoadingLoadedWeight", label: "Loaded Weight / Net Wt", visible: true },
            { id: "colLoadingGrossWt", label: "Gross Wt", visible: true },
            { id: "colLoadingTareWt", label: "Tare Wt", visible: true },
            { id: "colLoadingNetWt", label: "Net Wt", visible: true },
            { id: "colLoadingRemark", label: "Remark", visible: true },
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
            { id: "colLoadingLoadedWeight", label: "Loaded Weight / Net Wt", visible: true },
            { id: "colLoadingGrossWt", label: "Gross Wt", visible: true },
            { id: "colLoadingTareWt", label: "Tare Wt", visible: true },
            { id: "colLoadingNetWt", label: "Net Wt", visible: true },
            { id: "colLoadingRemark", label: "Remark", visible: true },
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
    },

    // =====================================================================
    // UPDATE LOADING BUTTON STATES BASED ON TRIPDETAILS STATUS
    // =====================================================================
    _updateLoadingButtonStates: function () {
        var oTripData = sap.ui.getCore().getModel("TripData");
        var oView = this.getView();
        
        if (!oTripData || !oView) {
            return;
        }
        
        var sStartLoading = oTripData.getProperty("/Start_Loading") || "";
        var sEndLoading = oTripData.getProperty("/End_Loading") || "";
        
        var bStartStarted = (sStartLoading === "X" || sStartLoading === "x");
        var bEndCompleted = (sEndLoading === "X" || sEndLoading === "x");
        
        var oBtnStart = oView.byId("btnStartLoading");
        var oBtnEnd = oView.byId("btnEndLoading");
        
        if (!oBtnStart || !oBtnEnd) {
            return;
        }
        
        // Logic:
        // 1. If started but not completed: Start disabled, End enabled, button text = "Start Loading"
        // 2. If both started and completed: Start enabled, End enabled, button text = "Restart Loading"
        // 3. If neither started: Start enabled, End disabled, button text = "Start Loading"
        
        if (bStartStarted && !bEndCompleted) {
            // Started but not completed
            oBtnStart.setEnabled(false);
            oBtnStart.setText("Start Loading");
            oBtnEnd.setEnabled(true);
        } else if (bStartStarted && bEndCompleted) {
            // Both started and completed - change button text to "Restart Loading"
            oBtnStart.setEnabled(true);
            oBtnStart.setText("Restart Loading");
            oBtnEnd.setEnabled(true);
        } else {
            // Neither started (default)
            oBtnStart.setEnabled(true);
            oBtnStart.setText("Start Loading");
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
                "$expand": "OrderDetails,ItemDetails,Feeds"
            },
            success: function (oData) {
                var oTripDataModel = new sap.ui.model.json.JSONModel(oData);
                sap.ui.getCore().setModel(oTripDataModel, "TripData");
                this.getView().setModel(oTripDataModel, "TripData");
                
                // Refresh materials directly from TripData ItemDetails to show updated weights
                this._bindMaterialsFromRefDocs(true);
                
                // Update weighment enabled state
                this._updateWeighmentEnabledState();
                // Update button states based on TripDetails status
                this._updateLoadingButtonStates();
                
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
