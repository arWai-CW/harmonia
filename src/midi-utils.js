import { Midi } from "@tonejs/midi";
import { Chord, Note } from "tonal";
import { detectKeyRegions, findTwoFiveChains, nameArpeggioChords } from "./harmony-analysis.js";
import { extractMelodyLine } from "./melody-extraction.js";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_NOTES = 20000;
const BOUNDARY_TOLERANCE = 0.05;
const ONSET_TOLERANCE_BEATS = 0.2;

export class MidiFileError extends Error {
	constructor(message, cause) {
		super(message, cause === undefined ? undefined : { cause });
		this.name = "MidiFileError";
	}
}

export const CHORD_TEMPLATES = [
	{ symbol: "maj13", intervals: ["1P", "3M", "5P", "7M", "9M", "13M"] },
	{ symbol: "13b9", intervals: ["1P", "3M", "5P", "7m", "9m", "13M"] },
	{ symbol: "13", intervals: ["1P", "3M", "5P", "7m", "9M", "13M"] },
	{ symbol: "m13", intervals: ["1P", "3m", "5P", "7m", "9M", "13M"] },
	{ symbol: "maj11", intervals: ["1P", "3M", "5P", "7M", "9M", "11P"] },
	{ symbol: "11b9", intervals: ["1P", "5P", "7m", "9m", "11P"] },
	{ symbol: "11", intervals: ["1P", "3M", "5P", "7m", "9M", "11P"] },
	{ symbol: "m11", intervals: ["1P", "3m", "5P", "7m", "9M", "11P"] },
	{ symbol: "7sus4", intervals: ["1P", "4P", "5P", "7m"] },
	{ symbol: "maj9", intervals: ["1P", "3M", "5P", "7M", "9M"] },
	{ symbol: "9#11", intervals: ["1P", "3M", "5P", "7m", "9M", "11A"] },
	{ symbol: "9", intervals: ["1P", "3M", "5P", "7m", "9M"] },
	{ symbol: "m9", intervals: ["1P", "3m", "5P", "7m", "9M"] },
	{ symbol: "7b9", intervals: ["1P", "3M", "5P", "7m", "9m"] },
	{ symbol: "7#9", intervals: ["1P", "3M", "5P", "7m", "9A"] },
	{ symbol: "7b13", intervals: ["1P", "3M", "5P", "7m", "13m"] },
	{ symbol: "7b5", intervals: ["1P", "3M", "5d", "7m"] },
	{ symbol: "7#5", intervals: ["1P", "3M", "5A", "7m"] },
	{ symbol: "maj7", intervals: ["1P", "3M", "5P", "7M"] },
	{ symbol: "m7b5", intervals: ["1P", "3m", "5d", "7m"] },
	{ symbol: "dim7", intervals: ["1P", "3m", "5d", "7d"] },
	{ symbol: "m7", intervals: ["1P", "3m", "5P", "7m"] },
	{ symbol: "7", intervals: ["1P", "3M", "5P", "7m"] },
	{ symbol: "add9", intervals: ["1P", "3M", "5P", "9M"] },
	{ symbol: "madd9", intervals: ["1P", "3m", "5P", "9M"] },
	{ symbol: "6", intervals: ["1P", "3M", "5P", "6M"] },
	{ symbol: "m6", intervals: ["1P", "3m", "5P", "6M"] },
	{ symbol: "sus2", intervals: ["1P", "2M", "5P"] },
	{ symbol: "sus4", intervals: ["1P", "4P", "5P"] },
	{ symbol: "dim", intervals: ["1P", "3m", "5d"] },
	{ symbol: "aug", intervals: ["1P", "3M", "5A"] },
	{ symbol: "m", intervals: ["1P", "3m", "5P"] },
	{ symbol: "", intervals: ["1P", "3M", "5P"] },
	{ symbol: "5", intervals: ["1P", "5P"] },
];

const INTERVAL_SEMITONES = {
	"1P": 0,
	"2M": 2,
	"3m": 3,
	"3M": 4,
	"4P": 5,
	"5d": 6,
	"5P": 7,
	"5A": 8,
	"6M": 9,
	"7d": 9,
	"7m": 10,
	"7M": 11,
	"9m": 13,
	"9M": 14,
	"9A": 15,
	"11P": 17,
	"11A": 18,
	"13m": 20,
	"13M": 21,
};

