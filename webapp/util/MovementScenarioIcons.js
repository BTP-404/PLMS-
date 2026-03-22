sap.ui.define([], function () {
  "use strict";

  var iconMap = {
    I02: "sap-icon://bar-code",
    I04: "sap-icon://factory",
    I05: "sap-icon://request",
    I08: "sap-icon://shipping-status",

    O01: "sap-icon://sales-order",
    O02: "sap-icon://world",
    O03: "sap-icon://journey-arrive",
    O04: "sap-icon://journey-depart",
    O05: "sap-icon://factory",
    O06: "sap-icon://undo",
    O08: "sap-icon://delete",
    O09: "sap-icon://cart",
  };

  var DEFAULT_ICON = "sap-icon://message-information";

  function padScenario(sScenario) {
    if (sScenario === undefined || sScenario === null) {
      return "";
    }
    var s = String(sScenario).trim();
    if (s.length === 0) {
      return "";
    }
    if (s.length === 1) {
      return "0" + s;
    }
    return s;
  }

  function getMovementScenarioItemKey(sMovementType, sMovementScenario) {
    if (!sMovementType || sMovementScenario === undefined || sMovementScenario === null) {
      return "";
    }
    var s = String(sMovementType).trim();
    if (!s) {
      return "";
    }
    var mt = s.charAt(0);
    var ps = padScenario(sMovementScenario);
    if (!ps) {
      return "";
    }
    return mt + ps;
  }

  function getIconForItemKey(sItemKey) {
    if (!sItemKey) {
      return DEFAULT_ICON;
    }
    return iconMap[sItemKey] || DEFAULT_ICON;
  }

  function enrichOrderTypeRows(aRows) {
    if (!aRows || !aRows.length) {
      return [];
    }
    return aRows.map(function (row) {
      var itemKey = getMovementScenarioItemKey(
        row.MovementType,
        row.MovementScenario
      );
      return Object.assign({}, row, {
        ItemKey: itemKey,
        Icon: getIconForItemKey(itemKey),
      });
    });
  }

  /** Movement scenario that uses scanner-first reporting (matches bar-code icon I02 / ASN). */
  var SCANNER_MOVEMENT_SCENARIO_ITEM_KEY = "I02";

  return {
    iconMap: iconMap,
    getMovementScenarioItemKey: getMovementScenarioItemKey,
    getIconForItemKey: getIconForItemKey,
    enrichOrderTypeRows: enrichOrderTypeRows,
    SCANNER_MOVEMENT_SCENARIO_ITEM_KEY: SCANNER_MOVEMENT_SCENARIO_ITEM_KEY,
  };
});
