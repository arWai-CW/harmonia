import { Chord } from "tonal";
import abcjs from "abcjs";
import {
	buildAbcChord,
	getKeyDefinition,
	spellNotesInKey,
	spellNotesWithOctaveInKey,
	toAbcKey,
} from "./chord-utils.js";
import { analyzeChordFunction } from "./chord-function.js";
import { persistState } from "./state.js";
import { t } from "./i18n/index.js";

const debounce = (fn, delay) => {
	let timeoutId;
	return (...args) => {
		clearTimeout(timeoutId);
		timeoutId = setTimeout(() => fn(...args), delay);
	};
};

let pendingAbcState = null;

const renderAbcDebounced = debounce(() => {
	if (!pendingAbcState) return;
	const { notesWithOctave, keyRoot, keyMode } = pendingAbcState;
	pendingAbcState = null;

	const abcSyntax = buildAbcChord(notesWithOctave);
	const abcKey = toAbcKey(keyRoot, keyMode);
	const abcText = `X:1\nK:${abcKey}\n${abcSyntax}`;
	abcjs.renderAbc("paper", abcText);
}, 300);

const SVG_DRAG_HANDLE_6_DOTS = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
	<circle cx="9" cy="5" r="1"></circle>
	<circle cx="9" cy="12" r="1"></circle>
	<circle cx="9" cy="19" r="1"></circle>
	<circle cx="15" cy="5" r="1"></circle>
	<circle cx="15" cy="12" r="1"></circle>
	<circle cx="15" cy="19" r="1"></circle>
</svg>`;

const SVG_DRAG_HANDLE_2_LINES = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
	<line x1="8" y1="9" x2="16" y2="9"></line>
	<line x1="8" y1="15" x2="16" y2="15"></line>
</svg>`;

const SVG_LOAD_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
	<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
	<polyline points="7 10 12 15 17 10"></polyline>
	<line x1="12" y1="15" x2="12" y2="3"></line>
</svg>`;

const SVG_REMOVE_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
	<line x1="18" y1="6" x2="6" y2="18"></line>
	<line x1="6" y1="6" x2="18" y2="18"></line>
</svg>`;

const FUNCTION_RECOMMENDATIONS = {
	tonic: "subdominant",
	subdominant: "dominant",
	dominant: "tonic",
};

const FUNCTION_SCALE_DEGREES = {
	tonic: [1, 3, 6],
	subdominant: [2, 4],
	dominant: [5, 7],
};

const chordFunctionCache = new Map();

const getCachedChordFunction = (chord, keyDefinition) => {
	const cacheKey = `${chord}|${keyDefinition.id}|${keyDefinition.mode}`;
	if (chordFunctionCache.has(cacheKey)) {
		return chordFunctionCache.get(cacheKey);
	}
	const result = analyzeChordFunction(chord, keyDefinition);
	chordFunctionCache.set(cacheKey, result);
	return result;
};

// 根據音級生成羅馬數字
const getRomanForDegree = (degree, mode) => {
	const numerals = ["I", "ii", "iii", "IV", "V", "vi", "vii°"];
	if (mode === "minor") {
		const minorNumerals = ["i", "ii°", "III", "iv", "v", "VI", "VII"];
		return minorNumerals[degree - 1] || "";
	}
	return numerals[degree - 1] || "";
};

// 根據音級生成和弦名稱
const getChordForDegree = (degree, keyDefinition) => {
	const { scale, mode } = keyDefinition;
	const root = scale[degree - 1];
	if (!root) return null;

	// 大調音階中各級和弦類型
	const majorChordTypes = ["", "m", "m", "", "", "m", "dim"];
	const minorChordTypes = ["", "dim", "", "m", "m", "", ""];
	const chordTypes = mode === "minor" ? minorChordTypes : majorChordTypes;
	const chordType = chordTypes[degree - 1];

	return root + chordType;
};

// 獲取推薦和弦
const getRecommendedChords = (lastChord, keyDefinition) => {
	if (!lastChord || !keyDefinition) return [];

	const chordFunction = getCachedChordFunction(lastChord, keyDefinition);
	if (!chordFunction || !chordFunction.function) return [];

	const nextFunction = FUNCTION_RECOMMENDATIONS[chordFunction.function];
	if (!nextFunction) return [];

	const degrees = FUNCTION_SCALE_DEGREES[nextFunction];
	return degrees
		.map((degree) => ({
			chord: getChordForDegree(degree, keyDefinition),
			roman: getRomanForDegree(degree, keyDefinition.mode),
			function: nextFunction,
		}))
		.filter((item) => item.chord);
};