const DEGREE_LABELS = {
	"1P": "1",
	"2M": "2",
	"3m": "b3",
	"3M": "3",
	"4P": "4",
	"5d": "b5",
	"5P": "5",
	"5A": "#5",
	"6M": "6",
	"7d": "bb7",
	"7m": "b7",
	"7M": "7",
	"9m": "b9",
	"9M": "9",
	"9A": "#9",
	"11P": "11",
	"11A": "#11",
	"13m": "b13",
	"13M": "13",
};

const TENSION_LABELS = {
	"6M": "6",
	"9m": "b9",
	"9M": "9",
	"9A": "#9",
	"11P": "11",
	"11A": "#11",
	"13m": "b13",
	"13M": "13",
};

const CORE_INTERVALS = new Set(["1P", "3m", "3M", "5d", "5P", "5A", "7d", "7m", "7M"]);

const ROLE_BY_INTERVAL = {
	"1P": "root",
	"3m": "guide",
	"3M": "guide",
	"7m": "guide",
	"7M": "guide",
	"5P": "stable",
};

const SKELETON_SIGNATURES = [
	{ suffix: "maj7", intervals: ["1P", "3M", "5P", "7M"] },
	{ suffix: "7", intervals: ["1P", "3M", "5P", "7m"] },
	{ suffix: "m7", intervals: ["1P", "3m", "5P", "7m"] },
	{ suffix: "m7b5", intervals: ["1P", "3m", "5d", "7m"] },
	{ suffix: "dim7", intervals: ["1P", "3m", "5d", "7d"] },
	{ suffix: "7b5", intervals: ["1P", "3M", "5d", "7m"] },
	{ suffix: "7#5", intervals: ["1P", "3M", "5A", "7m"] },
	{ suffix: "", intervals: ["1P", "3M", "5P"] },
	{ suffix: "m", intervals: ["1P", "3m", "5P"] },
	{ suffix: "dim", intervals: ["1P", "3m", "5d"] },
	{ suffix: "aug", intervals: ["1P", "3M", "5A"] },
];

const spellPitchClass = (pitchClass, keyDefinition) => {
	const names = keyDefinition?.accidental === "flat"
		? ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]
		: ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
	return names[((pitchClass % 12) + 12) % 12];
};

const spellTone = (rootName, interval, pitchClass, keyDefinition) => {
	const spelled = Note.transpose(rootName, interval);
	if (spelled && !spelled.includes("##") && !spelled.includes("bb")) {
		return spelled;
	}
	return spellPitchClass(pitchClass, keyDefinition);
};

const spellRootForChord = (rootPc, intervals, keyDefinition) => {
	const primary = spellPitchClass(rootPc, keyDefinition);
	const alternate = spellPitchClass(rootPc, {
		accidental: keyDefinition?.accidental === "flat" ? "sharp" : "flat",
	});
	const score = (rootName) => {
		let value = rootName === primary ? 0 : 1;
		for (const interval of intervals) {
			const name = Note.transpose(rootName, interval);
			if (!name) {
				return Number.POSITIVE_INFINITY;
			}
			if (name.includes("##") || name.includes("bb")) {
				value += 10;
			}
		}
		return value;
	};
	return score(primary) <= score(alternate) ? primary : alternate;
};

const formatReading = (root, suffix, bassPitchClass, pitchClasses, keyDefinition) => {
	const slash = bassPitchClass !== undefined
		&& bassPitchClass !== null
		&& bassPitchClass !== (Note.get(root).chroma ?? -1)
		&& pitchClasses.includes(bassPitchClass)
		? `/${spellPitchClass(bassPitchClass, keyDefinition)}`
		: "";
	return `${root}${suffix ?? ""}${slash}`;
};

const buildSkeleton = (intervals, rootName) => {
	const signature = SKELETON_SIGNATURES.find((candidate) => {
		const candidateSet = new Set(candidate.intervals);
		if (!candidate.intervals.every((interval) => intervals.includes(interval))) {
			return false;
		}
		return [...intervals]
			.filter((interval) => CORE_INTERVALS.has(interval))
			.every((interval) => candidateSet.has(interval));
	});
	if (!signature) {
		return null;
	}
	return {
		symbol: `${rootName}${signature.suffix}`,
		suffix: signature.suffix,
		intervals: signature.intervals,
	};
};

