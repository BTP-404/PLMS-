sap.ui.define(
  [
    "sap/ui/model/json/JSONModel",
    "sap/ui/model/Filter",
    "sap/ui/model/FilterOperator",
    "com/incresolZ_INC_PLMS/util/MovementScenarioIcons",
  ],
  function (JSONModel, Filter, FilterOperator, MovementScenarioIcons) {
    "use strict";

    /**
     * Loads /ConfigValues for MovementScenario + ConfigID (default "09") and updates
     * MovementScenarioIcons runtime code for Gate Out Bin Details (O + segment).
     * @param {sap.ui.model.odata.v2.ODataModel} oModel PLMS OData model
     * @param {string} sTripNumber optional — filters ConfigValues like VehicleType
     * @param {sap.ui.core.mvc.View} oView optional — receives movementScenarioConfig JSON model
     */
    function syncOutgoingDirectSaleFromConfig(oModel, sTripNumber, oView) {
      if (!oModel) {
        return;
      }
      var aBase = [
        new Filter(
          "ConfigGroup",
          FilterOperator.EQ,
          MovementScenarioIcons.CONFIG_GROUP_MOVEMENT_SCENARIO
        ),
        new Filter(
          "ConfigID",
          FilterOperator.EQ,
          MovementScenarioIcons.MOVEMENT_SCENARIO_CONFIG_ID_OUTGOING_DIRECT_SALE
        ),
      ];
      var aTripFilters = aBase.slice();
      if (sTripNumber) {
        aTripFilters.push(
          new Filter("TripNumber", FilterOperator.EQ, sTripNumber)
        );
      }

      var fnApply = function (oData) {
        var a = (oData && oData.results) || [];
        var sFallback =
          MovementScenarioIcons.resolveMovementScenarioFromConfigId(
            MovementScenarioIcons.MOVEMENT_SCENARIO_CONFIG_ID_OUTGOING_DIRECT_SALE
          );
        if (a.length && a[0].ConfigID !== undefined && a[0].ConfigID !== null) {
          MovementScenarioIcons.setOutgoingDirectSaleScenarioCodeFromConfig(
            a[0].ConfigID
          );
        } else {
          MovementScenarioIcons.setOutgoingDirectSaleScenarioCodeFromConfig(
            sFallback
          );
        }
        if (oView) {
          var oCfg =
            oView.getModel("movementScenarioConfig") || new JSONModel({});
          oCfg.setProperty(
            "/outgoingDirectSaleScenarioCode",
            MovementScenarioIcons.getOutgoingDirectSaleScenarioCode()
          );
          oView.setModel(oCfg, "movementScenarioConfig");
        }
      };

      oModel.read("/ConfigValues", {
        filters: aTripFilters,
        success: function (oData) {
          var a = (oData && oData.results) || [];
          if (a.length > 0 || !sTripNumber) {
            fnApply(oData);
            return;
          }
          oModel.read("/ConfigValues", {
            filters: aBase,
            success: fnApply,
            error: function () {
              fnApply({ results: [] });
            },
          });
        },
        error: function () {
          oModel.read("/ConfigValues", {
            filters: aBase,
            success: fnApply,
            error: function () {
              fnApply({ results: [] });
            },
          });
        },
      });
    }

    return {
      syncOutgoingDirectSaleFromConfig: syncOutgoingDirectSaleFromConfig,
    };
  }
);
