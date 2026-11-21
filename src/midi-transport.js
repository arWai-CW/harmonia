const clamp = (value, maximum) => Math.min(Math.max(0, value), Math.max(0, maximum));

export function wheelZoom(zoom, delta, minimum, maximum) {
	return Math.min(maximum, Math.max(minimum, zoom * Math.exp(-(Number.isFinite(delta) ? delta : 0) * 0.002)));
}

export function timeAtX(x, scrollLeft, pixelsPerSecond, duration, padding = 12) {
	if (!(pixelsPerSecond > 0) || !Number.isFinite(x + scrollLeft)) return 0;
	return clamp((x + scrollLeft - padding) / pixelsPerSecond, duration);
}

export function anchoredScrollLeft({ scrollLeft, cursorX, oldScale, newScale, viewportWidth, contentWidth, padding = 12 }) {
	if (!(oldScale > 0) || !(newScale > 0)) return 0;
	return clamp((scrollLeft + cursorX - padding) * newScale / oldScale + padding - cursorX, contentWidth - viewportWidth);
}

export function followScrollLeft(position, pixelsPerSecond, viewportWidth, contentWidth, padding = 12) {
	return clamp(padding + position * pixelsPerSecond - viewportWidth / 2, contentWidth - viewportWidth);
}