const buildExtensions = (intervals, skeleton) => {
	if (!skeleton) {
		return [];
	}
	return intervals
		.filter((interval) => TENSION_LABELS[interval] && !skeleton.intervals.includes(interval))
		.map((interval) => TENSION_LABELS[interval]);
};

const buildTones = (intervals, pitchClasses, rootName, rootPc, keyDefinition) => {
	const tones = [];
	const seen = new Set();
	for (const interval of intervals) {
		const pc = INTERVAL_SEMITONES[interval];
		if (pc === undefined) {
			continue;
		}
		const pitchClass = ((rootPc + pc) % 12 + 12) % 12;
		if (!pitchClasses.includes(pitchClass) || seen.has(pitchClass)) {
			continue;
		}
		seen.add(pitchClass);
		tones.push({
			pc: pitchClass,
			interval,
			degree: DEGREE_LABELS[interval] ?? "?",
			role: ROLE_BY_INTERVAL[interval] ?? "color",
			name: spellTone(rootName, interval, pitchClass, keyDefinition),
		});
	}
	for (const pitchClass of pitchClasses) {
		if (seen.has(pitchClass)) {
			continue;
		}
		seen.add(pitchClass);
		tones.push({
			pc: pitchClass,
			interval: null,
			degree: "?",
			role: "color",
			name: spellPitchClass(pitchClass, keyDefinition),
		});
	}
	return tones;
};

const getOmitted = (missingIntervals, rootName, rootPc, keyDefinition) =>
	missingIntervals.map((interval) => ({
		degree: DEGREE_LABELS[interval] ?? "?",
		name: spellTone(
			rootName,
			interval,
			(rootPc + INTERVAL_SEMITONES[interval]) % 12,
			keyDefinition,
		),
	}));

const matchTemplate = (pitchClasses, bassPitchClass, keyDefinition) => {
	if (!pitchClasses.length) {
		return null;
	}

	const bass = bassPitchClass ?? pitchClasses[0];
	const roots = [...new Set([bass, ...pitchClasses])];
	const rotations = roots.map((root) => {
		const rootPc = ((root % 12) + 12) % 12;
		const intervals = pitchClasses
			.filter((pc) => pc !== rootPc)
			.map((pc) => ((pc - rootPc) + 12) % 12)
			.sort((a, b) => a - b);
		return [0, ...intervals];
	});

	const candidates = [];
	for (const [index, semitones] of rotations.entries()) {
		const root = roots[index];
		const rootPc = ((root % 12) + 12) % 12;
		for (const template of CHORD_TEMPLATES) {
			const missingIntervals = template.intervals.filter(
				(interval) => !semitones.includes(INTERVAL_SEMITONES[interval] % 12),
			);
			if (missingIntervals.length > 1) {
				continue;
			}
			const expectedPcs = template.intervals.map((interval) => INTERVAL_SEMITONES[interval] % 12);
			if (semitones.some((pc) => !expectedPcs.includes(pc))) {
				continue;
			}
			candidates.push({
				template,
				rootPc,
				root: spellRootForChord(rootPc, template.intervals, keyDefinition),
				missingIntervals,
			});
		}
	}

	if (!candidates.length) {
		return null;
	}

	const scoring = (candidate) => {
		const bassFirst = candidate.rootPc === bass ? 1 : 0;
		const complexity = candidate.template.intervals.length;
		return [candidate.missingIntervals.length, -bassFirst, -complexity];
	};
	return candidates.sort((a, b) => {
		const left = scoring(a);
		const right = scoring(b);
		for (let i = 0; i < left.length; i += 1) {
			if (left[i] !== right[i]) return left[i] - right[i];
		}
		return 0;
	})[0];
};

