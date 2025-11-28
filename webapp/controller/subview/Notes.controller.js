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
                this._eventBus = sap.ui.getCore().getEventBus();
                this._eventBus.subscribe("TripData", "Updated", this._onTripDataUpdated, this);
                this._syncTripContext();
                this.loadNotes();
            },

            onExit: function () {
                this._eventBus?.unsubscribe("TripData", "Updated", this._onTripDataUpdated, this);
            },

            /** --------------------------------------------
             * LOAD NOTES FROM BACKEND
             * --------------------------------------------*/
            loadNotes: function () {
                const sTripNumber = this.TripNumber;
                if (!sTripNumber) {
                    MessageBox.warning("Trip number not available. Please select a trip first.");
                    return;
                }

                if (this._renderNotesFromTripModel()) {
                    return;
                }

                this.oModel.read("/Feeds", {
                    urlParameters: {
                        "$filter": `TripNumber eq '${sTripNumber}'`
                    },
                    success: function (oData) {
                        this._renderNotes(oData.results || []);
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
                if (!sDateTime) {
                    return "";
                }
                let oDate;
                if (typeof sDateTime === "string" && sDateTime.indexOf("/Date") === 0) {
                    var iTimestamp = parseInt(sDateTime.replace(/\D/g, ""), 10);
                    if (!isNaN(iTimestamp)) {
                        oDate = new Date(iTimestamp);
                    }
                }
                if (!oDate) {
                    oDate = new Date(sDateTime);
                }
                if (isNaN(oDate?.getTime())) {
                    return "";
                }
                let dd = String(oDate.getDate()).padStart(2, "0");
                let mm = String(oDate.getMonth() + 1).padStart(2, "0");
                let yyyy = oDate.getFullYear();

                let hh = String(oDate.getHours()).padStart(2, "0");
                let min = String(oDate.getMinutes()).padStart(2, "0");

                return `${dd}-${mm}-${yyyy} ${hh}:${min}`;
            },

            _syncTripContext: function () {
                var oTripDataModel = sap.ui.getCore().getModel("TripData");
                var oGlobalDataModel = sap.ui.getCore().getModel("globalData");
                this.TripNumber =
                    oTripDataModel?.getProperty("/TripNumber") ||
                    oGlobalDataModel?.getProperty("/TripNumber") ||
                    "";
                if (oTripDataModel) {
                    this.getView().setModel(oTripDataModel, "TripData");
                }
            },

            _onTripDataUpdated: function () {
                this._syncTripContext();
                this.loadNotes();
            },

            _renderNotesFromTripModel: function () {
                var oTripData = this.getView().getModel("TripData");
                if (!oTripData) {
                    return false;
                }
                var aNotes = this._extractResults(oTripData.getProperty("/Feeds"));
                if (aNotes === null) {
                    return false;
                }
                if (!aNotes.length) {
                    this._renderNotes([]);
                    return true;
                }
                this._renderNotes(aNotes);
                return true;
            },

            _renderNotes: function (aNotes) {
                const oContainer = this.byId("idNotesContainer");
                const oNoNotesText = this.byId("idNoNotesText");
                oContainer.removeAllItems();

                if (!aNotes.length) {
                    oNoNotesText.setVisible(true);
                    return;
                }
                oNoNotesText.setVisible(false);

                aNotes.forEach((note) => {
                    let sFormattedDate = this._formatDateTime(note.CreatedOn);
                    let oNoteBox = new sap.m.VBox({
                        items: [
                            new sap.m.Text({
                                text: note.Remarks,
                                wrapping: true
                            }).addStyleClass("stickyNoteText"),
                            new sap.m.VBox({
                                items: [
                                    new sap.m.Text({ text: "By: " + (note.CreatedBy || "") }),
                                    new sap.m.Text({ text: "On: " + sFormattedDate })
                                ]
                            }).addStyleClass("stickyNoteFooter")
                        ]
                    }).addStyleClass("stickyNote");
                    oContainer.addItem(oNoteBox);
                });
            },

            _extractResults: function (vData) {
                if (!vData) {
                    return null;
                }
                if (Array.isArray(vData)) {
                    return vData;
                }
                if (Array.isArray(vData.results)) {
                    return vData.results;
                }
                if (vData.__deferred) {
                    return null;
                }
                return [];
            }

        });
    }
);
