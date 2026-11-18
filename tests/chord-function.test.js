import { getKeyDefinition } from "../src/chord-utils.js";
import { analyzeChordFunction } from "../src/chord-function.js";

const C = getKeyDefinition("C", "major");
const Eb = getKeyDefinition("Eb", "major");

const assertEqual = (actual, expected, label) => {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(
			`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
		);
	}
};

const roman = (symbol, key, intervals) =>
	analyzeChordFunction(symbol, key, intervals)?.roman ?? null;

const test = (name, fn) => {
	try {
		fn();
		return { name, status: "pass" };
	} catch (error) {
		return { name, status: "fail", error };
	}
};

export function runChordFunctionTests() {
	return [
		test("調內七和弦與延伸和弦功能正確", () => {
			assertEqual(roman("Cmaj7", C, ["1P", "3M", "5P", "7M"]), "I", "I");
			assertEqual(roman("Am9", C, ["1P", "3m", "5P", "7m", "9M"]), "vi", "vi");
			assertEqual(roman("Fmaj11", C, ["1P", "3M", "5P", "7M", "9M", "11P"]), "IV", "IV");
			assertEqual(roman("G11", C, ["1P", "3M", "5P", "7m", "9M", "11P"]), "V", "V");
		}),
		test("同根音但性質不同的和弦不再誤標為調內", () => {
			assertEqual(roman("Cmaj7", Eb, ["1P", "3M", "5P", "7M"]), null, "Eb 的 Cmaj7");
			assertEqual(roman("Fmaj11", Eb, ["1P", "3M", "5P", "7M", "9M", "11P"]), null, "Eb 的 Fmaj11");
		}),
		test("副屬和弦依音程辨識，不靠和弦代號裡的 7", () => {
			assertEqual(roman("D9", C, ["1P", "3M", "5P", "7m", "9M"]), "V/V", "D9");
			assertEqual(roman("G11", Eb, ["1P", "3M", "5P", "7m", "9M", "11P"]), "V/vi", "Eb 的 G11");
		}),
		test("借用和弦保留降記號並比對和弦性質", () => {
			assertEqual(roman("Fm", C, ["1P", "3m", "5P"]), "iv", "Fm");
			assertEqual(roman("Ab", C, ["1P", "3M", "5P"]), "bVI", "Ab");
			assertEqual(roman("Abm", C, ["1P", "3m", "5P"]), null, "Abm");
		}),
	];
}
