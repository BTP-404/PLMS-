sap.ui.define([], function () {
  "use strict";

  var iconMap = {
    I01: "sap-icon://bar-code",
    I02: "sap-icon://bar-code",
    I03: "sap-icon://bar-code",
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

  /**
   * ConfigValues: customizing group for movement scenario codes (ConfigID = scenario segment, e.g. "09").
   * Backend should maintain a row with ConfigID matching the OrderType MovementScenario for O/W Direct Sale.
   */
  var CONFIG_GROUP_MOVEMENT_SCENARIO = "MovementScenario";

  /**
   * ConfigID in ConfigValues for outbound direct-sale / bin (maps to MovementScenario "09" and item key O09).
   * Resolved at runtime via ConfigValues read; falls back to this literal.
   */
  var MOVEMENT_SCENARIO_CONFIG_ID_OUTGOING_DIRECT_SALE = "09";

  /** Optional override after /ConfigValues read (two-char scenario segment). */
  var _sOutgoingDirectSaleScenarioCode = null;

  /**
   * Normalize scenario to a two-character segment for ItemKey (e.g. I01, O09).
   * Aligns with OrderType: "01".."09". Handles OData quirks: 9, "9", "09", "009".
   */
  function padScenario(sScenario) {
    if (sScenario === undefined || sScenario === null) {
      return "";
    }
    var s = String(sScenario).trim();
    if (s.length === 0) {
      return "";
    }
    if (/^\d+$/.test(s)) {
      var n = parseInt(s, 10);
      if (isNaN(n) || n < 0) {
        return "";
      }
      if (n <= 99) {
        var t = String(n);
        return t.length === 1 ? "0" + t : t;
      }
      var m = n % 100;
      var u = String(m);
      return u.length === 1 ? "0" + u : u;
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

  /**
   * Map ConfigValues.ConfigID (or similar) to MovementScenario segment — must match OrderType MovementScenario.
   */
  function resolveMovementScenarioFromConfigId(sConfigId) {
    return padScenario(sConfigId);
  }

  function getOutgoingDirectSaleScenarioCode() {
    return (
      _sOutgoingDirectSaleScenarioCode ||
      resolveMovementScenarioFromConfigId(MOVEMENT_SCENARIO_CONFIG_ID_OUTGOING_DIRECT_SALE)
    );
  }

  /**
   * Call after reading ConfigValues so Bin Details / O09 checks use the same code as customizing.
   */
  function setOutgoingDirectSaleScenarioCodeFromConfig(sScenarioCodeOrConfigId) {
    if (sScenarioCodeOrConfigId === undefined || sScenarioCodeOrConfigId === null) {
      _sOutgoingDirectSaleScenarioCode = null;
      return;
    }
    var s = resolveMovementScenarioFromConfigId(sScenarioCodeOrConfigId);
    _sOutgoingDirectSaleScenarioCode = s || null;
  }

  function getOutgoingDirectSaleItemKey() {
    return getMovementScenarioItemKey("O", getOutgoingDirectSaleScenarioCode()) || "";
  }

  function isOutgoingDirectSaleScenarioItemKey(sItemKey) {
    if (sItemKey === undefined || sItemKey === null || sItemKey === "") {
      return false;
    }
    var sExpected = getOutgoingDirectSaleItemKey();
    if (!sExpected) {
      return false;
    }
    return String(sItemKey).trim().toUpperCase() === sExpected;
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
      var sMt = String(row.MovementType || "").trim().toUpperCase();
      var sGroup =
        sMt === "O" ? "Outgoing Materials" : "Incoming Materials";
      return Object.assign({}, row, {
        ItemKey: itemKey,
        Icon: getIconForItemKey(itemKey),
        Group: sGroup,
      });
    });
  }

  /** Movement scenarios that use scanner-first reporting (ASN variants). */
  var SCANNER_MOVEMENT_SCENARIO_ITEM_KEYS = ["I01", "I02", "I03"];
  var SCANNER_MOVEMENT_SCENARIO_ITEM_KEY = "I02";

  function isScannerMovementScenarioItemKey(sItemKey) {
    if (!sItemKey) {
      return false;
    }
    var sKey = String(sItemKey).trim().toUpperCase();
    return SCANNER_MOVEMENT_SCENARIO_ITEM_KEYS.indexOf(sKey) !== -1;
  }

  return {
    iconMap: iconMap,
    getMovementScenarioItemKey: getMovementScenarioItemKey,
    getIconForItemKey: getIconForItemKey,
    enrichOrderTypeRows: enrichOrderTypeRows,
    isScannerMovementScenarioItemKey: isScannerMovementScenarioItemKey,
    SCANNER_MOVEMENT_SCENARIO_ITEM_KEYS: SCANNER_MOVEMENT_SCENARIO_ITEM_KEYS,
    SCANNER_MOVEMENT_SCENARIO_ITEM_KEY: SCANNER_MOVEMENT_SCENARIO_ITEM_KEY,
    CONFIG_GROUP_MOVEMENT_SCENARIO: CONFIG_GROUP_MOVEMENT_SCENARIO,
    MOVEMENT_SCENARIO_CONFIG_ID_OUTGOING_DIRECT_SALE:
      MOVEMENT_SCENARIO_CONFIG_ID_OUTGOING_DIRECT_SALE,
    resolveMovementScenarioFromConfigId: resolveMovementScenarioFromConfigId,
    setOutgoingDirectSaleScenarioCodeFromConfig: setOutgoingDirectSaleScenarioCodeFromConfig,
    getOutgoingDirectSaleScenarioCode: getOutgoingDirectSaleScenarioCode,
    getOutgoingDirectSaleItemKey: getOutgoingDirectSaleItemKey,
    isOutgoingDirectSaleScenarioItemKey: isOutgoingDirectSaleScenarioItemKey,
  };
});
