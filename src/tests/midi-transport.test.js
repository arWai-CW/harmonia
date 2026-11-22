import { wheelZoom, timeAtX, anchoredScrollLeft, followScrollLeft } from "../midi-transport.js";
import { createState, createStorage, persistStateImmediate } from "../state.js";

const assert = (value, message) => { if (!value) throw new Error(message); };
const test = (name, fn) => {
	try { fn(); return { name, status: "pass" }; }
	catch (error) { return { name, status: "fail", error }; }
};

export function runMidiTransportTests() {
	return [
		test("Wheel zoom follows direction, limits and invalid deltas", () => {
			assert(wheelZoom(2, -100, 1, 4) > 2 && wheelZoom(2, 100, 1, 4) < 2, "zoom direction");
			assert(wheelZoom(2, -10000, 1, 4) === 4 && wheelZoom(2, 10000, 1, 4) === 1, "limits");
			assert(wheelZoom(2, NaN, 1, 4) === 2 && wheelZoom(2, 0, 1, 4) === 2, "invalid/empty delta");
		}),
		test("Anchored zoom preserves cursor time and clamps scroll bounds", () => {
			const options = { scrollLeft: 200, cursorX: 180, oldScale: 60, newScale: 120, viewportWidth: 600, contentWidth: 4000 };
			const next = anchoredScrollLeft(options);
			assert(timeAtX(180, 200, 60, 100) === timeAtX(180, next, 120, 100), "same time under cursor");
			assert(anchoredScrollLeft({ ...options, contentWidth: 300 }) === 0, "short content");
			assert(anchoredScrollLeft({ ...options, oldScale: 0 }) === 0, "invalid scale");
			assert(anchoredScrollLeft({ ...options, scrollLeft: 3900 }) === 3400, "end clamp");
		}),
		test("Seek coordinates include scroll and padding and respect empty bounds", () => {
			assert(timeAtX(112, 100, 100, 10) === 2, "scrolled coordinate");
			assert(timeAtX(0, 0, 100, 10) === 0 && timeAtX(5000, 0, 100, 10) === 10, "bounds");
			assert(timeAtX(100, 0, 0, 10) === 0 && timeAtX(100, 0, 100, 0) === 0 && timeAtX(NaN, 0, 100, 10) === 0, "empty/invalid");
		}),
		test("Follow centers the playhead except at the beginning and end", () => {
			assert(followScrollLeft(0, 100, 600, 2000) === 0, "start");
			assert(followScrollLeft(8, 100, 600, 2000) === 512, "center");
			assert(followScrollLeft(20, 100, 600, 2000) === 1400, "end");
			assert(followScrollLeft(1, 100, 600, 200) === 0, "short content");
		}),
		test("Follow defaults on and persists through the state storage pattern", () => {
			const data = new Map();
			const storage = createStorage({ getItem: (key) => data.get(key), setItem: (key, value) => data.set(key, value) });
			const state = createState(storage);
			assert(state.midiFollowPlayhead === true, "default on");
			state.midiFollowPlayhead = false;
			persistStateImmediate(storage, state);
			assert(createState(storage).midiFollowPlayhead === false, "stored off");
		}),
	];
}
