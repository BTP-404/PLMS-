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
                    oView.setModel(new JSONModel(oData.results), "ItemDetailsModel");
                }
            },
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
    }
});
});
