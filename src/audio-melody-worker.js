import { estimateNoteLoudness, extractAudioMelodyContour, matchAudioMelodyToNotes } from "./audio-melody.js";

self.onmessage = ({ data: { samples, sampleRate, notes } }) => {
	try {
		const contour = extractAudioMelodyContour(samples, sampleRate);
		const melody = matchAudioMelodyToNotes(contour, notes);
		const loudness = estimateNoteLoudness(samples, sampleRate, notes);
		self.postMessage({ melody, loudness });
	} catch (error) {
		self.postMessage({ error: error.message });
	}
};
