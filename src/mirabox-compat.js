/**
 * Mirabox compatibility shim.
 *
 * Mirabox stream controllers send "Knob" as the controller type instead of
 * "Encoder" which the Elgato Stream Deck SDK expects. This module patches the
 * WebSocket class so that incoming messages are normalized before the SDK
 * processes them.
 *
 * Must be imported before streamDeck.connect() is called.
 */

import WebSocket from "ws";

const CONTROLLER_ALIASES = {
	Knob: "Encoder"
};

const OriginalWebSocket = WebSocket;
const origAddEventListener = OriginalWebSocket.prototype.addEventListener;

OriginalWebSocket.prototype.addEventListener = function (type, listener, ...rest) {
	if (type === "message") {
		const wrappedListener = function (event) {
			try {
				const data = JSON.parse(event.data);
				if (data?.payload?.controller && CONTROLLER_ALIASES[data.payload.controller]) {
					data.payload.controller = CONTROLLER_ALIASES[data.payload.controller];
					event = new MessageEvent("message", { data: JSON.stringify(data) });
				}
			} catch {
				// Not JSON or no controller field — pass through unchanged
			}
			return listener.call(this, event);
		};
		return origAddEventListener.call(this, type, wrappedListener, ...rest);
	}
	return origAddEventListener.call(this, type, listener, ...rest);
};

// Also patch the onmessage setter since the SDK uses webSocket.onmessage = ...
const onmessageDesc = Object.getOwnPropertyDescriptor(OriginalWebSocket.prototype, "onmessage")
	|| Object.getOwnPropertyDescriptor(Object.getPrototypeOf(OriginalWebSocket.prototype), "onmessage");

if (onmessageDesc && onmessageDesc.set) {
	const origSet = onmessageDesc.set;
	Object.defineProperty(OriginalWebSocket.prototype, "onmessage", {
		...onmessageDesc,
		set(handler) {
			const wrappedHandler = function (event) {
				try {
					const data = JSON.parse(event.data);
					if (data?.payload?.controller && CONTROLLER_ALIASES[data.payload.controller]) {
						data.payload.controller = CONTROLLER_ALIASES[data.payload.controller];
						event = { ...event, data: JSON.stringify(data) };
					}
				} catch {
					// Not JSON or no controller field — pass through unchanged
				}
				return handler.call(this, event);
			};
			origSet.call(this, wrappedHandler);
		}
	});
}