export const identifyChord = (pitchClasses, bassPitchClass, keyDefinition) => {
	const templateMatch = matchTemplate(pitchClasses, bassPitchClass, keyDefinition);
	if (templateMatch) {
		const { template } = templateMatch;
		const skeleton = buildSkeleton(template.intervals, templateMatch.root);
		return {
			symbol: formatReading(
				templateMatch.root,
				template.symbol,
				bassPitchClass,
				pitchClasses,
				keyDefinition,
			),
			intervals: template.intervals,
			origin: "template",
			rootPc: templateMatch.rootPc,
			root: templateMatch.root,
			suffix: template.symbol,
			tones: buildTones(
				template.intervals,
				pitchClasses,
				templateMatch.root,
				templateMatch.rootPc,
				keyDefinition,
			),
			skeleton,
			extensions: buildExtensions(template.intervals, skeleton),
			omitted: getOmitted(
				templateMatch.missingIntervals,
				templateMatch.root,
				templateMatch.rootPc,
				keyDefinition,
			),
		};
	}

	const detected = Chord.detect([...pitchClasses].map((pc) => spellPitchClass(pc, keyDefinition)));
	if (detected.length) {
		const symbol = detected[0];
		const chord = Chord.get(symbol);
		const root = chord.tonic ?? spellPitchClass(bassPitchClass ?? pitchClasses[0], keyDefinition);
		const intervals = chord.intervals ?? [];
		const skeleton = buildSkeleton(intervals, root);
		const tones = chord.notes?.length
			? chord.notes.map((name) => {
				const pitchClass = Note.get(name).chroma;
				const interval = intervals.find(
					(candidate) => INTERVAL_SEMITONES[candidate] % 12 === pitchClass,
				) ?? null;
				return {
					pc: pitchClass,
					interval,
					degree: DEGREE_LABELS[interval] ?? "?",
					role: ROLE_BY_INTERVAL[interval] ?? "color",
					name,
				};
			})
			: buildTones(
				intervals,
				pitchClasses,
				root,
				Note.get(root).chroma ?? bassPitchClass ?? pitchClasses[0],
				keyDefinition,
			);
		return {
			symbol: formatReading(root, chord.symbol ?? symbol, bassPitchClass, pitchClasses, keyDefinition),
			intervals,
			origin: "tonal",
			rootPc: Note.get(root).chroma ?? bassPitchClass ?? pitchClasses[0],
			root,
			suffix: chord.aliases?.[0] ?? "",
			tones,
			skeleton,
			extensions: buildExtensions(intervals, skeleton),
			omitted: [],
		};
	}

	const root = spellPitchClass(bassPitchClass ?? pitchClasses[0], keyDefinition);
	return {
		symbol: "?",
		intervals: [],
		origin: "unknown",
		rootPc: bassPitchClass ?? pitchClasses[0],
		root,
		suffix: "?",
		tones: buildTones([], pitchClasses, root, bassPitchClass ?? pitchClasses[0], keyDefinition),
		skeleton: null,
		extensions: [],
		omitted: [],
	};
};

const mergeSegments = (segments, ppq) => {
	const merged = [];
	for (const segment of segments) {
		const previous = merged.at(-1);
		const gap = previous ? segment.startTick - previous.endTick : Infinity;
		if (
			previous &&
			previous.chord.symbol === segment.chord.symbol &&
			gap >= 0 &&
			gap <= Math.max(ppq * BOUNDARY_TOLERANCE, (previous.endTick - previous.startTick) * 0.25)
		) {
			// Treat small note-off gaps as one span when labels match.
			previous.endTick = segment.endTick;
			previous.endTime = segment.endTime;
			previous.noteIds.push(...segment.noteIds);
			previous.pitchClasses = [...new Set([...previous.pitchClasses, ...segment.pitchClasses])].sort((a, b) => a - b);
			continue;
		}
		merged.push({ ...segment, noteIds: [...segment.noteIds], pitchClasses: [...segment.pitchClasses] });
	}
	return merged.map((segment, index) => ({ ...segment, id: `s${index}` }));
};

const snapBoundary = (tick, ppq) => {
	const step = ppq / 4;
	return Math.round(tick / step) * step;
};

const describeTrack = (track, index) => {
	const channel = track.channel ?? 0;
	const name = track.name?.trim() || (channel === 9 ? "打擊樂" : `軌道 ${index + 1}`);
	return {
		index,
		name,
		channel,
		percussion: channel === 9 || track.instrument?.percussion === true,
	};
};

