import { applyMelodyOverrides, extractMelodyLine } from "../melody-extraction.js";
import { filterMidiView } from "../midi-utils.js";
import { getKeyDefinition } from "../chord-utils.js";

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const test = (name, fn) => {
	try { fn(); return { name, status: "pass" }; }
	catch (error) { return { name, status: "fail", error }; }
};

export function createHandSwapNotes() {
	return [72, 74, 76, 74, 60, 62, 64, 62, 74, 76, 77, 76].flatMap((midi, i) => {
		const comp = i >= 4 && i < 8 ? [76, 79, 83] : [48, 52, 55];
		return [midi, ...comp].map((pitch, j) => ({
			id: j === 0 ? `melody${i}` : `comp${i}:${j}`,
			midi: pitch, trackIndex: 0, startTime: i * 0.5, endTime: i * 0.5 + (j === 0 ? 0.45 : 0.11),
			startTick: i * 480, endTick: i * 480 + (j === 0 ? 432 : 106), velocity: 100 / 127,
		}));
	});
}

export function runMelodyExtractionTests() {
	const options = { ppq: 480, barDuration: 2 };
	return [
		test("A sustaining bass does not crowd out four short melody notes", () => {
			const notes = [
				{ id: "bass", midi: 48, startTime: 0, endTime: 2 },
				...[72, 74, 76, 77].map((midi, i) => ({ id: `line${i}`, midi, startTime: i * 0.5, endTime: i * 0.5 + 0.25 })),
			];
			const selected = [...extractMelodyLine(notes, { beatDuration: 0.5, barDuration: 2 }).melody.keys()].sort();
			assert(selected.join() === "line0,line1,line2,line3", JSON.stringify(selected));
		}),
		test("Rest paths keep short and long sustain histories separate", () => {
			const notes = [
				{ id: "long", midi: 84, startTime: 0, endTime: 2 },
				{ id: "short", midi: 72, startTime: 0, endTime: 0.5 },
				...[36, 40, 43].map((midi, i) => ({ id: `comp${i}`, midi, startTime: 0.6, endTime: 0.61 })),
				...[72, 74, 76].map((midi, i) => ({ id: `next${i}`, midi, startTime: 1 + i * 0.5, endTime: 1.4 + i * 0.5 })),
			];
			const selected = [...extractMelodyLine(notes, { beatDuration: 0.5, barDuration: 2 }).melody.keys()].sort();
			assert(selected.join() === "next0,next1,next2,short", JSON.stringify(selected));
		}),
		test("A sustained melody does not absorb later accompaniment arpeggios", () => {
			for (const delay of [0.25, 2.25]) {
				const notes = [
					{ id: "held", midi: 72, startTime: 0, endTime: delay + 1.75 },
					...[60, 64, 67, 64].map((midi, i) => ({ id: `arp${i}`, midi, startTime: delay + i * 0.4, endTime: delay + 0.2 + i * 0.4 })),
				];
				const selected = [...extractMelodyLine(notes, { beatDuration: 0.5, barDuration: 2 }).melody.keys()];
				assert(selected.length === 1 && selected[0] === "held", JSON.stringify(selected));
				const source = {
					notes: notes.map((note) => ({ ...note, trackIndex: 0, startTick: Math.round(note.startTime * 960), endTick: Math.round(note.endTime * 960), velocity: 100 / 127 })),
					ppq: 480, barDuration: 2, bars: [0, 1].map((i) => ({ index: i + 1, time: i * 2, tick: i * 1920 })),
				};
				const view = filterMidiView(source, [0], getKeyDefinition("C", "major"), "auto");
				assert(view.segments.some((segment) => segment.chord?.root === "C"), "arpeggiated harmony remains after melody exclusion");
			}
		}),
		test("Normal legato overlap retains successive melody attacks", () => {
			const notes = [72, 74, 76, 77].map((midi, i) => ({ id: `legato${i}`, midi, startTime: i * 0.5, endTime: i * 0.5 + 0.58 }));
			const result = extractMelodyLine(notes, { beatDuration: 0.5, barDuration: 2 });
			assert(notes.every((note) => result.melody.has(note.id)), JSON.stringify([...result.melody.keys()]));
		}),
		test("A phrase after a long rest is independent of the preceding register", () => {
			const phrase = [
				{ id: "phrase0", midi: 60, startTime: 4, endTime: 4.5 },
				{ id: "phrase1", midi: 60, startTime: 4.5, endTime: 5 },
				{ id: "comp1", midi: 67, startTime: 4.5, endTime: 5 },
			];
			const extract = (prefix) => [...extractMelodyLine([...prefix, ...phrase], options).melody]
				.filter(([id]) => id !== "prefix").sort(([a], [b]) => a.localeCompare(b));
			const expected = extract([]);
			for (const midi of [24, 108]) {
				const actual = extract([{ id: "prefix", midi, startTime: 0, endTime: 0.5 }]);
				assert(JSON.stringify(actual.map(([id]) => id)) === JSON.stringify(expected.map(([id]) => id)), "same melody after high or low prefix");
				assert(actual.every(([, value], i) => Math.abs(value.confidence - expected[i][1].confidence) < 1e-10), "same confidence after phrase reset");
			}
		}),
		test("Small onset offsets stay in one cluster with low confidence for ambiguous lines", () => {
			const notes = [60, 72].map((midi, i) => ({ id: `ambiguous${i}`, midi, startTime: i * 0.01, endTime: i * 0.01 + 0.5, velocity: 100 / 127 }));
			const result = extractMelodyLine(notes, { beatDuration: 0.5 });
			assert(result.melody.size === 1 && result.melody.has("ambiguous1"), "one top-line note per cluster");
			assert(result.melody.get("ambiguous1").confidence < 0.35, "close alternatives flag uncertainty");
		}),
		test("Melody extraction follows RH, LH under upper comping, and RH again", () => {
			const result = extractMelodyLine(createHandSwapNotes(), options);
			const expected = Array.from({ length: 12 }, (_, i) => `melody${i}`).sort();
			assert(JSON.stringify([...result.melody.keys()].sort()) === JSON.stringify(expected), JSON.stringify([...result.melody.keys()]));
			assert([...result.melody.values()].every((value) => value.confidence >= 0 && value.confidence <= 1), "bounded confidence");
		}),
		test("Hand and track assignments do not influence extracted melody", () => {
			const notes = createHandSwapNotes();
			const split = notes.map((note, i) => ({ ...note, trackIndex: i % 3 }));
			assert(JSON.stringify([...extractMelodyLine(notes, options).melody]) === JSON.stringify([...extractMelodyLine(split, options).melody]), "ignore track and hand");
		}),
		test("Constant and near-constant velocities disable the velocity cue", () => {
			for (const offset of [0, 0.002]) {
				const result = extractMelodyLine(createHandSwapNotes().map((note, i) => ({ ...note, velocity: 0.78 + (i % 2) * offset })), options);
				assert(!result.velocityEnabled && result.melody.size > 0, "constant velocity disabled");
			}
		}),
		test("Varying velocities favour the louder line over higher accompaniment", () => {
			const notes = Array.from({ length: 4 }, (_, i) => [60, 67, 72].map((midi, j) => ({ id: `${i}:${j}`, midi, startTime: i * 0.5, endTime: i * 0.5 + 0.4, velocity: j === 0 ? 0.95 : 0.3 })) ).flat();
			const result = extractMelodyLine(notes, { beatDuration: 0.5 });
			assert(result.velocityEnabled && [...result.melody.keys()].every((id) => id.endsWith(":0")) && result.melody.size === 4, JSON.stringify([...result.melody.keys()]));
		}),
		test("Manual inclusion and exclusion override extraction without changing inputs", () => {
			const notes = createHandSwapNotes();
			const original = extractMelodyLine(notes, options);
			const overrides = new Map([["melody0", false], ["comp0:1", true], ["missing", true]]);
			const adjusted = applyMelodyOverrides(original.melody, notes, overrides);
			assert(!adjusted.has("melody0") && adjusted.get("comp0:1")?.manual && !adjusted.has("missing"), "overrides win");
			assert(original.melody.has("melody0") && !original.melody.has("comp0:1"), "pure overrides");
			const extracted = extractMelodyLine(notes, { ...options, overrides });
			assert(JSON.stringify([...extracted.melody]) === JSON.stringify([...adjusted]), "extractor applies overrides");
		}),
		test("Auto melody is excluded from harmony and note IDs survive track filtering", () => {
			const notes = createHandSwapNotes();
			const source = { notes, ppq: 480, barDuration: 2, bars: [0, 1, 2].map((i) => ({ index: i + 1, time: i * 2, tick: i * 1920 })) };
			const view = filterMidiView(source, [0], getKeyDefinition("C", "major"), "auto");
			assert(view.segments.every((segment) => segment.noteIds.every((id) => !view.melodyExtraction.melody.has(id))), "melody does not contaminate harmony");
			assert(view.notes.every((note, i) => note.id === notes[i].id), "stable IDs");
			const split = { ...source, notes: notes.map((note, i) => ({ ...note, trackIndex: i % 2 })) };
			const filtered = filterMidiView(split, [1], getKeyDefinition("C", "major"));
			assert(JSON.stringify(filtered.notes.map((note) => note.id)) === JSON.stringify(split.notes.filter((note) => note.trackIndex === 1).map((note) => note.id)), "IDs survive disabling tracks");
			const adjusted = filterMidiView(source, [0], getKeyDefinition("C", "major"), "auto", new Map([["melody0", false]]));
			assert(adjusted.segments.some((segment) => segment.noteIds.includes("melody0")), "override recomputes harmony");
		}),
		test("Empty, invalid and short accompaniment-only inputs are safe", () => {
			assert(extractMelodyLine([], options).melody.size === 0, "empty");
			assert(extractMelodyLine([{ id: "bad", midi: NaN, startTime: 0, endTime: 1 }], options).melody.size === 0, "invalid");
			const notes = [60, 64, 67].map((midi, i) => ({ id: `chord${i}`, midi, startTime: 0, endTime: 0.01 }));
			assert(extractMelodyLine(notes, { beatDuration: 0.5 }).melody.size === 0, "no-melody state");
		}),
	];
}
