import { Midi } from "@tonejs/midi";
import { getKeyDefinition } from "../chord-utils.js";
import { MidiFileError, filterMidiView, getBaseTriad, parseMidiFile } from "../midi-utils.js";

const KEY = getKeyDefinition("C", "major");

const createFile = (name, bytes) => new File([bytes], name);

const createMidiFile = (chords, name = "fixture.mid") => {
	const midi = new Midi();
	midi.header.setTempo(120);
	const track = midi.addTrack();
	track.name = "chords";
	chords.forEach((pitches, index) => {
		for (const midiNote of pitches) {
			track.addNote({ midi: midiNote, time: index, duration: 0.9, velocity: 0.8 });
		}
	});
	return createFile(name, midi.toArray());
};

const symbols = (view) => view.segments
	.filter((segment) => !segment.arpeggio)
	.map((segment) => segment.chord.symbol);


const assertEqual = (actual, expected, label) => {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
	}
};

const assert = (condition, label) => {
	if (!condition) {
		throw new Error(label);
	}
};

const test = async (name, fn) => {
	try {
		await fn();
		return { name, status: "pass" };
	} catch (error) {
		return { name, status: "fail", error };
	}
};

export async function runMidiUtilsTests() {
	return [
		await test("MIDI 檔案我只接受 .mid/.midi", async () => {
			try {
				await parseMidiFile(createFile("bad.txt", new Uint8Array([0])), KEY);
				throw new Error("should reject");
			} catch (error) {
				assert(error instanceof MidiFileError, "expected MidiFileError");
			}
		}),
		await test("MIDI 檔案超過大小上限時拒絕", async () => {
			const file = createFile("large.mid", new Uint8Array(10 * 1024 * 1024 + 1));
			try {
				await parseMidiFile(file, KEY);
				throw new Error("should reject");
			} catch (error) {
				assert(error instanceof MidiFileError, "expected MidiFileError");
			}
		}),
		await test("損毀的 MIDI 檔案不會拋出未包裝的錯誤", async () => {
			try {
				await parseMidiFile(createFile("broken.mid", new TextEncoder().encode("not midi")), KEY);
				throw new Error("should reject");
			} catch (error) {
				assert(error instanceof MidiFileError, "expected MidiFileError");
			}
		}),
		await test("parse 跳過鼓軌並輸出排序後音符", async () => {
			const midi = new Midi();
			midi.header.setTempo(120);
			const melody = midi.addTrack();
			melody.addNote({ midi: 67, time: 0, duration: 1 });
			melody.addNote({ midi: 60, time: 0, duration: 1 });
			const drums = midi.addTrack();
			drums.channel = 9;
			drums.addNote({ midi: 36, time: 0, duration: 0.1 });
			const view = await parseMidiFile(createFile("drums.mid", midi.toArray()), KEY);
			assertEqual(view.notes.map((note) => note.midi), [60, 67], "note order");
		}),
		await test("三和弦與複雜和弦可被辨識", async () => {
			const view = await parseMidiFile(createMidiFile([
				[60, 64, 67],
				[60, 64, 67, 74],
				[60, 67, 70, 74, 77],
				[60, 64, 67, 70],
			]), KEY);
			assertEqual(symbols(view), ["C", "Cadd9", "C11", "C7"], "chord labels");
		}),
		await test("和弦會拆成骨架與延伸音", async () => {
			const view = await parseMidiFile(createMidiFile([
				[60, 64, 67, 70, 74, 77],
				[60, 64, 67, 74],
				[60, 64, 67, 69],
			]), KEY);
			const [c11, cadd9, c6] = view.segments.map((segment) => segment.chord);
			assertEqual(c11.skeleton.symbol, "C7", "C11 skeleton");
			assertEqual(c11.extensions, ["9", "11"], "C11 extensions");
			assertEqual(c11.tones.map((tone) => tone.degree), ["1", "3", "5", "b7", "9", "11"], "C11 degrees");
			assertEqual(cadd9.skeleton.symbol, "C", "Cadd9 skeleton");
			assertEqual(cadd9.extensions, ["9"], "Cadd9 extensions");
			assertEqual(c6.skeleton.symbol, "C", "C6 skeleton");
			assertEqual(c6.extensions, ["6"], "C6 extensions");
			assertEqual(cadd9.omitted.map((tone) => tone.degree), [], "Cadd9 has no omitted tone");
		}),
		await test("延續音不會污染下一個和弦", async () => {
			const midi = new Midi();
			midi.header.setTempo(120);
			const track = midi.addTrack();
			for (const midiNote of [60, 64, 67, 71]) {
				track.addNote({ midi: midiNote, time: 0, duration: 2.5 });
			}
			for (const midiNote of [57, 60, 64, 67, 71]) {
				track.addNote({ midi: midiNote, time: 2, duration: 0.9 });
			}
			const view = await parseMidiFile(createFile("held.mid", midi.toArray()), KEY);
			assertEqual(symbols(view), ["Cmaj7", "Am9"], "held notes are ignored");
			assert(view.segments.every((segment) => segment.chord.symbol !== "?"), "no unknown chord");
		}),
		await test("時間軸與小節數跟著拍號", async () => {
			const view = await parseMidiFile(createMidiFile([
				[60, 64, 67],
				[62, 65, 69],
				[64, 67, 71],
				[65, 69, 72],
			]), KEY);
			assertEqual(view.timeSignature, [4, 4], "time signature");
			assertEqual(view.bars.length, 2, "bar count");
			assert(Math.abs(view.durationSeconds - 4) < 0.01, "duration");
		}),
		await test("分軌開關會同時改變音符和弦", async () => {
			const midi = new Midi();
			midi.header.setTempo(120);
			const piano = midi.addTrack();
			piano.name = "Piano";
			for (const midiNote of [60, 64, 67]) piano.addNote({ midi: midiNote, time: 0, duration: 0.9 });
			const bass = midi.addTrack();
			bass.name = "Bass";
			for (const midiNote of [55, 59, 62]) bass.addNote({ midi: midiNote, time: 1, duration: 0.9 });
			const view = await parseMidiFile(createFile("multitrack.mid", midi.toArray()), KEY);
			assertEqual(view.tracks.map((track) => track.name), ["Piano", "Bass"], "track names");
			assertEqual(symbols(filterMidiView(view, [0], KEY)), ["C"], "piano only");
			assertEqual(symbols(filterMidiView(view, [0, 1], KEY)), ["C", "G"], "two tracks");
			assertEqual(filterMidiView(view, [0], KEY).notes.length, 3, "piano note count");
		}),
		await test("分解和弦會標記並命名", async () => {
			const midi = new Midi();
			midi.header.setTempo(120);
			const track = midi.addTrack();
			track.addNote({ midi: 60, time: 0, duration: 1.2 });
			track.addNote({ midi: 64, time: 0.15, duration: 1.0 });
			track.addNote({ midi: 67, time: 0.3, duration: 0.8 });
			const view = await parseMidiFile(createFile("arp.mid", midi.toArray()), KEY);
			assertEqual(view.segments.length, 1, "one arpeggio segment");
			assert(view.segments[0].arpeggio === true, "marked as arpeggio");
			assertEqual(view.segments[0].chord.symbol, "C", "named broken chord");
			assertEqual(view.segments[0].pitchClasses.length, 3, "three pitch classes");
		}),
		await test("單音旋律不會被標成分解和弦", async () => {
			const midi = new Midi();
			midi.header.setTempo(120);
			const track = midi.addTrack();
			[60, 62, 64, 65].forEach((midiNote, index) => {
				track.addNote({ midi: midiNote, time: index * 0.5, duration: 0.4 });
			});
			const view = await parseMidiFile(createFile("melody.mid", midi.toArray()), KEY);
			assertEqual(view.segments.length, 0, "no segments");
		}),
		await test("基礎三和弦從和弦音取得", async () => {
			const view = await parseMidiFile(createMidiFile([[60, 63, 67, 70, 74]]), KEY);
			const base = getBaseTriad(view.segments[0].chord);
			assertEqual(base.symbol, "Cm", "base symbol");
			assertEqual(base.pcs, [0, 3, 7], "base pitch classes");
		}),
	];
}
