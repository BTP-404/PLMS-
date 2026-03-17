sap.ui.define(
  [
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/odata/v2/ODataModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "sap/m/SelectDialog",
    "sap/m/StandardListItem",
    "sap/m/SuggestionItem",
    "sap/ui/core/Fragment",
    "sap/ui/model/json/JSONModel"
  ],
  function (
    Controller,
    ODataModel,
    MessageToast,
    MessageBox,
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
        // this is for refresh the table data when user cancels the trip
        this._oEventBus = sap.ui.getCore().getEventBus();

        this._oEventBus.subscribe(
          "HomePage",
          "RefreshTripTable",
          this._onExternalRefresh,
          this
        );

        // Attach route matched event to automatically refresh table when navigating to HomePage
        var oRouter = this.getOwnerComponent().getRouter();
        if (oRouter) {
          oRouter.getRoute("HomePage").attachPatternMatched(this._onRouteMatched, this);
        }

        this.onRefresh();
      },

      onExit: function () {
        this._oEventBus?.unsubscribe(
          "HomePage",
          "RefreshTripTable",
          this._onExternalRefresh,
          this
        );

        // Detach route matched event
        var oRouter = this.getOwnerComponent().getRouter();
        if (oRouter) {
          oRouter.getRoute("HomePage").detachPatternMatched(this._onRouteMatched, this);
        }
      },

      // --------------------------------------------
      // NAVIGATION
      // --------------------------------------------
      onReportVehicle: function () {
        // Get current user for logging
        var sUser = "";
        try {
          sUser = sap.ushell.Container.getUser().getId();
        } catch (oError) {
          sUser = "Unknown";
        }
        
        // Clear global data
        var oGlobalModel = sap.ui.getCore().getModel("globalData");
        if (oGlobalModel) {
          oGlobalModel.setProperty("/TripNumber", "");
        }

        // Clear global TripData model completely
        sap.ui.getCore().setModel(null, "TripData");
        
        // Publish event to clear all tabs data before navigation
        sap.ui.getCore().getEventBus().publish("Stage", "ClearAllTabs");
        
        // Publish event to notify all subscribers that TripData is cleared
        sap.ui.getCore().getEventBus().publish("TripData", "Updated");

        // Notify Stage view to clear title model
        sap.ui.getCore().getEventBus().publish("Stage", "ResetPageTitle");
        
        var oRouter = this.getOwnerComponent().getRouter();
        if (oRouter) {
          oRouter.navTo("Stage");
        } else {
          window.location.hash = "#/Stage";
        }
      },

      onTripPress: function (oEvent) {
        var oCtx = oEvent.getParameter("listItem").getBindingContext();
        var oRowData = oCtx.getObject();
        var sTripNo = oRowData.TripNumber;
        var oGlobalModel = sap.ui.getCore().getModel("globalData");

        if (!oGlobalModel) {
          oGlobalModel = new sap.ui.model.json.JSONModel({ TripNumber: "" });
          sap.ui.getCore().setModel(oGlobalModel, "globalData");
        }

        oGlobalModel.setProperty("/TripNumber", sTripNo);

        var oTripDataModel = new JSONModel(oRowData);
        sap.ui.getCore().setModel(oTripDataModel, "TripData");
        sap.ui.getCore().getEventBus().publish("TripData", "Updated");

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
            // MessageToast.show("Trip details refreshed");
          });
        }
      },

      _onExternalRefresh: function () {
        this.onRefresh();
      },

      /**
       * Event handler for route matched - automatically refreshes table when navigating to HomePage
       * @private
       */
      _onRouteMatched: function () {
        // Small delay to ensure view is fully rendered before refreshing
        setTimeout(function() {
          this.onRefresh();
        }.bind(this), 100);
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
            var sValue = (oEvt.getParameter("value") || "").trim();
            // Make search case-insensitive by normalizing to upper case
            if (sValue) {
              sValue = sValue.toUpperCase();
            }
            var oBinding = oEvt.getSource().getBinding("items");
            
            if (!oBinding) {
              return;
            }
            
            var aFilters = [];
            if (sValue && sValue.length > 0) {
              aFilters = [
                new Filter(
                  [
                    new Filter(sKeyField, FilterOperator.Contains, sValue),
                    new Filter(sDescField, FilterOperator.Contains, sValue),
                  ],
                  false
                ),
              ];
            }
            oBinding.filter(aFilters);
          },
          search: function (oEvt) {
            // Same logic as liveChange for consistency
            var sValue = (oEvt.getParameter("value") || "").trim();
            // Make search case-insensitive by normalizing to upper case
            if (sValue) {
              sValue = sValue.toUpperCase();
            }
            var oBinding = oEvt.getSource().getBinding("items");
            
            if (!oBinding) {
              return;
            }
            
            var aFilters = [];
            if (sValue && sValue.length > 0) {
              aFilters = [
                new Filter(
                  [
                    new Filter(sKeyField, FilterOperator.Contains, sValue),
                    new Filter(sDescField, FilterOperator.Contains, sValue),
                  ],
                  false
                ),
              ];
            }
            oBinding.filter(aFilters);
          },
          confirm: function (oEvt) {
            var oSelectedItem = oEvt.getParameter("selectedItem");
            if (oSelectedItem) {
              oInput.setValue(oSelectedItem.getTitle());
              // Filtering will be applied when user clicks Go button
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
              // Filtering will be applied when user clicks Go button
            }.bind(this),
          });
      },

      onSuggestionItemSelected: function (oEvent) {
        var oInput = oEvent.getSource();
        oInput.setValue(oEvent.getParameter("selectedItem").getText());
        // Filtering will be applied when user clicks Go button
      },

      onGoPress: function () {
        // Validate date range before applying filters
        var oDateFromPicker = this.byId("ReportDateFrom");
        var oDateToPicker = this.byId("ReportDateTo");
        var oDateFrom = oDateFromPicker ? oDateFromPicker.getDateValue() : null;
        var oDateTo = oDateToPicker ? oDateToPicker.getDateValue() : null;

        if (oDateFrom && oDateTo) {
          var oStartFrom = new Date(oDateFrom);
          oStartFrom.setHours(0, 0, 0, 0);
          var oStartTo = new Date(oDateTo);
          oStartTo.setHours(0, 0, 0, 0);
          if (oStartTo.getTime() < oStartFrom.getTime()) {
            MessageBox.error("Report Date To cannot be before Report Date From.");
            return;
          }
        }

        // Apply all filters when Go button is clicked
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
        var oDateFrom = oDateFromPicker ? oDateFromPicker.getDateValue() : null;
        var oDateTo = oDateToPicker ? oDateToPicker.getDateValue() : null;

        if (oDateFrom || oDateTo) {
          var aDateFilters = [];
          if (oDateFrom) {
            var oStartOfDay = new Date(oDateFrom);
            oStartOfDay.setHours(0, 0, 0, 0);
            aDateFilters.push(
              new Filter("CreatedOn", FilterOperator.GE, oStartOfDay)
            );
          }
          if (oDateTo) {
            var oEndOfDay = new Date(oDateTo);
            oEndOfDay.setHours(23, 59, 59, 999);
            aDateFilters.push(
              new Filter("CreatedOn", FilterOperator.LE, oEndOfDay)
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
            name: "com.incresolZ_INC_PLMS.fragments.HomePageFrags.ColumnVisibilityDialog",
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
          "colMovementType",
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

      formatTripNumber: function (sTripNumber) {
        if (!sTripNumber) {
          return "";
        }
        // Convert to string and remove leading zeros
        var sStr = String(sTripNumber);
        // Remove leading zeros but keep at least one digit (e.g., "0000000014" -> "14", "0" -> "0")
        return sStr.replace(/^0+/, "") || "0";
      },

      formatMovementType: function (sMovementType) {
        if (!sMovementType) {
          return "";
        }
        var sType = String(sMovementType).toUpperCase().trim();
        if (sType === "I") {
          return "Inward";
        }
        if (sType === "O") {
          return "Outward";
        }
        return sType;
      },

      /**
       * Formatter to get CSS class based on Trip Status
       * @param {string} sTripStatus - Trip status value
       * @returns {string} CSS class name
       */
      getTripStatusClass: function (sTripStatus) {
        if (!sTripStatus) {
          return "";
        }
        
        // Normalize status to lowercase for comparison
        var sStatus = sTripStatus.toLowerCase().trim();
        
        // Map status values to CSS classes
        if (sStatus === "new" || sStatus === "created") {
          return "tripStatusNew";
        } else if (sStatus === "pending" || sStatus === "pending approval") {
          return "tripStatusPending";
        } else if (sStatus === "in progress" || sStatus === "active" || sStatus === "in-progress") {
          return "tripStatusInProgress";
        } else if (sStatus === "gate in" || sStatus === "gate-in") {
          return "tripStatusGateIn";
        } else if (sStatus === "loading" || sStatus === "loading start" || sStatus === "loading end") {
          return "tripStatusLoading";
        } else if (sStatus === "gate out" || sStatus === "gate-out") {
          return "tripStatusGateOut";
        } else if (sStatus === "completed" || sStatus === "done") {
          return "tripStatusCompleted";
        } else if (sStatus === "cancelled" || sStatus === "canceled") {
          return "tripStatusCancelled";
        } else if (sStatus === "error" || sStatus === "failed") {
          return "tripStatusError";
        }
        
        // Default: no special color
        return "";
      },

      // User-role-based visibility for Report Vehicle has been removed;
      // button visibility is now controlled purely by view configuration.
    });
  }
);