const collectNotes = (midi) => {
	const notes = [];
	for (const [trackIndex, track] of midi.tracks.entries()) {
		if (track.channel === 9 || track.instrument?.percussion) {
			continue;
		}
		for (const [noteIndex, note] of track.notes.entries()) {
			const midiNumber = note.midi;
			const startTick = note.ticks;
			const endTick = note.ticks + note.durationTicks;
			if (!Number.isFinite(startTick) || !Number.isFinite(endTick) || endTick <= startTick) {
				continue;
			}
			notes.push({
				id: `n${notes.length}`,
				trackIndex,
				midi: midiNumber,
				startTick,
				endTick,
				startTime: note.time,
				endTime: note.time + note.duration,
				velocity: note.velocity ?? 0.8,
				_source: `${trackIndex}:${noteIndex}`,
			});
		}
	}
	return notes.sort((a, b) => a.startTick - b.startTick || a.midi - b.midi).slice(0, MAX_NOTES);
};

const groupOnsets = (notes, ppq) => {
	const groups = [];
	const tolerance = ppq * ONSET_TOLERANCE_BEATS;
	for (const note of notes) {
		const group = groups.at(-1);
		if (group && note.startTick - group.startTick <= tolerance) {
			group.notes.push(note);
			continue;
		}
		groups.push({ startTick: note.startTick, notes: [note] });
	}
	return groups.map((group) => ({
		...group,
		startTick: snapBoundary(group.startTick, ppq),
	}));
};

const buildSegments = (notes, ppq, keyDefinition) => {
	if (!notes.length) {
		return [];
	}

	// Chord identity comes from notes attacked together. Held notes are ignored
	// so a sustained pad does not turn the next chord into a pile-up.
	// shortcut: arpeggios spread wider than 0.2 beat read as separate notes, widen the onset tolerance if this becomes a real use case.
	const groups = groupOnsets([...notes].sort((a, b) => a.startTick - b.startTick || a.midi - b.midi), ppq);
	const segments = [];
	for (const [index, group] of groups.entries()) {
		const pitchClasses = [...new Set(group.notes.map((note) => note.midi % 12))].sort((a, b) => a - b);
		if (pitchClasses.length < 2) {
			continue;
		}
		const next = groups[index + 1];
		const maxEndTick = Math.max(...group.notes.map((note) => note.endTick));
		const endTick = Math.min(next?.startTick ?? Number.POSITIVE_INFINITY, maxEndTick);
		const attackBass = group.notes.reduce(
			(lowest, note) => (note.midi < lowest.midi ? note : lowest),
			group.notes[0],
		);
		const bassPitchClass = attackBass.midi % 12;
		const endTime = next
			? Math.min(Math.max(...group.notes.map((note) => note.endTime)), Math.min(...next.notes.map((note) => note.startTime)))
			: Math.max(...group.notes.map((note) => note.endTime));
		segments.push({
			id: `s${segments.length}`,
			startTick: group.startTick,
			endTick,
			startTime: Math.min(...group.notes.map((note) => note.startTime)),
			endTime,
			noteIds: group.notes.map((note) => note.id),
			pitchClasses,
			chord: identifyChord(pitchClasses, bassPitchClass, keyDefinition),
		});
	}
	return mergeSegments(segments, ppq);
};


const buildSections = (notes, ppq, keyDefinition, barDuration, bars, melodyTrackIndex = null, melodyIds = new Set()) => {
	const harmonyNotes = notes.filter((n) => n.trackIndex !== melodyTrackIndex && !melodyIds.has(n.id));
	const candidates = buildSegments(harmonyNotes, ppq, keyDefinition);
	const chordSegments = candidates.filter((segment) => segment.pitchClasses.length >= 3);
	const arpeggioSegments = nameArpeggioChords(harmonyNotes, chordSegments, bars, barDuration, ppq, keyDefinition);
	const dyads = candidates.filter((segment) => segment.pitchClasses.length < 3 && !arpeggioSegments.some((arp) => segment.startTime < arp.endTime && segment.endTime > arp.startTime));
	return [...chordSegments, ...dyads, ...arpeggioSegments].sort(
		(a, b) => a.startTime - b.startTime || Number(a.arpeggio) - Number(b.arpeggio),
	);
};

