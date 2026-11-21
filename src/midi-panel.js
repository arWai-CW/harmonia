const MIDI_TRACK_COLORS = [
	"#4f46e5",
	"#0f766e",
	"#b45309",
	"#be185d",
	"#1d4ed8",
	"#6d28d9",
];

const MIDI_FUNCTION_COLORS = {
	green: "#16a34a",
	blue: "#2563eb",
	red: "#dc2626",
};

import { Note } from "tonal";
import {
	getKeyDefinition,
	spellNotesWithOctaveInKey,
} from "./chord-utils.js";
import { analyzeChordFunction } from "./chord-function.js";
import {
	MidiFileError,
	filterMidiView,
	getBaseTriad,
	parseMidiFile,
} from "./midi-utils.js";
import { t } from "./i18n/index.js";
import { labelMelodyNotes, suggestMelodyTrack } from "./harmony-analysis.js";

const MIDI_ROLE_LEGEND = [
	{ role: "root", color: "#1b1d20" },
	{ role: "guide", color: "#4f46e5" },
	{ role: "stable", color: "#a1a1aa" },
	{ role: "color", color: "#b45309" },
];

const MIDI_QUALITY_KEYS = {
	"": "major",
	m: "minor",
	7: "dom7",
	maj7: "maj7",
	m7: "min7",
	m7b5: "halfDim",
	dim7: "dim7",
	dim: "dim",
	aug: "aug",
	"7b5": "dom7b5",
	"7#5": "dom7Sharp5",
};

const midiQualityLabel = (suffix) =>
	t(`midi.quality.${MIDI_QUALITY_KEYS[suffix] ?? "chord"}`);
const midiRoleLabel = (role) => t(`midi.role.${role}`);

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const MIDI_PADDING = 12;
const MIDI_MIN_ZOOM = 1;
const MIDI_MAX_ZOOM = 4;
const MIDI_CHORD_MIN_WIDTH = 44;
const MIDI_CHORD_CHAR_WIDTH = 7.2;
const MIDI_CHORD_TOP = 86;
const MIDI_CHORD_LANE_HEIGHT = 34;
const MIDI_CHORD_MAX_LANES = 4;
const MIDI_CHORD_GAP = 0;
const MIDI_MASTER_GAIN = 0.9;
const MIDI_LOOKAHEAD_SECONDS = 0.6;
const MIDI_SCHEDULE_INTERVAL_MS = 70;

const clamp = (value, minimum, maximum) =>
	Math.min(Math.max(value, minimum), maximum);

const createSvgElement = (tag, attributes = {}) => {
	const element = document.createElementNS(SVG_NAMESPACE, tag);
	Object.entries(attributes).forEach(([key, value]) => {
		element.setAttribute(key, String(value));
	});
	return element;
};

