sap.ui.define(["sap/m/Panel"], function (Panel) {
  "use strict";

  var CD_KEY = "com.incresolZ_INC_PLMS.plmsPanelAccordion";
  var CD_SCOPE = "com.incresolZ_INC_PLMS.plmsPanelAccordionScope";

  function _onPanelExpand(oEvent) {
    if (!oEvent.getParameter("expand")) {
      return;
    }
    var oPanel = oEvent.getSource();
    var oScope = oPanel.data(CD_SCOPE);
    if (!oScope || typeof oScope.findAggregatedObjects !== "function") {
      return;
    }
    var aOthers = oScope.findAggregatedObjects(true, function (o) {
      return (
        o !== oPanel &&
        o instanceof Panel &&
        o.getExpandable &&
        o.getExpandable()
      );
    });
    aOthers.forEach(function (oOther) {
      if (oOther.getExpanded()) {
        oOther.setExpanded(false);
      }
    });
  }

  /**
   * When any expandable sap.m.Panel under oRoot expands, collapses every other
   * expandable sap.m.Panel in the same oRoot tree (typical screen-level accordion).
   */
  function attach(oRoot) {
    if (!oRoot || typeof oRoot.findAggregatedObjects !== "function") {
      return;
    }
    var aPanels = oRoot.findAggregatedObjects(true, function (o) {
      return (
        o instanceof Panel &&
        o.getExpandable &&
        o.getExpandable()
      );
    });
    aPanels.forEach(function (oPanel) {
      if (oPanel.data(CD_KEY)) {
        return;
      }
      oPanel.data(CD_KEY, true);
      oPanel.data(CD_SCOPE, oRoot);
      oPanel.attachExpand(_onPanelExpand);
    });
  }

  return {
    attach: attach
  };
});
