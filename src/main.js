import { Chord, Note } from "tonal";
import abcjs from "abcjs";
import {
	MAJOR_ROOTS,
	MINOR_ROOTS,
	buildAbcChord,
	getKeyDefinition,
	isValidNote,
	parseNotesInput,
	sanitizeChordInput,
	shouldSuggestEnharmonic,
	spellNotesInKey,
	spellNotesWithOctaveInKey,
	stripOctave,
	toAbcKey,
} from "./chord-utils.js";
import { analyzeChordFunction } from "./chord-function.js";
import { initSortable } from "./drag-utils.js";
import { MidiFileError, filterMidiView, getBaseTriad, parseMidiFile } from "./midi-utils.js";

const STORAGE_KEYS = {
	HISTORY: "harmonia.history",
	PROGRESSION: "harmonia.progression",
	PROGRESSION_HISTORY: "harmonia.progressionHistory",
	KEY_ROOT: "harmonia.keyRoot",
	KEY_MODE: "harmonia.keyMode",
	INPUT_MODE: "harmonia.inputMode",
};

const createStorage = (backend) => ({
	load(key, fallback) {
		try {
			const raw = backend.getItem(key);
			if (!raw) {
				return fallback;
			}
			const parsed = JSON.parse(raw);
			return parsed ?? fallback;
		} catch {
			return fallback;
		}
	},
	save(key, value) {
		backend.setItem(key, JSON.stringify(value));
	},
});

const createState = (storage) => ({
	currentChord: null,
	history: storage.load(STORAGE_KEYS.HISTORY, []),
	progression: storage.load(STORAGE_KEYS.PROGRESSION, []),
	progressionHistory: storage.load(STORAGE_KEYS.PROGRESSION_HISTORY, []),
	keyRoot: storage.load(STORAGE_KEYS.KEY_ROOT, "C"),
	keyMode: storage.load(STORAGE_KEYS.KEY_MODE, "major"),
	inputMode: storage.load(STORAGE_KEYS.INPUT_MODE, "chord"),
	displaySymbol: null,
	midi: null,
	midiSource: null,
	midiFile: null,
	midiEnabledTracks: new Set(),
	midiSelectedId: null,
	midiZoom: 1,
	midiPixelsPerSecond: 60,
	midiLoading: false,
	midiPlayback: {
		audioContext: null,
		master: null,
		nodes: new Set(),
		timer: 0,
		frame: 0,
		playing: false,
		offset: 0,
		startedAt: 0,
		rate: 1,
		cursor: 0,
		playheadRibbon: null,
		playheadRoll: null,
	},
});

const getUiElements = () => ({
	input: document.querySelector("#chord-input"),
	tabChord: document.querySelector("#tab-chord"),
	tabMidi: document.querySelector("#tab-midi"),
	panelChord: document.querySelector("#panel-chord"),
	panelMidi: document.querySelector("#panel-midi"),
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
	keyRoot: document.querySelector("#key-root"),
	modeMajor: document.querySelector("#mode-major"),
	modeMinor: document.querySelector("#mode-minor"),
	modeChord: document.querySelector("#mode-chord"),
	modeNotes: document.querySelector("#mode-notes"),
	chordOutput: document.querySelector("#chordOutput"),
	paper: document.querySelector("#paper"),
	historyButtons: document.querySelector("#historyButtons"),
	historyAdd: document.querySelector("#history-add"),
	historyClear: document.querySelector("#history-clear"),
	progressionAdd: document.querySelectorAll("#progression-add, #progression-add-modal"),
	progressionClear: document.querySelectorAll("#progression-clear, #progression-clear-modal"),
	progressionSave: document.querySelectorAll("#progression-save, #progression-save-modal"),
	progressionCurrent: document.querySelectorAll("#progressionCurrent"),
	progressionHistory: document.querySelectorAll("#progressionHistory"),
	floatingWindow: document.querySelector("#progression-floating-window"),
	sidebarClose: document.querySelector("#sidebar-close"),
	fabOpenProgression: document.querySelector("#fab-open-progression"),
});

const setModeToggle = (ui, mode) => {
	const isMajor = mode === "major";
	ui.modeMajor.classList.toggle("is-active", isMajor);
	ui.modeMinor.classList.toggle("is-active", !isMajor);
	ui.modeMajor.setAttribute("aria-pressed", String(isMajor));
	ui.modeMinor.setAttribute("aria-pressed", String(!isMajor));
};

const setInputModeToggle = (ui, mode) => {
	ui.modeChord.classList.toggle("is-active", mode === "chord");
	ui.modeNotes.classList.toggle("is-active", mode === "notes");
	ui.modeChord.setAttribute("aria-pressed", String(mode === "chord"));
	ui.modeNotes.setAttribute("aria-pressed", String(mode === "notes"));
};

const detectInputType = (input) => {
	// 直接解析原始輸入，不要先使用 sanitizeChordInput（會移除空格）
	const notes = parseNotesInput(input);
	const validNotes = notes.filter(isValidNote);
	if (validNotes.length >= 3) {
		return "notes";
	}
	return "chord";
};

const populateRootSelect = (ui, state, mode) => {
	const roots = mode === "minor" ? MINOR_ROOTS : MAJOR_ROOTS;
	ui.keyRoot.innerHTML = "";
	roots.forEach((root) => {
		const option = document.createElement("option");
		option.value = root;
		option.textContent = root;
		ui.keyRoot.appendChild(option);
	});
	if (roots.includes(state.keyRoot)) {
		ui.keyRoot.value = state.keyRoot;
	} else {
		ui.keyRoot.value = roots[0];
		state.keyRoot = roots[0];
	}
};

const renderEmptyState = (container, message) => {
	container.innerHTML = "";
	const empty = document.createElement("p");
	empty.className = "empty-state";
	empty.textContent = message;
	container.appendChild(empty);
};

