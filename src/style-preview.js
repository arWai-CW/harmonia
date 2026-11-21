import { Chord, Note } from "tonal";
import { Midi } from "@tonejs/midi";
import { getKeyDefinition, spellNotesWithOctaveInKey } from "./chord-utils.js";

const mod = (pitch) => ((pitch % 12) + 12) % 12;
const styles = new Set(["rock", "pop", "funk", "ballad"]);
const minor = (suffix) => /^m(?!aj)/.test(suffix);
const dominant = (suffix) => /^(7|9|11|13)/.test(suffix);
const mean = (notes) => notes.reduce((sum, pitch) => sum + pitch, 0) / notes.length;

function candidates(root, intervals, style) {
	const result = [];
	const low = style === "rock" ? 40 : style === "ballad" ? 48 : 52;
	const high = style === "rock" ? 71 : style === "ballad" ? 88 : 84;
	for (let base = low; base <= high - 12; base++) {
		if (mod(base) !== root) continue;
		const pitches = intervals.map((interval) => base + interval).sort((a, b) => a - b);
		for (let inversion = 0; inversion < pitches.length; inversion++) {
			const voiced = pitches.map((pitch, i) => pitch + (i < inversion ? 12 : 0)).sort((a, b) => a - b);
			for (const drop of [false, true]) {
				if (drop && (style === "rock" || voiced.length < 3)) continue;
				const notes = [...voiced];
				if (drop) notes[notes.length - 2] -= 12;
				notes.sort((a, b) => a - b);
				if (notes[0] >= low && notes.at(-1) <= high && (style !== "ballad" || notes.at(-1) - notes[0] >= 12)) result.push(notes);
				if (style === "rock") break;
			}
			if (style === "rock") break;
		}
	}
	return result;
}

export function voicingMovement(from, to) {
	const count = Math.max(from.length, to.length);
	return Array.from({ length: count }, (_, i) => Math.abs(from[Math.min(i, from.length - 1)] - to[Math.min(i, to.length - 1)])).reduce((a, b) => a + b, 0);
}

function voiceChords(chords, style) {
	const center = style === "rock" ? 54 : style === "ballad" ? 67 : 65;
	const rows = chords.map((chord) => candidates(chord.root, chord.intervals, style).map((notes) => ({ notes })));
	rows.forEach((row, i) => row.forEach((state) => {
		const drift = Math.abs(mean(state.notes) - center) * 0.025;
		state.score = drift; state.parent = -1;
		if (!i) return;
		state.score = Infinity;
		rows[i - 1].forEach((previous, j) => {
			const score = previous.score + voicingMovement(previous.notes, state.notes) + drift;
			if (score < state.score) { state.score = score; state.parent = j; }
		});
	}));
	let index = rows.at(-1)?.reduce((best, state, i, row) => state.score < row[best].score ? i : best, 0);
	for (let i = rows.length - 1; i >= 0; i--) {
		chords[i].voicing = rows[i][index].notes;
		index = rows[i][index].parent;
	}
}

