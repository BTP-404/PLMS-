sap.ui.define(
  [
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/odata/v2/ODataModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/ui/model/json/JSONModel",
    "sap/ui/core/Fragment",
  ],
  function (
    Controller,
    ODataModel,
    MessageToast,
    MessageBox,
    JSONModel,
    Fragment
  ) {
    "use strict";

    return Controller.extend(
      "com.incresolZ_INC_PLMS.controller.subview.GateOut",
      {
        onInit: function () {
          this.oModel = new ODataModel("/sap/opu/odata/sap/YIGP_PLMS_SRV/", {
            useBatch: false,
            defaultBindingMode: "TwoWay",
          });
          this.getView().setModel(this.oModel);
        },
        onAfterRendering: function () {
          this.loadExitGateNumber();
          var oParentView = this.getView().getParent();
          this.tripNumber =
            oParentView.getModel("shared").getProperty("/tripNumber") ||
            "0000000014";
          console.log("Received Trip Number: ", this.tripNumber);
        },
        loadExitGateNumber: function () {
          this.oModel.read("/ConfigValues", {
            filters: [
              new sap.ui.model.Filter(
                "ConfigGroup",
                sap.ui.model.FilterOperator.EQ,
                "ExitGate"
              ),
            ],
            success: function (oData) {
              console.log("Exit Gate", oData.results);
              this._ExitGateData = oData.results;
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
          var sValue = oEvent.getParameter("value");
          var oBinding = oEvent.getSource().getBinding("items");

          var aFilters = [
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
          ];

          oBinding.filter(
            new sap.ui.model.Filter({
              filters: aFilters,
              and: false,
            })
          );
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
          var sQuery = oEvent.getParameter("value");

          var oFilter = new sap.ui.model.Filter({
            filters: [
              new sap.ui.model.Filter(
                "ConfigID",
                sap.ui.model.FilterOperator.Contains,
                sQuery
              ),
              new sap.ui.model.Filter(
                "Description",
                sap.ui.model.FilterOperator.Contains,
                sQuery
              ),
            ],
            and: false,
          });

          oEvent.getSource().getBinding("items").filter(oFilter);
        },
        onSaveGateOut: function () {
          // Use the ODataModel created in onInit()
          var oModel = this.oModel;

          if (!oModel) {
            console.error("OData model not loaded");
            MessageBox.error("OData model is not loaded.");
            return;
          }

          var oView = this.getView();

          var sExitGateNumber = oView.byId("idExitGateNumber").getValue();
          var sRemarks = oView.byId("idGateOutRemarks").getValue();

          // Extract "Verified Documents" (RadioButtonGroup)
          // selectedIndex: 0 = Yes, 1 = No
          var oRBGroup = oView.byId("idVerifiedDocs");
          var bVerifiedDocs = oRBGroup.getSelectedIndex() === 0;

          // Global trip number
          var sTripNumber = sap.ui
            .getCore()
            .getModel("globalData")
            .getProperty("/TripNumber");

          // Function Import POST: GateOut
          oModel.callFunction("/GateOut", {
            method: "POST",
            urlParameters: {
              TripNumber: sTripNumber,
              ExitGateNumber: sExitGateNumber,
              VerifiedDocuments: bVerifiedDocs,
              Remarks: sRemarks,
            },
            headers: {
              "X-Requested-With": "X",
            },
            success: function (oData, response) {
              MessageBox.success("Gate Out information saved successfully!");
              console.log("GateOut Response:", oData);
            },
            error: function (oError) {
              console.error("GateOut Error:", oError);

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
                console.warn("Failed to parse OData error:", e);
              }

              MessageBox.error(sErrorMessage);
            },
          });
        },
      }
    );
  }
);
