sap.ui.define([
	"sap/ui/core/UIComponent",
	"sap/ui/Device",
	"com/incresolZ_INC_PLMS/model/models",
	"sap/ui/model/odata/v2/ODataModel"
], function (UIComponent, Device, models, ODataModel) {
	"use strict";

	return UIComponent.extend("com.incresolZ_INC_PLMS.Component", {

		metadata: {
			manifest: "json"
		},

		/**
		 * The component is initialized by UI5 automatically during the startup of the app and calls the init method once.
		 * @public
		 * @override
		 */
		init: function () {
			// call the base component's init function
			UIComponent.prototype.init.apply(this, arguments);

			this._installGlobalWriteRefresh();

			// set the device model
			this.setModel(models.createDeviceModel(), "device");

			// initialize the router
			this.getRouter().initialize();
		},

		_installGlobalWriteRefresh: function () {
			var oPrototype = ODataModel && ODataModel.prototype;
			if (!oPrototype || oPrototype._bPlmsWriteRefreshInstalled) {
				return;
			}

			var fnTriggerGlobalUiRefresh = function (oModel) {
				try {
					if (oModel && typeof oModel.refresh === "function") {
						oModel.refresh(true);
					}
				} catch (e) {
					// Keep write success flow unaffected even if refresh fails.
				}

				try {
					var oEventBus = sap.ui.getCore().getEventBus();
					oEventBus.publish("TripData", "Updated");
					oEventBus.publish("HomePage", "RefreshTripTable");
				} catch (e) {
					// Event bus refresh is best effort.
				}
			};

			var fnWrapWriteMethod = function (sMethodName) {
				var fnOriginal = oPrototype[sMethodName];
				if (typeof fnOriginal !== "function") {
					return;
				}

				oPrototype[sMethodName] = function () {
					var aArgs = Array.prototype.slice.call(arguments);
					var iParamsIndex = aArgs.length - 1;
					var oParams = aArgs[iParamsIndex];

					if (oParams && typeof oParams === "object") {
						var fnOriginalSuccess = oParams.success;
						oParams.success = function () {
							if (typeof fnOriginalSuccess === "function") {
								fnOriginalSuccess.apply(this, arguments);
							}
							fnTriggerGlobalUiRefresh(this);
						};
						aArgs[iParamsIndex] = oParams;
					}

					return fnOriginal.apply(this, aArgs);
				};
			};

			["create", "update", "remove", "submitChanges"].forEach(fnWrapWriteMethod);
			oPrototype._bPlmsWriteRefreshInstalled = true;
		}
	});
});