const percentile = (sorted, fraction) => sorted[Math.round((sorted.length - 1) * fraction)] ?? 0;

export function estimateNoteLoudness(samples, sampleRate, notes, { offsetSec = 0 } = {}) {
	const levels = new Map();
	if (!(sampleRate > 0)) return new Map(notes.map((note) => [note.id, 0]));
	for (const note of notes) {
		const start = Math.max(0, Math.round((note.startTime + offsetSec + 0.02) * sampleRate));
		const end = Math.min(samples.length, Math.round((Math.min(note.endTime, note.startTime + 0.1) + offsetSec) * sampleRate));
		let energy = 0;
		for (let harmonic = 1; harmonic <= 4 && end > start; harmonic++) {
			const frequency = 440 * 2 ** ((note.midi - 69) / 12) * harmonic;
			if (frequency >= sampleRate / 2) break;
			const coefficient = 2 * Math.cos(2 * Math.PI * frequency / sampleRate);
			let previous = 0, before = 0;
			for (let i = start; i < end; i++) {
				const window = 0.5 - 0.5 * Math.cos(2 * Math.PI * (i - start) / Math.max(1, end - start - 1));
				const next = samples[i] * window + coefficient * previous - before;
				before = previous; previous = next;
			}
			energy += Math.max(0, previous * previous + before * before - coefficient * previous * before) / Math.max(1, (end - start) ** 2) / harmonic;
		}
		levels.set(note.id, 10 * Math.log10(Math.max(1e-12, energy)));
	}
	const sorted = [...levels.values()].sort((a, b) => a - b);
	const low = percentile(sorted, 0.1), high = percentile(sorted, 0.9);
	return new Map([...levels].map(([id, db]) => [id, high - low < 1 ? 0.5 : Math.max(0, Math.min(1, (db - low) / (high - low)))]));
}

function fft(real, imaginary) {
	const size = real.length;
	for (let i = 1, j = 0; i < size; i++) {
		let bit = size >> 1;
		for (; j & bit; bit >>= 1) j ^= bit;
		j ^= bit;
		if (i < j) {
			[real[i], real[j]] = [real[j], real[i]];
			[imaginary[i], imaginary[j]] = [imaginary[j], imaginary[i]];
		}
	}
	for (let length = 2; length <= size; length *= 2) {
		const angle = -2 * Math.PI / length, wr = Math.cos(angle), wi = Math.sin(angle);
		for (let start = 0; start < size; start += length) {
			let r = 1, im = 0;
			for (let j = 0; j < length / 2; j++) {
				const a = start + j, b = a + length / 2;
				const br = real[b] * r - imaginary[b] * im, bi = real[b] * im + imaginary[b] * r;
				real[b] = real[a] - br; imaginary[b] = imaginary[a] - bi;
				real[a] += br; imaginary[a] += bi;
				const next = r * wr - im * wi;
				im = r * wi + im * wr; r = next;
			}
		}
	}
}

function resampleForMelody(samples, sampleRate, rate) {
	if (rate === sampleRate) return samples;
	const signal = new Float32Array(Math.floor(samples.length * rate / sampleRate));
	const ratio = sampleRate / rate, radius = Math.ceil(16 * ratio), cutoff = 0.45 / ratio;
	const kernels = new Map();
	for (let i = 0; i < signal.length; i++) {
		const position = i * ratio, index = Math.floor(position);
		const phase = Math.round((position - index) * 1024);
		let kernel = kernels.get(phase);
		if (!kernel) {
			kernel = new Float64Array(2 * radius + 1);
			let sum = 0;
			for (let k = -radius; k <= radius; k++) {
				const distance = k - phase / 1024;
				const window = Math.abs(distance) > radius ? 0 : 0.42 + 0.5 * Math.cos(Math.PI * distance / radius) + 0.08 * Math.cos(2 * Math.PI * distance / radius);
				const sinc = distance === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * distance) / (Math.PI * distance);
				kernel[k + radius] = sinc * window;
				sum += kernel[k + radius];
			}
			for (let k = 0; k < kernel.length; k++) kernel[k] /= sum;
			kernels.set(phase, kernel);
		}
		let value = 0;
		for (let k = Math.max(-radius, -index); k <= Math.min(radius, samples.length - 1 - index); k++) value += samples[index + k] * kernel[k + radius];
		signal[i] = value;
	}
	return signal;
}

