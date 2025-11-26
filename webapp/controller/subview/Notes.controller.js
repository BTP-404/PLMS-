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

        return Controller.extend("com.incresolZ_INC_PLMS.controller.subview.Notes", {

            onInit: function () {
                this.oModel = new ODataModel("/sap/opu/odata/sap/YIGP_PLMS_SRV/", {
                    useBatch: false,
                    defaultBindingMode: "TwoWay",
                });

                this.getView().setModel(this.oModel);
                var oTripDataModel = sap.ui.getCore().getModel("TripData");
                var oGlobalDataModel = sap.ui.getCore().getModel("globalData");
                var sTripNumber =
                    oTripDataModel?.getProperty("/TripNumber") ||
                    oGlobalDataModel?.getProperty("/TripNumber") ||
                    "";

                if (!sTripNumber) {
                    MessageBox.warning("Trip number not available. Please select a trip first.");
                    return;
                }

                // Trip number must be set
                this.TripNumber = sTripNumber;

                // Load existing notes
                this.loadNotes();
            },

            /** --------------------------------------------
             * LOAD NOTES FROM BACKEND
             * --------------------------------------------*/
            loadNotes: function () {
                const sTripNumber = this.TripNumber;
                const oContainer = this.byId("idNotesContainer");
                const oNoNotesText = this.byId("idNoNotesText");

                // Clear UI
                oContainer.removeAllItems();

                this.oModel.read("/Feeds", {
                    urlParameters: {
                        "$filter": `TripNumber eq '${sTripNumber}'`
                    },
                    success: function (oData) {

                        if (!oData.results.length) {
                            oNoNotesText.setVisible(true);
                            return;
                        }

                        oNoNotesText.setVisible(false);

                        oData.results.forEach((note) => {

                            // Format Date/Time
                            let sFormattedDate = this._formatDateTime(note.CreatedOn);

                            let oNoteBox = new sap.m.VBox({
                                items: [
                                    new sap.m.Text({
                                        text: note.Remarks,
                                        wrapping: true
                                    }).addStyleClass("stickyNoteText"),

                                    new sap.m.VBox({
                                        items: [
                                            new sap.m.Text({ text: "By: " + note.CreatedBy }),
                                            new sap.m.Text({ text: "On: " + sFormattedDate })
                                        ]
                                    }).addStyleClass("stickyNoteFooter")
                                ]
                            }).addStyleClass("stickyNote");

                            oContainer.addItem(oNoteBox);
                        });

                    }.bind(this),

                    error: function (oError) {
                        console.error("NOTE LOAD ERROR:", oError);
                    }
                });
            },

            /** --------------------------------------------
             * SAVE NOTE
             * --------------------------------------------*/
            onSaveNote: function () {
                const oTextArea = this.byId("idNoteInput");
                const sText = oTextArea.getValue().trim();

                if (!sText) {
                    sap.m.MessageToast.show("Please enter a note before saving.");
                    return;
                }

                const sTripNumber = this.TripNumber;
                const sSeqno = this._generateSeqNo();

                const oPayload = {
                    TripNumber: sTripNumber,
                    Seqno: sSeqno,
                    Remarks: sText
                };

                this.oModel.create("/Feeds", oPayload, {
                    headers: { "X-Requested-With": "X" },

                    success: function () {
                        sap.m.MessageToast.show("Note saved successfully!");
                        oTextArea.setValue("");

                        // Reload updated notes
                        this.loadNotes();

                    }.bind(this),

                    error: function (oError) {
                        sap.m.MessageToast.show("Failed to save note.");
                        console.error("SAVE ERROR:", oError);
                    }
                });
            },

            /** Generate sequence number (000, 001...) */
            _generateSeqNo: function () {
                const oContainer = this.byId("idNotesContainer");
                let count = oContainer.getItems().length;
                return String(count).padStart(3, "0");
            },

            /** --------------------------------------------
             * FORMAT DATETIME → dd-mm-yyyy hh:mm
             * --------------------------------------------*/
            _formatDateTime: function (sDateTime) {
                if (!sDateTime) return "";

                let oDate = new Date(sDateTime);

                let dd = String(oDate.getDate()).padStart(2, "0");
                let mm = String(oDate.getMonth() + 1).padStart(2, "0");
                let yyyy = oDate.getFullYear();

                let hh = String(oDate.getHours()).padStart(2, "0");
                let min = String(oDate.getMinutes()).padStart(2, "0");

                return `${dd}-${mm}-${yyyy} ${hh}:${min}`;
            }

        });
    }
);
