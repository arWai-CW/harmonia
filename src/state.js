export const STORAGE_KEYS = {
	PROGRESSION: "harmonia.progression",
	PROGRESSION_HISTORY: "harmonia.progressionHistory",
	KEY_ROOT: "harmonia.keyRoot",
	KEY_MODE: "harmonia.keyMode",
	INPUT_MODE: "harmonia.inputMode",
	MIDI_FOLLOW_PLAYHEAD: "harmonia.midiFollowPlayhead",
};

export const createStorage = (backend) => ({
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

export const createState = (storage) => ({
	currentChord: null,
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
	midiFollowPlayhead: storage.load(STORAGE_KEYS.MIDI_FOLLOW_PLAYHEAD, true),
	midiLoading: false,
	midiPixelsPerSecond: 60,
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

let pendingPersistTimeout = null;
let pendingState = null;

const flushPersist = () => {
	if (!pendingState) return;
	const { storage, state } = pendingState;
	pendingState = null;
	storage.save(STORAGE_KEYS.PROGRESSION, state.progression);
	storage.save(STORAGE_KEYS.PROGRESSION_HISTORY, state.progressionHistory);
	storage.save(STORAGE_KEYS.KEY_ROOT, state.keyRoot);
	storage.save(STORAGE_KEYS.KEY_MODE, state.keyMode);
	storage.save(STORAGE_KEYS.MIDI_FOLLOW_PLAYHEAD, state.midiFollowPlayhead);
};

export const persistState = (storage, state) => {
	pendingState = { storage, state };
	if (pendingPersistTimeout) {
		clearTimeout(pendingPersistTimeout);
	}
	pendingPersistTimeout = setTimeout(flushPersist, 150);
};

export const persistStateImmediate = (storage, state) => {
	if (pendingPersistTimeout) {
		clearTimeout(pendingPersistTimeout);
		pendingPersistTimeout = null;
	}
	pendingState = null;
	storage.save(STORAGE_KEYS.PROGRESSION, state.progression);
	storage.save(STORAGE_KEYS.PROGRESSION_HISTORY, state.progressionHistory);
	storage.save(STORAGE_KEYS.KEY_ROOT, state.keyRoot);
	storage.save(STORAGE_KEYS.KEY_MODE, state.keyMode);
	storage.save(STORAGE_KEYS.MIDI_FOLLOW_PLAYHEAD, state.midiFollowPlayhead);
};
