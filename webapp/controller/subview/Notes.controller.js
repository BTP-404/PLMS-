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
                
                // Track pending notes that haven't been confirmed from backend
                this._aPendingNotes = [];
                // Flag to prevent clearing immediate notes
                this._bJustAddedNote = false;
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
                        var aBackendNotes = oData.results || [];
                        
                        // Merge with pending notes that aren't in backend response yet
                        if (this._aPendingNotes && this._aPendingNotes.length > 0) {
                            var aMergedNotes = aBackendNotes.slice();
                            var that = this;
                            
                            this._aPendingNotes.forEach(function(oPendingNote) {
                                // Check if this pending note is already in backend response
                                var bExists = aBackendNotes.some(function(oBackendNote) {
                                    return oBackendNote.TripNumber === oPendingNote.TripNumber &&
                                           oBackendNote.Seqno === oPendingNote.Seqno;
                                });
                                
                                // If not in backend yet, add it to the list
                                if (!bExists) {
                                    aMergedNotes.push(oPendingNote);
                                } else {
                                    // Remove from pending since it's now confirmed from backend
                                    that._aPendingNotes = that._aPendingNotes.filter(function(p) {
                                        return !(p.TripNumber === oPendingNote.TripNumber && 
                                                p.Seqno === oPendingNote.Seqno);
                                    });
                                }
                            });
                            
                            this._renderNotes(aMergedNotes);
                        } else {
                            this._renderNotes(aBackendNotes);
                        }
                    }.bind(this),

                    error: function (oError) {
                        console.error("NOTE LOAD ERROR:", oError);
                        // On error, still show pending notes if any
                        if (this._aPendingNotes && this._aPendingNotes.length > 0) {
                            this._renderNotes(this._aPendingNotes);
                        }
                    }.bind(this)
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

                    success: function (oResponse) {
                        sap.m.MessageToast.show("Note saved successfully!");
                        oTextArea.setValue("");

                        // Show note immediately with response data or payload
                        var oNoteData = oResponse || oPayload;
                        // Ensure we have the text from the original payload
                        if (!oNoteData.Remarks) {
                            oNoteData.Remarks = sText;
                        }
                        
                        // Set flag to prevent clearing
                        this._bJustAddedNote = true;
                        
                        // Add note immediately - don't reload to avoid clearing it
                        this._addNoteImmediately(oNoteData);

                        // Reset flag after a delay
                        setTimeout(function() {
                            this._bJustAddedNote = false;
                        }.bind(this), 2000);

                        // Don't reload immediately - let the note stay visible
                        // The note will be refreshed when:
                        // 1. User navigates away and comes back
                        // 2. TripData is updated from another source
                        // 3. User manually refreshes

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
                // Don't reload if we just added a note (to prevent clearing it)
                if (!this._bJustAddedNote) {
                    this.loadNotes();
                }
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
                
                // Merge with pending notes if any
                if (this._aPendingNotes && this._aPendingNotes.length > 0) {
                    var aMergedNotes = (aNotes || []).slice();
                    var that = this;
                    
                    this._aPendingNotes.forEach(function(oPendingNote) {
                        // Check if this pending note is already in TripData
                        var bExists = aNotes.some(function(oNote) {
                            return oNote.TripNumber === oPendingNote.TripNumber &&
                                   oNote.Seqno === oPendingNote.Seqno;
                        });
                        
                        // If not in TripData yet, add it to the list
                        if (!bExists) {
                            aMergedNotes.push(oPendingNote);
                        }
                    });
                    
                    aNotes = aMergedNotes;
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
                
                if (!oContainer) {
                    return;
                }
                
                // If we just added a note, don't clear - just return
                // This prevents the immediate note from being removed
                if (this._bJustAddedNote) {
                    return;
                }
                
                // Normal case - remove all and re-render
                oContainer.removeAllItems();

                if (!aNotes.length) {
                    if (oNoNotesText) {
                        oNoNotesText.setVisible(true);
                    }
                    return;
                }
                
                if (oNoNotesText) {
                    oNoNotesText.setVisible(false);
                }

                // Sort notes by CreatedOn descending (newest first)
                var aSortedNotes = aNotes.slice().sort(function(a, b) {
                    var oDateA = a.CreatedOn ? new Date(a.CreatedOn) : new Date(0);
                    var oDateB = b.CreatedOn ? new Date(b.CreatedOn) : new Date(0);
                    return oDateB - oDateA; // Descending order
                });

                aSortedNotes.forEach((note) => {
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
            },

            /** --------------------------------------------
             * ADD NOTE IMMEDIATELY TO UI
             * --------------------------------------------*/
            _addNoteImmediately: function (oNoteData) {
                const oContainer = this.byId("idNotesContainer");
                const oNoNotesText = this.byId("idNoNotesText");
                
                if (!oContainer) {
                    console.warn("Notes container not found");
                    return;
                }

                // Hide "No notes" message if visible
                if (oNoNotesText) {
                    oNoNotesText.setVisible(false);
                }

                // Get current user (if available)
                var sCurrentUser = "";
                try {
                    var oUserInfo = sap.ushell.Container.getService("UserInfo");
                    if (oUserInfo) {
                        sCurrentUser = oUserInfo.getId() || "";
                    }
                } catch (e) {
                    // Fallback to CreatedBy from response or empty
                    sCurrentUser = oNoteData.CreatedBy || "";
                }

                // Use CreatedOn from response if available, otherwise use current time
                var oNoteDate = null;
                if (oNoteData.CreatedOn) {
                    oNoteDate = new Date(oNoteData.CreatedOn);
                }
                if (!oNoteDate || isNaN(oNoteDate.getTime())) {
                    oNoteDate = new Date();
                }
                var sFormattedDate = this._formatDateTime(oNoteDate);

                // Get note text
                var sNoteText = oNoteData.Remarks || "";
                if (!sNoteText) {
                    console.warn("No note text to display");
                    return;
                }

                // Create note UI element
                let oNoteBox = new sap.m.VBox({
                    items: [
                        new sap.m.Text({
                            text: sNoteText,
                            wrapping: true
                        }).addStyleClass("stickyNoteText"),
                        new sap.m.VBox({
                            items: [
                                new sap.m.Text({ text: "By: " + (sCurrentUser || "") }),
                                new sap.m.Text({ text: "On: " + sFormattedDate })
                            ]
                        }).addStyleClass("stickyNoteFooter")
                    ]
                }).addStyleClass("stickyNote");

                // Add to the beginning of the container (newest first)
                oContainer.insertItem(oNoteBox, 0);
            }

        });
    }
);
