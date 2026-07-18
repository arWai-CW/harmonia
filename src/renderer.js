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

const renderEmptyState = (container, message) => {
	container.innerHTML = "";
	const empty = document.createElement("p");
	empty.className = "empty-state";
	empty.textContent = message;
	container.appendChild(empty);
};

export const renderProgression = (ui, state) => {
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

			const progressionWithFunctions = progression.map((chord) => {
				const chordFunction = analyzeChordFunction(chord, keyDefinition);
				if (chordFunction && chordFunction.roman) {
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

export const renderDetectedChords = (ui, state, storage, detectedChords, keyDefinition) => {
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

export const renderChord = (ui, state, chordResult) => {
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
