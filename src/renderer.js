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

// 和弦功能推薦：根據當前功能推薦下一個功能
const FUNCTION_RECOMMENDATIONS = {
	tonic: "subdominant",
	subdominant: "dominant",
	dominant: "tonic",
};

// 各功能對應的音級（大調）
const FUNCTION_SCALE_DEGREES = {
	tonic: [1, 3, 6],
	subdominant: [2, 4],
	dominant: [5, 7],
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

	const chordFunction = analyzeChordFunction(lastChord, keyDefinition);
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
			renderEmptyState(container, "進程尚未開始。");
		} else {
			container.innerHTML = "";
			state.progression.forEach((chord, index) => {
				const chip = document.createElement("span");
				chip.className = "chip";
				chip.dataset.index = String(index);

				const chordFunction = analyzeChordFunction(chord, keyDefinition);

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
				removeBtn.title = "移除";
				removeBtn.addEventListener("click", (e) => {
					e.stopPropagation();
					state.progression.splice(index, 1);
					persistState(storage, state);
					renderProgression(ui, state, storage);
				});

				chip.appendChild(handle);
				chip.appendChild(contentContainer);
				chip.appendChild(removeBtn);
				container.appendChild(chip);
			});
		}
	});

	// 推薦下一個和弦
	if (ui.progressionRecommendation && ui.recommendationChips) {
		const lastChord = state.progression[state.progression.length - 1];
		const recommendations = getRecommendedChords(lastChord, keyDefinition);

		if (recommendations.length > 0 && state.progression.length > 0) {
			ui.progressionRecommendation.classList.remove("hidden");
			ui.recommendationChips.innerHTML = "";

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
				ui.recommendationChips.appendChild(recChip);
			});
		} else {
			ui.progressionRecommendation.classList.add("hidden");
		}
	}

	ui.progressionHistory.forEach((container) => {
		if (!state.progressionHistory.length) {
			renderEmptyState(container, "還沒有保存的進程。");
			return;
		}

		container.innerHTML = "";
		state.progressionHistory.forEach((progression, index) => {
			const row = document.createElement("div");
			row.className = "list-item";
			row.dataset.index = String(index);

			const handle = document.createElement("span");
			handle.className = "drag-handle drag-handle--list";
			handle.innerHTML = `
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<line x1="8" y1="9" x2="16" y2="9"></line>
					<line x1="8" y1="15" x2="16" y2="15"></line>
				</svg>
			`;

			const text = document.createElement("div");
			text.className = "list-item-text";

			progression.forEach((chord, i) => {
				if (i > 0) {
					const arrow = document.createElement("span");
					arrow.className = "text-ink/40 mx-1";
					arrow.textContent = "→";
					text.appendChild(arrow);
				}
				const chordFunction = analyzeChordFunction(chord, keyDefinition);
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
			load.title = "載入";
			load.innerHTML = `
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
					<polyline points="7 10 12 15 17 10"></polyline>
					<line x1="12" y1="15" x2="12" y2="3"></line>
				</svg>
			`;

			const remove = document.createElement("button");
			remove.className = "icon-button icon-button--icon";
			remove.type = "button";
			remove.dataset.index = String(index);
			remove.dataset.action = "remove";
			remove.title = "移除";
			remove.innerHTML = `
				<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<line x1="18" y1="6" x2="6" y2="18"></line>
					<line x1="6" y1="6" x2="18" y2="18"></line>
				</svg>
			`;

			actions.appendChild(load);
			actions.appendChild(remove);

			row.appendChild(handle);
			row.appendChild(text);
			row.appendChild(actions);
			container.appendChild(row);
		});
	});
};

export const renderDetectedChords = (ui, state, storage, detectedChords, keyDefinition) => {
	if (!detectedChords || detectedChords.length === 0) {
		ui.chordOutput.innerHTML = '<p class="empty-state">找不到對應的和弦，請確認音符是否正確。</p>';
		clearPaper(ui.paper);
		return;
	}

	const topChords = detectedChords.slice(0, 3);

	ui.chordOutput.innerHTML = "";
	clearPaper(ui.paper);

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
			ui.modeChord.classList.toggle("is-active", true);
			ui.modeNotes.classList.toggle("is-active", false);
			ui.modeChord.setAttribute("aria-pressed", "true");
			ui.modeNotes.setAttribute("aria-pressed", "false");
			state.displaySymbol = null;
			ui.input.dispatchEvent(new Event("input"));
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

const renderEmptyResult = (ui) => {
	ui.chordOutput.innerHTML = '<p class="empty-state">輸入和弦代號以查看結果。</p>';
	clearPaper(ui.paper);
};

export const renderChord = (ui, state, chordResult) => {
	if (chordResult.status === "empty") {
		renderEmptyResult(ui);
		state.currentChord = null;
		return;
	}

	if (chordResult.status === "invalid") {
		ui.chordOutput.innerHTML = '<p class="empty-state">找不到對應的和弦，請確認代號是否正確。</p>';
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