const renderEmptyState = (container, message) => {
	container.innerHTML = "";
	const empty = document.createElement("p");
	empty.className = "empty-state";
	empty.textContent = message;
	container.appendChild(empty);
};

const clearPaper = (paper) => {
	paper.innerHTML = "";
	paper.removeAttribute("style");
};

export const renderProgression = (ui, state, storage) => {
	const keyDefinition = getKeyDefinition(state.keyRoot, state.keyMode);

	ui.progressionCurrent.forEach((container) => {
		if (!state.progression.length) {
			renderEmptyState(container, t('progression.empty'));
		} else {
			const fragment = document.createDocumentFragment();
			state.progression.forEach((chord, index) => {
				const chip = document.createElement("span");
				chip.className = "chip";
				chip.dataset.index = String(index);

				const chordFunction = getCachedChordFunction(chord, keyDefinition);

				if (chordFunction && chordFunction.color) {
					chip.classList.add(`chip--${chordFunction.color}`);
				}

				if (chordFunction && chordFunction.function === "borrowed") {
					chip.classList.add("chip--borrowed");
				}
				if (chordFunction && chordFunction.function === "secondary-dominant") {
					chip.classList.add("chip--secondary");
				}

				const handle = document.createElement("span");
				handle.className = "drag-handle";
				handle.innerHTML = SVG_DRAG_HANDLE_6_DOTS;

				const contentContainer = document.createElement("span");
				contentContainer.className = "chip-content";

				if (chordFunction && chordFunction.roman) {
					const romanBadge = document.createElement("span");
					romanBadge.className = "chip-roman";

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

				const removeBtn = document.createElement("button");
				removeBtn.className = "chip-remove";
				removeBtn.innerHTML = "×";
				removeBtn.title = t('actions.remove');
				removeBtn.addEventListener("click", (e) => {
					e.stopPropagation();
					state.progression.splice(index, 1);
					persistState(storage, state);
					renderProgression(ui, state, storage);
				});

				chip.appendChild(handle);
				chip.appendChild(contentContainer);
				chip.appendChild(removeBtn);
				fragment.appendChild(chip);
			});
			container.innerHTML = "";
			container.appendChild(fragment);
		}
	});

	if (ui.progressionRecommendation && ui.recommendationChips) {
		const lastChord = state.progression[state.progression.length - 1];
		const recommendations = getRecommendedChords(lastChord, keyDefinition);

		if (recommendations.length > 0 && state.progression.length > 0) {
			ui.progressionRecommendation.classList.remove("hidden");
			const fragment = document.createDocumentFragment();

			recommendations.forEach((rec) => {
				const recChip = document.createElement("button");
				recChip.className = "chip chip--recommend";
				recChip.dataset.chord = rec.chord;
				recChip.innerHTML = `
					<span class="chip-roman">${rec.roman}</span>
					<span class="chip-text">${rec.chord}</span>
				`;
				recChip.addEventListener("click", () => {
					state.progression.push(rec.chord);
					persistState(storage, state);
					renderProgression(ui, state, storage);
				});
				fragment.appendChild(recChip);
			});
			ui.recommendationChips.innerHTML = "";
			ui.recommendationChips.appendChild(fragment);
		} else {
			ui.progressionRecommendation.classList.add("hidden");
		}
	}

	ui.progressionHistory.forEach((container) => {
		if (!state.progressionHistory.length) {
			renderEmptyState(container, t('progression.emptyHistory'));
			return;
		}

		const fragment = document.createDocumentFragment();
		state.progressionHistory.forEach((progression, index) => {
			const row = document.createElement("div");
			row.className = "list-item";
			row.dataset.index = String(index);

			const handle = document.createElement("span");
			handle.className = "drag-handle drag-handle--list";
			handle.innerHTML = SVG_DRAG_HANDLE_2_LINES;

			const text = document.createElement("div");
			text.className = "list-item-text";

			progression.forEach((chord, i) => {
				if (i > 0) {
					const arrow = document.createElement("span");
					arrow.className = "text-ink/40 mx-1";
					arrow.textContent = "→";
					text.appendChild(arrow);
				}
				const chordFunction = getCachedChordFunction(chord, keyDefinition);
				const chip = document.createElement("span");
				chip.className = "chip chip--light";
				if (chordFunction?.color) {
					chip.classList.add(`chip--${chordFunction.color}`);
				}
				chip.textContent = chord;
				text.appendChild(chip);
			});

			const actions = document.createElement("div");
			actions.className = "list-item-actions";

			const load = document.createElement("button");
			load.className = "icon-button icon-button--icon";
			load.type = "button";
			load.dataset.index = String(index);
			load.dataset.action = "load";
			load.title = t('actions.load');
			load.innerHTML = SVG_LOAD_ICON;

			const remove = document.createElement("button");
			remove.className = "icon-button icon-button--icon";
			remove.type = "button";
			remove.dataset.index = String(index);
			remove.dataset.action = "remove";
			remove.title = t('actions.remove');
			remove.innerHTML = SVG_REMOVE_ICON;

			actions.appendChild(load);
			actions.appendChild(remove);

			row.appendChild(handle);
			row.appendChild(text);
			row.appendChild(actions);
			fragment.appendChild(row);
		});
		container.innerHTML = "";
		container.appendChild(fragment);
	});
};

export const renderDetectedChords = (ui, state, storage, detectedChords, keyDefinition) => {
	if (!detectedChords || detectedChords.length === 0) {
		ui.chordOutput.innerHTML = `<p class="empty-state">${t('chord.notFoundNotes')}</p>`;
		clearPaper(ui.paper);
		return;
	}

	const topChords = detectedChords.slice(0, 3);

	const fragment = document.createDocumentFragment();

	const title = document.createElement("p");
	title.textContent = t('chord.detected', { count: detectedChords.length });
	title.className = "mb-2 font-medium";
	fragment.appendChild(title);

	topChords.forEach((chordName, index) => {
		const chordFunction = getCachedChordFunction(chordName, keyDefinition);
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
			state.displaySymbol = null;
			window.dispatchEvent(new CustomEvent("inputModeChange", { detail: { mode: "chord" } }));
			ui.input.dispatchEvent(new Event("input"));
		});

		fragment.appendChild(resultEl);
	});

	if (detectedChords.length > 3) {
		const more = document.createElement("p");
		more.className = "text-sm text-ink/50 mt-2";
		more.textContent = t('chord.more', { count: detectedChords.length - 3 });
		fragment.appendChild(more);
	}

	ui.chordOutput.innerHTML = "";
	ui.chordOutput.appendChild(fragment);
	clearPaper(ui.paper);
};

