sap.ui.define([
	"sap/ui/core/mvc/Controller",
	"sap/ui/core/Core",
	"sap/m/StandardListItem"
], function(Controller, Core, StandardListItem) {
	"use strict";
	return Controller.extend("com.incresolZ_INC_PLMS.controller.Stage", {
		onInit: function() {
			var oRouter = this.getOwnerComponent().getRouter();
			oRouter.getRoute("Stage").attachPatternMatched(this._onRouteMatched, this);
			oRouter.getRoute("StagewithParam").attachPatternMatched(this._onRouteMatched, this);
		},
		onAfterRendering: function() {},

		_onRouteMatched: function(oEvent) {
			var sTripNumber = oEvent.getParameter("arguments").tripNo;
			console.log("Navigated with Trip:", sTripNumber);

			// You can now filter data for this trip or bind it to the view
		},
		onDriverPhotoChange: function(oEvent) {
			const oUploader = oEvent.getSource();
			const aFiles = oEvent.getParameter("files");
			if (aFiles && aFiles.length > 0) {
				sap.m.MessageToast.show("Selected file: " + aFiles[0].name);
			}
		},
		onDriverPhotoUploadComplete: function(oEvent) {
			const sResponse = oEvent.getParameter("response");
			sap.m.MessageToast.show("Upload completed: " + sResponse);
		},
		onSaveReporting: function(oEvent) {
			alert("Save clicked");
		},
		onAddLoadingRow: function() {
			var oTable = this.byId("idLoadingMaterialTable");
			var oTemplate = oTable.getItems()[0].clone();

			// Reset inputs in new row
			oTemplate.getCells().forEach(function(cell) {
				if (cell instanceof sap.m.Input) {
					cell.setValue("");
				} else if (cell instanceof sap.m.Select) {
					cell.setSelectedKey("");
				} else if (cell instanceof sap.m.DatePicker) {
					cell.setDateValue(null);
				} else if (cell instanceof sap.m.TimePicker) {
					cell.setValue("");
				}
			});

			oTable.addItem(oTemplate);
			sap.m.MessageToast.show("New row added");
		},

		onEditLoading: function() {
			console.log("Edit button clicked for Loading section");
			sap.m.MessageToast.show("Edit mode triggered");
		},

		onSaveLoading: function() {
			var oTable = this.byId("idLoadingMaterialTable");
			var aData = [];

			oTable.getItems().forEach(function(oItem) {
				var aCells = oItem.getCells();
				var oRowData = {
					RefDocNumber: aCells[0].getSelectedKey ? aCells[0].getSelectedKey() : "",
					RefDocItemNumber: aCells[1].getSelectedKey ? aCells[1].getSelectedKey() : "",
					MaterialCode: aCells[2].getValue ? aCells[2].getValue() : "",
					MaterialDescription: aCells[3].getValue ? aCells[3].getValue() : "",
					Qty: aCells[4].getValue ? aCells[4].getValue() : "",
					UoM: aCells[5].getSelectedKey ? aCells[5].getSelectedKey() : "",
					LoadedQtyNetWt: aCells[6].getValue ? aCells[6].getValue() : "",
					GrossWt: aCells[7].getValue ? aCells[7].getValue() : "",
					TareWt: aCells[8].getValue ? aCells[8].getValue() : "",
					CreatedBy: aCells[9].getSelectedKey ? aCells[9].getSelectedKey() : "",
					CreatedOnDate: aCells[10].getDateValue ? aCells[10].getDateValue() : "",
					CreatedOnTime: aCells[11].getValue ? aCells[11].getValue() : "",
					ChangedBy: aCells[12].getSelectedKey ? aCells[12].getSelectedKey() : "",
					ChangedOnDate: aCells[13].getDateValue ? aCells[13].getDateValue() : "",
					ChangedOnTime: aCells[14].getValue ? aCells[14].getValue() : ""
				};
				aData.push(oRowData);
			});

			console.log("Saved Loading Table Data:", aData);
			sap.m.MessageToast.show("Data logged to console");
		},
		onDeleteLoadingRow: function(oEvent) {
			var oTable = this.byId("idLoadingMaterialTable");
			var aItems = oTable.getItems();

			// Prevent deleting if only one row left
			if (aItems.length <= 1) {
				sap.m.MessageToast.show("At least one row must remain.");
				return;
			}

			// Identify and remove the specific row
			var oItem = oEvent.getSource().getParent(); // the ColumnListItem
			oTable.removeItem(oItem);

			sap.m.MessageToast.show("Row deleted successfully.");
		},
		onAddRefDocRow: function() {
			var oTable = this.byId("idReferenceDocsTable");
			var oNewItem = oTable.getItems()[0].clone();
			oTable.addItem(oNewItem);
		},

		onDeleteRefDocRow: function(oEvent) {
			var oTable = this.byId("idReferenceDocsTable");
			var aItems = oTable.getItems();
			if (aItems.length > 1) {
				oTable.removeItem(oEvent.getSource().getParent());
			} else {
				sap.m.MessageToast.show("At least one row must remain.");
			}
		},

		onAddMaterialRow: function() {
			var oTable = this.byId("idMaterialDetailsTable");
			var oNewItem = oTable.getItems()[0].clone();
			oTable.addItem(oNewItem);
		},

		onDeleteMaterialRow: function(oEvent) {
			var oTable = this.byId("idMaterialDetailsTable");
			var aItems = oTable.getItems();
			if (aItems.length > 1) {
				oTable.removeItem(oEvent.getSource().getParent());
			} else {
				sap.m.MessageToast.show("At least one row must remain.");
			}
		},

		onEditReferenceDocs: function() {
			console.log("Edit clicked for Reference Documents & Materials tab");
		},

		onSaveReferenceDocs: function() {
			var refRows = this.byId("idReferenceDocsTable").getItems();
			var matRows = this.byId("idMaterialDetailsTable").getItems();
			console.log("Reference Documents Rows:", refRows.length);
			console.log("Material Details Rows:", matRows.length);
		},

		onSaveNote: function() {
			const oTextArea = this.byId("idNoteInput");
			const sText = oTextArea.getValue().trim();
			const oContainer = this.byId("idNotesContainer");
			const oNoNotesText = this.byId("idNoNotesText");

			if (!sText) {
				sap.m.MessageToast.show("Please enter a note before saving.");
				return;
			}

			oNoNotesText.setVisible(false);

			// Create light blue sticky note
			const oNoteBox = new sap.m.VBox({
				items: [
					new sap.m.Text({
						text: sText,
						wrapping: true
					})
				]
			}).addStyleClass("stickyNoteLightBlue");

			oContainer.addItem(oNoteBox);

			oTextArea.setValue("");
		},
		onFileChange: function(oEvent) {
			const aFiles = oEvent.getParameter("files");
			if (aFiles && aFiles.length > 0) {
				console.log("Selected file:", aFiles[0].name);
			}
		},

		onUploadDocument: function() {
			const oStageSelect = this.byId("idStageSelect");
			const sStage = oStageSelect.getSelectedKey();
			const oUploader = this.byId("idUnifiedUploader");
			const aFiles = oUploader.oFileUpload.files;

			if (!sStage) {
				MessageToast.show("Please select a stage.");
				return;
			}

			if (aFiles.length === 0) {
				MessageToast.show("Please choose a file to upload.");
				return;
			}

			const oList = this.byId("idUploadedFilesList");
			const oFile = aFiles[0];

			const oItem = new StandardListItem({
				title: oFile.name,
				description: `Stage: ${sStage}`,
				icon: "sap-icon://attachment",
				type: "Inactive"
			});

			oList.addItem(oItem);
			MessageToast.show("File uploaded successfully (simulated).");
			oUploader.clear();
		},

		onDeleteFile: function(oEvent) {
			const oItem = oEvent.getParameter("listItem");
			this.byId("idUploadedFilesList").removeItem(oItem);
			MessageToast.show("File removed.");
		}

	});
});