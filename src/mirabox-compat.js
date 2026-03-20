/**
 * Mirabox compatibility — rollup plugin.
 *
 * Mirabox stream controllers send "Knob" as the controller type instead of
 * "Encoder" which the Elgato Stream Deck SDK expects. This plugin patches the
 * SDK source during bundling so that "Knob" is treated as "Encoder" in the
 * three places that matter:
 *
 * 1. isDial() — recognizes "Knob" as a dial
 * 2. DialAction constructor — accepts "Knob" without throwing
 * 3. willAppear routing — creates a DialAction for "Knob" controllers
 */
export default function miraboxCompat() {
	return {
		name: "mirabox-compat",
		transform(code, id) {
			// Only patch the Stream Deck SDK
			if (!id.includes("@elgato") || !id.includes("streamdeck")) {
				return null;
			}

			let patched = code;

			// 1. isDial(): also return true for "Knob"
			patched = patched.replace(
				'return this.controllerType === "Encoder";',
				'return this.controllerType === "Encoder" || this.controllerType === "Knob";'
			);

			// 2. DialAction constructor: accept "Knob" as well
			patched = patched.replace(
				'if (source.payload.controller !== "Encoder") {',
				'if (source.payload.controller !== "Encoder" && source.payload.controller !== "Knob") {'
			);

			// 3. willAppear routing: treat "Knob" as an Encoder (create DialAction)
			patched = patched.replace(
				'ev.payload.controller === "Encoder" ? new DialAction(ev) : new KeyAction(ev)',
				'(ev.payload.controller === "Encoder" || ev.payload.controller === "Knob") ? new DialAction(ev) : new KeyAction(ev)'
			);

			if (patched !== code) {
				return { code: patched, map: null };
			}

			return null;
		}
	};
}
