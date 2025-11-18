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
			var oModel = new ODataModel(serviceUrl, { 				useBatch: false, 				defaultBindingMode: "TwoWay" 			});
			this.getView().setModel(oModel);
		},

		// --------------------------------------------
		// NAVIGATION
		// --------------------------------------------
		onReportVehicle: function () {
			var oRouter = this.getOwnerComponent().getRouter();
			if (oRouter) {
				oRouter.navTo("Stage");
			} else {
				window.location.hash = "#/stage";
			}
		},

		onTripPress: function (oEvent) {
			var sTripNo = oEvent.getParameter("listItem").getBindingContext().getProperty("TripNumber");
			
			this.getView().byId("tripTable").removeSelections(true); 
sap.ui.core.UIComponent.getRouterFor(this).navTo("StagewithParam", { 				tripNo: sTripNo || "" 			});

		},

		onRefresh: function () {
			var oTable = this.getView().byId("tripTable");
			var oModel = this.getView().getModel();
			if (oModel) {
				oTable.setBusy(true);
				oModel.refresh(true);
				oModel.attachRequestCompleted(function () {
					oTable.setBusy(false);
					MessageToast.show("Trip details refreshed");
				});
						}
		},

		// --------------------------------------------
		// VALUE HELP
		// --------------------------------------------
		onValueHelpRequest: function (oEvent) {
			var oInput = oEvent.getSource();
			var sField = oInput.data("field");
						var oFieldConfig = this._getFieldConfiguration(sField);
			if (!oFieldConfig) return 				MessageToast.show("No value help for " + sField);
				
			var { 				sKeyField, 				sDescField, 				sTitle 			} = oFieldConfig;
var oModel = this.getView().getModel();

			var oSelectDialog = new SelectDialog({
				title: sTitle,
				liveChange: function (oEvt) {
					var sValue = oEvt.getParameter("value");
					var aFilters = sValue ? [
new Filter([
							new Filter(sKeyField, FilterOperator.Contains, sValue),
							new Filter(sDescField, FilterOperator.Contains, sValue)
						], false)
					] : [];
					oEvt.getSource().getBinding("items").filter(aFilters);
				},
				confirm: function (oEvt) {
					var oSelectedItem = oEvt.getParameter("selectedItem");
					if (oSelectedItem) {
						oInput.setValue(oSelectedItem.getTitle());
this._applyTableFilter(); // Dynamic filtering
					}
				}.bind(this)
			});

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

		// --------------------------------------------
		// LIVE SUGGESTIONS
		// --------------------------------------------
		onSuggest: function (oEvent) {
			var oInput = oEvent.getSource();
			var sField = oInput.data("field");
			var sValue = oEvent.getParameter("suggestValue");
						var oFieldConfig = this._getFieldConfiguration(sField);
			if (!oFieldConfig) return;
			
var { sKeyField, sDescField } = oFieldConfig;
			var aFilters = sValue ? [new Filter([
					new Filter(sKeyField, FilterOperator.Contains, sValue),
					new Filter(sDescField, FilterOperator.Contains, sValue)
				], false)] : [];

			this.getView().getModel().read("/TripDetails", {
				filters: aFilters,
				success: function (oData) {
										oInput.destroySuggestionItems();
(oData.results || []).forEach(function (item) {
						oInput.addSuggestionItem(new SuggestionItem({
							key: item[sKeyField],
							text: item[sKeyField],
							description: item[sDescField]
						}));
					});
				this._applyTableFilter(); // Auto filter while typing
				}.bind(this)
			});
		},

onSuggestionItemSelected: function (oEvent) {
			var oInput = oEvent.getSource();
			oInput.setValue(oEvent.getParameter("selectedItem").getText());
			this._applyTableFilter();
		},

		onInputLiveChange: function () {
			this._applyTableFilter();
		},

		// --------------------------------------------
		// TABLE FILTERING LOGIC
		// --------------------------------------------
		_applyTableFilter: function () {
			var oTable = this.getView().byId("tripTable");
			var oBinding = oTable.getBinding("items");
			if (!oBinding) return;

			var aInputs = this.getView().findAggregatedObjects(true, function (oCtrl) {
				return oCtrl.isA("sap.m.Input") || oCtrl.isA("sap.m.DatePicker");
			});

			var aFilters = [];
			aInputs.forEach(function (oInput) {
				var sField = oInput.data("field");
				var sValue = oInput.getValue ? oInput.getValue() : "";
				if (sField && sValue) {
					var oFieldConfig = this._getFieldConfiguration(sField);
					if (oFieldConfig) {
						aFilters.push(new Filter(oFieldConfig.sKeyField, FilterOperator.Contains, sValue));
					}
				}
			}.bind(this));

			oBinding.filter(aFilters.length ? new Filter(aFilters, true) : []);
		},

		// --------------------------------------------
		// FIELD CONFIGURATION
		// --------------------------------------------
		_getFieldConfiguration: function (sField) {
			switch (sField) {
				case "tripNo": 					return { 						sKeyField: "TripNumber", 						sDescField: "VehicleNumber", 						sTitle: "Select Trip Number" 					};
				case "vehicleNumber": 					return { 						sKeyField: "VehicleNumber", 						sDescField: "VehicleType", 						sTitle: "Select Vehicle Number" 					};
				case "vehicleType": 					return { 						sKeyField: "VehicleType", 						sDescField: "VehicleSize", 						sTitle: "Select Vehicle Type" 					};
				case "transporterName": 					return { 						sKeyField: "TransporterName", 						sDescField: "DriverName", 						sTitle: "Select Transporter" 					};
				case "lrNumber": 					return { 						sKeyField: "LR_Number", 						sDescField: "TripNumber", 						sTitle: "Select LR Number" 					};
				case "plant": 					return { 						sKeyField: "Plant", 						sDescField: "CompanyCode", 						sTitle: "Select Plant" 					};
				case "companyCode": 					return { 						sKeyField: "CompanyCode", 						sDescField: "Plant", 						sTitle: "Select Company Code" 					};
				default: 					return null;
			}
		}
	});
});