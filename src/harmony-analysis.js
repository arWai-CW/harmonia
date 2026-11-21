import { Chord, Interval, Note } from "tonal";
import { CHORD_TEMPLATES, identifyChord } from "./midi-utils.js";

const ROOTS = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const mod = (n) => ((n % 12) + 12) % 12;
const PROFILES = [
	[6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88],
	[6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17],
];

export function detectKeyRegions(notes, bars, barDuration) {
	if (!notes.length || !bars.length || !(barDuration > 0)) return [];
	const emissions = bars.map((bar, i) => {
		const start = bars[Math.max(0, i - 1)].time;
		const end = bars[Math.min(bars.length - 1, i + 2)].time + barDuration;
		const histogram = Array(12).fill(0);
		for (const note of notes) histogram[mod(note.midi)] += Math.max(0, Math.min(end, note.endTime) - Math.max(start, note.startTime));
		const mean = histogram.reduce((a, b) => a + b, 0) / 12;
		const norm = Math.hypot(...histogram.map((n) => n - mean));
		return Array.from({ length: 24 }, (_, key) => {
			const profile = PROFILES[Math.floor(key / 12)];
			const average = profile.reduce((a, b) => a + b, 0) / 12;
			return norm ? histogram.reduce((sum, n, pc) => sum + (n - mean) * (profile[mod(pc - key % 12)] - average), 0) / (norm * Math.hypot(...profile.map((n) => n - average))) : 0;
		});
	});
	const paths = [];
	let scores = emissions[0];
	for (let i = 1; i < bars.length; i++) {
		const previous = [];
		scores = emissions[i].map((emission, key) => {
			let best = -Infinity;
			for (let from = 0; from < 24; from++) {
				const score = scores[from] - (from === key ? 0 : 0.65);
				if (score > best) { best = score; previous[key] = from; }
			}
			return best + emission;
		});
		paths[i] = previous;
	}
	let key = scores.indexOf(Math.max(...scores));
	const keys = [];
	for (let i = bars.length - 1; i >= 0; i--) { keys[i] = key; key = paths[i]?.[key]; }
	const regions = [];
	keys.forEach((value, i) => {
		const root = ROOTS[value % 12];
		const mode = value < 12 ? "major" : "minor";
		const last = regions.at(-1);
		if (last?.root === root && last.mode === mode) {
			last.endBar = bars[i].index; last.endTime = bars[i + 1]?.time ?? bars[i].time + barDuration;
		} else regions.push({ startBar: bars[i].index, endBar: bars[i].index, startTime: bars[i].time, endTime: bars[i + 1]?.time ?? bars[i].time + barDuration, root, mode });
	});
	return regions;
}

const family = (suffix) => {
	if (suffix === "m7b5") return "half-dim";
	if (/^dim/.test(suffix)) return "dim";
	if (/^m(6|7|9|11|13|add9)?$/.test(suffix)) return "minor";
	if (/^(7|9|11|13)/.test(suffix)) return "dominant";
	return "major";
};

export function findTwoFiveChains(segments) {
	const chords = [];
	for (const segment of [...segments].sort((a, b) => a.startTime - b.startTime)) {
		if (!segment.chord || segment.chord.symbol === "?") continue;
		const root = Note.chroma(segment.chord.root ?? Chord.get(segment.chord.symbol).tonic);
		if (root === null) continue;
		const quality = family(segment.chord.suffix ?? Chord.get(segment.chord.symbol).aliases[0]);
		const last = chords.at(-1);
		if (last?.root === root && last.quality === quality) { last.endTime = segment.endTime; last.ids.push(segment.id); }
		else chords.push({ root, quality, startTime: segment.startTime, endTime: segment.endTime, ids: [segment.id] });
	}
	const results = [];
	let chainId = 0;
	for (let i = 0; i < chords.length; i++) {
		const a = chords[i], b = chords[i + 1], c = chords[i + 2];
		let type, target, mode = "major", end = a, next = b;
		if (["minor", "half-dim"].includes(a.quality) && b?.quality === "dominant" && [5, 11].includes(mod(b.root - a.root))) {
			type = mod(b.root - a.root) === 5 ? "ii-V" : "ii-subV";
			target = mod(b.root + 5); mode = a.quality === "half-dim" ? "minor" : "major";
			if (type === "ii-subV") target = mod(a.root - 2);
			if (a.quality === "minor" && type === "ii-V" && c?.root === mod(b.root + 2)) { type = "backdoor"; target = c.root; }
			end = b; next = c; i++;
		} else if (a.quality === "dominant" && b && [5, 11, 2].includes(mod(b.root - a.root))) {
			type = ({ 5: "V-I", 11: "subV-I", 2: "backdoor" })[mod(b.root - a.root)]; target = b.root;
			mode = ["minor", "half-dim", "dim"].includes(b.quality) ? "minor" : "major";
		} else continue;
		const previous = results.at(-1);
		if (!previous || previous.resolved || previous._next !== a) chainId++;
		const nextMode = ["minor", "half-dim", "dim"].includes(next?.quality) ? "minor" : "major";
		results.push({ type, startTime: a.startTime, endTime: end.endTime, segmentIds: [...a.ids, ...(end === a ? [] : end.ids)], targetRoot: ROOTS[target], targetMode: mode, resolved: next?.root === target && nextMode === mode, chainId, _next: next });
	}
	return results.map(({ _next, ...result }) => result);
}

