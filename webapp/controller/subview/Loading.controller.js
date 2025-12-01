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

        var oTableModel = new JSONModel({ materials: [] });
        this.getView().byId("idLoadingMaterialTable").setModel(oTableModel);
        
        // Initialize suggestion models for value help
        this._initSuggestionModels();
        
        this._eventBus = sap.ui.getCore().getEventBus();
        this._eventBus.subscribe("TripData", "Updated", this._bindMaterialsFromTrip, this);
        this._bindMaterialsFromTrip();
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
        this._eventBus?.unsubscribe("TripData", "Updated", this._bindMaterialsFromTrip, this);
    },

    // =====================================================================
    // Start Loading
    // =====================================================================
    onStartLoading: function () {

        var oView = this.getView();
        var sTripNumber = sap.ui.getCore().getModel("globalData").getProperty("/TripNumber");

        oView.byId("btnStartLoading").setEnabled(false);
        oView.byId("btnEndLoading").setEnabled(true);
        oView.byId("btnAddRowLoading").setEnabled(true);

        oView.setBusy(true);

        this.oModel.callFunction("/StartLoading", {
            method: "POST",
            urlParameters: { TripNumber: sTripNumber },headers: {
              "X-Requested-With": "X",
            },
            success: function (oData) {
                oView.setBusy(false);
                MessageToast.show("Loading started successfully.");

                if (oData && oData.results) {
                    this._applyMaterials(oData.results);
                }
            }.bind(this),
            error: function (oError) {
                oView.setBusy(false);

                let sMessage = "Failed to Start Loading";

                try {
                    const oResponse = JSON.parse(oError.responseText);
                    if (oResponse.error?.message?.value) {
                        sMessage = oResponse.error.message.value;
                    }
                } catch (e) {}

                MessageBox.error(sMessage);

                oView.byId("btnStartLoading").setEnabled(true);
                oView.byId("btnEndLoading").setEnabled(false);
                oView.byId("btnAddRowLoading").setEnabled(false);
            }
        });
    },

    // =====================================================================
    // End Loading
    // =====================================================================
    onEndLoading: function () {

        var oView = this.getView();
        var sTripNumber = sap.ui.getCore().getModel("globalData").getProperty("/TripNumber");

        oView.byId("btnStartLoading").setEnabled(true);
        oView.byId("btnEndLoading").setEnabled(false);
        oView.byId("btnAddRowLoading").setEnabled(false);

        oView.setBusy(true);

        this.oModel.callFunction("/EndLoading", {
            method: "POST",headers: {
              "X-Requested-With": "X",
            },
            urlParameters: { TripNumber: sTripNumber },

            success: function () {
                oView.setBusy(false);
                MessageToast.show("Loading ended.");
            },

            error: function (oError) {
                oView.setBusy(false);

                let sMessage = "Failed to end loading";

                try {
                    const oResponse = JSON.parse(oError.responseText);
                    if (oResponse.error?.message?.value) {
                        sMessage = oResponse.error.message.value;
                    }
                } catch (e) {}

                MessageBox.error(sMessage);

                oView.byId("btnStartLoading").setEnabled(true);
                oView.byId("btnEndLoading").setEnabled(false);
                oView.byId("btnAddRowLoading").setEnabled(false);
            }
        });
    },

    // =====================================================================
    // OPEN ADD ROW DIALOG
    // =====================================================================
    onOpenAddRowDialog: function () {
        // Ensure suggestion models are initialized
        this._initSuggestionModels();
        
        // Load reference documents from TripData
        var oTripData = sap.ui.getCore().getModel("TripData");
        if (oTripData) {
            var aOrderDetails = this._extractResults(oTripData.getProperty("/OrderDetails")) || [];
            var aFilteredDocs = aOrderDetails.filter(function (oDoc) {
                return !oDoc.Deleted;
            });
            this._oRefDocSuggestionsModel.setProperty("/items", aFilteredDocs);
        }

        if (!this._oAddRowDialog) {
            Fragment.load({
                id: this.getView().getId(),     // important!
                name: "com.incresolZ_INC_PLMS.fragments.VehicleLoadingFrags.AddRowDialog",
                controller: this
            }).then(function (oDialog) {
                this._oAddRowDialog = oDialog;
                this.getView().addDependent(oDialog);
                // Set models on dialog
                oDialog.setModel(this._oRefDocSuggestionsModel, "refDocSuggestions");
                oDialog.setModel(this._oMaterialSuggestionsModel, "materialSuggestions");
                oDialog.open();
            }.bind(this));
        } else {
            // Update models when reopening
            this._oAddRowDialog.setModel(this._oRefDocSuggestionsModel, "refDocSuggestions");
            this._oAddRowDialog.setModel(this._oMaterialSuggestionsModel, "materialSuggestions");
            this._oAddRowDialog.open();
        }
    },

    // =====================================================================
    // SAVE BUTTON → Add Row
    // =====================================================================
    onAddRow: function () {
        this._onAddRow();
    },

    _onAddRow: function () {

        var oTable = this.byId("idLoadingMaterialTable");
        var oModel = oTable.getModel();
        var aData = oModel.getProperty("/materials");

        // Read dialog controls safely
        var oUoM = this.byId("idDialogUoM");
        var oQty = this.byId("idDialogQty");

        if (!oUoM || !oQty) {
            MessageToast.show("Dialog not fully loaded yet.");
            return;
        }

        var newRow = {
            RefDocNumber: this.byId("idDialogRefDocNo").getValue(),
            RefDocItemNumber: this.byId("idDialogRefDocItem").getValue(),
            MaterialCode: this.byId("idDialogMaterialCode").getValue(),
            MaterialDescription: this.byId("idDialogMaterialDesc").getValue(),
            Qty: oQty.getValue(),
            UoM: oUoM.getSelectedKey(),
            LoadedQty: this.byId("idDialogLoadedQty").getValue(),
            GrossWt: this.byId("idDialogGrossWt").getValue(),
            TareWt: this.byId("idDialogTareWt").getValue()
        };

        aData.push(newRow);
        oModel.setProperty("/materials", aData);

        this._oAddRowDialog.close();
        MessageToast.show("Row added successfully!");
        this._resetDialogFields();
    },

    // =====================================================================
    // CANCEL ADD ROW
    // =====================================================================
    onCancelAddRow: function () {
        this._oAddRowDialog.close();
        this._resetDialogFields();
    },

    // =====================================================================
    // RESET DIALOG FIELDS
    // =====================================================================
    _resetDialogFields: function () {

        [
            "idDialogRefDocNo",
            "idDialogRefDocItem",
            "idDialogMaterialCode",
            "idDialogMaterialDesc",
            "idDialogQty",
            "idDialogLoadedQty",
            "idDialogGrossWt",
            "idDialogTareWt"
        ].forEach(id => this.byId(id)?.setValue(""));

        this.byId("idDialogUoM")?.setSelectedKey("");
    },

    // =====================================================================
    // DELETE ROW
    // =====================================================================
    onDeleteLoadingRow: function (oEvent) {

        var oTable = this.byId("idLoadingMaterialTable");
        var oModel = oTable.getModel();
        var aData = oModel.getProperty("/materials");

        var iIndex = oTable.indexOfItem(oEvent.getSource().getParent());

        aData.splice(iIndex, 1);
        oModel.setProperty("/materials", aData);

        MessageToast.show("Row deleted successfully!");
    },

    _bindMaterialsFromTrip: function () {
        var oTripData = sap.ui.getCore().getModel("TripData");
        if (!oTripData) {
            return;
        }
        var aItems = this._extractResults(oTripData.getProperty("/ItemDetails"));
        if (aItems) {
            this._applyMaterials(aItems);
        }
    },

    _applyMaterials: function (aItems) {
        var oTable = this.byId("idLoadingMaterialTable");
        var oModel = oTable.getModel();
        if (!oModel) {
            oModel = new JSONModel({ materials: [] });
            oTable.setModel(oModel);
        }
        var aMapped = (aItems || []).map(this._mapItemDetail, this);
        oModel.setProperty("/materials", aMapped);
    },

    _mapItemDetail: function (oItem) {
        return {
            RefDocNumber: oItem.RefDocNo || oItem.RefDocNumber || "",
            RefDocItemNumber: oItem.RefDocItemNo || oItem.RefDocItemNumber || "",
            MaterialCode: oItem.MaterialCode || "",
            MaterialDescription: oItem.MaterialDescription || "",
            Qty: this._formatQuantity(oItem.Quantity),
            UoM: oItem.UoM || "",
            LoadedQty: oItem.LoadedQty || "",
            GrossWt: oItem.GrossWt || "",
            TareWt: oItem.TareWt || "",
            CreatedBy: oItem.CreatedBy || "",
            CreatedOnDate: this._formatODataDate(oItem.CreatedOn),
            CreatedOnTime: this._formatODataTime(oItem.CreatedTime)
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
    }
});
});
