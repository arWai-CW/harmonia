import { Chord, Note } from "tonal";
import { Midi } from "@tonejs/midi";
import { buildStylePreview, buildStylePreviewMidi, voicingMovement } from "../style-preview.js";
import { getKeyDefinition } from "../chord-utils.js";
import { findTwoFiveChains } from "../harmony-analysis.js";

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const test = (name, fn) => {
	try { fn(); return { name, status: "pass" }; }
	catch (error) { return { name, status: "fail", error }; }
};
const makeView = (symbols, beats = 4) => {
	const segments = symbols.map((symbol, i) => ({ id: `s${i}`, startTime: i * beats * 0.5, endTime: (i + 1) * beats * 0.5, chord: { symbol, root: Chord.get(symbol).tonic, suffix: Chord.get(symbol).aliases[0] } }));
	return { segments, twoFiveChains: findTwoFiveChains(segments), keyRegions: [], bars: symbols.map((_, i) => ({ index: i + 1, time: i * beats * 0.5 })), barDuration: beats * 0.5, timeSignature: [beats, 4] };
};
const symbols = (view, style, key = "C", autoKey = true) => buildStylePreview(view, style, { keyDefinition: getKeyDefinition(key, "major"), autoKey }).chords.map((chord) => chord.symbol);

export function runStylePreviewTests() {
	return [
		test("Rock ii–V–I substitutions transpose from C to F# and Gb", () => {
			assert(JSON.stringify(symbols(makeView(["Dm7", "G7", "Cmaj7"]), "rock")) === JSON.stringify(["F5", "G5", "C5"]), "C ii becomes IV");
			for (const key of ["F#", "Gb"]) {
				const result = buildStylePreview(makeView(["G#m7", "C#7", "F#maj7"]), "rock", { keyDefinition: getKeyDefinition(key, "major") });
				assert(JSON.stringify(result.chords.map((chord) => chord.root)) === JSON.stringify([11, 1, 6]), `${key} ii becomes IV`);
				assert(result.chords.every((chord) => JSON.stringify(chord.intervals) === "[0,7,12]"), "power chord structure");
				assert(result.chords[0].symbol === (key === "Gb" ? "Cb5" : "B5"), "local enharmonic spelling");
			}
		}),
		test("Rock/pop replace subV with V, rock holds passing dim, pop keeps ii", () => {
			const view = makeView(["Dm7", "Db7", "Cmaj7", "C#dim7", "Dm7"]);
			assert(JSON.stringify(symbols(view, "rock").slice(0, 4)) === JSON.stringify(["F5", "G5", "C5", "C5"]), "subV and passing dim");
			assert(JSON.stringify(symbols(view, "pop").slice(0, 3)) === JSON.stringify(["Dm", "G", "C"]), "pop keeps ii, simplifies dominant");
			assert(symbols(makeView(["G11"]), "pop")[0] === "Gsus4", "dominant fourth becomes sus4");
			assert(symbols(makeView(["G", "Bdim", "C"]), "rock")[1] === "B5", "structural leading-tone diminished is not a passing chord");
			const secondary = makeView(["Em7", "Eb7", "Dm7"]);
			assert(JSON.stringify(symbols(secondary, "rock").slice(0, 2)) === JSON.stringify(["G5", "A5"]), "secondary ii–subV uses its annotated target");
		}),
		test("Local modulation changes functional substitutions; Auto off uses song key", () => {
			const view = makeView(["Db7", "Db7"]);
			view.keyRegions = [{ startTime: 0, endTime: 2, root: "C", mode: "major" }, { startTime: 2, endTime: 4, root: "Gb", mode: "major" }];
			assert(JSON.stringify(symbols(view, "rock")) === JSON.stringify(["G5", "Db5"]), "bII in C, V in Gb");
			assert(JSON.stringify(symbols(view, "rock", "C", false)) === JSON.stringify(["G5", "G5"]), "global key when Auto off");
		}),
		test("DP voicings move no more than naive root positions on ii–V–I–vi", () => {
			const view = makeView(["Dm7", "G7", "Cmaj7", "Am7"]);
			const preview = buildStylePreview(view, "pop");
			const chosen = preview.chords.map((chord) => chord.voicing);
			const naive = preview.chords.map((chord) => chord.intervals.map((interval) => 60 + chord.root + interval).sort((a, b) => a - b));
			const movement = (sequence) => sequence.slice(1).reduce((sum, notes, i) => sum + voicingMovement(sequence[i], notes), 0);
			assert(movement(chosen) <= movement(naive), `${movement(chosen)} <= ${movement(naive)}`);
			assert(chosen.every((voicing) => voicing.every((pitch) => pitch >= 52 && pitch <= 84)), "pop register");
		}),
		test("All style patterns respect irregular segment boundaries and three-quarter bars", () => {
			for (const beats of [3, 4]) for (const style of ["rock", "pop", "funk", "ballad"]) {
				const view = makeView(["Dm7", "G7", "Cmaj7"], beats);
				view.segments[0].endTime -= 0.13;
				view.segments[1].startTime -= 0.13;
				const preview = buildStylePreview(view, style);
				assert(preview.notes.length > 0, "pattern exists");
				assert(preview.notes.every((note) => view.segments.some((segment) => note.startTime >= segment.startTime - 1e-8 && note.endTime <= segment.endTime + 1e-8) && note.endTime > note.startTime), `${style} boundaries`);
				assert(preview.notes.some((note) => note.role === "bass") && preview.notes.some((note) => note.role === "chord"), "separate parts");
				if (style === "ballad") assert(preview.chords.every((chord) => chord.voicing.at(-1) - chord.voicing[0] >= 12), "open ballad voicings");
			}
		}),
		test("Funk keeps substituted roots, ballad keeps altered harmony and slash bass", () => {
			const view = makeView(["Dm7", "Db7", "C/E", "G7b9"]);
			const funk = buildStylePreview(view, "funk");
			assert(funk.chords[1].root === 1 && funk.chords[1].symbol.endsWith("9"), "funk keeps tritone substitute");
			const ballad = buildStylePreview(view, "ballad");
			assert(ballad.chords[2].symbol === "Cmaj7/E" && ballad.chords[2].bass === 4, "slash bass");
			assert(ballad.chords[3].symbol === "G7b9", "altered harmony preserved");
		}),
		test("Preview export round-trips as three MIDI tracks", () => {
			const preview = buildStylePreview(makeView(["Dm7", "G7", "Cmaj7"]), "rock");
			const melody = [{ id: "m", midi: 72, startTime: 0.25, endTime: 1, velocity: 0.8 }];
			const parsed = new Midi(buildStylePreviewMidi(preview, melody).toArray());
			assert(parsed.tracks.length === 3 && parsed.tracks.map((track) => track.name).join() === "Chords,Bass,Melody", "three named tracks");
			assert(parsed.tracks[2].notes[0].midi === 72, "melody retained");
			assert(parsed.tracks[0].notes.length === preview.notes.filter((note) => note.role === "chord").length, "chord events retained");
			const localized = new Midi(buildStylePreviewMidi(preview, melody, { tempo: 100, timeSignature: [3, 4], trackNames: ["和弦", "貝斯", "旋律"] }).toArray());
			assert(localized.header.timeSignatures[0].timeSignature.join() === "3,4" && localized.header.tempos[0].bpm === 100, "export meter and tempo");
			assert(localized.tracks.length === 3, "localized track labels preserve parts");
		}),
		test("Empty, unknown and Off inputs do not generate preview events", () => {
			for (const style of ["rock", "pop", "funk", "ballad", "off", "unknown"]) assert(buildStylePreview(makeView([]), style).notes.length === 0, "empty/off");
			const view = makeView(["C"]); view.segments[0].chord.symbol = "?";
			assert(buildStylePreview(view, "rock").notes.length === 0, "unknown chord skipped");
			assert(buildStylePreview(makeView(["C"]), "off").chords.length === 0, "Off");
			assert(Note.chroma("F#") === Note.chroma("Gb"), "enharmonic fixtures");
		}),
	];
}