const DEGREES = ["1", "b9", "9", "#9", "3", "11", "#11", "5", "b13", "13", "b7", "7"];
const CORE = { "1P": "1", "3m": "b3", "3M": "3", "5d": "b5", "5P": "5", "5A": "#5", "7d": "bb7", "7m": "b7", "7M": "7" };

export function labelMelodyNotes(notes, segments, melodyTrackIndex, ppq) {
	const labels = new Map();
	if (melodyTrackIndex === null || melodyTrackIndex === undefined) return labels;
	const melody = notes.filter((n) => n.trackIndex === melodyTrackIndex).sort((a, b) => a.startTime - b.startTime);
	const chords = segments.filter((s) => s.chord && s.chord.symbol !== "?").sort((a, b) => a.startTime - b.startTime);
	melody.forEach((note, i) => {
		const segment = chords.findLast((s) => s.startTime <= note.startTime);
		if (!segment) return;
		const chord = segment.chord;
		const parsed = Chord.get(chord.symbol);
		const root = Note.chroma(chord.root ?? parsed.tonic);
		if (root === null) return;
		const degree = mod(note.midi - root);
		const intervals = chord.intervals ?? parsed.intervals;
		const core = intervals.find((interval) => (CORE[interval] || (interval === "6M" && /^(m?6)$/.test(chord.suffix ?? parsed.aliases[0]))) && mod(Interval.semitones(interval)) === degree);
		const step = (other) => other && Math.abs(note.midi - other.midi) >= 1 && Math.abs(note.midi - other.midi) <= 2;
		const passing = note.endTick - note.startTick <= ppq && step(melody[i - 1]) && step(melody[i + 1]);
		labels.set(note.id, { label: core ? CORE[core] ?? "6" : DEGREES[degree], kind: core ? "chord" : passing ? "passing" : "tension" });
	});
	return labels;
}

export function suggestMelodyTrack(notes) {
	const candidates = [...new Set(notes.map((n) => n.trackIndex))].map((index) => {
		const track = notes.filter((n) => n.trackIndex === index);
		const singles = track.filter((n) => !track.some((other) => other !== n && Math.abs(other.startTick - n.startTick) < 1)).length;
		return { index, average: track.reduce((sum, n) => sum + n.midi, 0) / track.length, eligible: singles / track.length > 0.7 };
	}).filter((track) => track.eligible).sort((a, b) => b.average - a.average);
	return candidates[0]?.index ?? null;
}

