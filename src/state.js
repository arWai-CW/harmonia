export const STORAGE_KEYS = {
	HISTORY: "harmonia.history",
	PROGRESSION: "harmonia.progression",
	PROGRESSION_HISTORY: "harmonia.progressionHistory",
	KEY_ROOT: "harmonia.keyRoot",
	KEY_MODE: "harmonia.keyMode",
	INPUT_MODE: "harmonia.inputMode",
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
	history: storage.load(STORAGE_KEYS.HISTORY, []),
	progression: storage.load(STORAGE_KEYS.PROGRESSION, []),
	progressionHistory: storage.load(STORAGE_KEYS.PROGRESSION_HISTORY, []),
	keyRoot: storage.load(STORAGE_KEYS.KEY_ROOT, "C"),
	keyMode: storage.load(STORAGE_KEYS.KEY_MODE, "major"),
	inputMode: storage.load(STORAGE_KEYS.INPUT_MODE, "chord"),
	displaySymbol: null,
});

export const persistState = (storage, state) => {
	storage.save(STORAGE_KEYS.HISTORY, state.history);
	storage.save(STORAGE_KEYS.PROGRESSION, state.progression);
	storage.save(STORAGE_KEYS.PROGRESSION_HISTORY, state.progressionHistory);
	storage.save(STORAGE_KEYS.KEY_ROOT, state.keyRoot);
	storage.save(STORAGE_KEYS.KEY_MODE, state.keyMode);
};
