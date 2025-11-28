sap.ui.define(
[
    "sap/ui/core/mvc/Controller",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/odata/v2/ODataModel",
    "sap/ui/core/Fragment"
],
function (
    Controller,
    MessageToast,
    MessageBox,
    JSONModel,
    ODataModel,
    Fragment
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
        this._eventBus = sap.ui.getCore().getEventBus();
        this._eventBus.subscribe("TripData", "Updated", this._bindMaterialsFromTrip, this);
        this._bindMaterialsFromTrip();
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

        if (!this._oAddRowDialog) {

            Fragment.load({
                id: this.getView().getId(),     // important!
                name: "com.incresolZ_INC_PLMS.fragments.VehicleLoadingFrags.AddRowDialog",
                controller: this
            }).then(function (oDialog) {

                this._oAddRowDialog = oDialog;
                this.getView().addDependent(oDialog);
                oDialog.open();

            }.bind(this));

        } else {
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
    }
});
});