export function nameArpeggioChords(notes, chordSegments, bars, barDuration, ppq, keyDefinition) {
	if (!notes.length || !bars?.length || !(barDuration > 0) || !(ppq > 0)) return [];
	const templates = CHORD_TEMPLATES.flatMap((template) => ROOTS.map((_, root) => ({ root, mask: template.intervals.map((interval) => mod(root + Interval.semitones(interval))), symbol: template.symbol })));
	const frames = [];
	for (let b = 0; b < bars.length; b++) {
		const start = bars[b].time, end = bars[b + 1]?.time ?? start + barDuration;
		const pool = notes.filter((n) => n.startTime < end && n.endTime > start && !chordSegments.some((s) => n.startTime >= s.startTime && n.startTime < s.endTime));
		if (new Set(pool.map((n) => mod(n.midi))).size < 3) continue;
		const line = [...pool].sort((a, c) => a.startTime - c.startTime || a.midi - c.midi);
		const transitions = line.slice(1).map((note, i) => ({
			step: Math.abs(note.midi - line[i].midi) <= 2,
			single: note.startTime > line[i].startTime && note.startTime >= line[i].endTime - 0.05,
		}));
		if (transitions.filter((t) => t.single).length / transitions.length >= 0.7 && transitions.filter((t) => t.step).length / transitions.length > 0.5) continue;
		const beats = bars[b + 1] ? (bars[b + 1].tick - bars[b].tick) / ppq : (b ? (bars[b].tick - bars[b - 1].tick) / ppq : 4);
		const beatDuration = (end - start) / beats;
		const context = Array(12).fill(0);
		for (const n of pool) context[mod(n.midi)] += Math.max(0, Math.min(end, n.endTime) - Math.max(start, n.startTime));
		for (let beat = 0; beat < beats; beat++) {
			const time = start + beat * beatDuration, stop = Math.min(end, time + beatDuration);
			if (chordSegments.some((s) => time < s.endTime && stop > s.startTime)) continue;
			const sounding = pool.filter((n) => n.startTime < stop && n.endTime > time);
			const histogram = context.map((n) => n * 0.6);
			for (const n of sounding) {
				const position = (n.startTime - start) / beatDuration;
				const metric = Math.abs(position - Math.round(position)) > 0.05 ? 0.5 : mod(Math.round(position)) === 0 ? 1 : 0.7;
				histogram[mod(n.midi)] += Math.max(0, Math.min(stop, n.endTime) - Math.max(time, n.startTime)) * metric;
			}
			const bass = sounding.length ? mod(Math.min(...sounding.map((n) => n.midi))) : null;
			const norm = Math.hypot(...histogram), mass = histogram.reduce((a, n) => a + n, 0);
			const candidates = templates.map((template) => {
				const inside = template.mask.reduce((sum, pc) => sum + histogram[pc], 0);
				const anchor = mod(Math.min(...pool.map((n) => n.midi)));
				return { ...template, emission: inside / (norm * Math.sqrt(template.mask.length) || 1) - 0.6 * (mass - inside) / (mass || 1) - Math.max(0, template.mask.length - 3) * 0.035 + (anchor === template.root ? 0.15 : 0) + (bass === template.root ? 0.05 : template.mask.includes(bass) ? 0.015 : 0) };
			}).sort((a, c) => c.emission - a.emission).slice(0, 8);
			frames.push({ time, stop, bass, downbeat: beat === 0, candidates, pool });
		}
	}
	for (let i = 0; i < frames.length; i++) {
		const frame = frames[i], previous = frames[i - 1];
		for (const candidate of frame.candidates) {
			candidate.score = candidate.emission; candidate.previous = null;
			if (!previous || frame.time - previous.stop > 0.01) continue;
			let best = -Infinity;
			for (const from of previous.candidates) {
				const same = from.root === candidate.root && from.symbol === candidate.symbol;
				const penalty = same ? 0 : frame.downbeat ? 0.08 : frame.bass !== previous.bass ? 0.2 : 0.8;
				if (from.score - penalty > best) { best = from.score - penalty; candidate.previous = from; }
			}
			candidate.score += best;
		}
	}
	for (let i = frames.length - 1; i >= 0; i--) {
		const frame = frames[i];
		frame.winner ??= frame.candidates.reduce((best, c) => c.score > best.score ? c : best);
		if (i && frame.winner.previous) frames[i - 1].winner = frame.winner.previous;
	}
	const merged = [];
	for (const frame of frames) {
		const last = merged.at(-1), winner = frame.winner;
		if (last && last.root === winner.root && last.symbol === winner.symbol && Math.abs(last.endTime - frame.time) < 0.01) { last.endTime = frame.stop; last.pool.push(...frame.pool); }
		else merged.push({ root: winner.root, symbol: winner.symbol, mask: winner.mask, startTime: frame.time, endTime: frame.stop, pool: [...frame.pool] });
	}
	return merged.map((span, i) => {
		const selected = [...new Map(span.pool.filter((n) => n.startTime < span.endTime && n.endTime > span.startTime).map((n) => [n.id, n])).values()];
		const pitchClasses = [...new Set(selected.map((n) => mod(n.midi)))];
		const fitting = pitchClasses.filter((pc) => span.mask.includes(pc));
		const bass = selected.length ? mod(Math.min(...selected.map((n) => n.midi))) : span.root;
		return { id: `a${i}`, arpeggio: true, startTime: span.startTime, endTime: span.endTime, startTick: Math.min(...selected.map((n) => n.startTick)), endTick: Math.max(...selected.map((n) => n.endTick)), noteIds: selected.map((n) => n.id), pitchClasses, tailNoteId: selected.sort((a, b) => a.startTime - b.startTime).at(-1)?.id, chord: identifyChord(fitting, bass, keyDefinition) };
	});
}