const formatMidiTime = (seconds) => {
	const total = Math.max(0, Math.round(seconds));
	return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

const formatMidiClock = (seconds) => {
	const total = Math.max(0, Math.floor(seconds));
	return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
};

const midiNoteName = (midi, keyDefinition) => {
	try {
		return (
			spellNotesWithOctaveInKey([Note.fromMidi(midi)], keyDefinition)[0] ??
			Note.fromMidi(midi)
		);
	} catch {
		return Note.fromMidi(midi);
	}
};

const getMidiTrackColor = (tracks, trackIndex) => {
	const position = tracks.findIndex((track) => track.index === trackIndex);
	return MIDI_TRACK_COLORS[(position < 0 ? 0 : position) % MIDI_TRACK_COLORS.length];
};

const getMidiBarIndex = (bars, time) => {
	let index = bars[0]?.index ?? 1;
	for (const bar of bars) {
		if (bar.time <= time + 0.01) {
			index = bar.index;
		} else {
			break;
		}
	}
	return index;
};

const syncMidiScroll = (ui) => {
	ui.midiRibbonInner.style.transform = `translateX(${-ui.midiRollScroll.scrollLeft}px)`;
	ui.midiAxisInner.style.transform = `translateY(${-ui.midiRollScroll.scrollTop}px)`;
};

const renderMidiDetailMessage = (ui, message) => {
	const empty = document.createElement("p");
	empty.className = "midi-detail__empty";
	empty.textContent = message;
	ui.midiDetail.replaceChildren(empty);
};

const renderMidiDetail = (ui, view, segment, keyDefinition) => {
	if (!segment) {
		renderMidiDetailMessage(
			ui,
			view.segments.length
				? t("midi.detail.hintSelect")
				: t("midi.detail.hintEmpty"),
		);
		return;
	}

	if (segment.arpeggio && !segment.chord) {
		const barIndex = getMidiBarIndex(view.bars, segment.startTime);
		const head = document.createElement("div");
		head.className = "midi-detail__head";

		const titleWrap = document.createElement("div");
		titleWrap.className = "midi-detail__title";
		const symbol = document.createElement("p");
		symbol.className = "midi-detail__symbol";
		symbol.textContent = t("midi.arpeggio.title");
		const meta = document.createElement("p");
		meta.className = "midi-detail__meta";
		meta.textContent = t("midi.detail.meta", {
			bar: barIndex,
			start: formatMidiTime(segment.startTime),
			end: formatMidiTime(segment.endTime),
			count: segment.noteIds.length,
		});
		titleWrap.append(symbol, meta);

		const chip = document.createElement("span");
		chip.className = "chip midi-detail__chip";
		chip.textContent = t("midi.undetermined");
		head.append(titleWrap, chip);

		const story = document.createElement("p");
		story.className = "midi-detail__story";
		story.textContent = t("midi.arpeggio.story");

		const tailNote = view.notes.find(
			(note) => note.id === segment.tailNoteId,
		);
		const tail = document.createElement("p");
		tail.className = "midi-detail__tail";
		if (tailNote) {
			const label = document.createElement("span");
			label.className = "midi-detail__label";
			label.textContent = t("midi.detail.tail");
			const value = document.createElement("span");
			value.textContent = t("midi.detail.tailHint", {
				note: midiNoteName(tailNote.midi, keyDefinition),
			});
			tail.append(label, value);
		}

		ui.midiDetail.replaceChildren(
			head,
			story,
			...(tailNote ? [tail] : []),
		);
		return;
	}

	const { chord } = segment;
	const chordFunction = analyzeChordFunction(
		chord.symbol,
		keyDefinition,
		chord.intervals,
	);
	const barIndex = getMidiBarIndex(view.bars, segment.startTime);

	const head = document.createElement("div");
	head.className = "midi-detail__head";

	const titleWrap = document.createElement("div");
	titleWrap.className = "midi-detail__title";

	const symbol = document.createElement("p");
	symbol.className = "midi-detail__symbol";
	symbol.textContent =
		chord.symbol === "?" ? t("midi.detail.unreadable") : chord.symbol;

	const meta = document.createElement("p");
	meta.className = "midi-detail__meta";
	meta.textContent = t("midi.detail.meta", {
		bar: barIndex,
		start: formatMidiTime(segment.startTime),
		end: formatMidiTime(segment.endTime),
		count: segment.pitchClasses.length,
	});
	titleWrap.append(symbol, meta);

	const chip = document.createElement("span");
	chip.className = `chip midi-detail__chip${chordFunction?.color ? ` chip--${chordFunction.color}` : ""}${chordFunction?.function === "borrowed" ? " chip--borrowed" : ""}`;
	const roman = document.createElement("span");
	roman.className = "midi-detail__roman";
	roman.textContent = chordFunction?.roman ?? "";
	const functionLabel = document.createElement("span");
	functionLabel.textContent = chordFunction
		? t(`midi.function.${chordFunction.function}`)
		: t("midi.detail.outOfKeyChord");
	if (chordFunction?.roman) {
		chip.append(roman, functionLabel);
	} else {
		chip.append(functionLabel);
	}
	chip.title =
		chordFunction?.description ??
		(chordFunction
			? `${chordFunction.roman}（${functionLabel.textContent}）`
			: t("midi.detail.notInKey"));
	head.append(titleWrap, chip);

	const story = document.createElement("p");
	story.className = "midi-detail__story";
	const extensionNames = chord.extensions
		.map((degree) => {
			const tone = chord.tones.find((item) => item.degree === degree);
			return tone ? `${degree}（${tone.name}）` : degree;
		})
		.join("、");

	if (chord.symbol === "?") {
		story.textContent = t("midi.detail.storyUnknown");
	} else if (chord.skeleton && extensionNames) {
		story.textContent = t("midi.detail.storySkeletonExt", {
			skeleton: chord.skeleton.symbol,
			extensions: extensionNames,
		});
	} else if (chord.skeleton) {
		story.textContent = t("midi.detail.storySkeleton", {
			skeleton: chord.skeleton.symbol,
			quality: midiQualityLabel(chord.skeleton.suffix),
		});
	} else {
		story.textContent = t("midi.detail.storyNoThird");
	}

	const legend = document.createElement("div");
	legend.className = "midi-legend";
	MIDI_ROLE_LEGEND.forEach(({ role, color }) => {
		const item = document.createElement("span");
		item.className = "midi-legend__item";
		const dot = document.createElement("span");
		dot.className = "midi-legend__dot";
		dot.style.backgroundColor = color;
		const text = document.createElement("span");
		text.textContent = t(`midi.legend.${role}`);
		item.append(dot, text);
		legend.append(item);
	});

	const tones = document.createElement("div");
	tones.className = "midi-tones";
	chord.tones.forEach((tone) => {
		const item = document.createElement("span");
		item.className = `midi-tone midi-tone--${tone.role}`;
		item.title = `${midiRoleLabel(tone.role)} · ${tone.degree}`;
		const name = document.createElement("span");
		name.className = "midi-tone__name";
		name.textContent = tone.name;
		const degree = document.createElement("span");
		degree.className = "midi-tone__degree";
		degree.textContent = tone.degree;
		item.append(name, degree);
		tones.append(item);
	});

	const baseTriad = getBaseTriad(chord);
	const base = document.createElement("p");
	base.className = "midi-detail__base";
	if (baseTriad) {
		const label = document.createElement("span");
		label.className = "midi-detail__label";
		label.textContent = t("midi.detail.base");
		const value = document.createElement("span");
		value.textContent = `${baseTriad.symbol}（${baseTriad.tones.map((tone) => tone.name).join("–")}）`;
		base.append(label, value);
	}

	const skeleton = document.createElement("p");
	skeleton.className = "midi-detail__skeleton";
	if (chord.skeleton) {
		const label = document.createElement("span");
		label.className = "midi-detail__label";
		label.textContent = t("midi.detail.skeleton");
		const value = document.createElement("span");
		value.textContent = `${chord.skeleton.symbol}（${midiQualityLabel(chord.skeleton.suffix)}）`;
		skeleton.append(label, value);
		if (chord.omitted.length) {
			const omitted = document.createElement("span");
			omitted.className = "midi-detail__omitted";
			omitted.textContent = t("midi.detail.omitted", {
				notes: chord.omitted
					.map((item) => `${item.degree}（${item.name}）`)
					.join("、"),
			});
			skeleton.append(omitted);
		}
	}

	ui.midiDetail.replaceChildren(
		head,
		story,
		legend,
		tones,
		...(baseTriad ? [base] : []),
		skeleton,
	);
};

const renderMidiTracks = (ui, state) => {
	if (!state.midiSource) {
		ui.midiTracks.hidden = true;
		ui.midiTrackList.replaceChildren();
		return;
	}

	ui.midiTracks.hidden = false;
	const allEnabled =
		state.midiEnabledTracks.size === state.midiSource.tracks.length;
	const items = state.midiSource.tracks.map((track) => {
		const enabled = state.midiEnabledTracks.has(track.index);
		const button = document.createElement("button");
		button.type = "button";
		button.className = "midi-track";
		button.dataset.trackIndex = String(track.index);
		button.setAttribute("aria-pressed", String(enabled));
		button.title = `${track.name}：${enabled ? t("midi.track.soloHint") : t("midi.track.addHint")}`;

		const dot = document.createElement("span");
		dot.className = "midi-track__dot";
		dot.style.backgroundColor = getMidiTrackColor(
			state.midiSource.tracks,
			track.index,
		);
		const name = document.createElement("span");
		name.className = "midi-track__name";
		name.textContent = track.name;
		const count = document.createElement("span");
		count.className = "midi-track__count";
		count.textContent = t("midi.track.notes", { count: track.noteCount });
		button.append(dot, name, count);
		return button;
	});

	if (state.midiSource.tracks.length > 1) {
		const all = document.createElement("button");
		all.type = "button";
		all.className = "midi-track midi-track--all";
		all.dataset.midiAll = "true";
		all.setAttribute("aria-pressed", String(allEnabled));
		all.textContent = t("midi.track.all");
		items.push(all);
	}

	ui.midiTrackList.replaceChildren(...items);
};

const getMidiDuration = (state) => Math.max(state.midi?.durationSeconds ?? 0, 0.01);

const getMidiPosition = (state) => {
	const playback = state.midiPlayback;
	const duration = getMidiDuration(state);
	if (!playback.playing || !playback.audioContext) {
		return clamp(playback.offset, 0, duration);
	}
	const elapsed =
		(playback.audioContext.currentTime - playback.startedAt) * playback.rate;
	return clamp(playback.offset + elapsed, 0, duration);
};

const ensureMidiAudio = (state) => {
	const playback = state.midiPlayback;
	if (playback.audioContext) return playback.audioContext;
	const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
	if (!AudioContextClass) return null;

	const context = new AudioContextClass();
	const compressor = context.createDynamicsCompressor();
	compressor.threshold.value = -18;
	compressor.knee.value = 18;
	compressor.ratio.value = 4;
	compressor.attack.value = 0.003;
	compressor.release.value = 0.2;
	const master = context.createGain();
	master.gain.value = MIDI_MASTER_GAIN;
	master.connect(compressor);
	compressor.connect(context.destination);

	playback.audioContext = context;
	playback.master = master;
	return context;
};

const stopMidiNode = ({ osc, gain }) => {
	try {
		osc.stop();
	} catch {
		/* already stopped */
	}
	try {
		gain.disconnect();
	} catch {
		/* already disconnected */
	}
};

const silenceMidi = (playback) => {
	if (!playback.nodes.size) return;
	const fading = [...playback.nodes];
	playback.nodes.clear();
	const context = playback.audioContext;
	if (!context || !playback.master) {
		fading.forEach(stopMidiNode);
		return;
	}

	// A 30 ms fade avoids a click when pausing, but new notes must not be cut
	// by the same timeout, so only the nodes that existed now are stopped.
	const now = context.currentTime;
	playback.master.gain.cancelScheduledValues(now);
	playback.master.gain.setValueAtTime(playback.master.gain.value, now);
	playback.master.gain.linearRampToValueAtTime(0, now + 0.03);
	window.setTimeout(() => {
		fading.forEach(stopMidiNode);
		if (playback.master) {
			playback.master.gain.setValueAtTime(
				MIDI_MASTER_GAIN,
				context.currentTime,
			);
		}
	}, 40);
};

const syncMidiPlayhead = (ui, state) => {
	const playback = state.midiPlayback;
	const visible = Boolean(state.midi) && !ui.midiView.hidden;
	[playback.playheadRibbon, playback.playheadRoll].forEach((line) => {
		if (line) line.hidden = !visible;
	});
	if (!visible) return;

	const position = getMidiPosition(state);
	const x = MIDI_PADDING + position * state.midiPixelsPerSecond;
	[playback.playheadRibbon, playback.playheadRoll].forEach((line) => {
		if (line) line.style.transform = `translateX(${x}px)`;
	});
	ui.midiTime.textContent = `${formatMidiClock(position)} / ${formatMidiClock(getMidiDuration(state))}`;
};

const updateMidiTransport = (ui, state) => {
	const playback = state.midiPlayback;
	const hasNotes = Boolean(state.midi?.notes.length);
	ui.midiPlay.disabled = !hasNotes;
	ui.midiStop.disabled = !hasNotes;
	ui.midiPlay.dataset.playing = String(playback.playing);
	ui.midiPlayLabel.textContent = playback.playing
		? t("midi.transport.pause")
		: t("midi.transport.play");
	ui.midiPlayIconPlay.hidden = playback.playing;
	ui.midiPlayIconPause.hidden = !playback.playing;
	ui.midiTempoValue.textContent = `${ui.midiTempo.value}%`;
	ui.midiTime.textContent = `${formatMidiClock(getMidiPosition(state))} / ${formatMidiClock(getMidiDuration(state))}`;
};

const scheduleMidiNote = (state, note, when, duration) => {
	const playback = state.midiPlayback;
	const context = playback.audioContext;
	const oscillator = context.createOscillator();
	const gain = context.createGain();
	oscillator.type = "triangle";
	oscillator.frequency.value = 440 * 2 ** ((note.midi - 69) / 12);

	const peak = 0.02 + (note.velocity ?? 0.8) * 0.06;
	const releaseStart = Math.max(when + 0.02, when + duration - 0.05);
	gain.gain.setValueAtTime(0.0001, when);
	gain.gain.linearRampToValueAtTime(peak, when + 0.012);
	gain.gain.setValueAtTime(peak, releaseStart);
	gain.gain.linearRampToValueAtTime(0.0001, when + duration);

	oscillator.connect(gain);
	gain.connect(playback.master);
	const entry = { osc: oscillator, gain };
	playback.nodes.add(entry);
	oscillator.onended = () => {
		playback.nodes.delete(entry);
		try {
			gain.disconnect();
		} catch {
			/* already disconnected */
		}
	};
	oscillator.start(when);
	oscillator.stop(when + duration + 0.02);
};

const pumpMidiSchedule = (state) => {
	const playback = state.midiPlayback;
	if (!playback.playing || !state.midi) return;
	const notes = state.midi.notes;
	const position = getMidiPosition(state);
	const horizon = position + MIDI_LOOKAHEAD_SECONDS;
	const context = playback.audioContext;

	while (playback.cursor < notes.length) {
		const note = notes[playback.cursor];
		if (note.startTime > horizon) break;
		playback.cursor += 1;
		const start = Math.max(note.startTime, position);
		if (note.endTime <= start + 0.01) continue;
		const when =
			context.currentTime +
			Math.max(0, (start - position) / playback.rate) +
			0.01;
		const duration = Math.max(
			0.06,
			(note.endTime - start) / playback.rate,
		);
		scheduleMidiNote(state, note, when, duration);
	}
};

const tickMidiPlayback = (ui, state) => {
	const playback = state.midiPlayback;
	if (!playback.playing) return;
	syncMidiPlayhead(ui, state);
	const position = getMidiPosition(state);
	if (position >= getMidiDuration(state) - 0.015) {
		stopMidiPlayback(ui, state, true);
		return;
	}

	const x = MIDI_PADDING + position * state.midiPixelsPerSecond;
	const scroll = ui.midiRollScroll;
	if (x > scroll.scrollLeft + scroll.clientWidth - 36) {
		scroll.scrollLeft = Math.min(
			x - scroll.clientWidth * 0.25,
			ui.midiRollContent.scrollWidth,
		);
	}
	playback.frame = window.requestAnimationFrame(() =>
		tickMidiPlayback(ui, state),
	);
};

const startMidiPlayback = async (ui, state) => {
	const playback = state.midiPlayback;
	if (playback.playing || !state.midi?.notes.length) return;
	const context = ensureMidiAudio(state);
	if (!context) {
		ui.midiPlay.title = t("midi.transport.unsupported");
		return;
	}
	try {
		if (context.state === "suspended") await context.resume();
	} catch {
		return;
	}

	const duration = getMidiDuration(state);
	if (playback.offset >= duration - 0.02) playback.offset = 0;
	playback.rate = clamp(Number(ui.midiTempo.value) / 100, 0.5, 1.5);
	playback.playing = true;
	playback.startedAt = context.currentTime;
	if (playback.offset < 0.05) ui.midiRollScroll.scrollLeft = 0;
	playback.cursor = state.midi.notes.findIndex(
		(note) => note.endTime > playback.offset + 0.001,
	);
	if (playback.cursor < 0) playback.cursor = state.midi.notes.length;
	playback.master.gain.cancelScheduledValues(context.currentTime);
	playback.master.gain.setValueAtTime(MIDI_MASTER_GAIN, context.currentTime);

	pumpMidiSchedule(state);
	window.clearInterval(playback.timer);
	playback.timer = window.setInterval(
		() => pumpMidiSchedule(state),
		MIDI_SCHEDULE_INTERVAL_MS,
	);
	window.cancelAnimationFrame(playback.frame);
	playback.frame = window.requestAnimationFrame(() =>
		tickMidiPlayback(ui, state),
	);
	updateMidiTransport(ui, state);
	syncMidiPlayhead(ui, state);
};

const pauseMidiPlayback = (ui, state) => {
	const playback = state.midiPlayback;
	if (!playback.playing) return;
	playback.offset = getMidiPosition(state);
	playback.playing = false;
	window.clearInterval(playback.timer);
	window.cancelAnimationFrame(playback.frame);
	silenceMidi(playback);
	updateMidiTransport(ui, state);
	syncMidiPlayhead(ui, state);
};

const stopMidiPlayback = (ui, state, reset = true) => {
	const playback = state.midiPlayback;
	const position = playback.playing
		? getMidiPosition(state)
		: playback.offset;
	playback.playing = false;
	window.clearInterval(playback.timer);
	window.cancelAnimationFrame(playback.frame);
	silenceMidi(playback);
	playback.offset = reset ? 0 : position;
	playback.cursor = 0;
	updateMidiTransport(ui, state);
	syncMidiPlayhead(ui, state);
};

const renderMidiView = (ui, state, keyDefinition) => {
	const view = state.midi;
	const keyAt = (time) => {
		const region = state.midiAutoKey !== false && view?.keyRegions.find((r) => time >= r.startTime && time < r.endTime);
		return region ? getKeyDefinition(region.root, region.mode) : keyDefinition;
	};
	if (!view) {
		ui.midiEmpty.hidden = false;
		ui.midiView.hidden = true;
		ui.midiZoom.hidden = true;
		ui.midiRibbonInner.replaceChildren();
		ui.midiRibbonInner.style.height = "66px";
		ui.midiRollContent.replaceChildren();
		ui.midiAxisInner.replaceChildren();
		ui.midiDetail.replaceChildren();
		state.midiPlayback.playheadRibbon = null;
		state.midiPlayback.playheadRoll = null;
		ui.midiTime.textContent = "0:00 / 0:00";
		updateMidiTransport(ui, state);
		return;
	}

	ui.midiEmpty.hidden = true;
	ui.midiView.hidden = false;
	ui.midiZoom.hidden = false;

	const previousLeft = ui.midiRollScroll.scrollLeft;
	const previousTop = ui.midiRollScroll.scrollTop;
	const duration = Math.max(view.durationSeconds, 0.5);
	const viewportWidth = ui.midiRollScroll.clientWidth || 620;
	const basePixelsPerSecond = clamp(
		(viewportWidth - MIDI_PADDING * 2) / duration,
		40,
		200,
	);
	const pixelsPerSecond = basePixelsPerSecond * state.midiZoom;
	state.midiPixelsPerSecond = pixelsPerSecond;
	const contentWidth = Math.ceil(
		MIDI_PADDING * 2 + duration * pixelsPerSecond,
	);

	ui.midiRibbonInner.style.width = `${contentWidth}px`;
	ui.midiRibbonInner.replaceChildren();
	ui.midiRollContent.replaceChildren();
	ui.midiAxisInner.replaceChildren();

	const selected =
		view.segments.find((segment) => segment.id === state.midiSelectedId) ??
		view.segments[0] ??
		null;
	state.midiSelectedId = selected?.id ?? null;

	if (!view.notes.length) {
		const empty = document.createElement("p");
		empty.className = "midi-roll-empty";
		empty.textContent = t("midi.roll.noTracks");
		ui.midiRollContent.append(empty);
		ui.midiRibbonInner.style.width = "100%";
		ui.midiRibbonInner.style.height = "66px";
		state.midiPlayback.playheadRibbon = null;
		state.midiPlayback.playheadRoll = null;
		renderMidiDetailMessage(ui, t("midi.roll.noTracksHint"));
		ui.midiZoomIn.disabled = state.midiZoom >= MIDI_MAX_ZOOM;
		ui.midiZoomOut.disabled = state.midiZoom <= MIDI_MIN_ZOOM;
		updateMidiTransport(ui, state);
		return;
	}

	const pitches = view.notes.map((note) => note.midi);
	const minPitch = Math.max(0, Math.min(...pitches) - 1);
	const maxPitch = Math.min(127, Math.max(...pitches) + 1);
	const pitchRange = maxPitch - minPitch + 1;
	const narrow = window.innerWidth <= 640;
	const rollHeight = narrow
		? clamp(pitchRange * 5, 180, 280)
		: clamp(pitchRange * 7, 240, 340);
	const rowHeight = Math.max(state.midiMelodyTrack === null ? 0 : 12, rollHeight / pitchRange);
	const contentHeight = Math.round(pitchRange * rowHeight);
	ui.midiAxis.style.height = `${contentHeight}px`;
	ui.midiRollScroll.style.height = `${contentHeight}px`;
	const trackNames = new Map(
		view.tracks.map((track) => [track.index, track.name]),
	);

	const ruler = document.createElement("div");
	ruler.className = "midi-ruler";
	view.bars.forEach((bar) => {
		const label = document.createElement("span");
		label.className = "midi-ruler__bar";
		label.style.left = `${MIDI_PADDING + bar.time * pixelsPerSecond}px`;
		label.textContent = String(bar.index);
		ruler.append(label);
	});
	ui.midiRibbonInner.append(ruler);
	view.keyRegions.forEach((region) => {
		const lane = document.createElement("div");
		lane.className = "midi-key-region";
		lane.style.left = `${MIDI_PADDING + region.startTime * pixelsPerSecond}px`;
		lane.style.width = `${(region.endTime - region.startTime) * pixelsPerSecond - 2}px`;
		lane.textContent = `${region.root} ${t(`midi.harmony.${region.mode}`)}`;
		ui.midiRibbonInner.append(lane);
	});
	view.twoFiveChains.forEach((pattern) => {
		const bracket = document.createElement("div");
		bracket.className = "midi-harmony-bracket";
		bracket.style.left = `${MIDI_PADDING + pattern.startTime * pixelsPerSecond}px`;
		bracket.style.width = `${Math.max(20, (pattern.endTime - pattern.startTime) * pixelsPerSecond - 2)}px`;
		bracket.style.borderStyle = pattern.resolved ? "solid" : "dashed";
		bracket.style.color = MIDI_TRACK_COLORS[pattern.chainId % MIDI_TRACK_COLORS.length];
		bracket.textContent = `${t(`midi.harmony.${pattern.type}`)} → ${pattern.targetRoot}`;
		ui.midiRibbonInner.append(bracket);
	});

	const chordBoxes = view.segments.map((segment) => {
		const label = segment.chord?.symbol ?? t("midi.arpeggio.short");
		const start = MIDI_PADDING + segment.startTime * pixelsPerSecond;
		const actualWidth = Math.max(
			2,
			(segment.endTime - segment.startTime) * pixelsPerSecond - 2,
		);
		const minWidth = clamp(
			20 + label.length * MIDI_CHORD_CHAR_WIDTH,
			MIDI_CHORD_MIN_WIDTH,
			96,
		);
		return {
			segment,
			start,
			actualWidth,
			width: Math.max(actualWidth, minWidth),
			lane: 0,
		};
	});

	// Very short chords get a readable minimum chip; overlapping chips move to a
	// second lane instead of covering each other.
	// shortcut: beyond four lanes the earliest lane is reused, so extremely dense clusters can overlap.
	const laneEnds = [];
	chordBoxes.forEach((box) => {
		let lane = laneEnds.findIndex(
			(end) => box.start >= end + MIDI_CHORD_GAP,
		);
		if (lane === -1 && laneEnds.length < MIDI_CHORD_MAX_LANES) {
			lane = laneEnds.length;
			laneEnds.push(0);
		}
		if (lane === -1) {
			lane = laneEnds.indexOf(Math.min(...laneEnds));
		}
		box.lane = lane;
		laneEnds[lane] = box.start + box.width;
	});
	ui.midiRibbonInner.style.height = `${Math.max(
		66,
		MIDI_CHORD_TOP + laneEnds.length * MIDI_CHORD_LANE_HEIGHT + 2,
	)}px`;

	chordBoxes.forEach(({ segment, start, actualWidth, width, lane }) => {
		const isArpeggio = Boolean(segment.arpeggio && !segment.chord);
		const label = isArpeggio ? t("midi.arpeggio.short") : segment.chord.symbol;
		const chordFunction = isArpeggio
			? null
			: analyzeChordFunction(
					segment.chord.symbol,
					keyAt(segment.startTime),
					segment.chord.intervals,
				);
		const color = isArpeggio
			? "rgba(27, 29, 32, 0.18)"
			: (MIDI_FUNCTION_COLORS[chordFunction?.color] ??
				"rgba(27, 29, 32, 0.16)");
		const button = document.createElement("button");
		button.type = "button";
		button.className = "midi-chord";
		button.dataset.segmentId = segment.id;
		button.style.left = `${start}px`;
		button.style.top = `${MIDI_CHORD_TOP + lane * MIDI_CHORD_LANE_HEIGHT}px`;
		button.style.width = `${width}px`;
		button.style.setProperty("--function-color", color);
		button.classList.toggle("is-selected", segment.id === selected?.id);
		button.classList.toggle(
			"midi-chord--arpeggio",
			isArpeggio,
		);
		button.classList.toggle("midi-chord--compact", width < 38);
		button.classList.toggle("midi-chord--widened", actualWidth < width);
		button.setAttribute(
			"aria-pressed",
			String(segment.id === selected?.id),
		);
		button.title = isArpeggio
			? t("midi.chord.titleArpeggio", {
					bar: getMidiBarIndex(view.bars, segment.startTime),
				})
			: t("midi.chord.title", {
					symbol: segment.chord.symbol,
					roman: chordFunction?.roman ?? t("midi.detail.outOfKey"),
					bar: getMidiBarIndex(view.bars, segment.startTime),
				});

		const symbol = document.createElement("span");
		symbol.className = "midi-chord__symbol";
		symbol.textContent = label;
		const roman = document.createElement("span");
		roman.className = "midi-chord__roman";
		roman.textContent = isArpeggio
			? t("midi.undetermined")
			: (chordFunction?.roman ?? t("midi.detail.outOfKey"));
		button.append(symbol, roman);
		ui.midiRibbonInner.append(button);
	});

	const svg = createSvgElement("svg", {
		viewBox: `0 0 ${contentWidth} ${contentHeight}`,
		width: contentWidth,
		height: contentHeight,
		class: "midi-roll",
		role: "img",
		"aria-label": t("midi.roll.aria", {
			name: view.sourceName,
			notes: view.notes.length,
			chords: view.segments.length,
		}),
	});

	for (let midi = minPitch; midi <= maxPitch; midi += 1) {
		const y = (maxPitch - midi) * rowHeight;
		const pitchClass = midi % 12;
		const isBlack = [1, 3, 6, 8, 10].includes(pitchClass);
		const row = createSvgElement("rect", {
			x: 0,
			y,
			width: contentWidth,
			height: rowHeight,
			fill: isBlack ? "rgba(27, 29, 32, 0.045)" : "rgba(255, 255, 255, 0.28)",
		});
		svg.append(row);
		if (pitchClass === 0) {
			svg.append(
				createSvgElement("line", {
					x1: 0,
					y1: y + rowHeight,
					x2: contentWidth,
					y2: y + rowHeight,
					stroke: "rgba(27, 29, 32, 0.12)",
					"stroke-width": 1,
				}),
			);
		}
	}

	const baseTriad =
		selected && !selected.arpeggio ? getBaseTriad(selected.chord) : null;
	const basePitchClasses = new Set(baseTriad?.pcs ?? []);
	if (selected) {
		const selectionX = MIDI_PADDING + selected.startTime * pixelsPerSecond;
		const selectionWidth = Math.max(
			2,
			(selected.endTime - selected.startTime) * pixelsPerSecond,
		);
		svg.append(
			createSvgElement("rect", {
				x: selectionX,
				y: 0,
				width: selectionWidth,
				height: contentHeight,
				fill: "rgba(79, 70, 229, 0.08)",
			}),
		);
		[selectionX, selectionX + selectionWidth].forEach((x) => {
			svg.append(
				createSvgElement("line", {
					x1: x,
					y1: 0,
					x2: x,
					y2: contentHeight,
					stroke: "rgba(79, 70, 229, 0.28)",
					"stroke-width": 1,
				}),
			);
		});
	}

	const barDuration =
		(view.bars[1]?.time ?? view.durationSeconds) -
		(view.bars[0]?.time ?? 0);
	const beatsPerBar = view.timeSignature[0] || 4;
	view.bars.forEach((bar) => {
		const x = MIDI_PADDING + bar.time * pixelsPerSecond;
		svg.append(
			createSvgElement("line", {
				x1: x,
				y1: 0,
				x2: x,
				y2: contentHeight,
				stroke: "rgba(27, 29, 32, 0.1)",
				"stroke-width": 1,
			}),
		);
		for (let beat = 1; beat < beatsPerBar; beat += 1) {
			const beatTime = bar.time + (barDuration * beat) / beatsPerBar;
			if (barDuration * pixelsPerSecond < 12) break;
			svg.append(
				createSvgElement("line", {
					x1: MIDI_PADDING + beatTime * pixelsPerSecond,
					y1: 0,
					x2: MIDI_PADDING + beatTime * pixelsPerSecond,
					y2: contentHeight,
					stroke: "rgba(27, 29, 32, 0.045)",
					"stroke-width": 1,
				}),
			);
		}
	});

	const selectedNoteIds = new Set(selected?.noteIds ?? []);
	const showNoteTitles = view.notes.length <= 4000;
	const melodyLabels = labelMelodyNotes(view.notes, view.segments, state.midiMelodyTrack, view.ppq, view.barDuration);
	view.notes.forEach((note) => {
		const selectedNote = selectedNoteIds.has(note.id);
		const baseNote =
			selectedNote && basePitchClasses.has(note.midi % 12);
		const opacity = !selected
			? 0.94
			: selected.arpeggio
				? selectedNote
					? 0.94
					: 0.35
				: baseNote
					? 0.98
					: selectedNote
						? 0.6
						: 0.35;
		const rect = createSvgElement("rect", {
			x: MIDI_PADDING + note.startTime * pixelsPerSecond,
			y: (maxPitch - note.midi) * rowHeight + 1,
			width: Math.max(
				2,
				(note.endTime - note.startTime) * pixelsPerSecond - 1,
			),
			height: Math.max(2, rowHeight - 2),
			rx: Math.min(3, rowHeight / 3),
			fill: getMidiTrackColor(view.tracks, note.trackIndex),
			opacity,
		});
		if (baseNote) {
			rect.setAttribute("stroke", "rgba(27, 29, 32, 0.9)");
			rect.setAttribute("stroke-width", "1.4");
		} else if (selectedNote) {
			rect.setAttribute("stroke", "rgba(255, 255, 255, 0.8)");
			rect.setAttribute("stroke-width", "0.8");
		}
		if (showNoteTitles) {
			const title = createSvgElement("title");
			title.textContent = `${midiNoteName(note.midi, keyDefinition)} · ${trackNames.get(note.trackIndex) ?? t("midi.roll.trackFallback", { index: note.trackIndex + 1 })}`;
			rect.append(title);
		}
		svg.append(rect);
		const melody = melodyLabels.get(note.id);
		if (melody) {
			rect.setAttribute("opacity", "0.95");
			rect.setAttribute("fill", ({ chord: "#0f766e", tension: "#b45309", passing: "#6d28d9" })[melody.kind]);
			const text = createSvgElement("text", { x: MIDI_PADDING + note.startTime * pixelsPerSecond + 2, y: (maxPitch - note.midi) * rowHeight + rowHeight - 2, fill: "white", "font-size": Math.max(9, rowHeight - 2), "pointer-events": "none" });
			text.textContent = melody.label;
			svg.append(text);
		}
	});
	ui.midiRollContent.append(svg);
	const ribbonPlayhead = document.createElement("div");
	ribbonPlayhead.className = "midi-playhead midi-playhead--ribbon";
	ribbonPlayhead.setAttribute("aria-hidden", "true");
	ui.midiRibbonInner.append(ribbonPlayhead);
	state.midiPlayback.playheadRibbon = ribbonPlayhead;

	const rollPlayhead = document.createElement("div");
		rollPlayhead.className = "midi-playhead midi-playhead--roll";
	rollPlayhead.setAttribute("aria-hidden", "true");
	ui.midiRollContent.append(rollPlayhead);
	state.midiPlayback.playheadRoll = rollPlayhead;


	for (let midi = minPitch; midi <= maxPitch; midi += 1) {
		if (midi % 12 !== 0) continue;
		const label = document.createElement("span");
		label.className = "midi-axis__label";
		label.style.top = `${(maxPitch - midi) * rowHeight + rowHeight / 2}px`;
		label.textContent = midiNoteName(midi, keyDefinition);
		ui.midiAxisInner.append(label);
	}
	ui.midiAxisInner.style.height = `${contentHeight}px`;

	renderMidiDetail(ui, view, selected, keyAt(selected?.startTime ?? 0));
	if (selected && melodyLabels.size) {
		const melody = document.createElement("p");
		melody.className = "midi-detail__melody";
		melody.textContent = `${t("midi.harmony.melody")}: ` + view.notes.filter((n) => n.startTime >= selected.startTime && n.startTime < selected.endTime && melodyLabels.has(n.id)).map((n) => `${midiNoteName(n.midi, keyAt(n.startTime))} (${melodyLabels.get(n.id).label})`).join(" · ");
		ui.midiDetail.append(melody);
	}

	ui.midiRollScroll.scrollLeft = previousLeft;
	ui.midiRollScroll.scrollTop = previousTop;
	syncMidiScroll(ui);
	ui.midiZoomIn.disabled = state.midiZoom >= MIDI_MAX_ZOOM;
	ui.midiZoomOut.disabled = state.midiZoom <= MIDI_MIN_ZOOM;
	updateMidiTransport(ui, state);
	syncMidiPlayhead(ui, state);
};


const getMidiElements = () => ({
	midiFile: document.querySelector("#midi-file"),
	midiStatus: document.querySelector("#midi-status"),
	midiWorkspace: document.querySelector("#midi-workspace"),
	midiEmpty: document.querySelector("#midi-empty"),
	midiView: document.querySelector("#midi-view"),
	midiTracks: document.querySelector("#midi-tracks"),
	midiTrackList: document.querySelector("#midi-track-list"),
	midiRibbon: document.querySelector("#midi-ribbon"),
	midiRibbonInner: document.querySelector("#midi-ribbon-inner"),
	midiAxis: document.querySelector("#midi-axis"),
	midiRollScroll: document.querySelector("#midi-roll-scroll"),
	midiRollContent: document.querySelector("#midi-roll-content"),
	midiAxisInner: document.querySelector("#midi-axis-inner"),
	midiDetail: document.querySelector("#midi-detail"),
	midiZoom: document.querySelector("#midi-zoom"),
	midiZoomIn: document.querySelector("#midi-zoom-in"),
	midiZoomOut: document.querySelector("#midi-zoom-out"),
	midiPlay: document.querySelector("#midi-play"),
	midiPlayLabel: document.querySelector("#midi-play .midi-transport__label"),
	midiPlayIconPlay: document.querySelector(".midi-transport__icon--play"),
	midiPlayIconPause: document.querySelector(".midi-transport__icon--pause"),
	midiStop: document.querySelector("#midi-stop"),
	midiTime: document.querySelector("#midi-time"),
	midiTempo: document.querySelector("#midi-tempo"),
	midiTempoValue: document.querySelector("#midi-tempo-value"),
});

export const createMidiPanel = (state) => {
	const ui = getMidiElements();
	state.midiAutoKey = true;
	state.midiMelodyTrack = null;
	const controls = document.createElement("div");
	controls.className = "midi-harmony-controls";
	const autoLabel = document.createElement("label");
	const auto = document.createElement("input");
	auto.type = "checkbox";
	auto.checked = true;
	const autoText = document.createElement("span");
	autoText.dataset.i18n = "midi.harmony.autoKey";
	autoText.textContent = t("midi.harmony.autoKey");
	autoLabel.append(auto, autoText);
	const melodyLabel = document.createElement("label");
	const melodyText = document.createElement("span");
	melodyText.dataset.i18n = "midi.harmony.melody";
	melodyText.textContent = t("midi.harmony.melody");
	const melodySelect = document.createElement("select");
	melodySelect.id = "midi-melody-track";
	melodyLabel.append(melodyText, melodySelect);
	controls.append(autoLabel, melodyLabel);
	ui.midiTracks.before(controls);
	auto.addEventListener("change", () => { state.midiAutoKey = auto.checked; refreshMidiView(); });
	melodySelect.addEventListener("change", () => { state.midiMelodyTrack = melodySelect.value === "" ? null : Number(melodySelect.value); refreshMidiView(); });

	const setMidiStatus = (message, isError = false) => {
		ui.midiStatus.textContent = message;
		ui.midiStatus.classList.toggle("midi-status--error", isError);
	};

	const refreshMidiView = (stopPlayback = false) => {
		if (!state.midiSource) return;
		if (stopPlayback) stopMidiPlayback(ui, state);
		const keyDefinition = getKeyDefinition(state.keyRoot, state.keyMode);
		const view = filterMidiView(
			state.midiSource,
			state.midiEnabledTracks,
			keyDefinition,
			state.midiMelodyTrack,
		);
		state.midi = view;
		if (!view.segments.some((segment) => segment.id === state.midiSelectedId)) {
			state.midiSelectedId = view.segments[0]?.id ?? null;
		}
		renderMidiTracks(ui, state);
		renderMidiView(ui, state, keyDefinition);
		const chordCount = view.segments.filter(
			(segment) => !segment.arpeggio,
		).length;
		const arpeggioCount = view.segments.length - chordCount;
		const summary = {
			name: view.sourceName,
			bars: view.bars.length,
			chords: chordCount,
			arpeggios: arpeggioCount,
			notes: view.notes.length,
			beat: `${view.timeSignature[0]}/${view.timeSignature[1]}`,
		};
		setMidiStatus(
			t(
				arpeggioCount
					? "midi.status.summaryArpeggio"
					: "midi.status.summary",
				summary,
			),
		);
	};

	const loadMidiFile = async (file) => {
		if (!file || state.midiLoading) return;
		state.midiLoading = true;
		setMidiStatus(t("midi.status.reading", { name: file.name }));
		try {
			const source = await parseMidiFile(
				file,
				getKeyDefinition(state.keyRoot, state.keyMode),
			);
			if (!source.tracks.length) {
				throw new MidiFileError(t("midi.status.noTracks"));
			}
			state.midiSource = source;
			state.midiMelodyTrack = suggestMelodyTrack(source.notes);
			const none = document.createElement("option");
			none.value = "";
			none.textContent = t("midi.harmony.none");
			melodySelect.replaceChildren(none, ...source.tracks.map((track) => {
				const option = document.createElement("option");
				option.value = String(track.index); option.textContent = track.name;
				return option;
			}));
			melodySelect.value = state.midiMelodyTrack === null ? "" : String(state.midiMelodyTrack);
			state.midiFile = file;
			state.midiEnabledTracks = new Set(
				source.tracks.map((track) => track.index),
			);
			state.midiSelectedId = null;
			state.midiZoom = 1;
			ui.midiRollScroll.scrollLeft = 0;
			ui.midiRollScroll.scrollTop = 0;
			refreshMidiView(true);
		} catch (error) {
			setMidiStatus(
				error instanceof MidiFileError
					? error.message
					: t("midi.status.readError"),
				true,
			);
		} finally {
			state.midiLoading = false;
		}
	};

	ui.midiFile.addEventListener("change", (event) => {
		const file = event.target.files?.[0];
		event.target.value = "";
		if (file) loadMidiFile(file);
	});

	ui.midiEmpty.addEventListener("click", (event) => {
		if (event.target.closest("[data-midi-open]")) ui.midiFile.click();
	});

	let dragDepth = 0;
	ui.midiWorkspace.addEventListener("dragenter", (event) => {
		event.preventDefault();
		dragDepth += 1;
		ui.midiWorkspace.classList.add("is-dragging");
	});
	ui.midiWorkspace.addEventListener("dragover", (event) => {
		event.preventDefault();
		if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
	});
	ui.midiWorkspace.addEventListener("dragleave", () => {
		dragDepth = Math.max(0, dragDepth - 1);
		if (!dragDepth) ui.midiWorkspace.classList.remove("is-dragging");
	});
	ui.midiWorkspace.addEventListener("drop", (event) => {
		event.preventDefault();
		dragDepth = 0;
		ui.midiWorkspace.classList.remove("is-dragging");
		const file = event.dataTransfer?.files?.[0];
		if (file) loadMidiFile(file);
	});

	ui.midiTrackList.addEventListener("click", (event) => {
		const button = event.target.closest(
			"button[data-track-index], button[data-midi-all]",
		);
		if (!button || !state.midiSource) return;
		const allTracks = state.midiSource.tracks.map((track) => track.index);
		let enabled = new Set(state.midiEnabledTracks);
		if (button.dataset.midiAll) {
			enabled = new Set(allTracks);
		} else {
			const trackIndex = Number(button.dataset.trackIndex);
			if (event.shiftKey) {
				if (enabled.has(trackIndex)) enabled.delete(trackIndex);
				else enabled.add(trackIndex);
				if (!enabled.size) enabled = new Set(allTracks);
			} else {
				const soloed = enabled.size === 1 && enabled.has(trackIndex);
				enabled = soloed ? new Set(allTracks) : new Set([trackIndex]);
			}
		}
		state.midiEnabledTracks = enabled;
		refreshMidiView(true);
		const selector = button.dataset.midiAll
			? "[data-midi-all]"
			: `[data-track-index="${button.dataset.trackIndex}"]`;
		ui.midiTrackList.querySelector(selector)?.focus();
	});

	ui.midiRibbonInner.addEventListener("click", (event) => {
		const button = event.target.closest("button[data-segment-id]");
		if (!button || !state.midi) return;
		state.midiSelectedId = button.dataset.segmentId;
		renderMidiView(ui, state, getKeyDefinition(state.keyRoot, state.keyMode));
		const segment = state.midi.segments.find(
			(item) => item.id === state.midiSelectedId,
		);
		if (segment) {
			const left = MIDI_PADDING + segment.startTime * state.midiPixelsPerSecond;
			const right =
				left +
				Math.max(
					2,
					(segment.endTime - segment.startTime) * state.midiPixelsPerSecond,
				);
			const scroll = ui.midiRollScroll;
			if (
				left < scroll.scrollLeft ||
				right > scroll.scrollLeft + scroll.clientWidth
			) {
				scroll.scrollLeft = Math.max(0, left - 24);
				syncMidiScroll(ui);
			}
		}
		ui.midiRibbonInner
			.querySelector(`[data-segment-id="${state.midiSelectedId}"]`)
			?.focus({ preventScroll: true });
	});

	const zoom = (delta) => {
		if (!state.midi) return;
		state.midiZoom = clamp(state.midiZoom + delta, MIDI_MIN_ZOOM, MIDI_MAX_ZOOM);
		renderMidiView(ui, state, getKeyDefinition(state.keyRoot, state.keyMode));
	};
	ui.midiZoomIn.addEventListener("click", () => zoom(0.5));
	ui.midiZoomOut.addEventListener("click", () => zoom(-0.5));

	ui.midiPlay.addEventListener("click", async () => {
		if (state.midiPlayback.playing) {
			pauseMidiPlayback(ui, state);
			return;
		}
		await startMidiPlayback(ui, state);
	});

	ui.midiStop.addEventListener("click", () => stopMidiPlayback(ui, state));

	ui.midiTempo.addEventListener("input", () => {
		ui.midiTempoValue.textContent = `${ui.midiTempo.value}%`;
	});

	ui.midiTempo.addEventListener("change", async () => {
		if (!state.midiPlayback.playing) return;
		pauseMidiPlayback(ui, state);
		await startMidiPlayback(ui, state);
	});

	ui.midiRollScroll.addEventListener("scroll", () => syncMidiScroll(ui), {
		passive: true,
	});

	let lastRollWidth = ui.midiRollScroll.clientWidth;
	new ResizeObserver((entries) => {
		const width = entries[0]?.contentRect.width ?? 0;
		if (!state.midi || width === 0 || width === lastRollWidth) return;
		lastRollWidth = width;
		renderMidiView(ui, state, getKeyDefinition(state.keyRoot, state.keyMode));
	}).observe(ui.midiRollScroll);

	window.addEventListener("langChange", () => {
		if (!state.midi) return;
		renderMidiTracks(ui, state);
		renderMidiView(ui, state, getKeyDefinition(state.keyRoot, state.keyMode));
		updateMidiTransport(ui, state);
		if (state.midiSource) refreshMidiView(false);
	});

	updateMidiTransport(ui, state);

	return {
		refresh: refreshMidiView,
		pause: () => pauseMidiPlayback(ui, state),
		show: () =>
			state.midi &&
			renderMidiView(ui, state, getKeyDefinition(state.keyRoot, state.keyMode)),
	};
};