export function buildStylePreview(view, style, { keyDefinition = getKeyDefinition("C", "major"), autoKey = true } = {}) {
	if (!styles.has(style)) return { chords: [], notes: [] };
	const chords = [];
	const segments = [...(view.segments ?? [])].sort((a, b) => a.startTime - b.startTime);
	for (const [index, segment] of segments.entries()) {
		if (!segment.chord || !(segment.endTime > segment.startTime)) continue;
		const parsed = Chord.get(segment.chord.symbol);
		const sourceIntervals = parsed.empty ? segment.chord.intervals ?? [] : parsed.intervals;
		let root = Note.chroma(parsed.empty ? segment.chord.root : parsed.tonic);
		if (root === null || !sourceIntervals.length) continue;
		const region = autoKey && view.keyRegions?.find((item) => segment.startTime >= item.startTime && segment.startTime < item.endTime);
		const key = region ? getKeyDefinition(region.root, region.mode) : keyDefinition;
		const degree = mod(root - Note.chroma(key.id));
		const suffix = segment.chord.suffix ?? parsed.aliases[0] ?? "";
		const isMinor = minor(suffix), isDominant = dominant(suffix), diminished = /dim|m7b5/.test(suffix);
		const twoFive = view.twoFiveChains?.find((chain) => ["ii-V", "ii-subV"].includes(chain.type) && chain.segmentIds.includes(segment.id));
		const substitute = view.twoFiveChains?.find((chain) => ["ii-subV", "subV-I"].includes(chain.type) && chain.segmentIds.includes(segment.id) && mod(root - Note.chroma(chain.targetRoot)) === 1);
		const previousRoot = Note.chroma(Chord.get(chords.at(-1)?.originalSymbol ?? "").tonic);
		const nextRoot = Note.chroma(Chord.get(segments[index + 1]?.chord?.symbol ?? "").tonic);
		const near = (pitch) => pitch !== null && Math.min(mod(root - pitch), mod(pitch - root)) <= 2;
		const passingDim = /dim/.test(suffix) && chords.length && near(previousRoot) && near(nextRoot)
			&& segment.endTime - segment.startTime <= chords.at(-1).endTime - chords.at(-1).startTime;
		if (style === "rock" && passingDim) {
			chords.push({ ...chords.at(-1), segmentId: segment.id, startTime: segment.startTime, endTime: segment.endTime, originalSymbol: segment.chord.symbol });
			continue;
		}
		if (style === "rock" && twoFive && mod(root - Note.chroma(twoFive.targetRoot)) === 2 && (isMinor || diminished)) root = mod(root + 3);
		if (["rock", "pop"].includes(style) && (substitute || degree === 1) && isDominant) root = mod(root + 6);
		let replacement = suffix;
		if (style === "rock") replacement = "5";
		if (style === "pop") replacement = diminished ? "dim" : isDominant && /sus4|11/.test(suffix) ? "sus4" : isMinor ? (/9/.test(suffix) ? "madd9" : "m") : /sus/.test(suffix) ? "sus4" : /9/.test(suffix) ? "add9" : "";
		if (style === "funk" && !diminished) replacement = isDominant ? "9" : isMinor ? (/9|11|13/.test(suffix) ? "m9" : "m7") : "maj7";
		if (style === "ballad" && !diminished && !isDominant && !/sus|aug|7|9|11|13/.test(suffix)) replacement = isMinor ? "m7" : "maj7";
		const rootName = spellNotesWithOctaveInKey([Note.fromMidi(60 + root)], key)[0].replace(/-?\d+$/, "");
		const slashName = segment.chord.symbol.split("/")[1] ?? "";
		const slash = /^[A-G](?:#|b)*$/.test(slashName) ? slashName : null;
		const bass = slash && Note.chroma(slash) !== null ? Note.chroma(slash) : root;
		const bassName = spellNotesWithOctaveInKey([Note.fromMidi(60 + bass)], key)[0].replace(/-?\d+$/, "");
		const symbol = rootName + replacement + (slash ? `/${bassName}` : "");
		const replacementIntervals = replacement === suffix ? sourceIntervals : Chord.get(rootName + replacement).intervals;
		const intervals = style === "rock" ? [0, 7, 12] : replacementIntervals.map((interval) => {
			const name = Note.transpose(rootName, interval);
			return mod(Note.chroma(name) - root);
		});
		if (!intervals.length) continue;
		chords.push({ segmentId: segment.id, startTime: segment.startTime, endTime: segment.endTime, symbol, originalSymbol: segment.chord.symbol, root, bass, intervals });
	}
	voiceChords(chords, style);
	const notes = [];
	const meter = view.timeSignature ?? [4, 4];
	const beats = meter[0] * 4 / meter[1];
	const beatDuration = view.barDuration / beats;
	if (!(beatDuration > 0)) return { chords, notes };
	const add = (chord, midi, time, duration, role) => {
		const startTime = Math.max(chord.startTime, time), endTime = Math.min(chord.endTime, time + duration);
		if (endTime > startTime + 0.001) notes.push({ id: `preview-${notes.length}`, midi, startTime, endTime, velocity: role === "bass" ? 0.76 : style === "funk" ? 0.78 : 0.62, role });
	};
	for (const chord of chords) {
		for (const bar of view.bars ?? [{ time: 0 }]) {
			if (bar.time >= chord.endTime || bar.time + view.barDuration <= chord.startTime) continue;
			const attacks = [];
			if (style === "rock") for (let beat = 0; beat < beats; beat += 0.5) attacks.push([beat, 0.38]);
			if (style === "pop") for (const beat of [0, Math.min(2, beats - 1), beats - 0.5]) attacks.push([beat, 0.85]);
			if (style === "funk") for (let beat = 0.25; beat < beats; beat += 0.75) attacks.push([beat, 0.14]);
			if (style === "ballad") attacks.push([0, beats]);
			for (const [beat, duration] of attacks) for (const midi of chord.voicing) add(chord, midi, bar.time + beat * beatDuration, duration * beatDuration, "chord");
			const step = style === "rock" ? 0.5 : style === "funk" ? 0.75 : 2;
			for (let beat = style === "funk" ? 0.25 : 0, i = 0; beat < beats; beat += step, i++) {
				const offset = style === "pop" ? (i % 2) * 7 : style === "funk" ? (i % 2) * 12 : 0;
				add(chord, 36 + chord.bass + offset, bar.time + beat * beatDuration, Math.min(step * 0.85, beats - beat) * beatDuration, "bass");
			}
		}
	}
	return { chords, notes: notes.sort((a, b) => a.startTime - b.startTime || a.midi - b.midi) };
}

export function buildStylePreviewMidi(preview, melody = [], { tempo = 120, timeSignature = [4, 4], trackNames = ["Chords", "Bass", "Melody"] } = {}) {
	const midi = new Midi();
	midi.header.setTempo(tempo);
	midi.header.timeSignatures.push({ ticks: 0, timeSignature });
	for (const [name, notes, instrument] of [[trackNames[0], preview.notes.filter((note) => note.role === "chord"), 0], [trackNames[1], preview.notes.filter((note) => note.role === "bass"), 33], [trackNames[2], melody, 0]]) {
		const track = midi.addTrack(); track.name = name; track.instrument.number = instrument;
		track.channel = midi.tracks.length - 1;
		for (const note of notes) if (note.endTime > note.startTime) track.addNote({ midi: note.midi, time: note.startTime, duration: note.endTime - note.startTime, velocity: note.velocity ?? 0.8 });
	}
	return midi;
}
