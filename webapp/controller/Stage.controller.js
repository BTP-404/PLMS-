sap.ui.define([
	"sap/ui/core/mvc/Controller",
	"sap/ui/model/json/JSONModel",
	"sap/ui/model/odata/v2/ODataModel",
	"sap/m/MessageBox",
	"sap/m/MessageToast",
	"sap/m/ButtonType",
	"sap/ui/model/Filter",
	"sap/ui/model/FilterOperator"
], function(Controller, JSONModel, ODataModel, MessageBox, MessageToast, ButtonType, Filter, FilterOperator) {
	"use strict";
	return Controller.extend("com.incresolZ_INC_PLMS.controller.Stage", {
		onInit: function() {
			var oRouter = this.getOwnerComponent().getRouter();
			oRouter.getRoute("Stage").attachPatternMatched(this._onRouteMatched, this);//new Vehicle Reporting Case
			oRouter.getRoute("StagewithParam").attachPatternMatched(this._onRouteMatched, this); // existing vehicle

			// Ensure global trip model exists upfront
			if (!sap.ui.getCore().getModel("globalData")) {
				sap.ui.getCore().setModel(new JSONModel({ TripNumber: "" }), "globalData");
			}
			this._initPageTitleModel();

			this._oEventBus = sap.ui.getCore().getEventBus();
			this._oEventBus.subscribe("TripData", "Updated", this._refreshPageTitleModel, this);
			this._oEventBus.subscribe("TripData", "Updated", this._updateLoadingUnloadingTabs, this);
			this._oEventBus.subscribe("TripData", "MovementTypeChanged", this._updateLoadingUnloadingTabs, this);
			this._oEventBus.subscribe("TripData", "Updated", this._updateCancelButtonVisibility, this);
			this._oEventBus.subscribe("TripData", "Updated", this._loadUserRolesForTrip, this);
			this._oEventBus.subscribe("Stage", "TripCreated", this._onTripCreated, this);
			this._oEventBus.subscribe("Notes", "UnreadCountChanged", this._updateNotesTabIndicator, this);
			this._oEventBus.subscribe("Stage", "ClearAllTabs", this._onClearAllTabs, this);

			// UserRoles are loaded in HomePage - just try to load plant-specific roles if TripData exists
			this._loadUserRolesForTrip();
		},
	onAfterRendering: function() {
		this._updateCancelButtonVisibility();
		this._updateTabVisibilityForCreateMode();
		this._updateLoadingUnloadingTabs(); // Call after _updateTabVisibilityForCreateMode to ensure movement type logic takes precedence
		this._updateHeaderVisibilityForCreateMode();
	},

		onExit: function () {
			this._oEventBus?.unsubscribe("TripData", "Updated", this._refreshPageTitleModel, this);
			this._oEventBus?.unsubscribe("TripData", "Updated", this._updateLoadingUnloadingTabs, this);
			this._oEventBus?.unsubscribe("TripData", "MovementTypeChanged", this._updateLoadingUnloadingTabs, this);
			this._oEventBus?.unsubscribe("TripData", "Updated", this._updateCancelButtonVisibility, this);
			this._oEventBus?.unsubscribe("TripData", "Updated", this._loadUserRolesForTrip, this);
			this._oEventBus?.unsubscribe("Stage", "TripCreated", this._onTripCreated, this);
			this._oEventBus?.unsubscribe("Notes", "UnreadCountChanged", this._updateNotesTabIndicator, this);
			this._oEventBus?.unsubscribe("Stage", "ClearAllTabs", this._onClearAllTabs, this);
		},
		
	_onClearAllTabs: function () {
		// Clear page title header (Trip No, Vehicle No, Trip status)
		this.resetPageTitleModel();
		// Set create mode to ensure header stays clear
		this._bCreateMode = true;
		this._sCurrentTripNumber = "";
		this._updateTabVisibilityForCreateMode();
		this._updateHeaderVisibilityForCreateMode();
		
		// IMPORTANT:
		// Do NOT reset UserRoles here – they are user-level, not trip-level.
		// Clearing them causes all other screens that depend on UserRoles
		// (Reference Docs, GateIn/Out, Loading, etc.) to lose authorization
		// after a clear/refresh. We keep the last loaded roles instead.
	},

	_onRouteMatched: function (oEvent) {

		var oArgs = oEvent.getParameter("arguments") || {};
		var sTripNumber = oArgs.tripNo || "";
	
		// Safely get matched route name
		var sRouteName = "";
		try {
			var oRoute = oEvent.getSource();
			// Check if route object exists and has getName method
			if (oRoute && typeof oRoute.getName === "function") {
				sRouteName = oRoute.getName();
			} else {
				// Fallback: determine route based on arguments
				// If tripNo parameter exists, it's StagewithParam route
				sRouteName = sTripNumber ? "StagewithParam" : "Stage";
			}
		} catch (oError) {
			// Error handling: determine route based on arguments as fallback
			sRouteName = sTripNumber ? "StagewithParam" : "Stage";
		}
	
		// ============================
		//   CASE 1 — CREATE MODE
		// ============================
		if (sRouteName === "Stage") {
	
			this._bCreateMode = true;
			this._sCurrentTripNumber = "";
	
			sap.ui.getCore().getModel("globalData")?.setProperty("/TripNumber", "");
			sap.ui.getCore().setModel(null, "TripData");
	
		this.resetPageTitleModel();   // ← finally clears
		this._setIconTabSelection("gateIn");
		this._updateCancelButtonVisibility();
		this._updateTabVisibilityForCreateMode();
		this._updateLoadingUnloadingTabs(); // Call after _updateTabVisibilityForCreateMode to ensure movement type logic takes precedence
		this._updateHeaderVisibilityForCreateMode();
	
		return;
		}
	
		// ============================
		//   CASE 2 — UPDATE MODE
		// ============================
		if (sRouteName === "StagewithParam") {
	
			this._bCreateMode = false;
			this._sCurrentTripNumber = sTripNumber;
	
			sap.ui.getCore().getModel("globalData")?.setProperty("/TripNumber", sTripNumber);
	
		this._refreshPageTitleModel();
		this._updateCancelButtonVisibility();
		this._updateTabVisibilityForCreateMode();
		this._updateLoadingUnloadingTabs(); // Call after _updateTabVisibilityForCreateMode to ensure movement type logic takes precedence
		this._updateHeaderVisibilityForCreateMode();
	}
	}
		
		,
		_setIconTabSelection: function (sKey) {
			var oIconTabBar = this.byId("iconTabBar");
			var sEffectiveKey = sKey || "gateIn";
			if (oIconTabBar) {
				oIconTabBar.setSelectedKey(sEffectiveKey);
			}
		}
		,

		_syncTripNumberFromRoute: function (sTripNumber, bReset) {
			var oGlobalModel = sap.ui.getCore().getModel("globalData");
			if (!oGlobalModel) {
				oGlobalModel = new JSONModel({ TripNumber: "" });
				sap.ui.getCore().setModel(oGlobalModel, "globalData");
			}

			if (bReset) {
				this._sCurrentTripNumber = "";
				this._bCreateMode = true;
				oGlobalModel.setProperty("/TripNumber", "");
				sap.ui.getCore().setModel(null, "TripData");
			} else if (sTripNumber) {
				this._bCreateMode = false;
				oGlobalModel.setProperty("/TripNumber", sTripNumber);
				this._sCurrentTripNumber = sTripNumber;
			} else {
				this._bCreateMode = false;
				this._sCurrentTripNumber = oGlobalModel.getProperty("/TripNumber") || "";
			}

			this._refreshPageTitleModel();
		},resetPageTitleModel: function () {
			var oModel = this.getView().getModel("pageTitleModel");
		
			if (!oModel) {
				oModel = new JSONModel({
					tripNumber: "",
					vehicleNumber: "",
					tripStatus: ""
				});
				this.getView().setModel(oModel, "pageTitleModel");
				return;
			}
		
			oModel.setData({
				tripNumber: "",
				vehicleNumber: "",
				tripStatus: ""
			}, true);
		}
,		

		_initPageTitleModel: function () {
			var oCoreModel = sap.ui.getCore().getModel("pageTitleModel");
			if (!oCoreModel) {
				oCoreModel = new JSONModel({
					tripNumber: "",
					vehicleNumber: "",
					tripStatus: ""
				});
				sap.ui.getCore().setModel(oCoreModel, "pageTitleModel");
			}
			this._oPageTitleModel = oCoreModel;
			this.getView().setModel(this._oPageTitleModel, "pageTitleModel");
			this._refreshPageTitleModel();
		},

	_onTripCreated: function (sChannel, sEvent, oData) {
		// Trip was just created, update mode and refresh header
		if (oData && oData.tripNumber) {
			this._bCreateMode = false;
			this._sCurrentTripNumber = oData.tripNumber;
			this._refreshPageTitleModel();
			this._updateHeaderVisibilityForCreateMode();
			this._updateTabVisibilityForCreateMode();
		}
	},

		_refreshPageTitleModel: function () {
			if (!this._oPageTitleModel) {
				return;
			}

			if (this._bCreateMode) {
				this._oPageTitleModel.setProperty("/tripNumber", "");
				this._oPageTitleModel.setProperty("/vehicleNumber", "");
				this._oPageTitleModel.setProperty("/tripStatus", "");
				return;
			}

			var oGlobal = sap.ui.getCore().getModel("globalData");
			var sTripNo = this._sCurrentTripNumber || (oGlobal ? oGlobal.getProperty("/TripNumber") : "") || "";
			var sFormattedTripNo = this.formatTripNumber(sTripNo);
			this._oPageTitleModel.setProperty("/tripNumber", sFormattedTripNo);

			var oTripDataModel = sap.ui.getCore().getModel("TripData");
			if (oTripDataModel) {
				var sVehicle = oTripDataModel.getProperty("/VehicleNumber") || "";
				var sStatus = oTripDataModel.getProperty("/TripStatus") || "";
				this._oPageTitleModel.setProperty("/vehicleNumber", sVehicle);
				this._oPageTitleModel.setProperty("/tripStatus", sStatus);
			} else {
				this._oPageTitleModel.setProperty("/vehicleNumber", "");
				this._oPageTitleModel.setProperty("/tripStatus", "");
				if (sTripNo) {
					this._loadTripHeaderDetails(sTripNo);
				}
			}
		},

		_clearPageTitleModel: function () {
			var oModel = this._oPageTitleModel || sap.ui.getCore().getModel("pageTitleModel");
			if (!oModel) {
				return;
			}
			this._oPageTitleModel = oModel;
			this._bCreateMode = true;
			oModel.setProperty("/tripNumber", "");
			oModel.setProperty("/vehicleNumber", "");
			oModel.setProperty("/tripStatus", "");
		},

		onCancelTrip: function () {
			var sTripNumber = this._sCurrentTripNumber || sap.ui.getCore().getModel("globalData")?.getProperty("/TripNumber");
			if (!sTripNumber) {
				MessageToast.show("No trip selected to cancel");
				return;
			}

			var oWarningDialog = MessageBox.warning("Do you want to cancel the trip?", {
				actions: [MessageBox.Action.OK, MessageBox.Action.CANCEL],
				onClose: function (oAction) {
					if (oAction === MessageBox.Action.OK) {
						this._deleteTrip(sTripNumber);
					}
				}.bind(this)
			});

			if (oWarningDialog) {
				oWarningDialog.attachAfterOpen(function () {
					var oOkButton = oWarningDialog.getButtons().find(function (oButton) {
						return oButton.getText() === MessageBox.Action.OK;
					});
					oOkButton?.setType(ButtonType.Reject);
				});
			}
		},

		_deleteTrip: function (sTripNumber) {
			var oService = this._getTripService();
			var sPath = "/TripDetails('" + sTripNumber + "')";

			oService.remove(sPath, {
				headers: {
					"X-Requested-With": "X"
				},
				success: function () {
					MessageToast.show("Trip cancelled successfully");
					this._handleTripCancelled();
				}.bind(this),
				error: function () {
					MessageBox.error("Failed to cancel trip. Please try again.");
				}
			});
		},

		_handleTripCancelled: function () {
			sap.ui.getCore().getEventBus().publish("HomePage", "RefreshTripTable");
			sap.ui.getCore().getModel("globalData")?.setProperty("/TripNumber", "");
			sap.ui.getCore().setModel(null, "TripData");
			this._bCreateMode = true;
			this._sCurrentTripNumber = "";
			this.resetPageTitleModel();
			this._setIconTabSelection("gateIn");
			this.getOwnerComponent().getRouter().navTo("HomePage");
		},

		_loadTripHeaderDetails: function (sTripNumber) {
			if (!sTripNumber) {
				return;
			}

			var oTripData = sap.ui.getCore().getModel("TripData");
			if (oTripData) {
				var sFormattedTripNo = this.formatTripNumber(oTripData.getProperty("/TripNumber") || sTripNumber);
				this._oPageTitleModel.setProperty("/tripNumber", sFormattedTripNo);
				this._oPageTitleModel.setProperty("/vehicleNumber", oTripData.getProperty("/VehicleNumber") || "");
				this._oPageTitleModel.setProperty("/tripStatus", oTripData.getProperty("/TripStatus") || "");
			} else {
				var sFormattedTripNo = this.formatTripNumber(sTripNumber);
				this._oPageTitleModel.setProperty("/tripNumber", sFormattedTripNo);
			}
		},

		formatTripNumber: function (sTripNumber) {
			if (!sTripNumber) {
				return "";
			}
			// Convert to string and remove leading zeros
			var sStr = String(sTripNumber);
			// Remove leading zeros but keep at least one digit (e.g., "0000000014" -> "14", "0" -> "0")
			return sStr.replace(/^0+/, "") || "0";
		},

		_getTripService: function () {
			if (!this._oTripService) {
				this._oTripService = new ODataModel("/sap/opu/odata/sap/YIGP_PLMS_SRV/", {
					useBatch: false,
					defaultBindingMode: "TwoWay"
				});
			}
			return this._oTripService;
		},

	_updateLoadingUnloadingTabs: function () {
		var oTripDataModel = sap.ui.getCore().getModel("TripData");
		var oLoadingTab = this.byId("idLoadingMaterial");
		var oUnloadingTab = this.byId("idUnloadingMaterial");

		if (!oLoadingTab || !oUnloadingTab) {
			return;
		}

		// In CREATE mode (new vehicle reporting), always hide both tabs
		// irrespective of movement type. Tabs are controlled only after
		// a trip exists (DISPLAY / update mode).
		if (this._bCreateMode) {
			oLoadingTab.setVisible(false);
			oUnloadingTab.setVisible(false);
			return;
		}

		var sMovementType = "";
		var sMovementTypeDesc = "";

		// Check TripData first (existing trips)
		if (oTripDataModel) {
			sMovementTypeDesc = (oTripDataModel.getProperty("/MovementTypeDesc") || "").toUpperCase();
			sMovementType = oTripDataModel.getProperty("/MovementType") || "";
		} else {
			// During trip creation, check globalData model
			var oGlobalModel = sap.ui.getCore().getModel("globalData");
			if (oGlobalModel) {
				sMovementType = oGlobalModel.getProperty("/MovementType") || "";
				sMovementTypeDesc = (oGlobalModel.getProperty("/MovementTypeDesc") || "").toUpperCase();
			}
		}

		// Determine if Inward or Outward based on MovementType code or description
		var bIsInward = sMovementType === "I" || sMovementTypeDesc.indexOf("INWARD") !== -1;
		var bIsOutward = sMovementType === "O" || sMovementTypeDesc.indexOf("OUTWARD") !== -1;

		// If Inward, show Unloading and hide Loading
		// If Outward, show Loading and hide Unloading
		if (bIsInward) {
			oUnloadingTab.setVisible(true);
			oLoadingTab.setVisible(false);
		} else if (bIsOutward) {
			oLoadingTab.setVisible(true);
			oUnloadingTab.setVisible(false);
		} else {
			// Default: hide both if movement type is not determined
			oLoadingTab.setVisible(false);
			oUnloadingTab.setVisible(false);
		}
	},

		/**
		 * Update Cancel Button Visibility
		 * Hide the cancel button in CREATE mode, or if TripStatus is "Gate Out"/"Gate-Out", or "Trip Completed"/"Completed"
		 */
		_updateCancelButtonVisibility: function () {
			var oCancelButton = this.byId("btnCancelTrip");
			
			if (!oCancelButton) {
				return;
			}

			// Hide button in CREATE mode (new vehicle reporting)
			if (this._bCreateMode) {
				oCancelButton.setVisible(false);
				return;
			}

			var oTripDataModel = sap.ui.getCore().getModel("TripData");
			
			// If no trip data, hide button
			if (!oTripDataModel) {
				oCancelButton.setVisible(false);
				return;
			}

			// Check TripStatus (case-insensitive)
			var sTripStatus = (oTripDataModel.getProperty("/TripStatus") || "").trim();
			var sLowerStatus = sTripStatus.toLowerCase();
			// Gate Out: "gate out" or "gate-out"
			var bIsGateOut = sLowerStatus === "gate out" || sLowerStatus === "gate-out";
			// Trip Completed: "completed", "trip completed", "done"
			var bIsCompleted = sLowerStatus === "completed" || sLowerStatus === "trip completed" || sLowerStatus === "done";

			// Hide button if Gate Out or Trip Completed
			oCancelButton.setVisible(!bIsGateOut && !bIsCompleted);
		},

		/**
		 * Update Tab Visibility for Create Mode
		 * Hide all tabs except Gate In (Reporting, Ref. Docs, Gate In merged) when creating a new vehicle
		 */
		_updateTabVisibilityForCreateMode: function () {
			var oIconTabBar = this.byId("iconTabBar");
			if (!oIconTabBar) {
				return;
			}

			var aTabs = oIconTabBar.getItems();
			
			aTabs.forEach(function(oTab) {
				var sKey = oTab.getKey();
				var sId = oTab.getId();
				
				// Always show Gate In tab (contains Reporting, Ref. Docs, Gate In)
				if (sKey === "gateIn") {
					oTab.setVisible(true);
					return;
				}
				
				// Skip Loading and Unloading tabs - they are handled by _updateLoadingUnloadingTabs()
				if (sId && (sId.indexOf("idLoadingMaterial") !== -1 || sId.indexOf("idUnloadingMaterial") !== -1)) {
					return; // Don't change visibility - let _updateLoadingUnloadingTabs() handle it
				}
				
				// Hide all other tabs in CREATE mode, show them in DISPLAY mode
				if (this._bCreateMode) {
					oTab.setVisible(false);
				} else {
					oTab.setVisible(true);
				}
			}.bind(this));
		},

		/**
		 * Update Header Visibility for Create Mode
		 * Hide the header (Trip No, Vehicle No, Trip status) when creating a new vehicle
		 */
		_updateHeaderVisibilityForCreateMode: function () {
			var oHeaderBar = this.byId("headerBar");
			if (!oHeaderBar) {
				return;
			}

			// Hide header in CREATE mode, show in DISPLAY mode
			oHeaderBar.setVisible(!this._bCreateMode);
		},

		/** --------------------------------------------
		 * UPDATE NOTES TAB BELL INDICATOR
		 * --------------------------------------------*/
		_updateNotesTabIndicator: function (sChannel, sEvent, oData) {
			var iUnreadCount = (oData && oData.unreadCount) ? oData.unreadCount : 0;
			var oNotesTab = this.byId("idNotesTab");
			
			if (!oNotesTab) {
				// Control might not be rendered yet, try again after a short delay
				setTimeout(function() {
					this._updateNotesTabIndicator(sChannel, sEvent, oData);
				}.bind(this), 100);
				return;
			}
			
			// Use $() to get the DOM element and manipulate classes directly
			var oDomRef = oNotesTab.$();
			if (oDomRef && oDomRef.length > 0) {
				if (iUnreadCount > 0) {
					oDomRef.addClass("notesTabWithBell");
				} else {
					oDomRef.removeClass("notesTabWithBell");
				}
			}
		},

		onIconTabSelect: function (oEvent) {
			var sSelectedKey = oEvent.getParameter("key");

			// If ReferenceDocuments tab is selected, focus on scanner input
			if (sSelectedKey === "referenceDocuments") {
				// Use setTimeout to ensure the view is rendered
				setTimeout(function() {
					// Get the ReferenceDocuments view and focus on scanner input
					var oIconTabBar = this.byId("iconTabBar");
					if (oIconTabBar) {
						var oRefDocTab = oIconTabBar.getItems().find(function(oItem) {
							return oItem.getKey() === "referenceDocuments";
						});
						
						if (oRefDocTab && oRefDocTab.getContent && oRefDocTab.getContent().length > 0) {
							var oRefDocView = oRefDocTab.getContent()[0];
							if (oRefDocView && oRefDocView.byId) {
							}
						}
					}
				}.bind(this), 100);
			}
		},

		/**
		 * Load UserRoles for the current trip's plant
		 * Matches trip's plant with user's plant and loads corresponding UserRoles
		 * IMPORTANT: Never clears existing roles if no match is found, to avoid random loss of permissions.
		 */
		_loadUserRolesForTrip: function () {
			var oTripData = sap.ui.getCore().getModel("TripData");
			if (!oTripData) {
				// No trip data yet – keep existing UserRoles (user-level)
				return;
			}

			var sTripPlant = oTripData.getProperty("/Plant") || "";
			if (!sTripPlant) {
				// No plant in trip data – keep existing UserRoles (user-level)
				return;
			}

			// Get all user roles from array
			var oUserRolesArrayModel = sap.ui.getCore().getModel("UserRolesArray");
			if (!oUserRolesArrayModel) {
				// Array not loaded yet – keep existing UserRoles (user-level)
				return;
			}

			var aAllRoles = oUserRolesArrayModel.getProperty("/roles") || [];

			// Normalized plant comparison (trim + uppercase)
			var fnNormalizePlant = function (sPlant) {
				return (sPlant || "").toString().trim().toUpperCase();
			};
			var sNormTripPlant = fnNormalizePlant(sTripPlant);

			var oMatchedRole = null;
			for (var i = 0; i < aAllRoles.length; i++) {
				var sRolePlant = fnNormalizePlant(aAllRoles[i].Plant);
				if (sRolePlant && sNormTripPlant && sRolePlant === sNormTripPlant) {
					oMatchedRole = aAllRoles[i];
					break;
				}
			}

			if (oMatchedRole) {
				// Store matched plant-specific UserRoles
				var oUserRolesModel = new JSONModel(oMatchedRole);
				sap.ui.getCore().setModel(oUserRolesModel, "UserRoles");

				// Publish event that UserRoles are loaded/updated
				sap.ui.getCore().getEventBus().publish("UserRoles", "Loaded", {
					roles: [oMatchedRole],
					plant: sTripPlant
				});
			} else {
				// IMPORTANT: Do NOT clear roles anymore – keep whatever UserRoles we already have.
				// This avoids random loss of permissions when plant values or timing don't match exactly.
				jQuery.sap.log.warning(
					"No matching UserRoles found for plant '" + sTripPlant +
					"'. Keeping existing UserRoles instead of clearing them."
				);
			}
		},

		/**
		 * Utility function to check if user has authorization for a specific action
		 * @param {string} sAction - Action name (e.g., "AddRef", "EditGatein", "DelLoading")
		 * @returns {boolean} - true if authorized (value is "X"), false otherwise
		 */
		_checkAuthorization: function (sAction) {
			var oUserRoles = sap.ui.getCore().getModel("UserRoles");
			if (!oUserRoles) {
				return false; // No roles loaded, deny access
			}
			var sValue = oUserRoles.getProperty("/" + sAction) || "";
			return sValue === "X";
		}

	});
});