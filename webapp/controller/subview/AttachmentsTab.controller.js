sap.ui.define([
	"sap/ui/core/mvc/Controller",
	"sap/ui/model/json/JSONModel",
	"sap/ui/model/odata/v2/ODataModel",
	"sap/m/MessageBox",
	"sap/m/MessageToast",
	"sap/m/StandardListItem",
	"sap/m/Dialog",
	"sap/m/Button",
	"sap/m/Image",
	"sap/m/Text",
	"sap/ui/core/HTML",
	"sap/ui/model/Filter",
	"sap/ui/model/FilterOperator"
], function(Controller, JSONModel, ODataModel, MessageBox, MessageToast, StandardListItem, Dialog, Button, Image, Text, HTML, Filter, FilterOperator) {
	"use strict";

	return Controller.extend("com.incresolZ_INC_PLMS.controller.subview.AttachmentsTab", {
		
		onInit: function() {
			// Initialize attachments model
			this._initAttachmentsModel();
			
			// Subscribe to TripData updates
			this._oEventBus = sap.ui.getCore().getEventBus();
			this._oEventBus.subscribe("TripData", "Updated", this._loadAttachments, this);
			this._oEventBus.subscribe("Stage", "ClearAllTabs", this._clearAllData, this);
			
			// Removed direct call - will be triggered by event subscription when TripData is available
		},

		onExit: function () {
			this._oEventBus?.unsubscribe("TripData", "Updated", this._loadAttachments, this);
			this._oEventBus?.unsubscribe("Stage", "ClearAllTabs", this._clearAllData, this);
		},
		
		_clearAllData: function () {
			// Clear attachments model
			if (this._oAttachmentsModel) {
				this._oAttachmentsModel.setData({ attachments: [] });
			}
			
			// Clear selected file
			this._oSelectedFile = null;
			
			// Clear file uploader
			var oFileUploader = this.byId("idAttachmentFileUploader");
			if (oFileUploader) {
				oFileUploader.clear();
			}
			
			// Clear stage select
			var oStageSelect = this.byId("idStageSelect");
			if (oStageSelect) {
				oStageSelect.setSelectedKey("");
			}
			
			// Clear preview button
			var oPreviewBtn = this.byId("idPreviewSelectedFile");
			if (oPreviewBtn) {
				oPreviewBtn.setEnabled(false);
			}
		},

		_initAttachmentsModel: function () {
			if (!this._oAttachmentsModel) {
				this._oAttachmentsModel = new JSONModel({ attachments: [] });
				this.getView().setModel(this._oAttachmentsModel, "attachmentsModel");
			}
		},

		_getAttachmentsService: function () {
			if (!this._oAttachmentsService) {
				this._oAttachmentsService = new ODataModel("/sap/opu/odata/sap/YIGP_PLMS_SRV/", {
					useBatch: false,
					defaultBindingMode: "TwoWay"
				});
			}
			return this._oAttachmentsService;
		},

		onFileChange: function (oEvent) {
			var oFileUploader = oEvent.getSource();
			
			// Get files from the native file input element
			var oDomRef = oFileUploader.getDomRef();
			var oFileInput = oDomRef ? oDomRef.querySelector("input[type='file']") : null;
			
			if (!oFileInput || !oFileInput.files || oFileInput.files.length === 0) {
				this._oSelectedFile = null;
				// Disable preview button
				var oPreviewBtn = this.byId("idPreviewSelectedFile");
				if (oPreviewBtn) {
					oPreviewBtn.setEnabled(false);
				}
				return;
			}
			
			this._oSelectedFile = oFileInput.files[0];
			
			// Enable preview button
			var oPreviewBtn = this.byId("idPreviewSelectedFile");
			if (oPreviewBtn) {
				oPreviewBtn.setEnabled(true);
			}
		},

		onUploadDocument: function () {
			if (!this._oSelectedFile) {
				MessageToast.show("Please select a file to upload");
				return;
			}

			var oGlobalModel = sap.ui.getCore().getModel("globalData");
			var sTripNumber = oGlobalModel?.getProperty("/TripNumber") || "";

			if (!sTripNumber) {
				MessageToast.show("Please open a trip first");
				return;
			}

			var oStageSelect = this.byId("idStageSelect");
			var sStage = oStageSelect ? oStageSelect.getSelectedKey() : "";
			// Note: Stage is not part of the Attachments entity, so it's only for UI reference

			var oFile = this._oSelectedFile;
			var sFileName = oFile.name;
			var sContentType = oFile.type || "application/octet-stream";

			// Show busy indicator
			this.getView().setBusy(true);

			// Read file as base64
			var oReader = new FileReader();
			oReader.onload = function (oEvent) {
				var sBase64Content = oEvent.target.result;
				// Remove data URL prefix (e.g., "data:image/jpeg;base64,")
				var sBase64Data = sBase64Content.split(",")[1] || sBase64Content;

				this._saveAttachment(sTripNumber, sFileName, sContentType, sBase64Data, sStage);
			}.bind(this);

			oReader.onerror = function () {
				this.getView().setBusy(false);
				MessageToast.show("Failed to read file");
			}.bind(this);

			oReader.readAsDataURL(oFile);
		},

	_saveAttachment: function (sTripNumber, sFileName, sContentType, sBase64Data, sStage) {
		var oService = this._getAttachmentsService();
		
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
		
		// Create filename with slug
		var sSlugFileName = sBaseFileName + "_" + slug + "." + sFileExtension;
		
		// Since TripNumber is the key and Content is Edm.String, we store base64 directly
		// For slug-based entities, we create/update with all properties including Content
		var oPayload = {
			TripNumber: sTripNumber,
			FileName: sSlugFileName,
			ContentType: sContentType,
			Content: sBase64Data
		};

		// Try to create first (if exists, will get error and we'll update)
		oService.create("/Attachments", oPayload, {
			headers: {
				"X-Requested-With": "X",
				"X-Driver-Slug": slug  // Send the slug in the header
			},
			success: function () {
				this.getView().setBusy(false);
				MessageToast.show("Attachment uploaded successfully");
				this._loadAttachments();
				this._clearUploadForm();
			}.bind(this),
			error: function (oError) {
				// If creation fails (entity exists), try update
				if (oError.statusCode === 409 || oError.statusCode === 400) {
					this._updateAttachment(sTripNumber, sFileName, sContentType, sBase64Data);
				} else {
					this.getView().setBusy(false);
					var sMessage = "Failed to upload attachment";
					try {
						var oResponse = JSON.parse(oError.responseText);
						if (oResponse.error?.message?.value) {
							sMessage = oResponse.error.message.value;
						}
					} catch (e) {}
					MessageToast.show(sMessage);
					// Upload error
				}
			}.bind(this)
		});
	},

	_updateAttachment: function (sTripNumber, sFileName, sContentType, sBase64Data) {
		var oService = this._getAttachmentsService();
		var sPath = "/Attachments('" + sTripNumber + "')";
		
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
		
		// Create filename with slug
		var sSlugFileName = sBaseFileName + "_" + slug + "." + sFileExtension;
		
		var oPayload = {
			FileName: sSlugFileName,
			ContentType: sContentType,
			Content: sBase64Data
		};

		oService.update(sPath, oPayload, {
			headers: {
				"X-Requested-With": "X",
				"X-Driver-Slug": slug  // Send the slug in the header
			},
			success: function () {
				this.getView().setBusy(false);
				MessageToast.show("Attachment updated successfully");
				this._loadAttachments();
				this._clearUploadForm();
			}.bind(this),
			error: function (oError) {
				this.getView().setBusy(false);
				var sMessage = "Failed to update attachment";
				try {
					var oResponse = JSON.parse(oError.responseText);
					if (oResponse.error?.message?.value) {
						sMessage = oResponse.error.message.value;
					}
				} catch (e) {}
				MessageToast.show(sMessage);
				// Update error
			}.bind(this)
		});
	},

		onPreviewSelectedFile: function () {
			if (!this._oSelectedFile) {
				MessageToast.show("Please select a file first");
				return;
			}

			var oFile = this._oSelectedFile;
			var sFileName = oFile.name;
			var sContentType = oFile.type || "application/octet-stream";

			// Read file as base64 for preview
			var oReader = new FileReader();
			oReader.onload = function (oEvent) {
				var sBase64Content = oEvent.target.result;
				// Remove data URL prefix (e.g., "data:image/jpeg;base64,")
				var sBase64Data = sBase64Content.split(",")[1] || sBase64Content;

				// Create a temporary attachment object for preview
				var oTempAttachment = {
					fileName: sFileName,
					contentType: sContentType,
					tripNumber: sap.ui.getCore().getModel("globalData")?.getProperty("/TripNumber") || ""
				};

				// Show preview dialog (mark as selected file)
				this._showPreviewDialog(oTempAttachment, sBase64Data, true);
			}.bind(this);

			oReader.onerror = function () {
				MessageToast.show("Failed to read file for preview");
			}.bind(this);

			oReader.readAsDataURL(oFile);
		},

		_clearUploadForm: function () {
			// Clear file uploader
			var oFileUploader = this.byId("idUnifiedUploader");
			if (oFileUploader) {
				oFileUploader.clear();
			}
			this._oSelectedFile = null;
			
			// Disable preview button
			var oPreviewBtn = this.byId("idPreviewSelectedFile");
			if (oPreviewBtn) {
				oPreviewBtn.setEnabled(false);
			}
			
			// Reset stage selection
			var oStageSelect = this.byId("idStageSelect");
			if (oStageSelect) {
				oStageSelect.setSelectedKey("");
			}
		},

		_loadAttachments: function () {
			var oGlobalModel = sap.ui.getCore().getModel("globalData");
			var sTripNumber = oGlobalModel?.getProperty("/TripNumber") || "";

			if (!sTripNumber) {
				this._oAttachmentsModel.setProperty("/attachments", []);
				this._renderAttachmentsList();
				return;
			}

			this._oAttachmentsModel.setProperty("/attachments", []);
			this._renderAttachmentsList();
		},

		_renderAttachmentsList: function () {
			// List is bound to model, so it will auto-update
			// This function is kept for compatibility
		},

		onPreviewAttachment: function (oEvent) {
			// Get the CustomListItem parent if button was clicked
			var oSource = oEvent.getSource();
			var oListItem = null;
			
			// Try to find the CustomListItem parent
			var oParent = oSource.getParent();
			while (oParent) {
				if (oParent.getBindingContext && oParent.getBindingContext("attachmentsModel")) {
					oListItem = oParent;
					break;
				}
				oParent = oParent.getParent ? oParent.getParent() : null;
			}
			
			if (oListItem) {
				var oContext = oListItem.getBindingContext("attachmentsModel");
				if (oContext) {
					var oAttachment = oContext.getObject();
					this._previewAttachment(oAttachment);
					return;
				}
			}
			
			// Fallback: try to get from event source directly
			var oContext = oSource.getBindingContext("attachmentsModel");
			if (oContext) {
				var oAttachment = oContext.getObject();
				this._previewAttachment(oAttachment);
			} else {
				MessageToast.show("Unable to load attachment");
			}
		},

		_previewAttachment: function (oAttachment) {
			var sTripNumber = oAttachment.tripNumber || sap.ui.getCore().getModel("globalData")?.getProperty("/TripNumber") || "";

			if (!sTripNumber) {
				MessageToast.show("Trip number not found");
				return;
			}

			var oService = this._getAttachmentsService();
			var sPath = "/Attachments('" + sTripNumber + "')";

			// Fetch the attachment with Content property (base64 string)
			oService.read(sPath, {
				success: function (oData) {
					if (!oData || !oData.Content) {
						MessageToast.show("Attachment content not found");
						return;
					}
					// Content is already base64 string, use it directly (uploaded file)
					this._showPreviewDialog(oAttachment, oData.Content, false);
				}.bind(this),
				error: function (oError) {
					MessageToast.show("Failed to load attachment for preview");
					// Preview error
				}.bind(this)
			});
		},

		_showPreviewDialog: function (oAttachment, sBase64Content, bIsSelectedFile) {
			var that = this;
			var bIsSelected = bIsSelectedFile || false;
			
			// Create dialog if it doesn't exist
			if (!this._oPreviewDialog) {
				this._oPreviewDialog = new Dialog({
					title: oAttachment.fileName,
					contentWidth: "90%",
					contentHeight: "85%",
					resizable: true,
					draggable: true,
					beginButton: new Button({
						text: "Close",
						press: function () {
							that._oPreviewDialog.close();
						}
					}),
					endButton: new Button({
						text: "Download",
						type: "Emphasized",
						icon: "sap-icon://download",
						press: function () {
							that._downloadAttachment(oAttachment, sBase64Content);
						}
					})
				});
				this.getView().addDependent(this._oPreviewDialog);
			}

			// Update dialog title and buttons
			this._oPreviewDialog.setTitle(oAttachment.fileName || "Preview");
			var oDownloadBtn = this._oPreviewDialog.getEndButton();
			if (oDownloadBtn) {
				// Always show download button - it works for both selected and uploaded files
				oDownloadBtn.setVisible(true);
				oDownloadBtn.setText(bIsSelected ? "Download Selected File" : "Download");
			}
			this._oPreviewDialog.removeAllContent();

			var sContentType = oAttachment.contentType || "";
			var sBase64 = sBase64Content || "";

			if (!sBase64) {
				var oText = new Text({
					text: "No content available for preview."
				});
				this._oPreviewDialog.addContent(oText);
				this._oPreviewDialog.open();
				return;
			}

			// Create data URL from base64 content
			var sDataUrl = "data:" + sContentType + ";base64," + sBase64;

			// Determine preview type based on content type
			if (sContentType.startsWith("image/")) {
				// For images, display directly with scroll container
				var oScrollContainer = new sap.m.ScrollContainer({
					width: "100%",
					height: "100%",
					vertical: true,
					horizontal: true,
					content: [
						new Image({
							src: sDataUrl,
							densityAware: false,
							width: "100%",
							height: "auto"
						})
					]
				});
				this._oPreviewDialog.addContent(oScrollContainer);
			} else if (sContentType === "application/pdf") {
				// For PDF, use iframe with full height
				var oScrollContainer = new sap.m.ScrollContainer({
					width: "100%",
					height: "100%",
					vertical: false,
					horizontal: false,
					content: [
						new HTML({
							content: '<iframe src="' + sDataUrl + '" width="100%" height="100%" style="border:none; min-height: 600px;"></iframe>'
						})
					]
				});
				this._oPreviewDialog.addContent(oScrollContainer);
			} else {
				// For other types, provide download option
				var oVBox = new sap.m.VBox({
					class: "sapUiMediumPadding",
					items: [
						new Text({
							text: "Preview not available for this file type. Please download to view.",
							class: "sapUiMediumMarginBottom"
						}),
						new Button({
							text: "Download File",
							type: "Emphasized",
							icon: "sap-icon://download",
							press: function () {
								that._downloadAttachment(oAttachment, sBase64);
							}
						})
					]
				});
				this._oPreviewDialog.addContent(oVBox);
			}

			this._oPreviewDialog.open();
		},

		_downloadAttachment: function (oAttachment, sBase64Content) {
			try {
				// Convert base64 to blob
				var sContentType = oAttachment.contentType || "application/octet-stream";
				var sBinary = atob(sBase64Content);
				var aBytes = new Uint8Array(sBinary.length);
				for (var i = 0; i < sBinary.length; i++) {
					aBytes[i] = sBinary.charCodeAt(i);
				}
				var oBlob = new Blob([aBytes], { type: sContentType });

				// Create download link
				var oUrl = URL.createObjectURL(oBlob);
				var oLink = document.createElement("a");
				oLink.href = oUrl;
				oLink.download = oAttachment.fileName || "attachment";
				document.body.appendChild(oLink);
				oLink.click();
				document.body.removeChild(oLink);
				URL.revokeObjectURL(oUrl);

				MessageToast.show("Download started");
			} catch (oError) {
				MessageToast.show("Failed to download file");
				// Download error
			}
		},

		onDeleteFile: function (oEvent) {
			var oItem = oEvent.getParameter("listItem");
			var sTitle = oItem.getTitle();
			var aAttachments = this._oAttachmentsModel.getProperty("/attachments") || [];
			var oAttachment = aAttachments.find(function (oAtt) {
				return oAtt.fileName === sTitle;
			});

			if (!oAttachment) {
				return;
			}

			var sTripNumber = oAttachment.tripNumber || sap.ui.getCore().getModel("globalData")?.getProperty("/TripNumber") || "";

			if (!sTripNumber) {
				MessageToast.show("Trip number not found");
				return;
			}

			MessageBox.confirm(
				"Are you sure you want to delete this attachment?",
				{
					title: "Confirm Deletion",
					actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
					onClose: function (sAction) {
						if (sAction === MessageBox.Action.OK) {
							this._deleteAttachment(sTripNumber);
						}
					}.bind(this)
				}
			);
		},

		_deleteAttachment: function (sTripNumber) {
			var oService = this._getAttachmentsService();
			var sPath = "/Attachments('" + sTripNumber + "')";

			oService.remove(sPath, {
				headers: {
					"X-Requested-With": "X"
				},
				success: function () {
					MessageToast.show("Attachment deleted successfully");
					this._loadAttachments();
				}.bind(this),
				error: function (oError) {
					MessageToast.show("Failed to delete attachment");
					// Delete error
				}
			});
		}
	});
});

