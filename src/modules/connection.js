import net from "net";
import { EventEmitter } from "events";
import { setTimeout } from "timers/promises";

import { TelnetSocket } from "telnet-stream";

/** @typedef {import("@elgato/streamdeck").Logger} Logger */
/** @typedef {import("@elgato/streamdeck").Action} Action */

/** @typedef {import("../plugin").PluginContext} PluginContext */
/** @typedef {import("./tracker").ReceiverInfo} ReceiverInfo */

/**
 * @typedef {Object} ReceiverEvent
 * @property { "connected"
 * 			 | "closed"
 * 			 | "powerChanged"
 * 			 | "volumeChanged"
 * 			 | "muteChanged"
 * 			 | "status"
 * 			 | "sourceChanged"
 * 			 | "dynamicVolumeChanged"
 * 			 | "dynamicEQChanged"
 * 			 | "channelLevelChanged"} type - The type of event.
 * @property {number} [zone] - The zone that the event occurred on.
 * @property {AVRConnection} connection - The receiver connection.
 * @property {Action[]} [actions] - The actions to inform of the event.
 */

/**
 * @typedef {"OFF" | "LIT" | "MED" | "HEV" | undefined} DynamicVolume
 */

/**
 * @typedef {Object} ReceiverZoneStatus
 * @property {boolean} power - Whether the zone is powered on.
 * @property {number} volume - The current volume of the zone.
 * @property {number} maxVolume - The (current) maximum volume of the receiver.
 * @property {DynamicVolume} [dynamicVolume] - Whether the volume is dynamic.
 * @property {boolean} [dynamicEQ] - Whether Dynamic EQ is enabled.
 * @property {boolean} muted - Whether the zone is muted.
 * @property {string} source - The current source of the zone.
 * @property {Record<string, number>} [channelLevels] - Channel level offsets (Options → Channel Level). Key is channel code (e.g. "SW"), value is dB offset.
 */

/**
 * @typedef {Object} ReceiverStatus
 * @property {ReceiverZoneStatus[]} zones - The status of each zone.
 * @property {string} statusMsg - The status message for this connection.
 */

const sources = {
	"PHONO": "Phono",
	"CD": "CD",
	"TUNER": "Tuner",
	"DVD": "DVD",
	"BD": "Blu-ray",
	"TV": "TV Audio",
	"SAT/CBL": "Cable / Satellite",
	"MPLAY": "Media Player",
	"GAME": "Game",
	"HDRADIO": "HD Radio",
	"NET": "Online Music",
	"PANDORA": "Pandora",
	"SIRIUSXM": "SiriusXM",
	"SPOTIFY": "Spotify",
	"LASTFM": "Last.fm",
	"FLICKR": "Flickr",
	"IRADIO": "iRadio",
	"SERVER": "Server",
	"FAVORITES": "Favorites",
	"AUX": "Aux",
	"AUX1": "Aux 1",
	"AUX2": "Aux 2",
	"AUX3": "Aux 3",
	"AUX4": "Aux 4",
	"AUX5": "Aux 5",
	"AUX6": "Aux 6",
	"AUX7": "Aux 7",
	"BT": "Bluetooth",
	"USB/IPOD": "USB/iPod",
	"USB": "USB",
	"IPD": "iPod",
	"IRP": "iRadio",
	"FVP": "",
	"ON": "Video Select: On",
	"OFF": "Video Select: Off"
};

/**
 * Represents a connection to a Denon AVR receiver
 */
export class AVRConnection {
	/** @type {Logger} */
	logger;

	/**
	 * The current status of the receiver
	 * @type {ReceiverStatus}
	 */
	status = {
		zones: [
			{
				power: false,
				volume: 0,
				maxVolume: 85,
				muted: false,
				dynamicVolume: "OFF",
				dynamicEQ: false,
				source: "",
				channelLevels: {},
			},
			{
				power: false,
				volume: 0,
				maxVolume: 85,
				muted: false,
				source: "",
			},
		],
		statusMsg: "Initializing...",
	};

