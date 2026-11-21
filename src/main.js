import Sortable from "sortablejs";
import { createStorage, createState, persistState } from "./state.js";
import { renderProgression, renderChord } from "./renderer.js";
import { bindEvents } from "./events.js";
import { initWindowManager } from "./window-manager.js";
import { initI18n, setLang, getLang } from "./i18n/index.js";
import { createMidiPanel } from "./midi-panel.js";

const SORTABLE_DEFAULTS = {
	animation: 150,
	handle: ".drag-handle",
	ghostClass: "drag-ghost",
	chosenClass: "drag-chosen",
	dragClass: "drag-item",
	forceFallback: true,
	fallbackOnBody: true,
	swapThreshold: 0.65,
};

const getUiElements = () => ({
	input: document.querySelector("#chord-input"),
	inputLabel: document.querySelector("#input-label"),
	keyRoot: document.querySelector("#key-root"),
	modeMajor: document.querySelector("#mode-major"),
	modeMinor: document.querySelector("#mode-minor"),
	modeChord: document.querySelector("#mode-chord"),
	modeNotes: document.querySelector("#mode-notes"),
	modeToggleSlider: document.querySelector(".mode-toggle .toggle-slider"),
	inputModeToggleSlider: document.querySelector(".input-mode-toggle .toggle-slider"),
	chordOutput: document.querySelector("#chordOutput"),
	paper: document.querySelector("#paper"),
	progressionAdd: document.querySelectorAll("#progression-add, #progression-add-modal"),
	progressionClear: document.querySelectorAll("#progression-clear, #progression-clear-modal"),
	progressionSave: document.querySelectorAll("#progression-save, #progression-save-modal"),
	progressionCurrent: document.querySelectorAll("#progressionCurrent"),
	progressionHistory: document.querySelectorAll("#progressionHistory"),
	progressionRecommendation: document.querySelector("#progressionRecommendation"),
	recommendationChips: document.querySelector("#recommendationChips"),
	tabChord: document.querySelector("#tab-chord"),
	tabMidi: document.querySelector("#tab-midi"),
	panelChord: document.querySelector("#panel-chord"),
	panelMidi: document.querySelector("#panel-midi"),
	floatingWindow: document.querySelector("#progression-floating-window"),
	sidebarClose: document.querySelector("#sidebar-close"),
	sidebarBackdrop: document.querySelector("#sidebar-backdrop"),
	fabOpenProgression: document.querySelector("#fab-open-progression"),
});

const init = async () => {
	await initI18n();

	const ui = getUiElements();
	const storage = createStorage(window.localStorage);
	const state = createState(storage);

	const midiPanel = createMidiPanel(state);

	const selectTab = (name) => {
		const isMidi = name === "midi";
		if (!isMidi) midiPanel.pause();
		ui.tabChord.setAttribute("aria-selected", String(!isMidi));
		ui.tabMidi.setAttribute("aria-selected", String(isMidi));
		ui.tabChord.tabIndex = isMidi ? -1 : 0;
		ui.tabMidi.tabIndex = isMidi ? 0 : -1;
		ui.panelChord.hidden = isMidi;
		ui.panelMidi.hidden = !isMidi;
		if (isMidi) midiPanel.show();
	};

	ui.tabChord.addEventListener("click", () => selectTab("chord"));
	ui.tabMidi.addEventListener("click", () => selectTab("midi"));
	[ui.tabChord, ui.tabMidi].forEach((tab, index, tabs) => {
		tab.addEventListener("keydown", (event) => {
			if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
			event.preventDefault();
			const next =
				event.key === "Home"
					? 0
					: event.key === "End"
						? tabs.length - 1
						: (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
			const target = next === 0 ? "chord" : "midi";
			selectTab(target);
			(next === 0 ? ui.tabChord : ui.tabMidi).focus();
		});
	});

	const { updateChord, setModeToggle, setInputModeToggle, populateRootSelect } = bindEvents(
		ui,
		state,
		storage,
		{ onKeyChange: () => midiPanel.refresh(true) },
	);

	setModeToggle(ui, state.keyMode);
	setInputModeToggle(ui, state.inputMode);
	populateRootSelect(ui, state, state.keyMode);
	renderProgression(ui, state, storage);
	updateChord(ui, state, storage);

	ui.progressionCurrent.forEach((container) => {
		if (!container) return;
		new Sortable(container, {
			...SORTABLE_DEFAULTS,
			onEnd: (evt) => {
				const { oldIndex, newIndex } = evt;
				if (oldIndex === newIndex) return;

				const movedItem = state.progression.splice(oldIndex, 1)[0];
				state.progression.splice(newIndex, 0, movedItem);

				persistState(storage, state);
				renderProgression(ui, state, storage);
			},
		});
	});

	ui.progressionHistory.forEach((container) => {
		if (!container) return;
		new Sortable(container, {
			...SORTABLE_DEFAULTS,
			onEnd: (evt) => {
				const { oldIndex, newIndex } = evt;
				if (oldIndex === newIndex) return;

				const movedItem = state.progressionHistory.splice(oldIndex, 1)[0];
				state.progressionHistory.splice(newIndex, 0, movedItem);

				persistState(storage, state);
				renderProgression(ui, state, storage);
			},
		});
	});

	initWindowManager(storage);

	const langSelect = document.querySelector("#lang-select");
	if (langSelect) {
		langSelect.value = getLang();
		langSelect.addEventListener("change", (e) => {
			setLang(e.target.value);
		});
	}

	window.addEventListener("langChange", () => {
		setInputModeToggle(ui, state.inputMode);
		renderProgression(ui, state, storage);
		if (state.currentChord) {
			const chordResult = {
				status: "valid",
				symbol: state.currentChord.symbol,
				notes: state.currentChord.notes,
				notesWithOctave: state.currentChord.notesWithOctave,
				function: state.currentChord.function,
			};
			renderChord(ui, state, chordResult);
		}
	});
};

init();
