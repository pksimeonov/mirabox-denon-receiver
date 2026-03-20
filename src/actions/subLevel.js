import { action } from "@elgato/streamdeck";
/** @typedef {import("@elgato/streamdeck").Action} Action */
/** @typedef {import("@elgato/streamdeck").WillAppearEvent} WillAppearEvent */
/** @typedef {import("@elgato/streamdeck").SendToPluginEvent} SendToPluginEvent */
/** @typedef {import("@elgato/streamdeck").DialRotateEvent} DialRotateEvent */
/** @typedef {import("@elgato/streamdeck").DialDownEvent} DialDownEvent */
/** @typedef {import("@elgato/streamdeck").KeyDownEvent} KeyDownEvent */
/** @typedef {import("@elgato/streamdeck").TouchTapEvent} TouchTapEvent */

import { PluginAction } from "./action";
/** @typedef {import("./action").ActionSettings} ActionSettings */

/** @typedef {import("../modules/connection").AVRConnection} AVRConnection */
/** @typedef {import("../modules/connection").ReceiverEvent} ReceiverEvent */

const CHANNEL = "SW";

/**
 * The Subwoofer Level action class.
 * Controls the subwoofer channel level (Options → Channel Level),
 * which is a runtime offset that does not affect MultEQ calibration.
 *
 * Can be placed on:
 * - A knob/encoder for direct adjustment (rotate to adjust, press to reset to 0dB)
 * - A display button as a companion display (shows current level, press to reset to 0dB)
 * @extends {PluginAction}
 */
@action({ UUID: "com.pksimeonov.mirabox-denon.sublevel" })
export class SubLevelAction extends PluginAction {
	/**
	 * Handle the will appear event.
	 * @param {WillAppearEvent} ev - The event object.
	 */
	async onWillAppear(ev) {
		await super.onWillAppear(ev);

		const connection = this.avrConnections[this.actionReceiverMap[ev.action.id]?.uuid];
		updateActionState(ev.action, connection);
	}

	/**
	 * Adjust the subwoofer level when the dial is rotated.
	 * @param {DialRotateEvent} ev - The event object.
	 */
	onDialRotate(ev) {
		this.avrConnections[this.actionReceiverMap[ev.action.id].uuid]?.changeChannelLevel(CHANNEL, ev.payload.ticks) || ev.action.showAlert();
	}

	/**
	 * Reset subwoofer level to 0dB when the dial is pressed.
	 * @param {DialDownEvent} ev - The event object.
	 */
	onDialDown(ev) {
		this.avrConnections[this.actionReceiverMap[ev.action.id].uuid]?.setChannelLevel(CHANNEL, 50) || ev.action.showAlert();
	}

	/**
	 * Reset subwoofer level to 0dB when the touch screen is tapped.
	 * @param {TouchTapEvent} ev - The event object.
	 */
	onTouchTap(ev) {
		this.avrConnections[this.actionReceiverMap[ev.action.id].uuid]?.setChannelLevel(CHANNEL, 50) || ev.action.showAlert();
	}

	/**
	 * Reset subwoofer level to 0dB when the button is pressed (companion display mode).
	 * @param {KeyDownEvent} ev - The event object.
	 */
	onKeyDown(ev) {
		this.avrConnections[this.actionReceiverMap[ev.action.id].uuid]?.setChannelLevel(CHANNEL, 50) || ev.action.showAlert();
	}

	/**
	 * Handle a user choosing a receiver from the PI.
	 * @param {SendToPluginEvent} ev - The event object.
	 */
	async onUserChoseReceiver(ev) {
		await super.onUserChoseReceiver(ev);

		const connection = this.avrConnections[this.actionReceiverMap[ev.action.id]?.uuid];
		updateActionState(ev.action, connection);
	}

	/**
	 * Handle a receiver channel level changing.
	 * @param {ReceiverEvent} ev - The event object.
	 */
	onReceiverChannelLevelChanged(ev) {
		if (!ev.actions) return;

		Promise.all(ev.actions.map((action) => updateActionState(action, ev.connection)));
	}

	/**
	 * Handle a receiver power status changing.
	 * @param {ReceiverEvent} ev - The event object.
	 */
	onReceiverPowerChanged(ev) {
		if (!ev.actions) return;

		Promise.all(ev.actions.map((action) => updateActionState(action, ev.connection)));
	}
}

/**
 * Format the dB offset as a display string.
 * @param {number|undefined} dbOffset - The dB offset from 0
 * @param {boolean|undefined} power - Whether the receiver is powered on
 * @returns {string}
 */
function formatLevel(dbOffset, power) {
	if (power === undefined) return "";
	if (!power) return "Off";
	if (dbOffset === undefined) return "--";
	const sign = dbOffset >= 0 ? "+" : "";
	return `${sign}${dbOffset}dB`;
}

/**
 * Update the state of an action based on the receiver's subwoofer channel level.
 * @param {Action} action - The action object.
 * @param {AVRConnection} [connection] - The receiver connection object.
 */
async function updateActionState(action, connection) {
	const { power, channelLevels } = connection !== undefined
		? connection.status.zones[0] : {};

	const rawLevel = channelLevels?.[CHANNEL];
	const dbOffset = rawLevel !== undefined ? rawLevel - 50 : undefined;

	if (action.isDial()) {
		const value = formatLevel(dbOffset, power);

		// Map the -12 to +12 dB range to 0-100 for the indicator
		const indicatorValue = rawLevel !== undefined && power
			? ((rawLevel - 38) / (62 - 38)) * 100
			: 0;

		action.setFeedback({
			indicator: {
				value: indicatorValue
			},
			value: value
		});
	} else if (action.isKey()) {
		// Companion display button — show the current level as the title
		action.setTitle(formatLevel(dbOffset, power));
	}
}