const renderEmptyResult = (ui) => {
	ui.chordOutput.innerHTML = `<p class="empty-state">${t('chord.empty')}</p>`;
	clearPaper(ui.paper);
};

export const renderChord = (ui, state, chordResult) => {
	if (chordResult.status === "empty") {
		renderEmptyResult(ui);
		state.currentChord = null;
		return;
	}

	if (chordResult.status === "invalid") {
		ui.chordOutput.innerHTML = `<p class="empty-state">${t('chord.notFound')}</p>`;
		clearPaper(ui.paper);
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
	outputHtml += `<div class="chord-notes">${t('chord.notesLabel')}${chordResult.notes.join(" ")}</div>`;

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
		outputHtml += `<div class="chord-analysis">${t('chord.notInKey')}</div>`;
	}

	if (chordResult.enharmonicSuggestion?.shouldSuggest) {
		const { current, preferred } = chordResult.enharmonicSuggestion;
		outputHtml += `<div class="enharmonic-suggestion">`;
		outputHtml += `<span class="suggestion-icon">💡</span>`;
		outputHtml += `<span class="suggestion-text">${t('chord.enharmonicTip', { current, preferred })}</span>`;
		outputHtml += `<button class="enharmonic-switch" data-preferred="${preferred}" data-symbol="${chordResult.symbol}">${t('chord.useInstead', { preferred })}</button>`;
		outputHtml += `</div>`;
	}

	outputHtml += `</div>`;

	ui.chordOutput.innerHTML = outputHtml;
	clearPaper(ui.paper);

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
		pendingAbcState = {
			notesWithOctave: chordResult.notesWithOctave,
			keyRoot: state.keyRoot,
			keyMode: state.keyMode,
		};
		renderAbcDebounced();
	}
};
