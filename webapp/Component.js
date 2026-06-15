sap.ui.define([
	"sap/ui/core/UIComponent",
	"sap/ui/Device",
	"com/incresolZ_INC_PLMS/model/models",
	"sap/ui/model/odata/v2/ODataModel",
	"sap/m/MessageBox"
], function (UIComponent, Device, models, ODataModel, MessageBox) {
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
			this._installGlobalODataErrorPopup();

			// set the device model
			this.setModel(models.createDeviceModel(), "device");

			// initialize the router
			this.getRouter().initialize();
		},

		_installGlobalODataErrorPopup: function () {
			var oCore = sap.ui.getCore && sap.ui.getCore();
			if (!oCore || typeof oCore.getMessageManager !== "function") {
				return;
			}

			if (this._bPlmsGlobalODataErrorPopupInstalled) {
				return;
			}
			this._bPlmsGlobalODataErrorPopupInstalled = true;

			var oMessageManager = oCore.getMessageManager();
			if (!oMessageManager) {
				return;
			}

			// Expose messages model so apps can also show MessagePopover if desired.
			try {
				this.setModel(oMessageManager.getMessageModel(), "message");
			} catch (e) {
				// best effort
			}

			var that = this;
			var iLastShownAt = 0;
			var sLastShownText = "";

			var fnGetFirstErrorText = function () {
				try {
					var aMsgs = oMessageManager.getMessageModel().getData() || [];
					for (var i = 0; i < aMsgs.length; i++) {
						var oMsg = aMsgs[i];
						var sType = oMsg && (oMsg.type || oMsg.getType && oMsg.getType());
						var sText = oMsg && (oMsg.message || oMsg.getMessage && oMsg.getMessage());
						if (String(sType || "").toLowerCase() === "error" && sText) {
							return String(sText);
						}
					}
				} catch (e) {
					// ignore
				}
				return "";
			};

			var fnMaybeShow = function () {
				var sText = fnGetFirstErrorText();
				if (!sText) {
					return;
				}

				// de-dupe and avoid spamming multiple popups for same backend error
				var iNow = Date.now();
				if (sText === sLastShownText && iNow - iLastShownAt < 1500) {
					return;
				}
				sLastShownText = sText;
				iLastShownAt = iNow;

				try {
					MessageBox.error(sText);
				} catch (e) {
					// best effort
				}
			};

			// When ODataMessageParser parses a 4xx/5xx, it adds messages to the MessageManager.
			// React on changes and show the first Error message.
			try {
				var oMsgModel = oMessageManager.getMessageModel();
				oMsgModel.attachPropertyChange(fnMaybeShow);
				oMsgModel.attachRequestCompleted(fnMaybeShow);
				oMsgModel.attachRequestFailed(fnMaybeShow);
				oMsgModel.attachChange(fnMaybeShow);
			} catch (e) {
				// best effort
			}

			// Also attach to the default OData model if present (covers cases where messages are not bound yet).
			try {
				var oDefaultModel = that.getModel && that.getModel();
				if (oDefaultModel && typeof oDefaultModel.attachRequestFailed === "function") {
					oDefaultModel.attachRequestFailed(fnMaybeShow);
				}
			} catch (e) {
				// best effort
			}
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