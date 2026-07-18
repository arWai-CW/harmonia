import {
	MAJOR_ROOTS,
	MINOR_ROOTS,
	getKeyDefinition,
	parseNotesInput,
	isValidNote,
	sanitizeChordInput,
	spellNotesInKey,
	spellNotesWithOctaveInKey,
	shouldSuggestEnharmonic,
	detectInputType,
} from "./chord-utils.js";
import { analyzeChordFunction } from "./chord-function.js";
import { persistState } from "./state.js";
import {
	renderProgression,
	renderChord,
	renderDetectedChords,
} from "./renderer.js";
import { Chord } from "tonal";

const moveToggleSlider = (slider, activeButton) => {
	if (!slider || !activeButton) return;
	const container = activeButton.parentElement;
	const buttons = container.querySelectorAll(".mode-toggle__button, .input-mode-toggle__button");
	const index = Array.from(buttons).indexOf(activeButton);
	slider.style.transform = `translateX(${index * 100}%)`;
};

const setModeToggle = (ui, mode) => {
	const isMajor = mode === "major";
	ui.modeMajor.classList.toggle("is-active", isMajor);
	ui.modeMinor.classList.toggle("is-active", !isMajor);
	ui.modeMajor.setAttribute("aria-pressed", String(isMajor));
	ui.modeMinor.setAttribute("aria-pressed", String(!isMajor));
	moveToggleSlider(ui.modeToggleSlider, isMajor ? ui.modeMajor : ui.modeMinor);
};

const setInputModeToggle = (ui, mode) => {
	ui.modeChord.classList.toggle("is-active", mode === "chord");
	ui.modeNotes.classList.toggle("is-active", mode === "notes");
	ui.modeChord.setAttribute("aria-pressed", String(mode === "chord"));
	ui.modeNotes.setAttribute("aria-pressed", String(mode === "notes"));
	moveToggleSlider(ui.inputModeToggleSlider, mode === "chord" ? ui.modeChord : ui.modeNotes);
	
	if (mode === "chord") {
		ui.inputLabel.textContent = "和弦代號";
		ui.input.placeholder = "例如：Cmaj7、F#m7b5、Bb13";
	} else {
		ui.inputLabel.textContent = "組成音";
		ui.input.placeholder = "例如：C E G、D F# A";
	}
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
};

const addProgressionItem = (storage, ui, state) => {
	if (!state.currentChord) {
		return;
	}
	state.progression.push(state.currentChord.symbol);
	persistState(storage, state);
	renderProgression(ui, state, storage);
};

const saveProgression = (storage, ui, state) => {
	if (!state.progression.length) {
		return;
	}
	state.progressionHistory.unshift([...state.progression]);
	state.progressionHistory = state.progressionHistory.slice(0, 20);
	persistState(storage, state);
	renderProgression(ui, state, storage);
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
		ui.floatingWindow.style.display = "none";
	}
};

const toggleSidebar = (ui) => {
	if (ui.floatingWindow?.classList.contains("open")) {
		closeSidebar(ui);
	} else {
		openSidebar(ui);
	}
};

export const bindEvents = (ui, state, storage) => {
	ui.input.addEventListener("input", () => updateChord(ui, state, storage));
	ui.keyRoot.addEventListener("change", () => {
		state.keyRoot = ui.keyRoot.value;
		state.displaySymbol = null;
		persistState(storage, state);
		updateChord(ui, state, storage);
		renderProgression(ui, state, storage);
	});
	ui.modeMajor.addEventListener("click", () => {
		if (state.keyMode === "major") {
			return;
		}
		state.keyMode = "major";
		state.displaySymbol = null;
		setModeToggle(ui, state.keyMode);
		populateRootSelect(ui, state, state.keyMode);
		persistState(storage, state);
		updateChord(ui, state, storage);
		renderProgression(ui, state, storage);
	});
	ui.modeMinor.addEventListener("click", () => {
		if (state.keyMode === "minor") {
			return;
		}
		state.keyMode = "minor";
		state.displaySymbol = null;
		setModeToggle(ui, state.keyMode);
		populateRootSelect(ui, state, state.keyMode);
		persistState(storage, state);
		updateChord(ui, state, storage);
		renderProgression(ui, state, storage);
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

	ui.progressionAdd.forEach((btn) => btn.addEventListener("click", () => addProgressionItem(storage, ui, state)));
	ui.progressionClear.forEach((btn) =>
		btn.addEventListener("click", () => {
			state.progression = [];
			persistState(storage, state);
			renderProgression(ui, state, storage);
		}),
	);
	ui.progressionSave.forEach((btn) => btn.addEventListener("click", () => saveProgression(storage, ui, state)));

	ui.progressionHistory.forEach((container) => {
		bindRemoveHandler(container, (index) => {
			state.progressionHistory.splice(index, 1);
			persistState(storage, state);
			renderProgression(ui, state, storage);
		});
	});

	ui.fabOpenProgression?.addEventListener("click", () => toggleSidebar(ui));
	ui.sidebarClose?.addEventListener("click", () => closeSidebar(ui));
	ui.sidebarBackdrop?.addEventListener("click", () => closeSidebar(ui));
	window.addEventListener("keydown", (e) => {
		if (e.key === "Escape" && !ui.sidebarBackdrop.classList.contains("hidden")) {
			closeSidebar(ui);
		}
	});

	return {
		updateChord,
		setModeToggle,
		setInputModeToggle,
		populateRootSelect,
	};
};
