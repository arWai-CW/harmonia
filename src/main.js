import { createStorage, createState, persistState } from "./state.js";
import { renderHistory, renderProgression } from "./renderer.js";
import { bindEvents } from "./events.js";
import { initSortable } from "./drag-utils.js";
import { initWindowManager } from "./window-manager.js";

const getUiElements = () => ({
	input: document.querySelector("#chord-input"),
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
	sidebarBackdrop: document.querySelector("#sidebar-backdrop"),
	fabOpenProgression: document.querySelector("#fab-open-progression"),
});

const init = () => {
	const ui = getUiElements();
	const storage = createStorage(window.localStorage);
	const state = createState(storage);

	const { updateChord, setModeToggle, setInputModeToggle, populateRootSelect } = bindEvents(ui, state, storage);

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

	initWindowManager();
};

init();
