sap.ui.define(
  [
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/odata/v2/ODataModel",
    "sap/m/MessageToast",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/SelectDialog",
    "sap/m/StandardListItem",
    "sap/m/SuggestionItem",
    "sap/ui/core/Fragment",
    "sap/ui/model/json/JSONModel",
  ],
  function (
    Controller,
    ODataModel,
    MessageToast,
    Filter,
    FilterOperator,
    SelectDialog,
    StandardListItem,
    SuggestionItem,
    Fragment,
    JSONModel
  ) {
    "use strict";

    return Controller.extend("com.incresolZ_INC_PLMS.controller.HomePage", {
      onInit: function () {
        var serviceUrl = "/sap/opu/odata/sap/YIGP_PLMS_SRV/";
        var oModel = new ODataModel(serviceUrl, {
          useBatch: false,
          defaultBindingMode: "TwoWay",
        });
        this.getView().setModel(oModel);
        this._initializeColumnVisibility();
        
      },

      // --------------------------------------------
      // NAVIGATION
      // --------------------------------------------
      onReportVehicle: function () {
        // clear global data
    var oGlobalModel = sap.ui.getCore().getModel("globalData");
    if (oGlobalModel) {
        oGlobalModel.setProperty("/TripNumber", "");
    }

    sap.ui.getCore().setModel(null, "TripData");
    sap.ui.getCore().getEventBus().publish("TripData", "Updated");

    // Notify Stage view to clear title model
    sap.ui.getCore().getEventBus().publish("Stage", "ResetPageTitle");
        var oRouter = this.getOwnerComponent().getRouter();
        if (oRouter) {
          oRouter.navTo("Stage");
        } else {
          window.location.hash = "#/stage";
        }
      },

      onTripPress: function (oEvent) {
        var sTripNo = oEvent
          .getParameter("listItem")
          .getBindingContext()
          .getProperty("TripNumber");
		   var oGlobalModel = sap.ui.getCore().getModel("globalData");

    if (!oGlobalModel) {
        oGlobalModel = new sap.ui.model.json.JSONModel({ TripNumber: "" });
        sap.ui.getCore().setModel(oGlobalModel, "globalData");
    }

    oGlobalModel.setProperty("/TripNumber", sTripNo);

        this.getView().byId("tripTable").removeSelections(true);
        sap.ui.core.UIComponent.getRouterFor(this).navTo("StagewithParam", {
          tripNo: sTripNo || "",
        });
      },

      onRefresh: function () {
        var oTable = this.getView().byId("tripTable");
        var oModel = this.getView().getModel();
        if (oModel) {
          oTable.setBusy(true);
          oModel.refresh(true);
          oModel.attachRequestCompleted(function () {
            oTable.setBusy(false);
            MessageToast.show("Trip details refreshed");
          });
        }
      },

      // --------------------------------------------
      // VALUE HELP
      // --------------------------------------------
      onValueHelpRequest: function (oEvent) {
        var oInput = oEvent.getSource();
        var sField = oInput.data("field");
        var oFieldConfig = this._getFieldConfiguration(sField);
        if (!oFieldConfig)
          return MessageToast.show("No value help for " + sField);

        var { sKeyField, sDescField, sTitle } = oFieldConfig;
        var oModel = this.getView().getModel();

        var oSelectDialog = new SelectDialog({
          title: sTitle,
          liveChange: function (oEvt) {
            var sValue = oEvt.getParameter("value");
            var aFilters = sValue
              ? [
                  new Filter(
                    [
                      new Filter(sKeyField, FilterOperator.Contains, sValue),
                      new Filter(sDescField, FilterOperator.Contains, sValue),
                    ],
                    false
                  ),
                ]
              : [];
            oEvt.getSource().getBinding("items").filter(aFilters);
          },
          confirm: function (oEvt) {
            var oSelectedItem = oEvt.getParameter("selectedItem");
            if (oSelectedItem) {
              oInput.setValue(oSelectedItem.getTitle());
              this._applyTableFilter(); // Dynamic filtering
            }
          }.bind(this),
        });

        oSelectDialog.setModel(oModel);
        oSelectDialog.bindAggregation("items", {
          path: "/TripDetails",
          template: new StandardListItem({
            title: "{" + sKeyField + "}",
            description: "{" + sDescField + "}",
          }),
        });

        oSelectDialog.open();
      },

      // --------------------------------------------
      // LIVE SUGGESTIONS
      // --------------------------------------------
      onSuggest: function (oEvent) {
        var oInput = oEvent.getSource();
        var sField = oInput.data("field");
        var sValue = oEvent.getParameter("suggestValue");
        var oFieldConfig = this._getFieldConfiguration(sField);
        if (!oFieldConfig) return;

        var { sKeyField, sDescField } = oFieldConfig;
        var aFilters = sValue
          ? [
              new Filter(
                [
                  new Filter(sKeyField, FilterOperator.Contains, sValue),
                  new Filter(sDescField, FilterOperator.Contains, sValue),
                ],
                false
              ),
            ]
          : [];

        this.getView()
          .getModel()
          .read("/TripDetails", {
            filters: aFilters,
            success: function (oData) {
              oInput.destroySuggestionItems();
              (oData.results || []).forEach(function (item) {
                oInput.addSuggestionItem(
                  new SuggestionItem({
                    key: item[sKeyField],
                    text: item[sKeyField],
                    description: item[sDescField],
                  })
                );
              });
              this._applyTableFilter(); // Auto filter while typing
            }.bind(this),
          });
      },

      onSuggestionItemSelected: function (oEvent) {
        var oInput = oEvent.getSource();
        oInput.setValue(oEvent.getParameter("selectedItem").getText());
        this._applyTableFilter();
      },

      onInputLiveChange: function () {
        this._applyTableFilter();
      },

      // --------------------------------------------
      // TABLE FILTERING LOGIC
      // --------------------------------------------
      _applyTableFilter: function () {
        var oTable = this.getView().byId("tripTable");
        var oBinding = oTable.getBinding("items");
        if (!oBinding) return;

        var aInputs = this.getView().findAggregatedObjects(
          true,
          function (oCtrl) {
            return (
              oCtrl.isA("sap.m.Input") ||
              oCtrl.isA("sap.m.DatePicker")
            );
          }
        );

        var aFilters = [];

        // Handle date range first
        var oDateFromPicker = this.byId("ReportDateFrom");
        var oDateToPicker = this.byId("ReportDateTo");
        var sDateFrom = oDateFromPicker ? oDateFromPicker.getValue() : "";
        var sDateTo = oDateToPicker ? oDateToPicker.getValue() : "";

        if (sDateFrom || sDateTo) {
          var aDateFilters = [];
          if (sDateFrom) {
            var sDateFromFormatted = sDateFrom + "T00:00:00";
            aDateFilters.push(
              new Filter("LR_Date", FilterOperator.GE, sDateFromFormatted)
            );
          }
          if (sDateTo) {
            var sDateToFormatted = sDateTo + "T23:59:59";
            aDateFilters.push(
              new Filter("LR_Date", FilterOperator.LE, sDateToFormatted)
            );
          }
          if (aDateFilters.length) {
            aFilters.push(new Filter(aDateFilters, true));
          }
        }

        // Handle text inputs
        aInputs.forEach(
          function (oInput) {
            if (oInput.isA("sap.m.DatePicker")) {
              // already handled
              return;
            }
            var sField = oInput.data("field");
            var sValue = oInput.getValue ? oInput.getValue() : "";
            if (sField && sValue) {
              var oFieldConfig = this._getFieldConfiguration(sField);
              if (oFieldConfig) {
                aFilters.push(
                  new Filter(
                    oFieldConfig.sKeyField,
                    FilterOperator.Contains,
                    sValue
                  )
                );
              }
            }
          }.bind(this)
        );

        oBinding.filter(aFilters.length ? new Filter(aFilters, true) : []);
      },

      // --------------------------------------------
      // FIELD CONFIGURATION
      // --------------------------------------------
      _getFieldConfiguration: function (sField) {
        switch (sField) {
          case "tripNo":
            return {
              sKeyField: "TripNumber",
              sDescField: "VehicleNumber",
              sTitle: "Select Trip Number",
            };
          case "vehicleNumber":
            return {
              sKeyField: "VehicleNumber",
              sDescField: "VehicleType",
              sTitle: "Select Vehicle Number",
            };
          case "vehicleType":
            return {
              sKeyField: "VehicleType",
              sDescField: "VehicleSize",
              sTitle: "Select Vehicle Type",
            };
          case "transporterName":
            return {
              sKeyField: "TransporterName",
              sDescField: "DriverName",
              sTitle: "Select Transporter",
            };
          case "lrNumber":
            return {
              sKeyField: "LR_Number",
              sDescField: "TripNumber",
              sTitle: "Select LR Number",
            };
          case "plant":
            return {
              sKeyField: "Plant",
              sDescField: "CompanyCode",
              sTitle: "Select Plant",
            };
          case "companyCode":
            return {
              sKeyField: "CompanyCode",
              sDescField: "Plant",
              sTitle: "Select Company Code",
            };
          default:
            return null;
        }
      },

      // ============================================================
      // COLUMN VISIBILITY
      // ============================================================
      _initializeColumnVisibility: function () {
        var oTable = this.getView().byId("tripTable");
        if (!oTable) {
          return;
        }

        var that = this;
        var aColumns = oTable.getColumns().map(function (oColumn) {
          var oHeader = oColumn.getHeader();
          var sLabel = oHeader && oHeader.getText ? oHeader.getText() : "";
          var sKey = that._extractColumnKey(oColumn.getId());
          var bDefault = that._getDefaultColumnVisibility(sKey);
          oColumn.setVisible(bDefault);
          return {
            id: sKey,
            label: sLabel,
            visible: bDefault,
          };
        });

        this._oColumnSettingsModel = new JSONModel({ columns: aColumns });
        this.getView().setModel(this._oColumnSettingsModel, "columnSettings");
      },

      _applyColumnVisibilityFromModel: function () {
        if (!this._oColumnSettingsModel) {
          return;
        }
        var oTable = this.getView().byId("tripTable");
        if (!oTable) {
          return;
        }

        var aColumns = this._oColumnSettingsModel.getProperty("/columns") || [];
        var that = this;
        aColumns.forEach(function (oColumnInfo) {
          var oColumn = that.byId(oColumnInfo.id);
          if (oColumn) {
            oColumn.setVisible(oColumnInfo.visible);
          }
        });
      },

      onOpenColumnVisibilityDialog: function () {
        if (!this._oColumnSettingsModel) {
          this._initializeColumnVisibility();
        } else {
          this._applyColumnVisibilityFromModel();
        }

        if (!this._oColumnVisibilityDialog) {
          Fragment.load({
            id: this.getView().getId(),
            name: "com.incresolZ_INC_PLMS.fragments.ColumnVisibilityDialog",
            controller: this,
          }).then(
            function (oDialog) {
              this._oColumnVisibilityDialog = oDialog;
              this.getView().addDependent(oDialog);
              oDialog.open();
            }.bind(this)
          );
        } else {
          this._oColumnVisibilityDialog.open();
        }
      },

      onColumnSwitchChanged: function (oEvent) {
        var oSwitch = oEvent.getSource();
        var bState = oSwitch.getState();
        var oContext = oSwitch.getBindingContext("columnSettings");
        if (!oContext) {
          return;
        }
        var sColumnId = oContext.getProperty("id");
        var oColumn = this.byId(sColumnId);
        if (oColumn) {
          oColumn.setVisible(bState);
        }
        oContext.getModel().setProperty(oContext.getPath() + "/visible", bState);
      },

      onResetColumnVisibility: function () {
        if (!this._oColumnSettingsModel) {
          return;
        }
        var aColumns =
          this._oColumnSettingsModel.getProperty("/columns") || [];
        aColumns.forEach(
          function (oCol) {
            oCol.visible = this._getDefaultColumnVisibility(oCol.id);
          }.bind(this)
        );
        this._oColumnSettingsModel.refresh(true);
        this._applyColumnVisibilityFromModel();
      },

      _extractColumnKey: function (sId) {
        if (!sId) return "";
        var aParts = sId.split("--");
        return aParts[aParts.length - 1];
      },

      _getDefaultColumnVisibility: function (sKey) {
        var aDefaultVisible = [
          "colTripNumber",
          "colVehicleNumber",
          "colTripStatus",
          "colCompanyCode",
          "colPlant",
        ];
        return aDefaultVisible.indexOf(sKey) !== -1;
      },

      onCloseColumnVisibilityDialog: function () {
        if (this._oColumnVisibilityDialog) {
          this._oColumnVisibilityDialog.close();
        }
      },
    });
  }
);
