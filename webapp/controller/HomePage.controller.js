sap.ui.define([
	"sap/ui/core/mvc/Controller",
	"sap/ui/model/odata/v2/ODataModel",
	"sap/m/MessageToast",
	"sap/ui/model/Filter",
	"sap/ui/model/FilterOperator",
	"sap/m/SelectDialog",
	"sap/m/StandardListItem",
	"sap/m/SuggestionItem"
], function (Controller, ODataModel, MessageToast, Filter, FilterOperator, SelectDialog, StandardListItem, SuggestionItem) {
	"use strict";

	return Controller.extend("com.incresolZ_INC_PLMS.controller.HomePage", {

		onInit: function () {
			var serviceUrl = "/sap/opu/odata/sap/YIGP_PLMS_SRV/";
			var oModel = new ODataModel(serviceUrl, {
				useBatch: false,
				defaultBindingMode: "TwoWay"
			});
			this.getView().setModel(oModel);
		},

		// --------------------------------------------------------------------
		// Navigation
		// --------------------------------------------------------------------
		onReportVehicle: function () {
			var oRouter = this.getOwnerComponent().getRouter();
			if (oRouter) {
				oRouter.navTo("Stage");
			} else {
				window.location.hash = "#/stage";
			}
		},

		onTripPress: function (oEvent) {
			var oSelectedItem = oEvent.getParameter("listItem");
			var oContext = oSelectedItem.getBindingContext();
			var sTripNo = oContext.getProperty("TripNumber");
			console.log(sTripNo)
			var oRouter = sap.ui.core.UIComponent.getRouterFor(this);
			oRouter.navTo("StagewithParam", {
				tripNo: sTripNo || "" // optional parameter
			});
		},

		onRefresh: function () {
			var oView = this.getView();
			var oTable = oView.byId("tripTable");
			var oModel = oView.getModel();

			if (oModel) {
				oTable.setBusy(true);
				oModel.refresh(true);
				oModel.attachRequestCompleted(function () {
					oTable.setBusy(false);
					MessageToast.show("Trip details refreshed");
				});
			} else {
				MessageToast.show("Model not found. Please check initialization.");
			}
		},

		// --------------------------------------------------------------------
		// VALUE HELP
		// --------------------------------------------------------------------
		onValueHelpRequest: function (oEvent) {
			var oInput = oEvent.getSource();
			var sField = oInput.data("field");
			var oModel = this.getView().getModel();
			var oFieldConfig = this._getFieldConfiguration(sField);

			if (!oFieldConfig) {
				MessageToast.show("No value help configured for " + sField);
				return;
			}

			var {
				sKeyField,
				sDescField,
				sTitle
			} = oFieldConfig;

			var oSelectDialog = new SelectDialog({
				title: sTitle,
				liveChange: function (oEvt) {
					var sValue = oEvt.getParameter("value");
					var aFilters = [];
					if (sValue) {
						aFilters.push(new Filter([
							new Filter(sKeyField, FilterOperator.Contains, sValue),
							new Filter(sDescField, FilterOperator.Contains, sValue)
						], false));
					}
					oEvt.getSource().getBinding("items").filter(aFilters);
				},
				confirm: function (oEvt) {
					var oSelectedItem = oEvt.getParameter("selectedItem");
					if (oSelectedItem) {
						oInput.setValue(oSelectedItem.getTitle());
					}
				},
				cancel: function () {
					MessageToast.show("Selection cancelled");
				}
			});

			// Bind TripDetails entity set
			oSelectDialog.setModel(oModel);
			oSelectDialog.bindAggregation("items", {
				path: "/TripDetails",
				template: new StandardListItem({
					title: "{" + sKeyField + "}",
					description: "{" + sDescField + "}"
				})
			});

			oSelectDialog.open();
		},

		// --------------------------------------------------------------------
		// LIVE SUGGESTIONS
		// --------------------------------------------------------------------
		onSuggest: function (oEvent) {
			var oInput = oEvent.getSource();
			var sField = oInput.data("field");
			var sValue = oEvent.getParameter("suggestValue");
			var oModel = this.getView().getModel();
			var oFieldConfig = this._getFieldConfiguration(sField);

			if (!oFieldConfig) return;
			var {
				sKeyField,
				sDescField
			} = oFieldConfig;

			var aFilters = [];
			if (sValue) {
				aFilters.push(new Filter([
					new Filter(sKeyField, FilterOperator.Contains, sValue),
					new Filter(sDescField, FilterOperator.Contains, sValue)
				], false));
			}

			oModel.read("/TripDetails", {
				filters: aFilters,
				success: function (oData) {
					var aResults = oData.results || [];
					oInput.destroySuggestionItems();

					aResults.forEach(function (item) {
						oInput.addSuggestionItem(new SuggestionItem({
							key: item[sKeyField],
							text: item[sKeyField],
							description: item[sDescField]
						}));
					});
				},
				error: function () {
					console.error("Failed to load suggestions for " + sField);
				}
			});
		},

		// --------------------------------------------------------------------
		// FIELD CONFIGURATION MAP (Single Table)
		// --------------------------------------------------------------------
		_getFieldConfiguration: function (sField) {
			switch (sField) {
				case "tripNo":
					return {
						sKeyField: "TripNumber",
						sDescField: "VehicleNumber",
						sTitle: "Select Trip Number"
					};
				case "vehicleNumber":
					return {
						sKeyField: "VehicleNumber",
						sDescField: "VehicleType",
						sTitle: "Select Vehicle Number"
					};
				case "vehicleType":
					return {
						sKeyField: "VehicleType",
						sDescField: "VehicleSize",
						sTitle: "Select Vehicle Type"
					};
				case "transporterName":
					return {
						sKeyField: "TransporterName",
						sDescField: "DriverName",
						sTitle: "Select Transporter"
					};
				case "lrNumber":
					return {
						sKeyField: "LR_Number",
						sDescField: "TripNumber",
						sTitle: "Select LR Number"
					};
				case "plant":
					return {
						sKeyField: "Plant",
						sDescField: "CompanyCode",
						sTitle: "Select Plant"
					};
				case "companyCode":
					return {
						sKeyField: "CompanyCode",
						sDescField: "Plant",
						sTitle: "Select Company Code"
					};
				default:
					return null;
			}
		}

	});
});