const renderHistory = (ui, state) => {
	// 渲染歷史按鈕
	if (!state.history.length) {
		ui.historyButtons.innerHTML = "";
		return;
	}

	// 更新按鈕容器
	ui.historyButtons.innerHTML = "";
	state.history.forEach((item, index) => {
		const button = document.createElement("button");
		button.className = "history-button";
		button.type = "button";
		button.dataset.index = String(index);
		button.textContent = item;
		ui.historyButtons.appendChild(button);
	});
};

const renderProgression = (ui, state) => {
	// Get current key definition for chord function analysis
	const keyDefinition = getKeyDefinition(state.keyRoot, state.keyMode);

	ui.progressionCurrent.forEach((container) => {
		if (!state.progression.length) {
			renderEmptyState(container, "進程尚未開始。");
		} else {
			container.innerHTML = "";
			state.progression.forEach((chord, index) => {
				const chip = document.createElement("span");
				chip.className = "chip";
				chip.dataset.index = String(index);

				// Analyze chord function
				const chordFunction = analyzeChordFunction(chord, keyDefinition);

				// Add function class for color coding
				if (chordFunction && chordFunction.color) {
					chip.classList.add(`chip--${chordFunction.color}`);
				}

				// Add visual indicator for special chord functions
				if (chordFunction && chordFunction.function === "borrowed") {
					chip.classList.add("chip--borrowed");
				}
				if (chordFunction && chordFunction.function === "secondary-dominant") {
					chip.classList.add("chip--secondary");
				}

				const handle = document.createElement("span");
				handle.className = "drag-handle";
				handle.innerHTML = `
					<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
						<circle cx="9" cy="5" r="1"></circle>
						<circle cx="9" cy="12" r="1"></circle>
						<circle cx="9" cy="19" r="1"></circle>
						<circle cx="15" cy="5" r="1"></circle>
						<circle cx="15" cy="12" r="1"></circle>
						<circle cx="15" cy="19" r="1"></circle>
					</svg>
				`;

				// Create container for chord text and roman numeral
				const contentContainer = document.createElement("span");
				contentContainer.className = "chip-content";

				// Add roman numeral badge if available
				if (chordFunction && chordFunction.roman) {
					const romanBadge = document.createElement("span");
					romanBadge.className = "chip-roman";

					// Add indicator for secondary dominant
					if (chordFunction.function === "secondary-dominant") {
						romanBadge.textContent = "•" + chordFunction.roman;
					} else {
						romanBadge.textContent = chordFunction.roman;
					}

					romanBadge.title = chordFunction.description || chordFunction.function;
					contentContainer.appendChild(romanBadge);
				}

				const text = document.createElement("span");
				text.className = "chip-text";
				const chordData = Chord.get(chord);
				const formattedChord = chordData.tonic + (chordData.aliases[0] || "");
				text.textContent = formattedChord;
				contentContainer.appendChild(text);

				chip.appendChild(handle);
				chip.appendChild(contentContainer);
				container.appendChild(chip);
			});
		}
	});

	ui.progressionHistory.forEach((container) => {
		if (!state.progressionHistory.length) {
			renderEmptyState(container, "還沒有保存的進程。");
			return;
		}

		container.innerHTML = "";
		state.progressionHistory.forEach((progression, index) => {
			const row = document.createElement("div");
			row.className = "list-item list-item--stack";
			row.dataset.index = String(index);

			const handle = document.createElement("span");
			handle.className = "drag-handle drag-handle--list";
			handle.innerHTML = `
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<line x1="8" y1="9" x2="16" y2="9"></line>
					<line x1="8" y1="15" x2="16" y2="15"></line>
				</svg>
			`;

			// Create progressions with chord function badges
			const progressionWithFunctions = progression.map((chord) => {
				const chordFunction = analyzeChordFunction(chord, keyDefinition);
				if (chordFunction && chordFunction.roman) {
					// Return chord with roman numeral in parentheses
					return `${chord} (${chordFunction.roman})`;
				}
				return chord;
			});

			const text = document.createElement("span");
			text.className = "list-item-text";
			text.textContent = progressionWithFunctions.join(" → ");

			const remove = document.createElement("button");
			remove.className = "icon-button";
			remove.type = "button";
			remove.dataset.index = String(index);
			remove.textContent = "移除";

			row.appendChild(handle);
			row.appendChild(text);
			row.appendChild(remove);
			container.appendChild(row);
		});
	});
};

const persistState = (storage, state) => {
	storage.save(STORAGE_KEYS.HISTORY, state.history);
	storage.save(STORAGE_KEYS.PROGRESSION, state.progression);
	storage.save(STORAGE_KEYS.PROGRESSION_HISTORY, state.progressionHistory);
	storage.save(STORAGE_KEYS.KEY_ROOT, state.keyRoot);
	storage.save(STORAGE_KEYS.KEY_MODE, state.keyMode);
};

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

const MIDI_FUNCTION_LABELS = {
	tonic: "主功能",
	subdominant: "下屬功能",
	dominant: "屬功能",
	borrowed: "借用和弦",
	"secondary-dominant": "副屬和弦",
};

const MIDI_ROLE_LABELS = {
	root: "根音",
	guide: "引導音",
	stable: "五度",
	color: "色彩音",
};

const MIDI_ROLE_LEGEND = [
	{ role: "root", label: "根音", color: "#1b1d20" },
	{ role: "guide", label: "3・7 引導", color: "#4f46e5" },
	{ role: "stable", label: "5 支撐", color: "#a1a1aa" },
	{ role: "color", label: "延伸色彩", color: "#b45309" },
];

