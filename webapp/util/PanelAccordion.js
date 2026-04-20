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

  function _onPanelExpandScoped(oEvent) {
    if (!oEvent.getParameter("expand")) {
      return;
    }
    var oPanel = oEvent.getSource();
    var aScopePanels = oPanel.data(CD_SCOPE);
    if (!Array.isArray(aScopePanels)) {
      return;
    }
    aScopePanels.forEach(function (oOther) {
      if (oOther !== oPanel && oOther.getExpanded && oOther.getExpanded()) {
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

  /**
   * Scoped accordion: only the provided panel IDs are mutually exclusive.
   * This avoids collapsing unrelated expandable panels in nested XMLViews.
   */
  /**
   * Sets expanded state on every expandable sap.m.Panel under oRoot.
   * Exactly one panel stays expanded when oExpandedPanel is provided; otherwise all collapse.
   */
  function collapseAllExcept(oRoot, oExpandedPanel) {
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
      if (oPanel.setExpanded) {
        oPanel.setExpanded(!!oExpandedPanel && oPanel === oExpandedPanel);
      }
    });
  }

  function attachByIds(oRoot, aPanelIds) {
    if (!oRoot || typeof oRoot.byId !== "function" || !Array.isArray(aPanelIds)) {
      return;
    }
    var aPanels = aPanelIds
      .map(function (sId) {
        return oRoot.byId(sId);
      })
      .filter(function (oPanel) {
        return (
          oPanel instanceof Panel &&
          oPanel.getExpandable &&
          oPanel.getExpandable()
        );
      });
    aPanels.forEach(function (oPanel) {
      if (oPanel.data(CD_KEY)) {
        return;
      }
      oPanel.data(CD_KEY, true);
      oPanel.data(CD_SCOPE, aPanels);
      oPanel.attachExpand(_onPanelExpandScoped);
    });
  }

  return {
    attach: attach,
    attachByIds: attachByIds,
    collapseAllExcept: collapseAllExcept
  };
});
