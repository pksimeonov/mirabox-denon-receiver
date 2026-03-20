import { action } from "@elgato/streamdeck";
/** @typedef {import("@elgato/streamdeck").KeyDownEvent} KeyDownEvent */
/** @typedef {import("@elgato/streamdeck").WillAppearEvent} WillAppearEvent */
/** @typedef {import("@elgato/streamdeck").Action} Action */
/** @typedef {import("@elgato/streamdeck").SendToPluginEvent} SendToPluginEvent */

import { PluginAction } from "./action";

/** @typedef {import("../modules/connection").AVRConnection} AVRConnection */
/** @typedef {import("../modules/connection").ReceiverEvent} ReceiverEvent */

/**
 * The Dynamic EQ action class.
 * Toggles Dynamic EQ on/off.
 * @extends {PluginAction}
 */
@action({ UUID: "com.pksimeonov.mirabox-denon.dyneq" })
export class DynEQAction extends PluginAction {
	/**
	 * Handle the action appearing on the Stream Deck.
	 * @param {WillAppearEvent} ev - The event object.
	 */
	async onWillAppear(ev) {
		await super.onWillAppear(ev);

		const connection = this.avrConnections[this.actionReceiverMap[ev.action.id]?.uuid];
		updateActionState(ev.action, connection);
	}

	/**
	 * Toggle Dynamic EQ when the key is pressed.
	 * @param {KeyDownEvent} ev - The event object.
	 */
	onKeyDown(ev) {
		const connection = this.avrConnections[this.actionReceiverMap[ev.action.id].uuid];
		if (!connection) {
			ev.action.showAlert();
			return;
		}

		connection.setDynamicEQ() || ev.action.showAlert();
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
	 * Handle a receiver Dynamic EQ status changing.
	 * @param {ReceiverEvent} ev - The event object.
	 */
	onReceiverDynamicEQChanged(ev) {
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
 * Update the state of an action based on the receiver's Dynamic EQ status.
 * @param {Action} action - The action object.
 * @param {AVRConnection} [connection] - The receiver connection object.
 */
async function updateActionState(action, connection) {
	const { power, dynamicEQ } = connection !== undefined
		? connection.status.zones[0] : {};

	if (!action.isKey()) return;

	if (power === undefined || !power) {
		action.setState(0);
		return;
	}

	action.setState(dynamicEQ ? 1 : 2);
}
