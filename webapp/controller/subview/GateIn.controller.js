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

    var tripNumber;
    var sID;
    return Controller.extend(
      "com.incresolZ_INC_PLMS.controller.subview.GateIn",
      {
        onInit: function () {
          this.oModel = new ODataModel("/sap/opu/odata/sap/YIGP_PLMS_SRV/", {
            useBatch: false,
            defaultBindingMode: "TwoWay",
          });
          this.getView().setModel(this.oModel);
          this._eventBus = sap.ui.getCore().getEventBus();
          this._eventBus.subscribe("TripData", "Updated", this._onTripDataUpdate, this);
          this._onTripDataUpdate();
        },
        onAfterRendering: function () {
          this.loadDelayReason();
          this.loadGateNumber();
        },
        onExit: function () {
          this._eventBus?.unsubscribe("TripData", "Updated", this._onTripDataUpdate, this);
        },
        _onTripDataUpdate: function () {
          var oTripData = sap.ui.getCore().getModel("TripData");
          if (oTripData) {
            this.getView().setModel(oTripData, "TripData");
          }
        },
        loadDelayReason: function () {
          this.oModel.read("/ConfigValues", {
            filters: [
              new sap.ui.model.Filter(
                "ConfigGroup",
                sap.ui.model.FilterOperator.EQ,
                "Delayed_Reasons"
              ),
            ],
            success: function (oData) {
              console.log("Delay reasons", oData.results);
              this._delayReasonData = oData.results;
            }.bind(this),
            error: function () {
              sap.m.MessageBox.error("Failed to load delay reasons.");
            },
          });
        },
        loadGateNumber: function () {
          this.oModel.read("/ConfigValues", {
            filters: [
              new sap.ui.model.Filter(
                "ConfigGroup",
                sap.ui.model.FilterOperator.EQ,
                "EntryGate"
              ),
            ],
            success: function (oData) {
              console.log("Entry Gate", oData.results);
              this._entryGateData = oData.results;
            }.bind(this),
            error: function () {
              sap.m.MessageBox.error("Failed to load entry gates.");
            },
          });
        },
        onEntryGateValueHelp: function (oEvent) {
          var oInput = oEvent.getSource();
          var oData = this._entryGateData;

          var that = this;

          // Load fragment directly
          if (!this._entryGateVH) {
            sap.ui.core.Fragment.load({
              name: "com.incresolZ_INC_PLMS.fragments.VehicleGateInFrags.EntryGateValueHelp",
              controller: this,
            }).then(function (oDialog) {
              that._entryGateVH = oDialog;

              // Bind list data
              oDialog.setModel(
                new sap.ui.model.json.JSONModel(oData),
                "helpModel"
              );

              that.getView().addDependent(oDialog);
              oDialog.open();
              that._vhInput = oInput; // input reference
            });
          } else {
            // Update model each time
            this._entryGateVH.setModel(
              new sap.ui.model.json.JSONModel(oData),
              "helpModel"
            );
            this._vhInput = oInput;
            this._entryGateVH.open();
          }
        },

        onEntryGateValueHelpConfirm: function (oEvent) {
          var oSelected = oEvent.getParameter("selectedItem");

          if (oSelected) {
            this._vhInput.setValue(oSelected.getTitle()); // ConfigID
          }

          // this._entryGateVH.close();
        },
        onEntryGateValueHelpSearch: function (oEvent) {
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
            sID = oSelected.getTitle(); // ConfigID
            var sDesc = oSelected.getDescription(); // Description

            this._vhInput.setValue(sDesc + " - " + sID);
          }

          // this._delayReasonVH.close();
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
        onSaveGateInInfo: function () {
          // Use the ODataModel created in onInit()
          
          var oModel = this.oModel;

          if (!oModel) {
            console.error("OData model not found!");
            MessageBox.error("OData model is not loaded.");
            return;
          }

          var oView = this.getView();

          var sEntryGateNumber = oView.byId("idEntryGateNumber").getValue();
          // var sDelayReasons = oView.byId("idDelayReasons").getValue();
          var sRemarks = oView.byId("idGateInRemarks").getValue();

          var sTripNumber = sap.ui
            .getCore()
            .getModel("globalData")
            .getProperty("/TripNumber");

          // Function Import Call with Custom Headers
          oModel.callFunction("/GateIn", {
            method: "POST",
            urlParameters: {
              TripNumber: sTripNumber,
              EntryGateNumber: sEntryGateNumber,
              Modified: true,
              Remarks: sRemarks,
              DelayReasons: sID,
            },
            headers: {
              "X-Requested-With": "X",
            },
            success: function (oData, oResponse) {
              MessageBox.success("Gate In information saved successfully!");
            },
            error: function (oError) {
              this.getView().setBusy(false);

              let sMessage = "Failed to Gate In"; // default message

              try {
                // oError.responseText is JSON string from backend
                const oResponse = JSON.parse(oError.responseText);
                if (
                  oResponse.error &&
                  oResponse.error.message &&
                  oResponse.error.message.value
                ) {
                  sMessage = oResponse.error.message.value;
                }
              } catch (e) {
                // fallback if parsing fails, try oError.message.value
                if (oError.message && oError.message.value) {
                  sMessage = oError.message.value;
                }
              }

              MessageBox.error(sMessage);
            }.bind(this),
          });
        },
        formatTripDate: function (vDate) {
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
        formatTripTime: function (vTime) {
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
      }
    );
  }
);