export const getBaseTriad = (chord) => {
	if (!chord || !chord.root || chord.root === "?") {
		return null;
	}
	const tones = chord.tones.filter((tone) =>
		["1", "3", "b3", "5", "b5", "#5"].includes(tone.degree),
	);
	if (!tones.length) {
		return null;
	}
	const third = tones.find((tone) => ["3", "b3"].includes(tone.degree));
	const fifth = tones.find((tone) => ["5", "b5", "#5"].includes(tone.degree));
	let suffix = "";
	if (third?.degree === "b3") {
		suffix = fifth?.degree === "b5" ? "dim" : "m";
	} else if (third?.degree === "3") {
		suffix = fifth?.degree === "#5" ? "aug" : "";
	} else if (fifth) {
		suffix = "5";
	}
	return {
		symbol: `${chord.root}${suffix}`,
		pcs: tones.map((tone) => tone.pc),
		tones,
	};
};

const buildBars = (midi, timeSignature, totalTicks) => {
	const [numerator, denominator] = timeSignature;
	const ticksPerBar = midi.header.ppq * numerator * (4 / denominator);
	const barCount = Math.max(1, Math.ceil(totalTicks / ticksPerBar));
	const toTime = (tick) => midi.header.ticksToSeconds(tick);
	const bars = Array.from({ length: barCount }, (_, index) => ({
		index: index + 1,
		tick: index * ticksPerBar,
		time: toTime(index * ticksPerBar),
	}));
	const barDuration = toTime(ticksPerBar) - toTime(0);
	return { bars, barDuration };
};

export async function parseMidiFile(file, keyDefinition) {
	if (!file || typeof file.arrayBuffer !== "function") {
		throw new MidiFileError("請選擇 MIDI 檔案。");
	}
	if (!/\.midi?$/i.test(file.name ?? "")) {
		throw new MidiFileError("只支援 .mid 或 .midi 檔案。");
	}
	if (file.size > MAX_FILE_BYTES) {
		throw new MidiFileError("MIDI 檔案過大（上限 10 MB）。");
	}

	let midi;
	try {
		midi = new Midi(await file.arrayBuffer());
	} catch (error) {
		throw new MidiFileError("MIDI 檔案無法讀取。", error);
	}

	const ppq = midi.header?.ppq;
	if (!Number.isFinite(ppq) || ppq <= 0) {
		throw new MidiFileError("MIDI 檔案的拍點格式不正確。");
	}

	const notes = collectNotes(midi);
	const signature = midi.header.timeSignatures?.[0]?.timeSignature;
	// shortcut: only the first time signature is used, mid-file meter changes are not drawn.
	const timeSignature = Array.isArray(signature) && signature.length === 2 ? signature : [4, 4];
	const totalTicks = notes.length ? Math.max(...notes.map((note) => note.endTick)) : 0;
	const { bars, barDuration } = buildBars(midi, timeSignature, totalTicks);
	const segments = buildSections(notes, ppq, keyDefinition, barDuration, bars);
	const noteEnd = notes.length ? Math.max(...notes.map((note) => note.endTime)) : 0;

	return {
		sourceName: file.name,
		durationSeconds: Math.max(noteEnd, bars.length * barDuration),
		ppq,
		timeSignature,
		bars,
		barDuration,
		notes: notes.map(({ _source, ...note }) => note),
		tracks: midi.tracks
			.map(describeTrack)
			.filter((track) => !track.percussion)
			.map((track) => ({
				...track,
				noteCount: notes.filter((note) => note.trackIndex === track.index).length,
			}))
			.filter((track) => track.noteCount > 0),
		segments,
		keyRegions: detectKeyRegions(notes, bars, barDuration),
		twoFiveChains: findTwoFiveChains(segments),
	};
}

export function filterMidiView(view, enabledTracks, keyDefinition, melodyTrackIndex = null, melodyOverrides = new Map()) {
	const enabled = new Set(enabledTracks);
	const notes = view.notes
		.filter((note) => enabled.has(note.trackIndex));
	const extraction = melodyTrackIndex === "auto" ? extractMelodyLine(notes, { ppq: view.ppq, barDuration: view.barDuration, overrides: melodyOverrides }) : null;
	const segments = buildSections(
		notes,
		view.ppq,
		keyDefinition,
		view.barDuration,
		view.bars,
		melodyTrackIndex,
		new Set(extraction?.melody.keys()),
	);
	return {
		...view,
		notes,
		segments,
		melodyExtraction: extraction,
		keyRegions: detectKeyRegions(notes, view.bars, view.barDuration),
		twoFiveChains: findTwoFiveChains(segments),
	};
}
