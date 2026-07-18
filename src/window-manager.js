const WINDOW_STATE_KEY = "harmonia:windowState";
const DEFAULT_WINDOW_STATE = {
	x: window.innerWidth - 404,
	y: window.innerHeight - 572,
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

const loadWindowState = (storage) => {
	try {
		return storage.load(WINDOW_STATE_KEY, DEFAULT_WINDOW_STATE);
	} catch (e) {
		console.warn("Failed to load window state:", e);
		return DEFAULT_WINDOW_STATE;
	}
};

const initFloatingWindowDrag = (storage) => {
	const floatingWindow = document.querySelector("#progression-floating-window");
	const header = document.querySelector("#progression-window-header");

	if (!floatingWindow || !header) return;

	const saveWindowState = debounce((state) => {
		try {
			storage.save(WINDOW_STATE_KEY, state);
		} catch (e) {
			console.warn("Failed to save window state:", e);
		}
	}, 300);

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

	const state = loadWindowState(storage);
	floatingWindow.style.left = state.x + "px";
	floatingWindow.style.top = state.y + "px";
	floatingWindow.style.width = state.width + "px";
	floatingWindow.style.height = state.height + "px";
	floatingWindow.style.right = "auto";
	floatingWindow.style.transform = "none";
	hasConvertedToPx = true;

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

const initFloatingWindowResize = (storage) => {
	const floatingWindow = document.querySelector("#progression-floating-window");
	const resizeHandle = document.querySelector("#progression-resize-handle");

	if (!floatingWindow || !resizeHandle) return;

	const saveWindowState = debounce((state) => {
		try {
			storage.save(WINDOW_STATE_KEY, state);
		} catch (e) {
			console.warn("Failed to save window state:", e);
		}
	}, 300);

	let isResizing = false;
	let startX, startY;
	let startWidth, startHeight;

	const MIN_WIDTH = 320;
	const MIN_HEIGHT = 200;

	const getClientX = (e) => (e.type.includes("touch") ? e.touches[0].clientX : e.clientX);
	const getClientY = (e) => (e.type.includes("touch") ? e.touches[0].clientY : e.clientY);

	const startResize = (e) => {
		isResizing = true;
		floatingWindow.classList.add("resizing");

		startX = getClientX(e);
		startY = getClientY(e);
		startWidth = floatingWindow.offsetWidth;
		startHeight = floatingWindow.offsetHeight;

		e.preventDefault();
	};

	const onResize = (e) => {
		if (!isResizing) return;

		const clientX = getClientX(e);
		const clientY = getClientY(e);

		const deltaX = clientX - startX;
		const deltaY = clientY - startY;

		const newWidth = Math.max(MIN_WIDTH, Math.min(window.innerWidth * 0.9, startWidth + deltaX));
		const newHeight = Math.max(MIN_HEIGHT, Math.min(window.innerHeight * 0.9, startHeight + deltaY));

		floatingWindow.style.width = newWidth + "px";
		floatingWindow.style.height = newHeight + "px";
	};

	const stopResize = () => {
		isResizing = false;
		floatingWindow.classList.remove("resizing");

		saveWindowState({
			x: floatingWindow.offsetLeft,
			y: floatingWindow.offsetTop,
			width: floatingWindow.offsetWidth,
			height: floatingWindow.offsetHeight,
		});
	};

	resizeHandle.addEventListener("mousedown", startResize);
	resizeHandle.addEventListener("touchstart", startResize, { passive: false });
	window.addEventListener("mousemove", onResize);
	window.addEventListener("touchmove", onResize, { passive: false });
	window.addEventListener("mouseup", stopResize);
	window.addEventListener("touchend", stopResize);
};

export const initWindowManager = (storage) => {
	initFloatingWindowDrag(storage);
	initFloatingWindowResize(storage);
};