export function extractAudioMelodyContour(samples, sampleRate, { minMidi = 36, maxMidi = 96, hopSec = 0.01 } = {}) {
	if (!samples.length || !(sampleRate > 0) || !(hopSec > 0) || maxMidi < minMidi) return [];
	const rate = Math.min(22050, sampleRate);
	const size = 2 ** Math.round(Math.log2(rate * 0.075));
	const hop = Math.max(1, Math.round(rate * hopSec));
	const signal = resampleForMelody(samples, sampleRate, rate);
	const length = signal.length;
	const window = Float64Array.from({ length: size }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (size - 1)));
	const real = new Float64Array(size), imaginary = new Float64Array(size), magnitudes = new Float64Array(size / 2);
	const bins = Math.floor((maxMidi - minMidi) * 10) + 1;
	const frames = [];
	let maximum = 0;
	for (let center = 0; center < length; center += hop) {
		for (let i = 0; i < size; i++) real[i] = (signal[center + i - size / 2] ?? 0) * window[i];
		imaginary.fill(0); fft(real, imaginary);
		for (let i = 0; i < magnitudes.length; i++) magnitudes[i] = Math.hypot(real[i], imaginary[i]) / size;
		const saliences = new Float64Array(bins);
		const peakMaximum = Math.max(...magnitudes);
		for (let i = 2; i < magnitudes.length - 1; i++) {
			const amplitude = magnitudes[i];
			if (amplitude < peakMaximum * 0.015 || amplitude <= magnitudes[i - 1] || amplitude <= magnitudes[i + 1]) continue;
			const a = Math.log(magnitudes[i - 1] + 1e-15), b = Math.log(amplitude + 1e-15), c = Math.log(magnitudes[i + 1] + 1e-15);
			const frequency = (i + 0.5 * (a - c) / (a - 2 * b + c)) * rate / size;
			for (let harmonic = 1; harmonic <= 8; harmonic++) {
				const pitch = 69 + 12 * Math.log2(frequency / harmonic / 440);
				const position = (pitch - minMidi) * 10, nearest = Math.round(position);
				for (let bin = Math.max(0, nearest - 2); bin <= Math.min(bins - 1, nearest + 2); bin++) {
					saliences[bin] += amplitude / harmonic ** 1.2 * Math.exp(-0.5 * ((bin - position) / 1.2) ** 2);
				}
			}
		}
		const candidates = [];
		for (let i = 0; i < bins; i++) {
			if (saliences[i] > 1e-8 && saliences[i] >= (saliences[i - 1] ?? 0) && saliences[i] >= (saliences[i + 1] ?? 0)) candidates.push({ midiPitch: minMidi + i / 10, salience: saliences[i] });
		}
		candidates.sort((a, b) => b.salience - a.salience);
		maximum = Math.max(maximum, candidates[0]?.salience ?? 0);
		frames.push({ time: center / rate, states: [...candidates.slice(0, 8), { midiPitch: null, salience: 0 }] });
	}
	for (let i = 0; i < frames.length; i++) {
		for (const state of frames[i].states) {
			const emission = state.midiPitch === null ? 0 : 2 * state.salience / Math.max(1e-8, maximum) - 0.35;
			state.score = emission; state.parent = -1;
			if (!i) continue;
			let best = -Infinity;
			frames[i - 1].states.forEach((previous, index) => {
				const jump = previous.midiPitch === null || state.midiPitch === null ? (previous.midiPitch === state.midiPitch ? 0 : 0.2) : Math.min(2, Math.abs(previous.midiPitch - state.midiPitch) * 0.08);
				if (previous.score - jump > best) { best = previous.score - jump; state.parent = index; }
			});
			state.score += best;
		}
	}
	let index = frames.at(-1)?.states.reduce((best, state, i, states) => state.score > states[best].score ? i : best, 0);
	const contour = new Array(frames.length);
	for (let i = frames.length - 1; i >= 0; i--) {
		const state = frames[i].states[index];
		contour[i] = { time: frames[i].time, midiPitch: state.midiPitch, salience: state.salience / Math.max(1e-8, maximum) };
		index = state.parent;
	}
	return contour;
}

export function matchAudioMelodyToNotes(contour, notes, { offsetSec = 0 } = {}) {
	const hop = contour.length > 1 ? contour[1].time - contour[0].time : 0.01;
	return new Map(notes.map((note) => {
		const start = note.startTime + offsetSec, end = note.endTime + offsetSec;
		let matched = 0;
		for (let i = Math.max(0, Math.floor((start - (contour[0]?.time ?? 0)) / hop)); i < contour.length && contour[i].time - hop / 2 < end; i++) {
			const frame = contour[i];
			if (frame.midiPitch === null) continue;
			const distance = Math.abs(frame.midiPitch - note.midi);
			const weight = distance <= 0.5 ? 1 : Math.abs(distance - 12) <= 0.5 ? 0.35 : 0;
			matched += Math.max(0, Math.min(end, frame.time + hop / 2) - Math.max(start, frame.time - hop / 2)) * weight;
		}
		return [note.id, end > start ? Math.min(1, matched / (end - start)) : 0];
	}));
}

export function filterPlaybackNotes(notes, mode, melodyTrack, melody = new Map()) {
	if (mode === "all") return notes;
	return notes.filter((note) => {
		const included = melodyTrack === "auto" ? melody.has(note.id) : melodyTrack !== null && melodyTrack !== undefined && note.trackIndex === melodyTrack;
		return mode === "melody" ? included : !included;
	});
}
