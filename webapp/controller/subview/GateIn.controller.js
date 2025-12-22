sap.ui.define(
  [
    "sap/ui/core/mvc/Controller",
    "sap/ui/model/odata/v2/ODataModel",
    "sap/m/MessageToast",
    "sap/m/MessageBox",
    "sap/ui/model/json/JSONModel",
    "sap/ui/core/Fragment",
    "sap/ndc/BarcodeScanner",
  ],
  function (
    Controller,
    ODataModel,
    MessageToast,
    MessageBox,
    JSONModel,
    Fragment,
    BarcodeScanner
  ) {
    "use strict";

    var tripNumber;
    var sID;
    return Controller.extend(
      "com.incresolZ_INC_PLMS.controller.subview.GateIn",
      {
        onInit: function () {
          this.oModel = new ODataModel("/sap/opu/odata/sap/YIGP_PLMS_SRV/", {
            useBatch: false,
            defaultBindingMode: "TwoWay",
          });
          this.getView().setModel(this.oModel);
          this._eventBus = sap.ui.getCore().getEventBus();
          this._eventBus.subscribe("TripData", "Updated", this._onTripDataUpdate, this);
          this._eventBus.subscribe("Stage", "ClearAllTabs", this._clearAllData, this);
          this._onTripDataUpdate();
          
          // Initialize weighment required if not set (default to "No")
          var oTripData = sap.ui.getCore().getModel("TripData");
          if (oTripData && !oTripData.getProperty("/WeighmentRequired")) {
            oTripData.setProperty("/WeighmentRequired", "N");
          }
          
          // Initialize attachments model
          this._initGateInAttachmentsModel();
          
          // Initialize selected files array
          this._aSelectedFiles = [];
        },
        
        _initGateInAttachmentsModel: function () {
          if (!this._oGateInAttachmentsModel) {
            this._oGateInAttachmentsModel = new JSONModel({ attachments: [] });
            this.getView().setModel(this._oGateInAttachmentsModel, "gateInAttachmentsModel");
          }
        },
        onAfterRendering: function () {
          this.loadDelayReason();
          this.loadGateNumber();
          
          // Set initial input state based on whether GateIn data exists
          var oTripData = sap.ui.getCore().getModel("TripData");
          if (oTripData) {
            var sExistingEntryGateNum = oTripData.getProperty("/EntryGateNum");
            if (sExistingEntryGateNum && sExistingEntryGateNum.trim() !== "") {
              // GateIn exists - disable inputs (display mode)
              this._setInputsEnabled(false);
            } else {
              // First time - enable inputs (create mode)
              this._setInputsEnabled(true);
            }
          } else {
            // No TripData - enable inputs for new entry
            this._setInputsEnabled(true);
          }
          
          // Load saved attachments
          this._loadGateInAttachments();
          
          // Focus on scanner input when page loads
          this._focusOnScannerInput();
        },
        onExit: function () {
          this._eventBus?.unsubscribe("TripData", "Updated", this._onTripDataUpdate, this);
          this._eventBus?.unsubscribe("Stage", "ClearAllTabs", this._clearAllData, this);
        },
        
        _clearAllData: function () {
          // Clear attachments model
          if (this._oGateInAttachmentsModel) {
            this._oGateInAttachmentsModel.setData({ attachments: [] });
          }
          
          // Clear selected files
          this._aSelectedFiles = [];
          
          // Clear any file uploaders
          var oFileUploader = this.byId("idGateInFileUploader");
          if (oFileUploader) {
            oFileUploader.clear();
          }
          
          // Clear input fields by resetting TripData properties if model exists
          var oTripData = this.getView().getModel("TripData");
          if (oTripData) {
            oTripData.setProperty("/EntryGateNum", "");
            oTripData.setProperty("/EntryTime", "");
            oTripData.setProperty("/DelayReason", "");
            oTripData.setProperty("/WeighmentRequired", "N");
            oTripData.setProperty("/GrossWeight", "");
            oTripData.setProperty("/TareWeight", "");
            oTripData.setProperty("/NetWeight", "");
          }
        },
        _onTripDataUpdate: function () {
          var oTripData = sap.ui.getCore().getModel("TripData");
          if (oTripData) {
            this.getView().setModel(oTripData, "TripData");
            // Disable inputs if GateIn data already exists (display mode)
            var sExistingEntryGateNum = oTripData.getProperty("/EntryGateNum");
            if (sExistingEntryGateNum && sExistingEntryGateNum.trim() !== "") {
              this._setInputsEnabled(false);
            } else {
              // First time - enable inputs
              this._setInputsEnabled(true);
            }
          }
          
          // Reload attachments when trip data updates
          this._loadGateInAttachments();
        },
        loadDelayReason: function () {
          this.oModel.read("/ConfigValues", {
            filters: [
              new sap.ui.model.Filter(
                "ConfigGroup",
                sap.ui.model.FilterOperator.EQ,
                "Delayed_Reasons"
              ),
            ],
            success: function (oData) {
              console.log("Delay reasons", oData.results);
              this._delayReasonData = oData.results;
            }.bind(this),
            error: function () {
              sap.m.MessageBox.error("Failed to load delay reasons.");
            },
          });
        },
        loadGateNumber: function () {
          this.oModel.read("/ConfigValues", {
            filters: [
              new sap.ui.model.Filter(
                "ConfigGroup",
                sap.ui.model.FilterOperator.EQ,
                "EntryGate"
              ),
            ],
            success: function (oData) {
              console.log("Entry Gate", oData.results);
              this._entryGateData = oData.results;
            }.bind(this),
            error: function () {
              sap.m.MessageBox.error("Failed to load entry gates.");
            },
          });
        },
        onEntryGateValueHelp: function (oEvent) {
          var oInput = oEvent.getSource();
          var oData = this._entryGateData;

          var that = this;

          // Load fragment directly
          if (!this._entryGateVH) {
            sap.ui.core.Fragment.load({
              name: "com.incresolZ_INC_PLMS.fragments.VehicleGateInFrags.EntryGateValueHelp",
              controller: this,
            }).then(function (oDialog) {
              that._entryGateVH = oDialog;

              // Bind list data
              oDialog.setModel(
                new sap.ui.model.json.JSONModel(oData),
                "helpModel"
              );

              that.getView().addDependent(oDialog);
              oDialog.open();
              that._vhInput = oInput; // input reference
            });
          } else {
            // Update model each time
            this._entryGateVH.setModel(
              new sap.ui.model.json.JSONModel(oData),
              "helpModel"
            );
            this._vhInput = oInput;
            this._entryGateVH.open();
          }
        },

        onEntryGateValueHelpConfirm: function (oEvent) {
          var oSelected = oEvent.getParameter("selectedItem");

          if (oSelected) {
            this._vhInput.setValue(oSelected.getTitle()); // ConfigID
          }

          // this._entryGateVH.close();
        },
        onEntryGateValueHelpSearch: function (oEvent) {
          var sValue = oEvent.getParameter("value") || "";
          var oBinding = oEvent.getSource().getBinding("items");

          if (!oBinding) {
            return;
          }

          var aFilters = [];
          if (sValue && sValue.trim().length > 0) {
            aFilters = [
              new sap.ui.model.Filter(
                "ConfigID",
                sap.ui.model.FilterOperator.Contains,
                sValue
              ),
              new sap.ui.model.Filter(
                "Description",
                sap.ui.model.FilterOperator.Contains,
                sValue
              ),
            ];
            oBinding.filter(
              new sap.ui.model.Filter({
                filters: aFilters,
                and: false,
              })
            );
          } else {
            // Clear filter when search is empty
            oBinding.filter([]);
          }
        },
        onDelayReasonValueHelp: function (oEvent) {
          var oInput = oEvent.getSource();
          var aData = this._delayReasonData; // <-- use loaded API data

          if (!aData || aData.length === 0) {
            sap.m.MessageToast.show("No delay reason data available");
            return;
          }

          var that = this;

          if (!this._delayReasonVH) {
            sap.ui.core.Fragment.load({
              name: "com.incresolZ_INC_PLMS.fragments.VehicleGateInFrags.DelayReasonValueHelp",
              controller: this,
            }).then(function (oDialog) {
              that._delayReasonVH = oDialog;

              // Bind data
              oDialog.setModel(
                new sap.ui.model.json.JSONModel(aData),
                "delayData"
              );

              that.getView().addDependent(oDialog);
              that._vhInput = oInput;
              oDialog.open();
            });
          } else {
            this._delayReasonVH.setModel(
              new sap.ui.model.json.JSONModel(aData),
              "delayData"
            );
            this._vhInput = oInput;
            this._delayReasonVH.open();
          }
        },
        onDelayReasonValueHelpConfirm: function (oEvent) {
          var oSelected = oEvent.getParameter("selectedItem");

          if (oSelected) {
            sID = oSelected.getTitle(); // ConfigID
            var sDesc = oSelected.getDescription(); // Description

            this._vhInput.setValue(sDesc + " - " + sID);
          }

          // this._delayReasonVH.close();
        },
        onDelayReasonValueHelpSearch: function (oEvent) {
          var sQuery = (oEvent.getParameter("value") || "").trim();
          var oBinding = oEvent.getSource().getBinding("items");

          if (!oBinding) {
            return;
          }

          if (sQuery && sQuery.length > 0) {
            var oFilter = new sap.ui.model.Filter({
              filters: [
                new sap.ui.model.Filter(
                  "ConfigID",
                  sap.ui.model.FilterOperator.Contains,
                  sQuery
                ),
                new sap.ui.model.Filter(
                  "Description",
                  sap.ui.model.FilterOperator.Contains,
                  sQuery
                ),
              ],
              and: false,
            });

            oBinding.filter(oFilter);
          } else {
            // Clear filter when search is empty
            oBinding.filter([]);
          }
        },
        onSaveGateInInfo: function () {
          // Use the ODataModel created in onInit()
          
          var oModel = this.oModel;

          if (!oModel) {
            console.error("OData model not found!");
            MessageBox.error("OData model is not loaded.");
            return;
          }

          var oView = this.getView();

          var sEntryGateNumber = oView.byId("idEntryGateNumber").getValue() || "";
          // var sDelayReasons = oView.byId("idDelayReasons").getValue();
          var sRemarks = oView.byId("idGateInRemarks").getValue() || "";
          
          // Get weighment required value
          var oWeighmentRadioGroup = oView.byId("idWeighmentRequired");
          var sWeighmentRequired = "N"; // Default to No
          if (oWeighmentRadioGroup) {
            var iSelectedIndex = oWeighmentRadioGroup.getSelectedIndex();
            sWeighmentRequired = iSelectedIndex === 0 ? "Y" : "N";
          }

          var sTripNumber = sap.ui
            .getCore()
            .getModel("globalData")
            .getProperty("/TripNumber") || "";
          
          // Ensure DelayReasons has a value (empty string if not selected)
          var sDelayReasons = sID || "";
          
          // Update TripData model with weighment required value
          var oTripData = sap.ui.getCore().getModel("TripData");
          if (oTripData) {
            oTripData.setProperty("/WeighmentRequired", sWeighmentRequired);
            // Publish event so Loading controller can react
            this._eventBus.publish("TripData", "WeighmentRequiredChanged", {
              weighmentRequired: sWeighmentRequired
            });
          }

          // Determine if this is first time (create) or update
          // Check if EntryGateNum already exists in TripData
          var bIsFirstTime = false;
          if (oTripData) {
            var sExistingEntryGateNum = oTripData.getProperty("/EntryGateNum");
            // If EntryGateNum is empty, null, or undefined, it's the first time
            bIsFirstTime = !sExistingEntryGateNum || sExistingEntryGateNum.trim() === "";
          } else {
            // If TripData doesn't exist, assume it's first time
            bIsFirstTime = true;
          }

          // Modified flag: false for create (first time), true for update
          var bModified = !bIsFirstTime;

          // Function Import Call with Custom Headers
          oModel.callFunction("/GateIn", {
            method: "POST",
            urlParameters: {
              TripNumber: sTripNumber,
              EntryGateNumber: sEntryGateNumber,
              Modified: bModified,
              Remarks: sRemarks || "",
              DelayReasons: sDelayReasons,
              // WeighmentRequired removed from payload - not sent to backend
            },
            headers: {
              "X-Requested-With": "X",
            },
            success: function (oData, oResponse) {
              var sMessage = bIsFirstTime 
                ? "Gate In information created successfully!" 
                : "Gate In information updated successfully!";
              
              // Reload complete TripData from backend to maintain data consistency
              var sTripNumber = sap.ui.getCore().getModel("globalData").getProperty("/TripNumber");
              if (sTripNumber) {
                this._reloadTripDataAfterSave(sTripNumber, sEntryGateNumber);
              } else {
                // Fallback: just update the property if no trip number
                var oTripData = sap.ui.getCore().getModel("TripData");
                if (oTripData) {
                  oTripData.setProperty("/EntryGateNum", sEntryGateNumber);
                  this._eventBus.publish("TripData", "Updated");
                }
              }
              
              // Upload attachments if any files were selected
              if (this._aSelectedFiles && this._aSelectedFiles.length > 0) {
                this._uploadGateInAttachments(function(bSuccess) {
                  if (bSuccess) {
                    MessageBox.success(sMessage + " Attachments uploaded successfully!");
                  } else {
                    MessageBox.success(sMessage);
                    MessageBox.warning("Some attachments failed to upload.");
                  }
                  
                  // Disable inputs after successful save
                  this._setInputsEnabled(false);
                  
                  // Reload attachments list
                  this._loadGateInAttachments();
                });
              } else {
                MessageBox.success(sMessage);
                // Disable inputs after successful save
                this._setInputsEnabled(false);
              }
            }.bind(this),
            error: function (oError) {
              this.getView().setBusy(false);

              let sMessage = "Failed to Gate In"; // default message

              try {
                // oError.responseText is JSON string from backend
                const oResponse = JSON.parse(oError.responseText);
                if (
                  oResponse.error &&
                  oResponse.error.message &&
                  oResponse.error.message.value
                ) {
                  sMessage = oResponse.error.message.value;
                }
              } catch (e) {
                // fallback if parsing fails, try oError.message.value
                if (oError.message && oError.message.value) {
                  sMessage = oError.message.value;
                }
              }

              MessageBox.error(sMessage);
            }.bind(this),
          });
        },
        formatTripDate: function (vDate) {
          if (!vDate) {
            return "";
          }
          if (vDate instanceof Date) {
            return vDate.toISOString().slice(0, 10);
          }
          if (typeof vDate === "string" && vDate.indexOf("/Date") === 0) {
            var iTimestamp = parseInt(vDate.replace(/\D/g, ""), 10);
            if (!isNaN(iTimestamp)) {
              return new Date(iTimestamp).toISOString().slice(0, 10);
            }
          }
          return vDate;
        },
        formatTripTime: function (vTime) {
          if (vTime == null) {
            return "";
          }
          var iMs = NaN;
          if (typeof vTime === "object" && typeof vTime.ms === "number") {
            iMs = vTime.ms;
          } else if (typeof vTime === "number") {
            iMs = vTime;
          } else if (typeof vTime === "string") {
            var oMatch = vTime.match(/PT(\d+)H(\d+)M(\d+)S/);
            if (oMatch) {
              iMs =
                ((parseInt(oMatch[1], 10) || 0) * 3600 +
                  (parseInt(oMatch[2], 10) || 0) * 60 +
                  (parseInt(oMatch[3], 10) || 0)) *
                1000;
            }
          }
          if (isNaN(iMs)) {
            return "";
          }
          var iHours = Math.floor(iMs / 3600000);
          var iMinutes = Math.floor((iMs % 3600000) / 60000);
          var iSeconds = Math.floor((iMs % 60000) / 1000);
          return (
            String(iHours).padStart(2, "0") +
            ":" +
            String(iMinutes).padStart(2, "0") +
            ":" +
            String(iSeconds).padStart(2, "0")
          );
        },
        formatWeighmentRequiredIndex: function (sValue) {
          // Convert "Y"/"N" to radio button index (0 = Yes, 1 = No)
          if (sValue === "Y" || sValue === "Yes") {
            return 0;
          }
          return 1; // Default to "No"
        },
        onWeighmentRequiredChange: function (oEvent) {
          var iSelectedIndex = oEvent.getParameter("selectedIndex");
          var sValue = iSelectedIndex === 0 ? "Y" : "N";
          
          var oTripData = sap.ui.getCore().getModel("TripData");
          if (oTripData) {
            oTripData.setProperty("/WeighmentRequired", sValue);
            // Publish event so Loading controller can react
            this._eventBus.publish("TripData", "WeighmentRequiredChanged", {
              weighmentRequired: sValue
            });
          }
        },
        onEditGateInInfo: function () {
          // Enable inputs for edit mode
          this._setInputsEnabled(true);
          MessageToast.show("Edit mode activated");
        },
        _setInputsEnabled: function (bEnabled) {
          try {
            var oPanel = this.getView().byId("gateInInfoPanel");
            if (!oPanel) return;
            
            // Check if vehicle is reported yet
            var oTripData = sap.ui.getCore().getModel("TripData");
            var bVehicleReported = false;
            if (oTripData) {
              var sVehicleNumber = oTripData.getProperty("/VehicleNumber");
              bVehicleReported = sVehicleNumber && sVehicleNumber.trim() !== "";
            }
            
            // Find all aggregated controls in the panel
            var aChildren = oPanel.findAggregatedObjects(true); // deep search
            
            var that = this;
            aChildren.forEach(function(ctrl) {
              var sCtrlId = ctrl.getId();
              
              // Ignore Edit/Save buttons (they are handled separately)
              if (sCtrlId && (sCtrlId.indexOf("btnEditGateInInfo") !== -1 || 
                              sCtrlId.indexOf("btnSaveGateInInfo") !== -1)) {
                return;
              }
              
              // Keep Scanner Input and Scan Button always enabled if vehicle is not reported
              if (!bVehicleReported && sCtrlId && 
                  (sCtrlId.indexOf("idGateInScannerInput") !== -1 || 
                   sCtrlId.indexOf("idGateInScanButton") !== -1)) {
                if (ctrl.setEditable) {
                  ctrl.setEditable(true);
                } else if (ctrl.setEnabled) {
                  ctrl.setEnabled(true);
                }
                return;
              }
              
              // Ignore other buttons
              if (ctrl.isA && ctrl.isA("sap.m.Button")) return;
              
              // Try setEditable first (for Input, TextArea, etc.)
              if (ctrl.setEditable) {
                try {
                  ctrl.setEditable(bEnabled);
                } catch (e) {
                  // Fallback to setEnabled if setEditable fails
                  if (ctrl.setEnabled) {
                    ctrl.setEnabled(bEnabled);
                  }
                }
              } else if (ctrl.setEnabled) {
                // For controls that only support setEnabled (like RadioButtonGroup)
                try {
                  ctrl.setEnabled(bEnabled);
                } catch (e) {
                  // Ignore errors
                }
              }
            });
            
            // Ensure Edit/Save buttons remain enabled
            if (this.getView().byId("btnEditGateInInfo")) {
              this.getView().byId("btnEditGateInInfo").setEnabled(true);
            }
            if (this.getView().byId("btnSaveGateInInfo")) {
              this.getView().byId("btnSaveGateInInfo").setEnabled(true);
            }
          } catch (e) {
            // Don't break if something unexpected happens
            console.error("Error in _setInputsEnabled: " + e);
          }
        },
        onGateInAttachmentChange: function (oEvent) {
          var oFileUploader = oEvent.getSource();
          
          // Get files from the native file input element
          var oDomRef = oFileUploader.getDomRef();
          var oFileInput = oDomRef ? oDomRef.querySelector("input[type='file']") : null;
          
          if (!oFileInput || !oFileInput.files || oFileInput.files.length === 0) {
            this._aSelectedFiles = [];
            // Disable preview button
            var oPreviewBtn = this.getView().byId("idPreviewSelectedGateInFiles");
            if (oPreviewBtn) {
              oPreviewBtn.setEnabled(false);
            }
            return;
          }
          
          // Store selected files
          this._aSelectedFiles = Array.from(oFileInput.files);
          
          // Enable preview button
          var oPreviewBtn = this.getView().byId("idPreviewSelectedGateInFiles");
          if (oPreviewBtn) {
            oPreviewBtn.setEnabled(true);
          }
        },
        onPreviewSelectedGateInFiles: function () {
          if (!this._aSelectedFiles || this._aSelectedFiles.length === 0) {
            MessageToast.show("Please select files first");
            return;
          }
          
          // Show preview for first file (or create a list to preview all)
          var oFile = this._aSelectedFiles[0];
          var sFileName = oFile.name;
          var sContentType = oFile.type || "application/octet-stream";
          
          // Read file as base64 for preview
          var oReader = new FileReader();
          oReader.onload = function (oEvent) {
            var sBase64Content = oEvent.target.result;
            // Remove data URL prefix
            var sBase64Data = sBase64Content.split(",")[1] || sBase64Content;
            
            // Create a temporary attachment object for preview
            var oTempAttachment = {
              fileName: sFileName,
              contentType: sContentType
            };
            
            // Show preview dialog
            this._showGateInPreviewDialog(oTempAttachment, sBase64Data, true);
          }.bind(this);
          
          oReader.onerror = function () {
            MessageToast.show("Failed to read file for preview");
          }.bind(this);
          
          oReader.readAsDataURL(oFile);
        },
        _uploadGateInAttachments: function (fnCallback) {
          if (!this._aSelectedFiles || this._aSelectedFiles.length === 0) {
            return;
          }

          var oGlobalModel = sap.ui.getCore().getModel("globalData");
          var sTripNumber = oGlobalModel?.getProperty("/TripNumber") || "";

          if (!sTripNumber) {
            MessageToast.show("Please open a trip first");
            return;
          }

          // Show busy indicator
          this.getView().setBusy(true);

          // Process each file
          var iTotalFiles = this._aSelectedFiles.length;
          var iProcessedFiles = 0;
          var iSuccessCount = 0;
          var iErrorCount = 0;

          var that = this;

          this._aSelectedFiles.forEach(function (oFile) {
            var sFileName = oFile.name;
            var sContentType = oFile.type || "application/octet-stream";

            // Read file as base64
            var oReader = new FileReader();
            oReader.onload = function (oEvent) {
              var sBase64Content = oEvent.target.result;
              // Remove data URL prefix (e.g., "data:image/jpeg;base64,")
              var sBase64Data = sBase64Content.split(",")[1] || sBase64Content;

              that._saveGateInAttachment(sTripNumber, sFileName, sContentType, sBase64Data, function (bSuccess) {
                iProcessedFiles++;
                if (bSuccess) {
                  iSuccessCount++;
                } else {
                  iErrorCount++;
                }

                // Check if all files are processed
                if (iProcessedFiles === iTotalFiles) {
                  that.getView().setBusy(false);
                  
                  // Clear file uploader
                  var oFileUploader = that.getView().byId("idGateInAttachments");
                  if (oFileUploader) {
                    oFileUploader.clear();
                  }
                  that._aSelectedFiles = [];
                  
                  // Disable preview button
                  var oPreviewBtn = that.getView().byId("idPreviewSelectedGateInFiles");
                  if (oPreviewBtn) {
                    oPreviewBtn.setEnabled(false);
                  }

                  // Call callback with success status
                  if (fnCallback) {
                    fnCallback(iErrorCount === 0);
                  }
                }
              });
            };

            oReader.onerror = function () {
              iProcessedFiles++;
              iErrorCount++;
              
              if (iProcessedFiles === iTotalFiles) {
                that.getView().setBusy(false);
                MessageToast.show("Failed to read some files");
              }
            };

            oReader.readAsDataURL(oFile);
          });
        },
        _saveGateInAttachment: function (sTripNumber, sFileName, sContentType, sBase64Data, fnCallback) {
          var oService = this.oModel;
          
          // Function to generate slug from a string (e.g., trip number)
          function generateSlug(inputString) {
            return inputString
              .toLowerCase()  // Convert to lowercase
              .replace(/\s+/g, '-')  // Replace spaces with hyphens
              .replace(/[^\w\-]+/g, '')  // Remove non-alphanumeric characters
              .replace(/--+/g, '-')  // Replace multiple hyphens with a single one
              .trim();  // Remove leading and trailing spaces
          }
          
          // Generate a slug from the trip number
          var slug = generateSlug(sTripNumber);
          
          // Extract file extension from original filename or content type
          var sFileExtension = "";
          var sBaseFileName = sFileName;
          if (sFileName && sFileName.lastIndexOf(".") > 0) {
            sBaseFileName = sFileName.substring(0, sFileName.lastIndexOf("."));
            sFileExtension = sFileName.substring(sFileName.lastIndexOf(".") + 1);
          } else if (sContentType && sContentType.indexOf("/") > 0) {
            sFileExtension = sContentType.split("/")[1];
          } else {
            sFileExtension = "bin";
          }
          
          // Create filename with slug and stage prefix
          var sSlugFileName = "GateIn_" + sBaseFileName + "_" + slug + "." + sFileExtension;
          
          var oPayload = {
            TripNumber: sTripNumber,
            FileName: sSlugFileName,
            ContentType: sContentType,
            Content: sBase64Data
          };

          var that = this;

          // Try to create first (if exists, will get error and we'll update)
          oService.create("/Attachments", oPayload, {
            headers: {
              "X-Requested-With": "X",
              "X-Driver-Slug": slug  // Send the slug in the header
            },
            success: function () {
              if (fnCallback) {
                fnCallback(true);
              }
            },
            error: function (oError) {
              // If creation fails (entity exists), try update
              if (oError.statusCode === 409 || oError.statusCode === 400) {
                that._updateGateInAttachment(sTripNumber, sSlugFileName, sContentType, sBase64Data, fnCallback);
              } else {
                if (fnCallback) {
                  fnCallback(false);
                }
                console.error("Upload error:", oError);
              }
            }
          });
        },
        _updateGateInAttachment: function (sTripNumber, sFileName, sContentType, sBase64Data, fnCallback) {
          var oService = this.oModel;
          var sPath = "/Attachments('" + sTripNumber + "')";
          
          var oPayload = {
            FileName: sFileName,
            ContentType: sContentType,
            Content: sBase64Data
          };

          oService.update(sPath, oPayload, {
            headers: {
              "X-Requested-With": "X"
            },
            success: function () {
              if (fnCallback) {
                fnCallback(true);
              }
            },
            error: function (oError) {
              if (fnCallback) {
                fnCallback(false);
              }
              console.error("Update attachment error:", oError);
            }
          });
        },
        _loadGateInAttachments: function () {
          // Ensure attachments model is initialized
          if (!this._oGateInAttachmentsModel) {
            this._initGateInAttachmentsModel();
          }

          var oGlobalModel = sap.ui.getCore().getModel("globalData");
          var sTripNumber = oGlobalModel?.getProperty("/TripNumber") || "";

          if (!sTripNumber) {
            this._oGateInAttachmentsModel.setProperty("/attachments", []);
            return;
          }

          var oService = this.oModel;
          // Try to read as collection first
          oService.read("/Attachments", {
            filters: [
              new sap.ui.model.Filter("TripNumber", sap.ui.model.FilterOperator.EQ, sTripNumber)
            ],
            success: function (oData) {
              var aAttachments = [];
              if (oData && oData.results && Array.isArray(oData.results)) {
                // Filter for GateIn attachments
                oData.results.forEach(function(oAttachment) {
                  if (oAttachment.FileName && oAttachment.FileName.startsWith("GateIn_")) {
                    aAttachments.push({
                      tripNumber: oAttachment.TripNumber || sTripNumber,
                      fileName: oAttachment.FileName || "",
                      contentType: oAttachment.ContentType || ""
                    });
                  }
                });
              } else if (oData && oData.FileName && oData.FileName.startsWith("GateIn_")) {
                // Single entity response
                aAttachments.push({
                  tripNumber: oData.TripNumber || sTripNumber,
                  fileName: oData.FileName || "",
                  contentType: oData.ContentType || ""
                });
              }
              this._oGateInAttachmentsModel.setProperty("/attachments", aAttachments);
            }.bind(this),
            error: function (oError) {
              // Try reading by key if collection read fails
              oService.read("/Attachments('" + sTripNumber + "')", {
                success: function (oData) {
                  var aAttachments = [];
                  if (oData && oData.FileName && oData.FileName.startsWith("GateIn_")) {
                    aAttachments.push({
                      tripNumber: oData.TripNumber || sTripNumber,
                      fileName: oData.FileName || "",
                      contentType: oData.ContentType || ""
                    });
                  }
                  this._oGateInAttachmentsModel.setProperty("/attachments", aAttachments);
                }.bind(this),
                error: function () {
                  this._oGateInAttachmentsModel.setProperty("/attachments", []);
                }.bind(this)
              });
            }.bind(this)
          });
        },
        onPreviewGateInAttachment: function (oEvent) {
          var oSource = oEvent.getSource();
          var oListItem = oSource.getParent();
          
          // Try to find the CustomListItem parent
          var oParent = oSource.getParent();
          while (oParent) {
            if (oParent.getBindingContext && oParent.getBindingContext("gateInAttachmentsModel")) {
              oListItem = oParent;
              break;
            }
            oParent = oParent.getParent ? oParent.getParent() : null;
          }
          
          if (oListItem) {
            var oContext = oListItem.getBindingContext("gateInAttachmentsModel");
            if (oContext) {
              var oAttachment = oContext.getObject();
              this._previewGateInAttachment(oAttachment);
              return;
            }
          }
          
          MessageToast.show("Unable to load attachment");
        },
        _previewGateInAttachment: function (oAttachment) {
          var sTripNumber = oAttachment.tripNumber || sap.ui.getCore().getModel("globalData")?.getProperty("/TripNumber") || "";

          if (!sTripNumber) {
            MessageToast.show("Trip number not found");
            return;
          }

          var oService = this.oModel;
          // Try reading as collection first
          oService.read("/Attachments", {
            filters: [
              new sap.ui.model.Filter("TripNumber", sap.ui.model.FilterOperator.EQ, sTripNumber),
              new sap.ui.model.Filter("FileName", sap.ui.model.FilterOperator.EQ, oAttachment.fileName)
            ],
            success: function (oData) {
              var oAttachmentData = null;
              if (oData && oData.results && Array.isArray(oData.results) && oData.results.length > 0) {
                oAttachmentData = oData.results[0];
              } else if (oData && oData.FileName === oAttachment.fileName) {
                oAttachmentData = oData;
              }
              
              if (oAttachmentData && oAttachmentData.Content) {
                this._showGateInPreviewDialog(oAttachment, oAttachmentData.Content, false);
              } else {
                // Try reading by key
                oService.read("/Attachments('" + sTripNumber + "')", {
                  success: function (oDataByKey) {
                    if (oDataByKey && oDataByKey.Content) {
                      this._showGateInPreviewDialog(oAttachment, oDataByKey.Content, false);
                    } else {
                      MessageToast.show("Attachment content not found");
                    }
                  }.bind(this),
                  error: function () {
                    MessageToast.show("Attachment not found");
                  }
                });
              }
            }.bind(this),
            error: function (oError) {
              // Try reading by key if collection read fails
              oService.read("/Attachments('" + sTripNumber + "')", {
                success: function (oDataByKey) {
                  if (oDataByKey && oDataByKey.Content) {
                    this._showGateInPreviewDialog(oAttachment, oDataByKey.Content, false);
                  } else {
                    MessageToast.show("Attachment content not found");
                  }
                }.bind(this),
                error: function () {
                  MessageToast.show("Failed to load attachment for preview");
                  console.error("Preview error:", oError);
                }
              });
            }.bind(this)
          });
        },
        _showGateInPreviewDialog: function (oAttachment, sBase64Content, bIsSelectedFile) {
          var that = this;
          
          // Create dialog if it doesn't exist
          if (!this._oGateInPreviewDialog) {
            this._oGateInPreviewDialog = new sap.m.Dialog({
              title: oAttachment.fileName,
              contentWidth: "90%",
              contentHeight: "85%",
              resizable: true,
              draggable: true,
              beginButton: new sap.m.Button({
                text: "Close",
                press: function () {
                  that._oGateInPreviewDialog.close();
                }
              }),
              endButton: new sap.m.Button({
                text: "Download",
                type: "Emphasized",
                icon: "sap-icon://download",
                press: function () {
                  that._downloadGateInAttachment(oAttachment, sBase64Content);
                }
              })
            });
            this.getView().addDependent(this._oGateInPreviewDialog);
          }

          // Update dialog title
          this._oGateInPreviewDialog.setTitle(oAttachment.fileName || "Preview");
          this._oGateInPreviewDialog.removeAllContent();

          var sContentType = oAttachment.contentType || "";
          var sBase64 = sBase64Content || "";

          if (!sBase64) {
            var oText = new sap.m.Text({
              text: "No content available for preview."
            });
            this._oGateInPreviewDialog.addContent(oText);
            this._oGateInPreviewDialog.open();
            return;
          }

          // Create data URL from base64 content
          var sDataUrl = "data:" + sContentType + ";base64," + sBase64;

          // Determine preview type based on content type
          if (sContentType.startsWith("image/")) {
            // Image preview
            var oScrollContainer = new sap.m.ScrollContainer({
              width: "100%",
              height: "100%",
              vertical: true,
              horizontal: true,
              content: [
                new sap.m.Image({
                  src: sDataUrl,
                  densityAware: false,
                  width: "100%",
                  height: "auto"
                })
              ]
            });
            this._oGateInPreviewDialog.addContent(oScrollContainer);
          } else if (sContentType === "application/pdf") {
            // PDF preview using iframe
            var oHTML = new sap.ui.core.HTML({
              content: '<iframe src="' + sDataUrl + '" style="width:100%;height:100%;border:none;"></iframe>'
            });
            this._oGateInPreviewDialog.addContent(oHTML);
          } else {
            // Other file types - show download option
            var oText = new sap.m.Text({
              text: "Preview not available for this file type. Please download to view."
            });
            this._oGateInPreviewDialog.addContent(oText);
          }

          this._oGateInPreviewDialog.open();
        },
        _downloadGateInAttachment: function (oAttachment, sBase64Content) {
          var sContentType = oAttachment.contentType || "application/octet-stream";
          var sFileName = oAttachment.fileName || "attachment";
          
          // Create data URL
          var sDataUrl = "data:" + sContentType + ";base64," + sBase64Content;
          
          // Create temporary link and trigger download
          var oLink = document.createElement("a");
          oLink.href = sDataUrl;
          oLink.download = sFileName;
          document.body.appendChild(oLink);
          oLink.click();
          document.body.removeChild(oLink);
        },

        //---------------------------------------------
        // SCANNER LOGIC
        //---------------------------------------------
        onScanSuccess: function () {
          var that = this;
          BarcodeScanner.scan(
            function (oResult) {
              console.log("Scan result:", oResult);
              if (!oResult.cancelled) {
                var sScannedCode = oResult.text;
                // Parse code if it contains pipe separator (e.g., "GATE001|Entry Gate 1")
                var sParsedCode = sScannedCode.split("|")[0];
                that._processScannedCode(sParsedCode);
              }
            }.bind(this),
            function (oError) {
              console.error("Scan failed:", oError);
              MessageToast.show("Scan failed: " + (oError.message || oError));
              setTimeout(function() {
                var oScannerInput = that.getView().byId("idGateInScannerInput");
                if (oScannerInput) {
                  oScannerInput.focus();
                }
              }, 200);
            }.bind(this)
          );
        },

        onScanLiveupdate: function (oEvent) {
          var sText = oEvent.getParameter("newValue");
          var oScannerInput = this.getView().byId("idGateInScannerInput");
          if (oScannerInput) {
            oScannerInput.setValue(sText);
          }
          // Process scanned code if value is entered
          if (sText && sText.trim() !== "") {
            var sParsedCode = sText.split("|")[0];
            this._processScannedCode(sParsedCode);
          }
        },

        _processScannedCode: function (sScannedCode) {
          console.log("=== SCANNER DEBUG ===");
          console.log("Processing scanned code:", sScannedCode);
          
          if (!sScannedCode || sScannedCode.trim() === "") {
            console.log("Invalid scan code - empty");
            MessageToast.show("Invalid scan code");
            return;
          }

          // Try to parse scanned code as JSON first
          var oScannedData = null;
          try {
            oScannedData = JSON.parse(sScannedCode);
            console.log("Parsed JSON data:", oScannedData);
          } catch (e) {
            // If not JSON, try to parse as comma-separated key-value pairs
            console.log("Scanned code is not JSON, trying to parse as key-value pairs");
            oScannedData = this._parseKeyValueString(sScannedCode);
            if (!oScannedData) {
              console.log("Failed to parse scanned code");
              MessageToast.show("Invalid barcode format");
              this._clearAndRefocusScanner();
              return;
            }
            console.log("Parsed key-value data:", oScannedData);
          }

          // Extract asnId and orgId from scanned data
          var sAsnId = oScannedData.asnId;
          var sOrgId = oScannedData.orgId;
          
          if (!sAsnId || !sOrgId) {
            console.log("Missing asnId or orgId in scanned data");
            console.log("Available keys:", Object.keys(oScannedData));
            MessageToast.show("Invalid barcode: Missing asnId or orgId");
            this._clearAndRefocusScanner();
            return;
          }

          console.log("Extracted asnId:", sAsnId);
          console.log("Extracted orgId:", sOrgId);

          // Step 1: Get OAuth Token
          this._getOAuthToken(sAsnId, sOrgId);
        },

        _parseKeyValueString: function (sString) {
          try {
            // Parse format like: "vendorCode=I0141,asnId=ASN5a8faad3,poNum=2000000294,orgId=a039ec0a-df8c-4b0b-abb5-7f41b2190fc6"
            var oResult = {};
            var aPairs = sString.split(',');
            aPairs.forEach(function(sPair) {
              var aKeyValue = sPair.split('=');
              if (aKeyValue.length === 2) {
                var sKey = aKeyValue[0].trim();
                var sValue = aKeyValue[1].trim();
                oResult[sKey] = sValue;
              }
            });
            console.log("Converted to JSON object:", oResult);
            return oResult;
          } catch (e) {
            console.error("Error parsing key-value string:", e);
            return null;
          }
        },

        _clearAndRefocusScanner: function () {
          var oScannerInput = this.getView().byId("idGateInScannerInput");
          if (oScannerInput) {
            oScannerInput.setValue("");
            setTimeout(function() {
              oScannerInput.focus();
            }, 100);
          }
        },

        _focusOnScannerInput: function () {
          var that = this;
          setTimeout(function() {
            var oScannerInput = that.getView().byId("idGateInScannerInput");
            if (oScannerInput && oScannerInput.focus) {
              oScannerInput.focus();
            }
          }, 200);
        },

        _getOAuthToken: function (sAsnId, sOrgId) {
          console.log("Getting OAuth token for asnId:", sAsnId, "orgId:", sOrgId);
          // Add your OAuth token logic here
          // This is a placeholder - implement according to your authentication requirements
          MessageToast.show("Scanner processed successfully! ASN ID: " + sAsnId);
        },

        _reloadTripDataAfterSave: function (sTripNumber, sEntryGateNumber) {
          console.log("Reloading TripData after Gate-In save for trip:", sTripNumber);
          
          var oModel = this.oModel;
          var that = this;
          
          // Read complete TripDetails with expanded data
          oModel.read("/TripDetails('" + sTripNumber + "')", {
            urlParameters: {
              "$expand": "OrderDetails,ItemDetails"
            },
            success: function (oData) {
              console.log("TripData reloaded successfully after Gate-In save");
              
              // Ensure EntryGateNum is set to the saved value
              oData.EntryGateNum = sEntryGateNumber;
              
              // Update global TripData model
              var oTripDataModel = new sap.ui.model.json.JSONModel(oData);
              sap.ui.getCore().setModel(oTripDataModel, "TripData");
              
              // Update view model
              that.getView().setModel(oTripDataModel, "TripData");
              
              // Publish event to notify other views with complete data
              that._eventBus.publish("TripData", "Updated");
              
              console.log("TripData model updated with complete data including OrderDetails and ItemDetails");
            },
            error: function (oError) {
              console.error("Failed to reload TripData after Gate-In save:", oError);
              
              // Fallback: just update the EntryGateNum property
              var oTripData = sap.ui.getCore().getModel("TripData");
              if (oTripData) {
                oTripData.setProperty("/EntryGateNum", sEntryGateNumber);
                that._eventBus.publish("TripData", "Updated");
              }
            }
          });
        },
      }
    );
  }
);
