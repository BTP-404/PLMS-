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
			
			// Load attachments on init
			this._loadAttachments();
		},

		onExit: function () {
			this._oEventBus?.unsubscribe("TripData", "Updated", this._loadAttachments, this);
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
				return;
			}
			
			this._oSelectedFile = oFileInput.files[0];
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

			var oFile = this._oSelectedFile;
			var sFileName = oFile.name;
			var sContentType = oFile.type || "application/octet-stream";

			// Read file as base64
			var oReader = new FileReader();
			oReader.onload = function (oEvent) {
				var sBase64Content = oEvent.target.result;
				// Remove data URL prefix (e.g., "data:image/jpeg;base64,")
				var sBase64Data = sBase64Content.split(",")[1] || sBase64Content;

				this._saveAttachment(sTripNumber, sFileName, sContentType, sBase64Data);
			}.bind(this);

			oReader.onerror = function () {
				MessageToast.show("Failed to read file");
			};

			oReader.readAsDataURL(oFile);
		},

		_saveAttachment: function (sTripNumber, sFileName, sContentType, sBase64Data) {
			var oService = this._getAttachmentsService();
			var sPath = "/Attachments('" + sTripNumber + "')";
			
			// Check if attachment already exists
			oService.read(sPath, {
				success: function () {
					// Attachment exists, update it
					this._updateAttachmentContent(sTripNumber, sFileName, sContentType, sBase64Data, true);
				}.bind(this),
				error: function () {
					// Attachment doesn't exist, create it
					this._createAttachment(sTripNumber, sFileName, sContentType, sBase64Data);
				}.bind(this)
			});
		},

		_createAttachment: function (sTripNumber, sFileName, sContentType, sBase64Data) {
			var oService = this._getAttachmentsService();
			
			// For media entities with HasStream="true", create with metadata first
			var oMetadata = {
				TripNumber: sTripNumber,
				FileName: sFileName,
				ContentType: sContentType
			};

			oService.create("/Attachments", oMetadata, {
				headers: {
					"X-Requested-With": "X"
				},
				success: function () {
					// Update with binary content
					this._updateAttachmentContent(sTripNumber, sFileName, sContentType, sBase64Data, false);
				}.bind(this),
				error: function (oError) {
					var sMessage = "Failed to create attachment";
					try {
						var oResponse = JSON.parse(oError.responseText);
						if (oResponse.error?.message?.value) {
							sMessage = oResponse.error.message.value;
						}
					} catch (e) {}
					MessageToast.show(sMessage);
					console.error("Create error:", oError);
				}
			});
		},

		_updateAttachmentContent: function (sTripNumber, sFileName, sContentType, sBase64Data, bIsUpdate) {
			var oService = this._getAttachmentsService();
			var sPath = "/Attachments('" + sTripNumber + "')/$value";
			
			// Convert base64 to binary
			var sBinaryData = atob(sBase64Data);
			var aBytes = new Uint8Array(sBinaryData.length);
			for (var i = 0; i < sBinaryData.length; i++) {
				aBytes[i] = sBinaryData.charCodeAt(i);
			}

			// Update metadata if updating existing attachment
			if (bIsUpdate) {
				var oMetadata = {
					FileName: sFileName,
					ContentType: sContentType
				};
				oService.update("/Attachments('" + sTripNumber + "')", oMetadata, {
					headers: {
						"X-Requested-With": "X"
					},
					success: function () {
						this._uploadBinaryContent(sPath, aBytes, sContentType);
					}.bind(this),
					error: function () {
						// Try uploading binary anyway
						this._uploadBinaryContent(sPath, aBytes, sContentType);
					}.bind(this)
				});
			} else {
				this._uploadBinaryContent(sPath, aBytes, sContentType);
			}
		},

		_uploadBinaryContent: function (sPath, aBytes, sContentType) {
			var oService = this._getAttachmentsService();
			
			oService.update(sPath, aBytes, {
				headers: {
					"X-Requested-With": "X",
					"Content-Type": sContentType
				},
				success: function () {
					MessageToast.show("Attachment uploaded successfully");
					this._loadAttachments();
					// Clear file uploader
					this.byId("idUnifiedUploader")?.clear();
					this._oSelectedFile = null;
				}.bind(this),
				error: function (oError) {
					var sMessage = "Failed to upload attachment content";
					try {
						var oResponse = JSON.parse(oError.responseText);
						if (oResponse.error?.message?.value) {
							sMessage = oResponse.error.message.value;
						}
					} catch (e) {}
					MessageToast.show(sMessage);
					console.error("Upload error:", oError);
				}
			});
		},

		_loadAttachments: function () {
			var oGlobalModel = sap.ui.getCore().getModel("globalData");
			var sTripNumber = oGlobalModel?.getProperty("/TripNumber") || "";

			if (!sTripNumber) {
				this._oAttachmentsModel.setProperty("/attachments", []);
				this._renderAttachmentsList();
				return;
			}

			var oService = this._getAttachmentsService();
			oService.read("/Attachments('" + sTripNumber + "')", {
				success: function (oData) {
					var aAttachments = [];
					if (oData && oData.FileName) {
						// Single attachment
						aAttachments.push({
							tripNumber: oData.TripNumber || "",
							fileName: oData.FileName || "",
							contentType: oData.ContentType || ""
						});
					}
					this._oAttachmentsModel.setProperty("/attachments", aAttachments);
					this._renderAttachmentsList();
				}.bind(this),
				error: function () {
					// Try reading as collection
					oService.read("/Attachments", {
						filters: [
							new Filter("TripNumber", FilterOperator.EQ, sTripNumber)
						],
						success: function (oData) {
							var aResults = oData.results || [];
							var aAttachments = aResults.map(function (oItem) {
								return {
									tripNumber: oItem.TripNumber || "",
									fileName: oItem.FileName || "",
									contentType: oItem.ContentType || ""
								};
							});
							this._oAttachmentsModel.setProperty("/attachments", aAttachments);
							this._renderAttachmentsList();
						}.bind(this),
						error: function () {
							this._oAttachmentsModel.setProperty("/attachments", []);
							this._renderAttachmentsList();
						}.bind(this)
					});
				}.bind(this)
			});
		},

		_renderAttachmentsList: function () {
			// List is bound to model, so it will auto-update
			// This function is kept for compatibility
		},

		onPreviewAttachment: function (oEvent) {
			var oItem = oEvent.getSource();
			var oContext = oItem.getBindingContext("attachmentsModel");
			if (oContext) {
				var oAttachment = oContext.getObject();
				this._previewAttachment(oAttachment);
			}
		},

		_previewAttachment: function (oAttachment) {
			var sTripNumber = oAttachment.tripNumber || sap.ui.getCore().getModel("globalData")?.getProperty("/TripNumber") || "";

			if (!sTripNumber) {
				MessageToast.show("Trip number not found");
				return;
			}

			var oService = this._getAttachmentsService();
			var sPath = "/Attachments('" + sTripNumber + "')/$value";

			// Fetch the binary content
			oService.read(sPath, {
				headers: {
					"Accept": oAttachment.contentType || "*/*"
				},
				success: function (oData) {
					// Create preview dialog
					this._showPreviewDialog(oAttachment, oData);
				}.bind(this),
				error: function () {
					MessageToast.show("Failed to load attachment for preview");
				}
			});
		},

		_showPreviewDialog: function (oAttachment, oContent) {
			if (!this._oPreviewDialog) {
				this._oPreviewDialog = new Dialog({
					title: oAttachment.fileName,
					contentWidth: "80%",
					contentHeight: "80%",
					resizable: true,
					draggable: true,
					beginButton: new Button({
						text: "Close",
						press: function () {
							this._oPreviewDialog.close();
						}.bind(this)
					})
				});
				this.getView().addDependent(this._oPreviewDialog);
			}

			this._oPreviewDialog.setTitle(oAttachment.fileName);
			this._oPreviewDialog.removeAllContent();

			var sContentType = oAttachment.contentType || "";
			var sFileName = oAttachment.fileName || "";

			// Determine if it's an image
			if (sContentType.startsWith("image/")) {
				// For images, create base64 data URL
				var sBase64 = "";
				if (typeof oContent === "string") {
					sBase64 = oContent;
				} else {
					// Convert binary to base64
					var aBytes = new Uint8Array(oContent);
					var sBinary = "";
					for (var i = 0; i < aBytes.length; i++) {
						sBinary += String.fromCharCode(aBytes[i]);
					}
					sBase64 = btoa(sBinary);
				}
				var sDataUrl = "data:" + sContentType + ";base64," + sBase64;

				var oImage = new Image({
					src: sDataUrl,
					densityAware: false,
					width: "100%",
					height: "100%"
				});
				this._oPreviewDialog.addContent(oImage);
			} else if (sContentType === "application/pdf") {
				// For PDF, use iframe
				var sBase64 = "";
				if (typeof oContent === "string") {
					sBase64 = oContent;
				} else {
					var aBytes = new Uint8Array(oContent);
					var sBinary = "";
					for (var i = 0; i < aBytes.length; i++) {
						sBinary += String.fromCharCode(aBytes[i]);
					}
					sBase64 = btoa(sBinary);
				}
				var sDataUrl = "data:" + sContentType + ";base64," + sBase64;

				var oIFrame = new HTML({
					content: '<iframe src="' + sDataUrl + '" width="100%" height="100%" style="border:none;"></iframe>'
				});
				this._oPreviewDialog.addContent(oIFrame);
			} else {
				// For other types, show download option
				var oText = new Text({
					text: "Preview not available for this file type. Please download to view."
				});
				this._oPreviewDialog.addContent(oText);
			}

			this._oPreviewDialog.open();
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
					console.error("Delete error:", oError);
				}
			});
		}
	});
});

