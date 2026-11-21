import { detectKeyRegions, findTwoFiveChains, labelMelodyNotes, nameArpeggioChords } from "../harmony-analysis.js";
import { getKeyDefinition } from "../chord-utils.js";
import { Note } from "tonal";

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const segments = (symbols) => symbols.map((symbol, i) => ({ id: `s${i}`, startTime: i * 2, endTime: i * 2 + 2, chord: { symbol } }));
const test = (name, fn) => {
	try { fn(); return { name, status: "pass" }; }
	catch (error) { return { name, status: "fail", error }; }
};

export function runHarmonyAnalysisTests() {
	return [
		test("Melody ending two bars after accompaniment has no chord label", () => {
			const notes = [{ id: "late", trackIndex: 1, midi: 60, startTime: 6, endTime: 6.5, startTick: 5760, endTick: 6240 }];
			assert(labelMelodyNotes(notes, segments(["Cmaj7"]), 1, 480, 2).size === 0, "two-bar rest");
			assert(labelMelodyNotes(notes, segments(["Cmaj7"]), 1, 480).size === 0, "four-beat fallback");
		}),
		test("Melody carries chords through short comping gaps, not past the next chord", () => {
			const chords = segments(["Cmaj7", "Dm7"]);
			chords[0].endTime = 1.5;
			const notes = [1.75, 2].map((startTime, i) => ({ id: `gap${i}`, trackIndex: 1, midi: 60, startTime, endTime: startTime + 0.5, startTick: startTime * 960, endTick: startTime * 960 + 480 }));
			const labels = labelMelodyNotes(notes, chords, 1, 480, 2);
			assert(labels.get("gap0")?.label === "1", "half-beat comping gap uses C");
			assert(labels.get("gap1")?.label === "b7", "next chord starts: use Dm7");
		}),
		test("All 24 detected keys round-trip through the key table", () => {
			const profiles = {
				major: [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88],
				minor: [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17],
			};
			for (const [mode, profile] of Object.entries(profiles)) {
				for (let root = 0; root < 12; root++) {
					const notes = profile.map((weight, pc) => ({ midi: 60 + (root + pc) % 12, startTime: 0, endTime: weight }));
					const regions = detectKeyRegions(notes, [{ index: 1, time: 0 }], 8);
					assert(regions.length === 1, "one region");
					const detected = regions[0];
					const definition = getKeyDefinition(detected.root, detected.mode);
					assert(Note.chroma(detected.root) === root && detected.mode === mode, `detected ${root} ${mode}: ${JSON.stringify(detected)}`);
					assert(Note.chroma(definition.id) === root && definition.mode === mode, `round-trip ${detected.root} ${mode}`);
				}
			}
		}),
		...[[60, 62, 64, 65], [65, 64, 62, 60], [60, 62, 64, 65, 72], [60, 62, 60, 62]].map((pitches) => test(`Stepwise single line stays unlabelled: ${pitches.join(" ")}`, () => {
			const notes = pitches.map((midi, i) => ({ id: `n${i}`, midi, trackIndex: 0, startTime: i * 2 / pitches.length, endTime: (i + 0.8) * 2 / pitches.length, startTick: i * 1920 / pitches.length, endTick: (i + 0.8) * 1920 / pitches.length }));
			const found = nameArpeggioChords(notes, [], [{ index: 1, time: 0, tick: 0 }], 2, 480, getKeyDefinition("C", "major"));
			assert(found.length === 0, JSON.stringify(found.map((s) => s.chord.symbol)));
		})),
		...[{ pitches: [[60, 64, 67, 64]], expected: ["C"], held: true }, { pitches: [[57, 60, 64, 67]], expected: ["Am7"] }, { pitches: [[62, 65, 69, 72], [55, 59, 62, 65]], expected: ["Dm7", "G7"] }, { pitches: [[60, 64, 65, 67, 64]], expected: ["C"] }].map((fixture) => test(`Broken chord ${fixture.expected.join(" / ")}`, () => {
			const notes = fixture.pitches.flatMap((pitches, bar) => pitches.map((midi, i) => ({ id: `${bar}:${i}`, midi, trackIndex: 0, startTime: bar * 2 + i * 2 / pitches.length, endTime: fixture.held ? bar * 2 + 2 : bar * 2 + (i + 0.7) * 2 / pitches.length, startTick: bar * 1920 + i * 1920 / pitches.length, endTick: (bar + 1) * 1920 })));
			const bars = fixture.pitches.map((_, i) => ({ index: i + 1, time: i * 2, tick: i * 1920 }));
			const found = nameArpeggioChords(notes, [], bars, 2, 480, getKeyDefinition("C", "major"));
			assert(JSON.stringify(found.map((s) => s.chord.symbol)) === JSON.stringify(fixture.expected), JSON.stringify(found.map((s) => s.chord.symbol)));
		})),
		test("Key regions follow C to Eb without flicker", () => {
			const bars = Array.from({ length: 16 }, (_, i) => ({ index: i + 1, time: i * 2 }));
			const notes = bars.flatMap((bar, i) => [0, 0, 0, 4, 4, 7, 7, 2, 5, 9, 11].map((pitch) => ({ midi: 60 + pitch + (i < 8 ? 0 : 3), startTime: bar.time, endTime: bar.time + 2 })));
			const regions = detectKeyRegions(notes, bars, 2);
			assert(regions.length === 2, JSON.stringify(regions));
			assert(regions[0].root === "C" && regions[1].root === "Eb" && regions.every((r) => r.mode === "major"), JSON.stringify(regions));
			assert(Math.abs(regions[1].startBar - 9) <= 1, "boundary near modulation");
		}),
		test("ii–V and tritone substitution", () => {
			const normal = findTwoFiveChains(segments(["Dm7", "G7", "Cmaj7"]))[0];
			const sub = findTwoFiveChains(segments(["Dm9", "Db7", "Cmaj7"]))[0];
			assert(normal.type === "ii-V" && normal.targetRoot === "C" && normal.resolved, JSON.stringify(normal));
			assert(sub.type === "ii-subV" && sub.targetRoot === "C" && sub.resolved, JSON.stringify(sub));
		}),
		test("Backdoor requires actual tonic arrival", () => {
			assert(findTwoFiveChains(segments(["Fm7", "Bb7", "C"]))[0].type === "backdoor", "backdoor");
			const ordinary = findTwoFiveChains(segments(["Fm7", "Bb7", "Ebmaj7"]))[0];
			assert(ordinary.type === "ii-V" && ordinary.targetRoot === "Eb", "ordinary ii V");
		}),
		test("Unresolved ii–V chains share identity", () => {
			const patterns = findTwoFiveChains(segments(["Em7", "A7", "Dm7", "G7", "Cmaj7"]));
			assert(patterns.length === 2 && !patterns[0].resolved && patterns[1].resolved && patterns[0].chainId === patterns[1].chainId, JSON.stringify(patterns));
		}),
		test("Revoicings and half diminished ii", () => {
			const patterns = findTwoFiveChains(segments(["Dm7b5", "Dm7b5", "G7b9", "Cm"]));
			assert(patterns.length === 1 && patterns[0].segmentIds.length === 3 && patterns[0].targetMode === "minor", JSON.stringify(patterns));
		}),
		test("Melody chord, ninth, sharp eleven and passing labels", () => {
			const notes = [60, 62, 64, 74, 78].map((midi, i) => ({ id: `n${i}`, trackIndex: 1, midi, startTime: i / 4, endTime: i / 4 + 0.2, startTick: i * 120, endTick: i * 120 + 100 }));
			const labels = labelMelodyNotes(notes, segments(["Cmaj7"]), 1, 480);
			assert(labels.get("n0").kind === "chord", "root");
			assert(labels.get("n1").kind === "passing", "stepwise passing ninth");
			assert(labels.get("n3").label === "9" && labels.get("n3").kind === "tension", "ninth");
			assert(labels.get("n4").label === "#11", "sharp eleven");
		}),
		test("Empty and unknown inputs do not produce analysis", () => {
			assert(detectKeyRegions([], [], 2).length === 0, "empty keys");
			assert(findTwoFiveChains(segments(["?"])).length === 0, "unknown chord");
			assert(labelMelodyNotes([], [], null, 480).size === 0, "empty melody");
		}),
	];
}
