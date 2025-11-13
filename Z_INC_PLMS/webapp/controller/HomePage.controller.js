sap.ui.define([
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/odata/v2/ODataModel",
    "sap/m/MessageToast",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/SelectDialog",
    "sap/m/StandardListItem",
    "sap/m/SuggestionItem"
], function (Controller, ODataModel, MessageToast, Filter, FilterOperator, SelectDialog, StandardListItem, SuggestionItem) {
    "use strict";

    return Controller.extend("com.incresolZ_INC_PLMS.controller.HomePage", {

        onInit: function () {
            var serviceUrl = "/sap/opu/odata/sap/YIGP_PLMS_SRV/";
            var oModel = new ODataModel(serviceUrl, {
                useBatch: false,
                defaultBindingMode: "TwoWay"
            });
            this.getView().setModel(oModel);
        },

        onReportVehicle: function () {
             this.getOwnerComponent().getRouter().navTo("RouteStage");
            // this.getOwnerComponent().getRouter().navTo("RouteStage", { tripNo:"NA" });
        },

        onTripPress: function (oEvent) {
            var TripNumber = oEvent.getParameter("listItem").getBindingContext().getObject().TripNumber;
            
            this.getOwnerComponent().getRouter().navTo("RouteStagePara", { tripNo:TripNumber });
        },

        onRefresh: function () {
            var oTable = this.getView().byId("tripTable");
            var oModel = this.getView().getModel();

            if (oModel) {
                oTable.setBusy(true);
                oModel.refresh(true);
                oModel.attachRequestCompleted(() => {
                    oTable.setBusy(false);
                    MessageToast.show("Trip details refreshed");
                });
            }
        },

        // --------------------------------------------------------------------
        // Value Help
        // --------------------------------------------------------------------
        onValueHelpRequest: function (oEvent) {
            var oInput = oEvent.getSource();
            var sField = oInput.data("field");
            var oModel = this.getView().getModel();
            var oFieldConfig = this._getFieldConfiguration(sField);
            if (!oFieldConfig) return;

            var { sKeyField, sDescField, sTitle } = oFieldConfig;

            var oSelectDialog = new SelectDialog({
                title: sTitle,
                liveChange: function (oEvt) {
                    var sValue = oEvt.getParameter("value");
                    var aFilters = sValue ? [
                        new Filter([
                            new Filter(sKeyField, FilterOperator.Contains, sValue),
                            new Filter(sDescField, FilterOperator.Contains, sValue)
                        ], false)
                    ] : [];
                    oEvt.getSource().getBinding("items").filter(aFilters);
                },
                confirm: function (oEvt) {
                    var oSelectedItem = oEvt.getParameter("selectedItem");
                    if (oSelectedItem) {
                        oInput.setValue(oSelectedItem.getTitle());
                        this.onFilterChange(); //  Filter table after value help selection
                    }
                }.bind(this)
            });

            oSelectDialog.setModel(oModel);
            oSelectDialog.bindAggregation("items", {
                path: "/TripDetails",
                template: new StandardListItem({
                    title: "{" + sKeyField + "}",
                    description: "{" + sDescField + "}"
                })
            });
            oSelectDialog.open();
        },

        // --------------------------------------------------------------------
        // Live Suggestion
        // --------------------------------------------------------------------
        onSuggest: function (oEvent) {
            var oInput = oEvent.getSource();
            var sField = oInput.data("field");
            var sValue = oEvent.getParameter("suggestValue");
            var oModel = this.getView().getModel();
            var oFieldConfig = this._getFieldConfiguration(sField);
            if (!oFieldConfig) return;
            var { sKeyField, sDescField } = oFieldConfig;

            var aFilters = sValue ? [
                new Filter([
                    new Filter(sKeyField, FilterOperator.Contains, sValue),
                    new Filter(sDescField, FilterOperator.Contains, sValue)
                ], false)
            ] : [];

            oModel.read("/TripDetails", {
                filters: aFilters,
                success: function (oData) {
                    oInput.destroySuggestionItems();
                    (oData.results || []).forEach(function (item) {
                        oInput.addSuggestionItem(new SuggestionItem({
                            key: item[sKeyField],
                            text: item[sKeyField],
                            description: item[sDescField]
                        }));
                    });
                    this.onFilterChange(); //  Live filter as user types
                }.bind(this)
            });
        },

        // --------------------------------------------------------------------
        // Table Filtering Logic
        // --------------------------------------------------------------------
        onFilterChange: function () {
            var oView = this.getView();
            var oTable = oView.byId("tripTable");
            var aFilters = [];

            var mFields = {
                tripNo: "TripNumber",
                vehicleNumber: "VehicleNumber",
                vehicleType: "VehicleType",
                transporterName: "TransporterName",
                lrNumber: "LR_Number",
                plant: "Plant",
                companyCode: "CompanyCode"
            };

            Object.entries(mFields).forEach(([key, field]) => {
                var oInput = oView.findElements(true).find(e => e.data && e.data("field") === key);
                if (oInput && oInput.getValue()) {
                    aFilters.push(new Filter(field, FilterOperator.Contains, oInput.getValue()));
                }
            });

            var oBinding = oTable.getBinding("items");
            if (oBinding) oBinding.filter(aFilters);
        },

        // --------------------------------------------------------------------
        // Config Map
        // --------------------------------------------------------------------
        _getFieldConfiguration: function (sField) {
            switch (sField) {
                case "tripNo": return { sKeyField: "TripNumber", sDescField: "VehicleNumber", sTitle: "Select Trip Number" };
                case "vehicleNumber": return { sKeyField: "VehicleNumber", sDescField: "VehicleType", sTitle: "Select Vehicle Number" };
                case "vehicleType": return { sKeyField: "VehicleType", sDescField: "VehicleSize", sTitle: "Select Vehicle Type" };
                case "transporterName": return { sKeyField: "TransporterName", sDescField: "DriverName", sTitle: "Select Transporter" };
                case "lrNumber": return { sKeyField: "LR_Number", sDescField: "TripNumber", sTitle: "Select LR Number" };
                case "plant": return { sKeyField: "Plant", sDescField: "CompanyCode", sTitle: "Select Plant" };
                case "companyCode": return { sKeyField: "CompanyCode", sDescField: "Plant", sTitle: "Select Company Code" };
                default: return null;
            }
        }

    });
});