	/**
	 * The event emitter for this instance
	 * @type {EventEmitter}
	 */
	#eventEmitter = new EventEmitter();

	/**
	 * The listeners for this instance
	 * @type {string[]}
	 */
	#listenerIds = [];

	/**
	 * The raw socket connection to the receiver
	 * @type {net.Socket | undefined}
	 */
	#rawSocket;

	/**
	 * The telnet socket connection to the receiver
	 * @type {TelnetSocket | undefined}
	 */
	#telnet;

	/**
	 * The number of times in a row that we've retried connecting
	 * @type {number}
	 */
	#reconnectCount = 0;

	/**
	 * The host address of the receiver
	 * @type {string}
	 */
	#host;
	get host() { return this.#host; }

	/**
	 * The UUID of the receiver
	 * @type {string}
	 */
	#uuid;
	get uuid() { return this.#uuid; }

	static get sources() { return sources; }

	/**
	 * Create a new DenonAVR instance and attempt to connect to the receiver
	 * @param {PluginContext} plugin - The plugin context to use
	 * @param {string} uuid - The UUID of the receiver on the network
	 * @param {string} host - The IP address of the receiver to connect to
	 */
	constructor(plugin, uuid, host) {
		this.logger = plugin.logger.createScope(this.constructor.name);

		this.#host = host;
		this.#uuid = uuid;
		this.connect();
	}

	/**
	 * Connect to a receiver
	 */
	async connect() {
		this.logger.debug(`Connecting to Denon receiver: ${this.#host}`);

		let rawSocket = net.createConnection(23, this.#host);
		let telnet = new TelnetSocket(rawSocket);

		// Connection lifecycle events
		telnet.on("connect", () => {
			if (this.#telnet !== telnet) return;
			this.#onConnect();
		});
		telnet.on("close", (hadError) => {
			if (this.#telnet !== telnet) return;
			this.#onClose(hadError);
		});
		telnet.on("error", (error) => {
			if (this.#telnet !== telnet) return;
			this.#onError(error);
		});

		// Ignore standard telnet negotiation
		telnet.on("do", (option) => {
			if (this.#telnet !== telnet) return;
			try {
				telnet.writeWont(option);
			} catch (error) {
				this.logger.debug(`Ignoring telnet DO negotiation failure for ${this.#host}: ${error.message}`);
			}
		});
		telnet.on("will", (option) => {
			if (this.#telnet !== telnet) return;
			try {
				telnet.writeDont(option);
			} catch (error) {
				this.logger.debug(`Ignoring telnet WILL negotiation failure for ${this.#host}: ${error.message}`);
			}
		});

		// Data events
		telnet.on("data", (data) => {
			if (this.#telnet !== telnet) return;
			this.#onData(data);
		});

		// Assign the telnet socket to the instance
		this.#rawSocket = rawSocket;
		this.#telnet = telnet;
	}

	/**
	 * Disconnect from the receiver and clean up resources
	 */
	disconnect() {
		let rawSocket = this.#rawSocket;
		let telnet = this.#telnet;

		// Clear the listeners for this instance
		this.#listenerIds = [];

		// Dispose of this instance's sockets
		this.#rawSocket = undefined;
		this.#telnet = undefined;

		if (telnet && rawSocket?.destroyed !== true) {
			telnet.destroy();

			// Set a timeout to clean up the sockets
			setTimeout(1000).then(() => {
				if (telnet && rawSocket?.destroyed !== true) {
					telnet.unref();
					rawSocket?.unref();
				}
			});
		}
	}

	/**
	 * Send a telnet command if the current socket is still writable.
	 * @param {string} command
	 * @param {string} description
	 * @returns {boolean}
	 */
	#sendCommand(command, description) {
		const telnet = this.#telnet;
		const rawSocket = this.#rawSocket;

		if (!telnet || !rawSocket || rawSocket.destroyed || rawSocket.writable !== true) {
			this.logger.debug(`Skipped ${description} because receiver socket is not writable: ${this.#host}`);
			return false;
		}

		try {
			telnet.write(command + "\r");
			this.logger.debug(`Sent ${description}: ${command}`);
			return true;
		} catch (error) {
			this.logger.warn(`Failed to send ${description} to ${this.#host}: ${error.message}`);
			return false;
		}
	}

	/**
	 * Change the volume by the given delta
	 * @param {number} delta - The amount to change the volume by
	 * @param {number} [zone=0] - The zone to change the volume for
	 * @returns {boolean} Whether the command was sent successfully
	 */
	changeVolume(delta, zone = 0) {
		const status = this.status.zones[zone];

		if (!status.power || status.volume === undefined) return false;

		try {
			let command = ["MV", "Z2"][zone];

			let newVolume = Math.max(0, Math.min(status.maxVolume, status.volume + delta));
			// Round to nearest 0.5
			newVolume = Math.round(newVolume * 2) / 2;
			// Format: whole numbers as "XX", half steps as "XXX" (e.g. 45.5 -> "455")
			let newVolumeStr = Number.isInteger(newVolume)
				? newVolume.toString().padStart(2, "0")
				: (newVolume * 10).toString().padStart(3, "0");
			command += newVolumeStr;

			return this.#sendCommand(command, "volume command");
		} catch (error) {
			this.logger.error(`Error sending volume command: ${error.message}`);
			return false;
		}
	}

	/**
	 * Change the volume to the given value
	 * @param {number} value - The new volume value to set
	 * @param {number} [zone=0] - The zone to change the volume for
	 * @returns {boolean} Whether the command was sent successfully
	 */
	changeVolumeAbsolute(value, zone = 0) {
		const status = this.status.zones[zone];

		if (!status.power) return false;

		try {
			let command = ["MV", "Z2"][zone];
			command += value.toString().padStart(2, "0");

			return this.#sendCommand(command, "volume command");
		} catch (error) {
			this.logger.error(`Error sending volume command: ${error.message}`);
			return false;
		}
	}

	changeVolumeUp(zone = 0) {
		const status = this.status.zones[zone];

		if (!status.power) return false;

		try {
			let command = ["MV", "Z2"][zone] + "UP";
			return this.#sendCommand(command, "volume command");
		} catch (error) {
			this.logger.error(`Error sending volume command: ${error.message}`);
			return false;
		}
	}

	changeVolumeDown(zone = 0) {
		const status = this.status.zones[zone];

		if (!status.power) return false;

		try {
			let command = ["MV", "Z2"][zone] + "DOWN";
			return this.#sendCommand(command, "volume command");
		} catch (error) {
			this.logger.error(`Error sending volume command: ${error.message}`);
			return false;
		}
	}

	/**
	 * Set the mute state
	 * @param {boolean} [value] - The new mute state to set
	 * @param {number} [zone=0] - The zone to set the mute state for
	 * @returns {boolean} Whether the command was sent successfully
	 */
	setMute(value, zone = 0) {
		const status = this.status.zones[zone];

		if (!status.power) return false;

		if (value === undefined) value = !status.muted;

		let command = ["MU", "Z2MU"][zone];
		command += value ? "ON" : "OFF";

		if (!this.#sendCommand(command, "mute command")) {
			return false;
		}

		// Refresh the mute status to avoid synchronization issues
		command = "?";
		this.#sendCommand(command, "mute status request");

		return true;
	}

	/**
	 * Set the power state
	 * @param {boolean} [value] - The new power state to set. If not provided, toggle the current state.
	 * @param {number} [zone=0] - The zone to set the power state for
	 * @returns {boolean} Whether the command was sent successfully
	 */
	setPower(value, zone = 0) {
		const status = this.status.zones[zone];

		if (value === undefined) value = !status.power;

		let command = ["PW", "Z2"][zone];
		command += value ? "ON" : ["STANDBY", "OFF"][zone];

		return this.#sendCommand(command, "power command");
	}

	/**
	 * Set the source of the given zone
	 * @param {string} value - The source to set
	 * @param {number} [zone=0] - The zone to set the source for
	 * @returns {boolean} Whether the command was sent successfully
	 */
	setSource(value, zone = 0) {
		if (!value) return false;

		let command = ["SI", "Z2"][zone];
		command += value;

		return this.#sendCommand(command, "source command");
	}

	/**
	 * Set the video select source of the given zone
	 * @param {string} value - The source to set
	 * @returns {boolean} Whether the command was sent successfully
	 */
	setVideoSelectSource(value) {
		if (!value) return false;

		let command = "SV";
		command += value;

		return this.#sendCommand(command, "video select source command");
	}

	/**
	 * Set the dynamic volume state
	 * @param {DynamicVolume} value - The new dynamic volume state to set
	 * @returns {boolean} Whether the command was sent successfully
	 */
	setDynamicVolume(value) {
		let command = "PSDYNVOL ";
		command += value;

		return this.#sendCommand(command, "dynamic volume command");
	}

	/**
	 * Set the Dynamic EQ state
	 * @param {boolean} [value] - The new state. If not provided, toggles.
	 * @returns {boolean} Whether the command was sent successfully
	 */
	setDynamicEQ(value) {
		if (value === undefined) value = !this.status.zones[0].dynamicEQ;

		const command = `PSDYNEQ ${value ? "ON" : "OFF"}`;
		return this.#sendCommand(command, "dynamic EQ command");
	}

	/**
	 * Change a channel level by the given delta (Options → Channel Level).
	 * This adjusts the runtime offset and does not affect MultEQ calibration.
	 * @param {string} channel - The channel code (e.g. "SW" for subwoofer)
	 * @param {number} delta - The amount to change the level by (in dB steps)
	 * @returns {boolean} Whether the command was sent successfully
	 */
	changeChannelLevel(channel, delta) {
		const status = this.status.zones[0];

		if (!status.power) return false;

		try {
			let command = `CV${channel}`;

			const currentLevel = status.channelLevels?.[channel] ?? 50;
			let newLevel = Math.max(38, Math.min(62, currentLevel + delta));
			// Round to nearest 0.5
			newLevel = Math.round(newLevel * 2) / 2;
			// Format: whole numbers as "XX", half steps as "XXX" (e.g. 50.5 -> "505")
			const newLevelStr = Number.isInteger(newLevel)
				? newLevel.toString().padStart(2, "0")
				: (newLevel * 10).toString().padStart(3, "0");
			command += ` ${newLevelStr}`;

			return this.#sendCommand(command, "channel level command");
		} catch (error) {
			this.logger.error(`Error sending channel level command: ${error.message}`);
			return false;
		}
	}

	/**
	 * Set a channel level to a specific value (Options → Channel Level).
	 * @param {string} channel - The channel code (e.g. "SW" for subwoofer)
	 * @param {number} value - The raw level value (38-62, where 50 = 0dB)
	 * @returns {boolean} Whether the command was sent successfully
	 */
	setChannelLevel(channel, value) {
		const status = this.status.zones[0];

		if (!status.power) return false;

		try {
			const clamped = Math.max(38, Math.min(62, value));
			const command = `CV${channel} ${clamped.toString().padStart(2, "0")}`;

			return this.#sendCommand(command, "channel level command");
		} catch (error) {
			this.logger.error(`Error sending channel level command: ${error.message}`);
			return false;
		}
	}

	/** @typedef {(...args: any[]) => void} EventListener */

	/**
	 * Subscribe to events from this receiver
	 * @param {EventListener} listener - The listener function to call when the event is emitted
	 * @param {string} id - The binding ID for this listener, should be the manifest ID of the action that is listening
	 */
	on(listener, id) {
		const listenerId = `${id}-${listener.name}`;

		// Don't add the same listener twice
		if (this.#listenerIds.includes(listenerId)) {
			return;
		}

		this.#listenerIds.push(listenerId);

		this.#eventEmitter.on("event", listener);
	}

	/**
	 * Emit an event from this receiver
	 * @param {ReceiverEvent["type"]} type - The type of event to emit
	 * @param {ReceiverEvent["zone"]} [zone] - The zone that the event occurred on
	 */
	emit(type, zone = 0) {
		/** @type {ReceiverEvent} */
		const payload = { type, zone, connection: this };
		this.#eventEmitter.emit("event", payload);
	}

	/**
	 * Handle connection events
	 */
	#onConnect() {
		this.logger.debug(`Telnet connection established to Denon receiver at ${this.#host}`);

		this.#reconnectCount = 0;
		this.status.statusMsg = "Connected.";

		this.emit("connected");

		this.#requestFullReceiverStatus();
	}

	/**
	 * Handle connection closing event
	 * @param {boolean} [hadError=false] - Whether the connection was closed due to an error.
	 */
	#onClose(hadError = false) {
		(hadError ? this.logger.warn : this.logger.debug)(`Telnet connection to Denon receiver at ${this.#host} closed${hadError ? " due to error" : ""}.`);
		this.#rawSocket = undefined;
		this.#telnet = undefined;

		this.emit("closed");

		// Attempt to reconnect if we haven't given up yet
		if (this.#reconnectCount < 10) {
			this.#reconnectCount++;
			this.status.statusMsg = `Reconnecting... (${this.#reconnectCount}/10)`;
			this.emit("status");

			setTimeout(1000).then(() => {
				this.logger.debug(`Trying to reconnect to Denon receiver at ${this.#host}. Attempt ${this.#reconnectCount}`);
				this.connect();
			});
		}
	}

	/**
	 * Incoming data from the receiver
	 * @param {Buffer | string} data
	 */
	#onData(data) {
		let lines = data.toString().split("\r");
		for (let line of lines) {
			if (line.length === 0) continue;

			let command = "";
			let parameter = "";
			let zone = 0;

			if (line.startsWith("Z2")) {
				// Zone 2 status messages start with "Z2"
				zone = 1;
				line = line.substring(2); // Remove the "Z2" prefix

				// Special parsing for zone 2 due to a lack of "command" portion
				if (parseInt(line.substring(0, 2)) > 0) {
					// Volume
					command = "MV";
					parameter = line.substring(2);
				} else if (line.startsWith("ON") || line.startsWith("OFF")) {
					// Power
					command = "PW";
					parameter = line;
				} else if (line in sources) {
					// Source
					command = "SI";
					parameter = line;
				} else {
					// Resume default parsing
					command = line.substring(0, 2);
					parameter = line.substring(2);
				}
			} else if (line.startsWith("PS")) {
				// Unclear what this meta-command stands for
				line = line.substring(2);  // Remove the "PS" prefix

				// These commands are all space-delimited from their values
				[command, parameter] = line.split(" ");
			} else {
				// Default parsing
				command = line.substring(0, 2);
				parameter = line.substring(2);
			}

			switch (command) {
				case "PW": // Power
					this.#onPowerChanged(parameter, zone);
					break;
				case "MV": // Volume or max volume
					this.#onVolumeChanged(parameter, zone);
					break;
				case "MU": // Mute
					this.#onMuteChanged(parameter, zone);
					break;
				case "SI": // Source
					this.#onSourceChanged(parameter, zone);
					break;
				case "CV": // Channel level (Options → Channel Level)
					this.#onChannelLevelChanged(parameter);
					break;
				case "DYNVOL": // Dynamic volume
					this.#onDynamicVolumeChanged(parameter);
					break;
				case "DYNEQ": // Dynamic EQ
					this.#onDynamicEQChanged(parameter);
					break;
				default:
					this.logger.warn(`Unhandled message from receiver at ${this.#host} Z${zone === 0 ? "M" : "2"}: ${line}`);
					break;
			}
		}
	}

	/**
	 * Handle a power changed message from the receiver
	 * @param {string} parameter - The parameter from the receiver
	 * @param {number} [zone=0] - The zone that the power status changed for
	 */
	#onPowerChanged(parameter, zone = 0) {
		const status = this.status.zones[zone];

		// The receiver will send "ON" or "STANDBY" in zone 1, and "ON" or "OFF" in zone 2
		// It also repeats the power status at a regular interval, so we don't need to emit an event for every message
		const newStatus = parameter === "ON";
		if (newStatus === status.power) return;

		status.power = newStatus;
		this.logger.debug(`Updated receiver power status for ${this.#host} Z${zone === 0 ? "M" : "2"}: ${status.power}`);

		this.emit("powerChanged", zone);

		// Request the full status of the receiver if it is powered on
		// if (status.power) {
		// 	this.#requestFullReceiverStatus();
		// }
	}

	/**
	 * Handle a volume changed message from the receiver
	 * @param {string} parameter - The parameter from the receiver
	 * @param {number} [zone=0] - The zone that the volume status changed for
	 */
	#onVolumeChanged(parameter, zone = 0) {
		const status = this.status.zones[zone];

		if (parameter.startsWith("MAX")) {
			// The "MAX" extended command is not documented, but it is used by the receiver
			// Guessing this is the current maximum volume supported by the receiver
			// In testing, this value raises as the volume approaches the maximum
			// Ex: "MAX 855"
			let valueStr = parameter.substring(4);
			let newMaxVolume = parseInt(valueStr);
			if (valueStr.length === 3) {
				newMaxVolume = newMaxVolume / 10;
			}

			status.maxVolume = newMaxVolume;
			this.logger.debug(`Updated receiver max volume for ${this.#host} Z${zone === 0 ? "M" : "2"}: ${status.maxVolume}`);

			// this.emit("maxVolumeChanged");
		} else {
			let newVolume = parseInt(parameter);
			if (parameter.length === 3) {
				newVolume = newVolume / 10;
			}

			status.volume = newVolume;
			status.muted = false; // Implied by the volume changing
			this.logger.debug(`Updated receiver volume for ${this.#host} Z${zone === 0 ? "M" : "2"}: ${status.volume}`);

			this.emit("volumeChanged", zone);
		}
	}

	/**
	 * Handle a mute changed message from the receiver
	 * @param {string} parameter - The parameter from the receiver
	 * @param {number} [zone=0] - The zone that the mute status changed for
	 */
	#onMuteChanged(parameter, zone = 0) {
		const status = this.status.zones[zone];

		status.muted = parameter == "ON";
		this.logger.debug(`Updated receiver mute status for ${this.#host} Z${zone === 0 ? "M" : "2"}: ${status.muted}`);

		this.emit("muteChanged", zone);
	}

	/**
	 * Handle a source changed message from the receiver
	 * @param {string} parameter - The parameter from the receiver
	 * @param {number} [zone=0] - The zone that the source status changed for
	 */
	#onSourceChanged(parameter, zone = 0) {
		const status = this.status.zones[zone];

		status.source = parameter;
		this.logger.debug(`Updated receiver source for ${this.#host} Z${zone === 0 ? "M" : "2"}: ${status.source}`);

		this.emit("sourceChanged", zone);
	}

	/**
	 * Handle a dynamic volume changed message from the receiver
	 * @param {string} parameter - The parameter from the receiver
	 */
	#onDynamicVolumeChanged(parameter) {
		if (!["HEV", "MED", "LIT", "OFF"].includes(parameter)) {
			this.logger.warn(`Invalid dynamic volume value received from receiver at ${this.#host}: ${parameter}`);
			return;
		}

		const status = this.status;

		status.zones[0].dynamicVolume = /** @type {DynamicVolume} */ (parameter);
		this.logger.debug(`Updated receiver dynamic volume status for ${this.#host}: ${status.zones[0].dynamicVolume}`);

		this.emit("dynamicVolumeChanged");
	}

