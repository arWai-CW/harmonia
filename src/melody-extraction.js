const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

export function applyMelodyOverrides(melody, notes, overrides = new Map()) {
	const result = new Map(melody);
	const available = new Set(notes.map((note) => note.id));
	for (const [id, included] of overrides) {
		if (!available.has(id)) continue;
		if (included) result.set(id, { confidence: 1, manual: true });
		else result.delete(id);
	}
	return result;
}

export function extractMelodyLine(notes, { ppq, beatDuration, barDuration, overrides, loudness, audioMelody } = {}) {
	const valid = notes.filter((note) => Number.isFinite(note.midi) && Number.isFinite(note.startTime) && note.endTime > note.startTime)
		.sort((a, b) => a.startTime - b.startTime || a.midi - b.midi);
	if (!valid.length) return { melody: new Map(), velocityEnabled: false };
	const getVelocity = (note) => loudness ? (loudness.get(note.id) ?? 0.5) : (Number.isFinite(note.velocity) ? note.velocity : 0.8);
	const velocities = valid.map(getVelocity);
	const velocityScale = Math.max(...velocities) > 1 ? 127 : 1;
	const sortedVelocities = velocities.map((v) => v / velocityScale).sort((a, b) => a - b);
	const velocityLow = sortedVelocities[Math.floor((sortedVelocities.length - 1) * 0.1)];
	const velocityHigh = sortedVelocities[Math.ceil((sortedVelocities.length - 1) * 0.9)];
	const velocityEnabled = velocityHigh - velocityLow >= 0.08;
	const inferredBeat = valid.find((note) => note.endTick > note.startTick);
	const secondsPerBeat = beatDuration ?? (ppq > 0 && inferredBeat ? (inferredBeat.endTime - inferredBeat.startTime) * ppq / (inferredBeat.endTick - inferredBeat.startTick) : 0.5);
	const tolerance = Math.min(0.06, secondsPerBeat * 0.08);
	const legatoTolerance = Math.min(0.1, secondsPerBeat * 0.2);
	const clusters = [];
	for (const note of valid) {
		const cluster = clusters.at(-1);
		if (cluster && note.startTime - cluster.time <= tolerance) cluster.notes.push(note);
		else clusters.push({ time: note.startTime, notes: [note] });
	}
	for (let i = 0; i < clusters.length; i++) {
		const cluster = clusters[i];
		const previous = clusters[i - 1];
		const reset = previous && cluster.time - previous.time >= (barDuration ?? secondsPerBeat * 4);
		const resetHistory = (from) => reset && !(from?.lastEndTime > cluster.time + legatoTolerance);
		const pitches = cluster.notes.map((note) => note.midi);
		const low = Math.min(...pitches), high = Math.max(...pitches);
		cluster.states = cluster.notes.map((note) => {
			const beats = ppq > 0 && note.endTick > note.startTick ? (note.endTick - note.startTick) / ppq : (note.endTime - note.startTime) / secondsPerBeat;
			const neighbours = cluster.notes.filter((other) => other !== note && Math.abs(note.midi - other.midi) <= 5);
			const inner = neighbours.some((n) => n.midi > note.midi) && neighbours.some((n) => n.midi < note.midi);
			const velocity = velocityEnabled ? (clamp(getVelocity(note) / velocityScale, velocityLow, velocityHigh) - (velocityLow + velocityHigh) / 2) / (velocityHigh - velocityLow) * 1.3 : 0;
			const emission = -0.35 + (note.midi - low) / (high - low || 1) * 0.25 + (note.midi === high ? 0.15 : 0)
				+ (cluster.notes.length === 1 ? 0.65 : 0) + 1.35 * Math.log2(1 + Math.min(4, beats))
				- (inner ? 0.5 : neighbours.length >= 2 ? 0.4 : neighbours.length ? 0.18 : 0) + velocity + (audioMelody ? 3 * (audioMelody.get(note.id) ?? 0) : 0);
			return { note, emission };
		});
		const holds = new Set(previous?.states.filter((from) => from.lastEndTime > cluster.time + legatoTolerance).map((from) => from.lastNote));
		cluster.states.push({ note: null, emission: cluster.notes.length >= 3 ? -0.05 : -0.65 },
			...[...holds].map((hold) => ({ note: null, hold, emission: 0 })));
		cluster.edges = cluster.states.map((state) => previous?.states.map((from) => {
			if (state.hold) return from.lastNote === state.hold ? 0 : Infinity;
			if (!state.note && from.lastEndTime > cluster.time + legatoTolerance) return Infinity;
			if (resetHistory(from)) return 0;
			const overlap = (from.lastEndTime ?? -Infinity) - (state.note?.startTime ?? cluster.time);
			if (!state.note) return from.note ? 0.2 : 0;
			if (overlap > legatoTolerance) return 4 + overlap / secondsPerBeat;
			if (from.lastPitch === undefined) return 0.15;
			const leap = Math.abs(state.note.midi - from.lastPitch);
			return leap * 0.04 + Math.max(0, leap - 5) * 0.075 + Math.max(0, leap - 12) * 0.06
				+ Math.max(0, Math.abs(state.note.midi - from.register) - 12) * 0.03;
		}) ?? []);
		cluster.states.forEach((state, index) => {
			let best = 0, parent = -1;
			if (previous) {
				best = -Infinity;
				previous.states.forEach((from, j) => {
					const score = from.score - cluster.edges[index][j];
					if (score > best) { best = score; parent = j; }
				});
			}
			state.score = best + state.emission;
			state.parent = parent;
			let from = previous?.states[parent];
			if (resetHistory(from)) from = undefined;
			state.lastPitch = state.note?.midi ?? from?.lastPitch;
			state.lastEndTime = state.note?.endTime ?? from?.lastEndTime;
			state.lastNote = state.note ?? from?.lastNote;
			state.register = state.note ? (from?.register === undefined ? state.note.midi : from.register * 0.65 + state.note.midi * 0.35) : from?.register;
		});
	}
	for (let i = clusters.length - 1; i >= 0; i--) {
		const cluster = clusters[i], next = clusters[i + 1];
		cluster.states.forEach((state, j) => {
			state.future = next ? Math.max(...next.states.map((to, k) => to.emission + to.future - next.edges[k][j])) : 0;
		});
	}
	const melody = new Map();
	const last = clusters.at(-1).states;
	let index = last.reduce((best, state, i) => state.score > last[best].score ? i : best, 0);
	for (let i = clusters.length - 1; i >= 0; i--) {
		const states = clusters[i].states, chosen = states[index];
		if (chosen.note) {
			const alternative = Math.max(...states.filter((_, j) => j !== index).map((state) => state.score + state.future));
			const margin = Math.max(0, chosen.score + chosen.future - alternative);
			melody.set(chosen.note.id, { confidence: margin / (1 + margin), manual: false });
		}
		index = chosen.parent;
	}
	return { melody: applyMelodyOverrides(melody, valid, overrides), velocityEnabled };
}
