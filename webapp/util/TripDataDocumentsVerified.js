sap.ui.define([], function () {
  "use strict";

  function documentsVerifiedMeansYes(v) {
    if (v === true || v === "true" || v === "X" || v === "Y" || v === 1 || v === "1") {
      return true;
    }
    return false;
  }

  /**
   * After GET TripDetails: map backend DocumentsVerified to TripData.VerifiedDocs
   * for Gate Out radio (0 = Yes, 1 = No), aligned with GateOut.formatVerifiedDocsIndex.
   */
  function applyDocumentsVerifiedToVerifiedDocs(oData) {
    if (!oData || typeof oData !== "object") {
      return;
    }
    var d = oData.DocumentsVerified;
    if (
      d === undefined ||
      d === null ||
      (typeof d === "string" && String(d).trim() === "")
    ) {
      return;
    }
    oData.VerifiedDocs = documentsVerifiedMeansYes(d) ? 0 : 1;
  }

  /**
   * Before TripDetails POST/PATCH: map UI VerifiedDocs to TripDetails.DocumentsVerified.
   * Caller removes VerifiedDocs afterward so it is not sent as an unknown property.
   */
  function applyVerifiedDocsUiToDocumentsVerified(oData) {
    if (!oData || typeof oData !== "object") {
      return;
    }
    var v = oData.VerifiedDocs;
    if (v === undefined || v === null || String(v).trim() === "") {
      return;
    }
    if (v === 0 || v === "0" || v === "X" || v === "Y" || v === true || v === "true") {
      oData.DocumentsVerified = true;
    } else {
      oData.DocumentsVerified = false;
    }
  }

  return {
    applyDocumentsVerifiedToVerifiedDocs: applyDocumentsVerifiedToVerifiedDocs,
    applyVerifiedDocsUiToDocumentsVerified: applyVerifiedDocsUiToDocumentsVerified,
  };
});