	/**
	 * Handle a Dynamic EQ changed message from the receiver
	 * @param {string} parameter - The parameter from the receiver ("ON" or "OFF")
	 */
	#onDynamicEQChanged(parameter) {
		if (!["ON", "OFF"].includes(parameter)) {
			this.logger.warn(`Invalid dynamic EQ value received from receiver at ${this.#host}: ${parameter}`);
			return;
		}

		this.status.zones[0].dynamicEQ = parameter === "ON";
		this.logger.debug(`Updated receiver dynamic EQ status for ${this.#host}: ${this.status.zones[0].dynamicEQ}`);

		this.emit("dynamicEQChanged");
	}

	/**
	 * Handle a channel level changed message from the receiver.
	 * Response format: "CVXX yy" where XX is the channel code and yy is the raw value (38-62, 50=0dB).
	 * Three-digit values represent 0.5dB steps (e.g. 505 = +0.5dB).
	 * @param {string} parameter - The parameter from the receiver (e.g. "SW 50", "FL 505")
	 */
	#onChannelLevelChanged(parameter) {
		const status = this.status.zones[0];

		// CV responses come as "CVXX yy" — after removing the "CV" prefix in #onData,
		// parameter is like "SW 50" or "FL 505" or "END" (end of channel level dump)
		if (parameter === "END") return;

		// Find the split between channel name and value
		// Channel names: FL, FR, C, SW, SL, SR, SBL, SBR, FHL, FHR, FWL, FWR, etc.
		const spaceIdx = parameter.indexOf(" ");
		if (spaceIdx === -1) return;

		const channel = parameter.substring(0, spaceIdx);
		const valueStr = parameter.substring(spaceIdx + 1);
		let value = parseInt(valueStr);

		if (isNaN(value)) return;

		// Three-digit values represent 0.5dB steps
		if (valueStr.length === 3) {
			value = value / 10;
		}

		status.channelLevels[channel] = value;

		const dbOffset = value - 50;
		const dbStr = dbOffset >= 0 ? `+${dbOffset}` : `${dbOffset}`;
		this.logger.debug(`Updated channel level for ${this.#host} ${channel}: ${dbStr}dB (raw: ${value})`);

		this.emit("channelLevelChanged");
	}

	/**
	 * Handle socket errors
	 * @param {Object} error
	 */
	#onError(error) {
		const status = this.status;

		if (error.code === "ENOTFOUND") {
			// If the host can't be looked up, give up.
			status.statusMsg = `Host not found: ${this.#host}`;
			this.disconnect();
		} else {
			status.statusMsg = `Connection error: ${error.message} (${error.code})`;
		}

		this.logger.warn(status.statusMsg);
		this.emit("status");
	}

	/**
	 * Request the full status of the receiver
	 * Usually only needed when the connection is first established
	 */
	#requestFullReceiverStatus() {
		// Main zone
		this.#sendCommand("PW?", "power status request");
		this.#sendCommand("MV?", "volume status request");
		this.#sendCommand("MU?", "mute status request");
		this.#sendCommand("CV?", "channel level status request");
		this.#sendCommand("PSDYNVOL ?", "dynamic volume status request");
		this.#sendCommand("PSDYNEQ ?", "dynamic EQ status request");

		// Zone 2
		this.#sendCommand("Z2PW?", "zone 2 power status request");
		this.#sendCommand("Z2MV?", "zone 2 volume status request");
		this.#sendCommand("Z2MU?", "zone 2 mute status request");
	}
}