const MIDI_QUALITY_LABELS = {
	"": "大三和弦",
	m: "小三和弦",
	7: "屬七和弦",
	maj7: "大七和弦",
	m7: "小七和弦",
	m7b5: "半減七和弦",
	dim7: "減七和弦",
	dim: "減三和弦",
	aug: "增三和弦",
	"7b5": "屬七降五",
	"7#5": "屬七增五",
};

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const MIDI_PADDING = 12;
const MIDI_MIN_ZOOM = 1;
const MIDI_MAX_ZOOM = 4;
const MIDI_CHORD_MIN_WIDTH = 44;
const MIDI_CHORD_CHAR_WIDTH = 7.2;
const MIDI_CHORD_TOP = 30;
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
				? "點選上方和弦，查看它的組成。"
				: "沒有找到可辨識的和弦，先確認啟用的分軌。",
		);
		return;
	}

	if (segment.arpeggio) {
		const barIndex = getMidiBarIndex(view.bars, segment.startTime);
		const head = document.createElement("div");
		head.className = "midi-detail__head";

		const titleWrap = document.createElement("div");
		titleWrap.className = "midi-detail__title";
		const symbol = document.createElement("p");
		symbol.className = "midi-detail__symbol";
		symbol.textContent = "分解和弦";
		const meta = document.createElement("p");
		meta.className = "midi-detail__meta";
		meta.textContent = `第 ${barIndex} 小節 · ${formatMidiTime(segment.startTime)}–${formatMidiTime(segment.endTime)} · ${segment.noteIds.length} 個音`;
		titleWrap.append(symbol, meta);

		const chip = document.createElement("span");
		chip.className = "chip midi-detail__chip";
		chip.textContent = "未判定";
		head.append(titleWrap, chip);

		const story = document.createElement("p");
		story.className = "midi-detail__story";
		story.textContent =
			"這些和弦音是先後出現，沒有同時擊發，所以先不判定和弦。對照 piano roll 的音高，再從尾音回頭推測它可能屬於哪個和弦。";

		const tailNote = view.notes.find(
			(note) => note.id === segment.tailNoteId,
		);
		const tail = document.createElement("p");
		tail.className = "midi-detail__tail";
		if (tailNote) {
			const label = document.createElement("span");
			label.className = "midi-detail__label";
			label.textContent = "尾音";
			const value = document.createElement("span");
			value.textContent = `${midiNoteName(tailNote.midi, keyDefinition)}（僅供參考）`;
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
	symbol.textContent = chord.symbol === "?" ? "無法判讀" : chord.symbol;

	const meta = document.createElement("p");
	meta.className = "midi-detail__meta";
	meta.textContent = `第 ${barIndex} 小節 · ${formatMidiTime(segment.startTime)}–${formatMidiTime(segment.endTime)} · ${segment.pitchClasses.length} 個音`;
	titleWrap.append(symbol, meta);

	const chip = document.createElement("span");
	chip.className = `chip midi-detail__chip${chordFunction?.color ? ` chip--${chordFunction.color}` : ""}${chordFunction?.function === "borrowed" ? " chip--borrowed" : ""}`;
	const roman = document.createElement("span");
	roman.className = "midi-detail__roman";
	roman.textContent = chordFunction?.roman ?? "";
	const functionLabel = document.createElement("span");
	functionLabel.textContent = chordFunction
		? MIDI_FUNCTION_LABELS[chordFunction.function] ?? "調外"
		: "調外和弦";
	if (chordFunction?.roman) {
		chip.append(roman, functionLabel);
	} else {
		chip.append(functionLabel);
	}
	chip.title =
		chordFunction?.description ??
		(chordFunction ? `${chordFunction.roman}（${functionLabel.textContent}）` : "不在目前調內");
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
		story.textContent =
			"這組音不在目前的辨識表裡。先看下面每個音的音名與級數，找出它的根音與三度。";
	} else if (chord.skeleton && extensionNames) {
		story.textContent = `先抓 ${chord.skeleton.symbol} 當骨架，再加上 ${extensionNames}。`;
	} else if (chord.skeleton) {
		story.textContent = `骨架是 ${chord.skeleton.symbol}（${MIDI_QUALITY_LABELS[chord.skeleton.suffix] ?? "和弦"}），沒有額外的延伸音。`;
	} else {
		story.textContent = "這個和弦沒有明確的三度，先聽它的聲響，再對照音名。";
	}

	const legend = document.createElement("div");
	legend.className = "midi-legend";
	MIDI_ROLE_LEGEND.forEach(({ label, color }) => {
		const item = document.createElement("span");
		item.className = "midi-legend__item";
		const dot = document.createElement("span");
		dot.className = "midi-legend__dot";
		dot.style.backgroundColor = color;
		const text = document.createElement("span");
		text.textContent = label;
		item.append(dot, text);
		legend.append(item);
	});

	const tones = document.createElement("div");
	tones.className = "midi-tones";
	chord.tones.forEach((tone) => {
		const item = document.createElement("span");
		item.className = `midi-tone midi-tone--${tone.role}`;
		item.title = `${MIDI_ROLE_LABELS[tone.role] ?? "和弦音"} · ${tone.degree}`;
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
		label.textContent = "基礎";
		const value = document.createElement("span");
		value.textContent = `${baseTriad.symbol}（${baseTriad.tones.map((tone) => tone.name).join("–")}）`;
		base.append(label, value);
	}

	const skeleton = document.createElement("p");
	skeleton.className = "midi-detail__skeleton";
	if (chord.skeleton) {
		const label = document.createElement("span");
		label.className = "midi-detail__label";
		label.textContent = "骨架";
		const value = document.createElement("span");
		value.textContent = `${chord.skeleton.symbol}（${MIDI_QUALITY_LABELS[chord.skeleton.suffix] ?? chord.skeleton.suffix}）`;
		skeleton.append(label, value);
		if (chord.omitted.length) {
			const omitted = document.createElement("span");
			omitted.className = "midi-detail__omitted";
			omitted.textContent = `省略 ${chord.omitted.map((item) => `${item.degree}（${item.name}）`).join("、")}`;
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
		button.title = `${track.name}：${enabled ? "點擊只聽這一軌，Shift + 點擊可多選" : "點擊加入這一軌"}`;

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
		count.textContent = `${track.noteCount} 音`;
		button.append(dot, name, count);
		return button;
	});

	if (state.midiSource.tracks.length > 1) {
		const all = document.createElement("button");
		all.type = "button";
		all.className = "midi-track midi-track--all";
		all.dataset.midiAll = "true";
		all.setAttribute("aria-pressed", String(allEnabled));
		all.textContent = "全部";
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
	ui.midiPlayLabel.textContent = playback.playing ? "暫停" : "播放";
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
		ui.midiPlay.title = "此環境不支援音訊播放";
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
		empty.textContent = "沒有啟用的樂器分軌";
		ui.midiRollContent.append(empty);
		ui.midiRibbonInner.style.width = "100%";
		ui.midiRibbonInner.style.height = "66px";
		state.midiPlayback.playheadRibbon = null;
		state.midiPlayback.playheadRoll = null;
		renderMidiDetailMessage(ui, "沒有啟用的樂器分軌，請從上方重新選取。");
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
	const rowHeight = rollHeight / pitchRange;
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

	const chordBoxes = view.segments.map((segment) => {
		const label = segment.arpeggio ? "分解" : segment.chord.symbol;
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
		const isArpeggio = Boolean(segment.arpeggio);
		const label = isArpeggio ? "分解" : segment.chord.symbol;
		const chordFunction = isArpeggio
			? null
			: analyzeChordFunction(
					segment.chord.symbol,
					keyDefinition,
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
			? `分解和弦 · 未判定 · 第 ${getMidiBarIndex(view.bars, segment.startTime)} 小節`
			: `${segment.chord.symbol} · ${chordFunction?.roman ?? "調外"} · 第 ${getMidiBarIndex(view.bars, segment.startTime)} 小節`;

		const symbol = document.createElement("span");
		symbol.className = "midi-chord__symbol";
		symbol.textContent = label;
		const roman = document.createElement("span");
		roman.className = "midi-chord__roman";
		roman.textContent = isArpeggio ? "未判定" : (chordFunction?.roman ?? "調外");
		button.append(symbol, roman);
		ui.midiRibbonInner.append(button);
	});

	const svg = createSvgElement("svg", {
		viewBox: `0 0 ${contentWidth} ${contentHeight}`,
		width: contentWidth,
		height: contentHeight,
		class: "midi-roll",
		role: "img",
		"aria-label": `${view.sourceName}：${view.notes.length} 個音符，${view.segments.length} 個和弦段落`,
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
			title.textContent = `${midiNoteName(note.midi, keyDefinition)} · ${trackNames.get(note.trackIndex) ?? `分軌 ${note.trackIndex + 1}`}`;
			rect.append(title);
		}
		svg.append(rect);
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

	renderMidiDetail(ui, view, selected, keyDefinition);

	ui.midiRollScroll.scrollLeft = previousLeft;
	ui.midiRollScroll.scrollTop = previousTop;
	syncMidiScroll(ui);
	ui.midiZoomIn.disabled = state.midiZoom >= MIDI_MAX_ZOOM;
	ui.midiZoomOut.disabled = state.midiZoom <= MIDI_MIN_ZOOM;
	updateMidiTransport(ui, state);
	syncMidiPlayhead(ui, state);
};

const buildChordResult = (cleaned, keyDefinition) => {
	if (!cleaned) {
		return { status: "empty" };
	}

	const result = Chord.get(cleaned);
	if (!result.notes || !result.notes.length) {
		return { status: "invalid" };
	}

	const spelledNotes = spellNotesInKey(result.notes, keyDefinition);
	const spelledWithOctave = spellNotesWithOctaveInKey(
		spelledNotes.map((note) => `${note}4`),
		keyDefinition,
	);

	const chordFunction = analyzeChordFunction(cleaned, keyDefinition);
	const enharmonicSuggestion = shouldSuggestEnharmonic(result.tonic, keyDefinition);

	return {
		status: "valid",
		symbol: result.symbol,
		notes: spelledNotes,
		notesWithOctave: spelledWithOctave,
		function: chordFunction,
		enharmonicSuggestion,
	};
};

const renderDetectedChords = (ui, state, storage, detectedChords, keyDefinition) => {
	if (!detectedChords || detectedChords.length === 0) {
		ui.chordOutput.textContent = "找不到對應的和弦，請確認音符是否正確。";
		ui.paper.innerHTML = "";
		return;
	}

	const topChords = detectedChords.slice(0, 3);

	ui.chordOutput.innerHTML = "";
	ui.paper.innerHTML = "";

	const title = document.createElement("p");
	title.textContent = `從音符推測和弦 (${detectedChords.length} 個可能):`;
	title.className = "mb-2 font-medium";
	ui.chordOutput.appendChild(title);

	topChords.forEach((chordName, index) => {
		const chordFunction = analyzeChordFunction(chordName, keyDefinition);
		const resultEl = document.createElement("div");
		resultEl.className = "detected-chord mb-2 cursor-pointer hover:bg-white/10 rounded p-2 transition-colors";
		resultEl.dataset.chord = chordName;

		let html = `<span class="font-bold">${index + 1}. ${chordName}</span>`;

		if (chordFunction) {
			const roman = chordFunction.roman;
			const func = chordFunction.function;
			const color = chordFunction.color;
			html += ` <span class="chip chip--${color} text-xs">${roman} (${func})</span>`;
		}

		resultEl.innerHTML = html;

		resultEl.addEventListener("click", () => {
			ui.input.value = chordName;
			state.inputMode = "chord";
			setInputModeToggle(ui, "chord");
			persistState(storage, state);
			updateChord(ui, state, storage);
		});

		ui.chordOutput.appendChild(resultEl);
	});

	if (detectedChords.length > 3) {
		const more = document.createElement("p");
		more.className = "text-sm text-ink/50 mt-2";
		more.textContent = `還有 ${detectedChords.length - 3} 個其他可能...`;
		ui.chordOutput.appendChild(more);
	}
};

const renderChord = (ui, state, chordResult) => {
	if (chordResult.status === "empty") {
		ui.chordOutput.textContent = "";
		ui.paper.innerHTML = "";
		state.currentChord = null;
		return;
	}

	if (chordResult.status === "invalid") {
		ui.chordOutput.textContent = "找不到對應的和弦，請確認代號是否正確。";
		ui.paper.innerHTML = "";
		state.currentChord = null;
		return;
	}

	state.currentChord = {
		symbol: chordResult.symbol,
		notes: chordResult.notes,
		notesWithOctave: chordResult.notesWithOctave,
		function: chordResult.function,
	};

	const displaySymbol = state.displaySymbol || chordResult.symbol;

	let outputHtml = `<div class="chord-result">`;
	outputHtml += `<div class="chord-symbol">${displaySymbol}</div>`;
	outputHtml += `<div class="chord-notes">組成音：${chordResult.notes.join(" ")}</div>`;

	if (chordResult.function) {
		const roman = chordResult.function.roman;
		const func = chordResult.function.function;
		const color = chordResult.function.color;
		const colorClass = color ? `chip--${color}` : "";
		const romanDisplay = func === "secondary-dominant" ? "•" + roman : roman;

		outputHtml += `<div class="chord-analysis">`;
		outputHtml += `<span class="chip ${colorClass}">${romanDisplay}</span>`;
		outputHtml += `<span class="function-desc">${func}</span>`;
		outputHtml += `</div>`;
	} else {
		outputHtml += `<div class="chord-analysis">非調內和弦</div>`;
	}

	if (chordResult.enharmonicSuggestion?.shouldSuggest) {
		const { current, preferred } = chordResult.enharmonicSuggestion;
		outputHtml += `<div class="enharmonic-suggestion">`;
		outputHtml += `<span class="suggestion-icon">💡</span>`;
		outputHtml += `<span class="suggestion-text">提示：${current} 在此調性中通常記為 ${preferred}</span>`;
		outputHtml += `<button class="enharmonic-switch" data-preferred="${preferred}" data-symbol="${chordResult.symbol}">改用 ${preferred}</button>`;
		outputHtml += `</div>`;
	}

	outputHtml += `</div>`;

	ui.chordOutput.innerHTML = outputHtml;
	ui.paper.innerHTML = "";

	const switchBtn = ui.chordOutput.querySelector(".enharmonic-switch");
	if (switchBtn) {
		switchBtn.addEventListener("click", () => {
			const preferred = switchBtn.dataset.preferred;
			const originalSymbol = switchBtn.dataset.symbol;
			const current = chordResult.enharmonicSuggestion.current;
			const suffix = originalSymbol.slice(current.length);
			const newSymbol = preferred + suffix;
			ui.input.value = newSymbol;
			ui.input.dispatchEvent(new Event("input"));
		});
	}

	if (chordResult.notesWithOctave.length) {
		const abcSyntax = buildAbcChord(chordResult.notesWithOctave);
		const abcKey = toAbcKey(state.keyRoot, state.keyMode);
		const abcText = `X:1\nK:${abcKey}\n${abcSyntax}`;
		abcjs.renderAbc("paper", abcText);
	}
};

// 定時器變數
let inputTimeout = null;

const updateChord = (ui, state, storage) => {
	const input = ui.input.value;
	const keyDefinition = getKeyDefinition(state.keyRoot, state.keyMode);

	const notes = parseNotesInput(input);
	const validNotes = notes.filter(isValidNote);
	const detectedType = detectInputType(input);

	if (detectedType !== state.inputMode && validNotes.length >= 3) {
		state.inputMode = detectedType;
		setInputModeToggle(ui, detectedType);
	}

	state.displaySymbol = null;

	if (state.inputMode === "notes" && validNotes.length >= 2) {
		const detected = Chord.detect(validNotes);
		renderDetectedChords(ui, state, storage, detected, keyDefinition);
		state.currentChord = detected.length > 0 ? { symbol: detected[0] } : null;
	} else {
		const cleaned = sanitizeChordInput(input);
		const chordResult = buildChordResult(cleaned, keyDefinition);
		renderChord(ui, state, chordResult);
	}

	if (inputTimeout) {
		clearTimeout(inputTimeout);
	}
};

const addHistoryItem = (storage, ui, state) => {
	if (!state.currentChord) {
		return;
	}
	state.history.unshift(state.currentChord.symbol);
	state.history = state.history.slice(0, 20);
	persistState(storage, state);
	renderHistory(ui, state);
};

const addProgressionItem = (storage, ui, state) => {
	if (!state.currentChord) {
		return;
	}
	state.progression.push(state.currentChord.symbol);
	persistState(storage, state);
	renderProgression(ui, state);
};

const saveProgression = (storage, ui, state) => {
	if (!state.progression.length) {
		return;
	}
	state.progressionHistory.unshift([...state.progression]);
	state.progressionHistory = state.progressionHistory.slice(0, 20);
	persistState(storage, state);
	renderProgression(ui, state);
};

const bindRemoveHandler = (container, onRemove) => {
	container.addEventListener("click", (event) => {
		const button = event.target.closest("button[data-index]");
		if (!button) {
			return;
		}
		const index = Number(button.dataset.index);
		if (Number.isNaN(index)) {
			return;
		}
		onRemove(index);
	});
};

const openSidebar = (ui) => {
	if (ui.floatingWindow) {
		ui.floatingWindow.style.display = "block";
		void ui.floatingWindow.offsetWidth;
		ui.floatingWindow.classList.add("open");
	}
};

const closeSidebar = (ui) => {
	if (ui.floatingWindow) {
		ui.floatingWindow.classList.remove("open");
		setTimeout(() => {
			ui.floatingWindow.style.display = "none";
		}, 200);
	}
};

const init = () => {
	const ui = getUiElements();
	const storage = createStorage(window.localStorage);
	const state = createState(storage);

	const selectTab = (name) => {
		const isMidi = name === "midi";
		if (!isMidi) pauseMidiPlayback(ui, state);
		ui.tabChord.setAttribute("aria-selected", String(!isMidi));
		ui.tabMidi.setAttribute("aria-selected", String(isMidi));
		ui.tabChord.tabIndex = isMidi ? -1 : 0;
		ui.tabMidi.tabIndex = isMidi ? 0 : -1;
		ui.panelChord.hidden = isMidi;
		ui.panelMidi.hidden = !isMidi;
		(isMidi ? ui.tabMidi : ui.tabChord).focus();
		if (isMidi && state.midi) {
			renderMidiView(
				ui,
				state,
				getKeyDefinition(state.keyRoot, state.keyMode),
			);
		}
	};

	ui.tabChord.addEventListener("click", () => selectTab("chord"));
	ui.tabMidi.addEventListener("click", () => selectTab("midi"));
	[ui.tabChord, ui.tabMidi].forEach((tab, index, tabs) => {
		tab.addEventListener("keydown", (event) => {
			if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
			event.preventDefault();
			const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
			selectTab(next === 0 ? "chord" : "midi");
		});
	});
	const setMidiStatus = (message, isError = false) => {
		ui.midiStatus.textContent = message;
		ui.midiStatus.classList.toggle("midi-status--error", isError);
	};

	const updateMidiStatus = (view) => {
		const chordCount = view.segments.filter(
			(segment) => !segment.arpeggio,
		).length;
		const arpeggioCount = view.segments.length - chordCount;
		setMidiStatus(
			`${view.sourceName} · ${view.bars.length} 小節 · ${chordCount} 個和弦${arpeggioCount ? ` · ${arpeggioCount} 段分解` : ""} · ${view.notes.length} 個音 · ${view.timeSignature[0]}/${view.timeSignature[1]}`,
		);
	};

	const refreshMidiView = (stopPlayback = false) => {
		if (!state.midiSource) return;
		if (stopPlayback) stopMidiPlayback(ui, state);
		const keyDefinition = getKeyDefinition(state.keyRoot, state.keyMode);
		const view = filterMidiView(
			state.midiSource,
			state.midiEnabledTracks,
			keyDefinition,
		);
		state.midi = view;
		if (!view.segments.some((segment) => segment.id === state.midiSelectedId)) {
			state.midiSelectedId = view.segments[0]?.id ?? null;
		}
		renderMidiTracks(ui, state);
		renderMidiView(ui, state, keyDefinition);
		updateMidiStatus(view);
	};

	const loadMidiFile = async (file) => {
		if (!file || state.midiLoading) return;
		state.midiLoading = true;
		setMidiStatus(`正在讀取 ${file.name}…`);
		try {
			const source = await parseMidiFile(
				file,
				getKeyDefinition(state.keyRoot, state.keyMode),
			);
			if (!source.tracks.length) {
				throw new MidiFileError("這個 MIDI 沒有可分析的非鼓分軌。");
			}
			state.midiSource = source;
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
					: "MIDI 讀取失敗，請再試一次。",
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
				enabled = soloed
					? new Set(allTracks)
					: new Set([trackIndex]);
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
		renderMidiView(
			ui,
			state,
			getKeyDefinition(state.keyRoot, state.keyMode),
		);
		const segment = state.midi.segments.find(
			(item) => item.id === state.midiSelectedId,
		);
		if (segment) {
			const left = MIDI_PADDING + segment.startTime * state.midiPixelsPerSecond;
			const right = left + Math.max(2, (segment.endTime - segment.startTime) * state.midiPixelsPerSecond);
			const scroll = ui.midiRollScroll;
			if (left < scroll.scrollLeft || right > scroll.scrollLeft + scroll.clientWidth) {
				scroll.scrollLeft = Math.max(0, left - 24);
				syncMidiScroll(ui);
			}
		}
		ui.midiRibbonInner
			.querySelector(`[data-segment-id="${state.midiSelectedId}"]`)
			?.focus({ preventScroll: true });
	});

	ui.midiZoomIn.addEventListener("click", () => {
		if (!state.midi) return;
		state.midiZoom = clamp(state.midiZoom + 0.5, MIDI_MIN_ZOOM, MIDI_MAX_ZOOM);
		renderMidiView(
			ui,
			state,
			getKeyDefinition(state.keyRoot, state.keyMode),
		);
	});
	ui.midiZoomOut.addEventListener("click", () => {
		if (!state.midi) return;
		state.midiZoom = clamp(state.midiZoom - 0.5, MIDI_MIN_ZOOM, MIDI_MAX_ZOOM);
		renderMidiView(
			ui,
			state,
			getKeyDefinition(state.keyRoot, state.keyMode),
		);
	});

	ui.midiPlay.addEventListener("click", async () => {
		if (state.midiPlayback.playing) {
			pauseMidiPlayback(ui, state);
			return;
		}
		await startMidiPlayback(ui, state);
	});

	ui.midiStop.addEventListener("click", () => {
		stopMidiPlayback(ui, state);
	});

	ui.midiTempo.addEventListener("input", () => {
		ui.midiTempoValue.textContent = `${ui.midiTempo.value}%`;
	});

	ui.midiTempo.addEventListener("change", async () => {
		if (!state.midiPlayback.playing) return;
		pauseMidiPlayback(ui, state);
		await startMidiPlayback(ui, state);
	});

	updateMidiTransport(ui, state);

	ui.midiRollScroll.addEventListener("scroll", () => syncMidiScroll(ui), {
		passive: true,
	});

	let lastRollWidth = ui.midiRollScroll.clientWidth;
	const midiResizeObserver = new ResizeObserver((entries) => {
		const width = entries[0]?.contentRect.width ?? 0;
		if (!state.midi || width === 0 || width === lastRollWidth) return;
		lastRollWidth = width;
		renderMidiView(
			ui,
			state,
			getKeyDefinition(state.keyRoot, state.keyMode),
		);
	});
	midiResizeObserver.observe(ui.midiRollScroll);

	setModeToggle(ui, state.keyMode);
	setInputModeToggle(ui, state.inputMode);
	populateRootSelect(ui, state, state.keyMode);
	renderHistory(ui, state);
	renderProgression(ui, state);
	updateChord(ui, state, storage);

	ui.progressionCurrent.forEach((container) => {
		initSortable(container, {
			onEnd: (evt) => {
				const { oldIndex, newIndex } = evt;
				if (oldIndex === newIndex) return;

				const movedItem = state.progression.splice(oldIndex, 1)[0];
				state.progression.splice(newIndex, 0, movedItem);

				persistState(storage, state);
				renderProgression(ui, state);
			},
		});
	});

	ui.progressionHistory.forEach((container) => {
		initSortable(container, {
			onEnd: (evt) => {
				const { oldIndex, newIndex } = evt;
				if (oldIndex === newIndex) return;

				const movedItem = state.progressionHistory.splice(oldIndex, 1)[0];
				state.progressionHistory.splice(newIndex, 0, movedItem);

				persistState(storage, state);
				renderProgression(ui, state);
			},
		});
	});

	ui.input.addEventListener("input", () => updateChord(ui, state, storage));
	ui.keyRoot.addEventListener("change", async () => {
		state.keyRoot = ui.keyRoot.value;
		state.displaySymbol = null;
		persistState(storage, state);
		updateChord(ui, state, storage);
		renderProgression(ui, state);
		await refreshMidiView(true);
	});
	ui.modeMajor.addEventListener("click", async () => {
		if (state.keyMode === "major") {
			return;
		}
		state.keyMode = "major";
		state.displaySymbol = null;
		setModeToggle(ui, state.keyMode);
		populateRootSelect(ui, state, state.keyMode);
		persistState(storage, state);
		updateChord(ui, state, storage);
		renderProgression(ui, state);
		await refreshMidiView(true);
	});
	ui.modeMinor.addEventListener("click", async () => {
		if (state.keyMode === "minor") {
			return;
		}
		state.keyMode = "minor";
		state.displaySymbol = null;
		setModeToggle(ui, state.keyMode);
		populateRootSelect(ui, state, state.keyMode);
		persistState(storage, state);
		updateChord(ui, state, storage);
		renderProgression(ui, state);
		await refreshMidiView(true);
	});
	ui.modeChord.addEventListener("click", () => {
		if (state.inputMode === "chord") {
			return;
		}
		state.inputMode = "chord";
		setInputModeToggle(ui, "chord");
		persistState(storage, state);
		updateChord(ui, state, storage);
	});
	ui.modeNotes.addEventListener("click", () => {
		if (state.inputMode === "notes") {
			return;
		}
		state.inputMode = "notes";
		setInputModeToggle(ui, "notes");
		persistState(storage, state);
		updateChord(ui, state, storage);
	});
	ui.historyAdd.addEventListener("click", () => addHistoryItem(storage, ui, state));
	ui.historyClear.addEventListener("click", () => {
		state.history = [];
		persistState(storage, state);
		renderHistory(ui, state);
	});

	ui.progressionAdd.forEach((btn) => btn.addEventListener("click", () => addProgressionItem(storage, ui, state)));
	ui.progressionClear.forEach((btn) =>
		btn.addEventListener("click", () => {
			state.progression = [];
			persistState(storage, state);
			renderProgression(ui, state);
		}),
	);
	ui.progressionSave.forEach((btn) => btn.addEventListener("click", () => saveProgression(storage, ui, state)));

	// 為歷史按鈕添加點擊事件，點擊時填入輸入框
	ui.historyButtons.addEventListener("click", (event) => {
		const button = event.target.closest("button.history-button");
		if (!button) return;
		const chord = button.textContent;
		ui.input.value = chord;
		state.displaySymbol = null;
		updateChord(ui, state, storage);
	});

	ui.progressionHistory.forEach((container) => {
		bindRemoveHandler(container, (index) => {
			state.progressionHistory.splice(index, 1);
			persistState(storage, state);
			renderProgression(ui, state);
		});
	});

	ui.fabOpenProgression?.addEventListener("click", () => openSidebar(ui));
	ui.sidebarClose?.addEventListener("click", () => closeSidebar(ui));
	ui.sidebarBackdrop?.addEventListener("click", () => closeSidebar(ui));
	window.addEventListener("keydown", (e) => {
		if (e.key === "Escape" && !ui.sidebarBackdrop.classList.contains("hidden")) {
			closeSidebar(ui);
		}
	});

	// Window state persistence
	const WINDOW_STATE_KEY = "harmonia:windowState";
	const DEFAULT_WINDOW_STATE = {
		x: window.innerWidth - 400,
		y: (window.innerHeight - 480) / 2,
		width: 380,
		height: 480,
	};

	const debounce = (fn, delay) => {
		let timeout;
		return (...args) => {
			clearTimeout(timeout);
			timeout = setTimeout(() => fn(...args), delay);
		};
	};

	const saveWindowState = debounce((state) => {
		try {
			localStorage.setItem(WINDOW_STATE_KEY, JSON.stringify(state));
		} catch (e) {
			console.warn("Failed to save window state:", e);
		}
	}, 300);

	const loadWindowState = () => {
		try {
			const saved = localStorage.getItem(WINDOW_STATE_KEY);
			return saved ? JSON.parse(saved) : DEFAULT_WINDOW_STATE;
		} catch (e) {
			console.warn("Failed to load window state:", e);
			return DEFAULT_WINDOW_STATE;
		}
	};

	const initFloatingWindowDrag = () => {
		const floatingWindow = document.querySelector("#progression-floating-window");
		const header = document.querySelector("#progression-window-header");

		if (!floatingWindow || !header) return;

		let isDragging = false;
		let startX, startY;
		let initialLeft, initialTop;
		let hasConvertedToPx = false;

		const convertPositionToPx = () => {
			if (hasConvertedToPx) return;

			const rect = floatingWindow.getBoundingClientRect();
			const computed = window.getComputedStyle(floatingWindow);

			floatingWindow.style.left = rect.left + "px";
			floatingWindow.style.top = rect.top + "px";
			floatingWindow.style.right = "auto";
			floatingWindow.style.transform = "none";

			hasConvertedToPx = true;
			floatingWindow.dataset.initialRight = computed.getPropertyValue("right").trim();
		};

		const initializeDrag = (e) => {
			if (e.type === "mousedown" && e.button !== 0) return;
			if (e.type === "touchstart") e.preventDefault();

			convertPositionToPx();

			isDragging = true;
			floatingWindow.classList.add("dragging");

			startX = e.type.includes("touch") ? e.touches[0].clientX : e.clientX;
			startY = e.type.includes("touch") ? e.touches[0].clientY : e.clientY;
			initialLeft = floatingWindow.offsetLeft;
			initialTop = floatingWindow.offsetTop;
		};

		const onDrag = (e) => {
			if (!isDragging) return;
			if (e.type === "touchmove") e.preventDefault();

			const deltaX = (e.type.includes("touch") ? e.touches[0].clientX : e.clientX) - startX;
			const deltaY = (e.type.includes("touch") ? e.touches[0].clientY : e.clientY) - startY;

			let newX = initialLeft + deltaX;
			let newY = initialTop + deltaY;

			// Boundary constraints
			const minX = 40 - floatingWindow.offsetWidth;
			const maxX = window.innerWidth - 40;
			const minY = 0;
			const maxY = window.innerHeight - 40;

			newX = Math.max(minX, Math.min(maxX, newX));
			newY = Math.max(minY, Math.min(maxY, newY));

			floatingWindow.style.left = newX + "px";
			floatingWindow.style.top = newY + "px";
		};

		const stopDrag = () => {
			if (!isDragging) return;

			isDragging = false;
			floatingWindow.classList.remove("dragging");

			const rect = floatingWindow.getBoundingClientRect();
			floatingWindow.dataset.lastLeft = rect.left + "px";
			floatingWindow.dataset.lastTop = rect.top + "px";

			saveWindowState({
				x: floatingWindow.offsetLeft,
				y: floatingWindow.offsetTop,
				width: floatingWindow.offsetWidth,
				height: floatingWindow.offsetHeight,
			});
		};

		header.addEventListener("mousedown", initializeDrag);
		header.addEventListener("touchstart", initializeDrag, { passive: false });
		window.addEventListener("mousemove", onDrag);
		window.addEventListener("touchmove", onDrag, { passive: false });
		window.addEventListener("mouseup", stopDrag);
		window.addEventListener("touchend", stopDrag);

		// Load saved window state
		const state = loadWindowState();
		floatingWindow.style.left = state.x + "px";
		floatingWindow.style.top = state.y + "px";
		floatingWindow.style.width = state.width + "px";
		floatingWindow.style.height = state.height + "px";
		floatingWindow.style.right = "auto";
		floatingWindow.style.transform = "none";
		hasConvertedToPx = true;

		// Handle window resize - keep window in bounds
		const constrainWindowBounds = () => {
			const rect = floatingWindow.getBoundingClientRect();
			const minX = 40 - rect.width;
			const maxX = window.innerWidth - 40;
			const minY = 0;
			const maxY = window.innerHeight - 40;

			let newX = rect.left;
			let newY = rect.top;

			newX = Math.max(minX, Math.min(maxX, newX));
			newY = Math.max(minY, Math.min(maxY, newY));

			floatingWindow.style.left = newX + "px";
			floatingWindow.style.top = newY + "px";
		};

		window.addEventListener("resize", constrainWindowBounds);
	};

	initFloatingWindowDrag();

	// Floating window resize logic
	const initFloatingWindowResize = () => {
		const floatingWindow = document.querySelector("#progression-floating-window");
		const resizeHandle = document.querySelector("#progression-resize-handle");

		if (!floatingWindow || !resizeHandle) return;

		let isResizing = false;
		let startX, startY;
		let startWidth, startHeight;

		const MIN_WIDTH = 320;
		const MIN_HEIGHT = 200;

		const getClientX = (e) => (e.type.includes("touch") ? e.touches[0].clientX : e.clientX);
		const getClientY = (e) => (e.type.includes("touch") ? e.touches[0].clientY : e.clientY);

		resizeHandle.addEventListener("mousedown", startResize);
		resizeHandle.addEventListener("touchstart", startResize, { passive: false });

		function startResize(e) {
			isResizing = true;
			floatingWindow.classList.add("resizing");

			startX = getClientX(e);
			startY = getClientY(e);
			startWidth = floatingWindow.offsetWidth;
			startHeight = floatingWindow.offsetHeight;

			e.preventDefault();
		}

		window.addEventListener("mousemove", onResize);
		window.addEventListener("touchmove", onResize, { passive: false });
		window.addEventListener("mouseup", stopResize);
		window.addEventListener("touchend", stopResize);

		function onResize(e) {
			if (!isResizing) return;

			const clientX = getClientX(e);
			const clientY = getClientY(e);

			const deltaX = clientX - startX;
			const deltaY = clientY - startY;

			const newWidth = Math.max(MIN_WIDTH, Math.min(window.innerWidth * 0.9, startWidth + deltaX));
			const newHeight = Math.max(MIN_HEIGHT, Math.min(window.innerHeight * 0.9, startHeight + deltaY));

			floatingWindow.style.width = newWidth + "px";
			floatingWindow.style.height = newHeight + "px";
		}

		function stopResize() {
			isResizing = false;
			floatingWindow.classList.remove("resizing");

			saveWindowState({
				x: floatingWindow.offsetLeft,
				y: floatingWindow.offsetTop,
				width: floatingWindow.offsetWidth,
				height: floatingWindow.offsetHeight,
			});
		}
	};

	// Initialize resize after DOM is ready
	initFloatingWindowResize();
};

init();
