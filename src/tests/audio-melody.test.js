import { estimateNoteLoudness, extractAudioMelodyContour, matchAudioMelodyToNotes, filterPlaybackNotes } from "../audio-melody.js";
import { extractMelodyLine } from "../melody-extraction.js";

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const test = (name, fn) => {
	try { fn(); return { name, status: "pass" }; }
	catch (error) { return { name, status: "fail", error }; }
};

export function createAudioMelodyFixture(repeats = 1, sampleRate = 22050) {
	const notes = [];
	const samples = new Float32Array(sampleRate * 2 * repeats);
	for (let i = 0; i < 4 * repeats; i++) {
		for (const [voice, amplitude, interval] of [["lower", 0.2, 0], ["upper", 0.035, 19]]) {
			const midi = [60, 62, 64, 65][i % 4] + interval;
			const startTime = i * 0.5, endTime = startTime + 0.45;
			notes.push({ id: `${voice}${i}`, midi, trackIndex: 0, startTime, endTime, velocity: 100 / 127 });
			const frequency = 440 * 2 ** ((midi - 69) / 12);
			for (let j = Math.round(startTime * sampleRate); j < Math.round(endTime * sampleRate); j++) {
				const time = j / sampleRate - startTime;
				const envelope = Math.min(1, time / 0.015, (endTime - j / sampleRate) / 0.02);
				for (let h = 1; h <= 4; h++) samples[j] += envelope * amplitude / h ** 1.2 * Math.sin(2 * Math.PI * frequency * h * time);
			}
		}
	}
	return { samples, sampleRate, notes };
}

export function runAudioMelodyTests() {
	const { samples, sampleRate, notes } = createAudioMelodyFixture();
	const loudness = estimateNoteLoudness(samples, sampleRate, notes);
	const contour = extractAudioMelodyContour(samples, sampleRate);
	const audioMelody = matchAudioMelodyToNotes(contour, notes);
	return [
		test("Harmonic onset loudness ranks loud lower notes above quiet upper notes", () => {
			for (let i = 0; i < 4; i++) assert(loudness.get(`lower${i}`) > loudness.get(`upper${i}`), "lower line is louder");
			assert([...loudness.values()].every((level) => level >= 0 && level <= 1), "normalized levels");
		}),
		test("Predominant audio contour follows the harmonic lower melody", () => {
			for (let i = 0; i < 4; i++) {
				const frames = contour.filter((frame) => frame.time > i * 0.5 + 0.1 && frame.time < i * 0.5 + 0.35);
				assert(frames.filter((frame) => Math.abs(frame.midiPitch - notes[i * 2].midi) < 0.5).length / frames.length > 0.9, `contour follows note ${i}`);
				assert(audioMelody.get(`lower${i}`) > 0.8 && audioMelody.get(`upper${i}`) < 0.1, "duration matching");
			}
		}),
		test("Audio-assisted extraction picks lower melody; MIDI-only picks upper line", () => {
			const off = extractMelodyLine(notes);
			const on = extractMelodyLine(notes, { audioMelody, loudness });
			assert(off.melody.size === 4 && [...off.melody.keys()].every((id) => id.startsWith("upper")), "MIDI-only top line");
			assert(on.melody.size === 4 && [...on.melody.keys()].every((id) => id.startsWith("lower")), "audio lower line");
			const contourOnly = extractMelodyLine(notes, { audioMelody });
			assert(contourOnly.melody.size === 4 && [...contourOnly.melody.keys()].every((id) => id.startsWith("lower")), "contour works without loudness");
			const contraryLoudness = new Map([...loudness].map(([id, level]) => [id, 1 - level]));
			assert([...extractMelodyLine(notes, { audioMelody, loudness: contraryLoudness }).melody.keys()].every((id) => id.startsWith("lower")), "contour outweighs secondary loudness");
			const corrected = extractMelodyLine(notes, { audioMelody, loudness, overrides: new Map([["lower0", false], ["upper0", true]]) });
			assert(!corrected.melody.has("lower0") && corrected.melody.get("upper0")?.manual, "manual overrides still win");
			const loudnessOnly = extractMelodyLine(notes, { loudness });
			assert(loudnessOnly.melody.size === 4 && [...loudnessOnly.melody.keys()].every((id) => id.startsWith("lower")), "loudness works independently");
		}),
		test("Tiny audio loudness spread disables the velocity cue", () => {
			const result = extractMelodyLine(notes.map((note, i) => ({ ...note, velocity: i % 2 })), { loudness: new Map(notes.map((note, i) => [note.id, 0.5 + (i % 2) * 0.001])) });
			assert(!result.velocityEnabled, "audio replaces MIDI velocity and disables tiny spread");
		}),
		test("Playback filters all, Auto melody, track melody and accompaniment", () => {
			const melody = new Map([["lower0", {}]]);
			assert(filterPlaybackNotes(notes, "all", "auto", melody).length === notes.length, "all");
			const selected = filterPlaybackNotes(notes, "melody", "auto", melody);
			assert(selected.length === 1 && selected[0].id === "lower0", "Auto melody");
			assert(filterPlaybackNotes(notes, "accompaniment", "auto", melody).length === notes.length - 1, "Auto accompaniment");
			const split = notes.map((note, i) => ({ ...note, trackIndex: i % 2 }));
			assert(filterPlaybackNotes(split, "melody", 1).length === 4 && filterPlaybackNotes(split, "melody", 1).every((note) => note.trackIndex === 1), "track melody");
			assert(filterPlaybackNotes(split, "accompaniment", 1).length === 4 && filterPlaybackNotes(split, "accompaniment", 1).every((note) => note.trackIndex === 0), "track accompaniment");
			assert(filterPlaybackNotes(notes, "melody", null).length === 0 && filterPlaybackNotes(notes, "accompaniment", null).length === notes.length, "no melody selection");
		}),
		test("Audio utilities handle silence, empty inputs, invalid rate, offsets and octave errors", () => {
			assert(extractAudioMelodyContour(new Float32Array(), sampleRate).length === 0, "empty");
			assert(extractAudioMelodyContour(samples, 0).length === 0, "invalid rate");
			assert(extractAudioMelodyContour(new Float32Array(2205), sampleRate).every((frame) => frame.midiPitch === null), "unvoiced silence");
			assert(estimateNoteLoudness(samples, sampleRate, []).size === 0, "empty notes");
			assert(estimateNoteLoudness(samples, 0, notes).get("lower0") === 0, "invalid loudness rate");
			assert([...estimateNoteLoudness(new Float32Array(), sampleRate, notes).values()].every(Number.isFinite), "missing audio is safe");
			const shifted = new Float32Array(samples.length + sampleRate);
			shifted.set(samples, sampleRate);
			const shiftedLevels = estimateNoteLoudness(shifted, sampleRate, notes, { offsetSec: 1 });
			assert([...loudness].every(([id, level]) => Math.abs(level - shiftedLevels.get(id)) < 1e-6), "audio offset");
			const frames = Array.from({ length: 100 }, (_, i) => ({ time: 1 + i * 0.01, midiPitch: 72, salience: 1 }));
			const matched = matchAudioMelodyToNotes(frames, [{ id: "octave", midi: 60, startTime: 0, endTime: 1 }], { offsetSec: 1 });
			assert(matched.get("octave") > 0.34 && matched.get("octave") <= 0.35, "octave error partial credit");
			assert(matchAudioMelodyToNotes([], notes).get("lower0") === 0, "empty contour");
		}),
	];
}
