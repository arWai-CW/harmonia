import { getKeyDefinition } from "../chord-utils.js";
import { analyzeChordFunction } from "../chord-function.js";

const assertEqual = (actual, expected, message) => {
	if (actual !== expected) {
		throw new Error(`${message} Expected "${expected}", got "${actual}".`);
	}
};

const assertDeepEqual = (actual, expected, message) => {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(`${message} Expected "${JSON.stringify(expected)}", got "${JSON.stringify(actual)}".`);
	}
};

const test = (name, fn) => {
	try {
		fn();
		return { name, status: "pass" };
	} catch (error) {
		return { name, status: "fail", error };
	}
};

const runChordFunctionTests = () => {
	const results = [];

	const cMajorKey = getKeyDefinition("C", "major");
	const aMinorKey = getKeyDefinition("A", "minor");

	const majorTests = [
		{ chord: "C", expected: { function: "tonic", roman: "I", color: "green" } },
		{ chord: "F", expected: { function: "subdominant", roman: "IV", color: "blue" } },
		{ chord: "G", expected: { function: "dominant", roman: "V", color: "red" } },
		{ chord: "Am", expected: { function: "tonic", roman: "vi", color: "green" } },
		{ chord: "Dm", expected: { function: "subdominant", roman: "ii", color: "blue" } },
		{ chord: "Em", expected: { function: "tonic", roman: "iii", color: "green" } },
		{ chord: "Bdim", expected: { function: "dominant", roman: "vii°", color: "red" } },
	];

	const nonDiatonicTests = [
		{ chord: "F#", expected: null },
	];

	// 平行小調借用，需略過才能保留音質檢查的正常分析路徑。
	const borrowedTests = [
		{ chord: "Eb", expected: { roman: "bIII", function: "borrowed" } },
		{ chord: "Ab", expected: { roman: "bVI", function: "borrowed" } },
	];

	const minorTests = [
		{ chord: "Am", expected: { function: "tonic", roman: "i", color: "green" } },
		{ chord: "C", expected: { function: "tonic", roman: "III", color: "green" } },
		{ chord: "Dm", expected: { function: "subdominant", roman: "iv", color: "blue" } },
		{ chord: "Em", expected: { function: "dominant", roman: "v", color: "red" } },
		{ chord: "F", expected: { function: "tonic", roman: "VI", color: "green" } },
		{ chord: "G", expected: { function: "dominant", roman: "VII", color: "red" } },
		{ chord: "Bdim", expected: { function: "subdominant", roman: "ii°", color: "blue" } },
	];

	majorTests.forEach(({ chord, expected }) => {
		results.push(
			test(`C major: ${chord} → ${expected.roman}`, () => {
				const result = analyzeChordFunction(chord, cMajorKey);
				assertEqual(result.roman, expected.roman, "Roman numeral mismatch.");
				assertEqual(result.function, expected.function, "Function mismatch.");
				assertEqual(result.color, expected.color, "Color mismatch.");
			})
		);
	});

	nonDiatonicTests.forEach(({ chord, expected }) => {
		results.push(
			test(`C major: ${chord} → null (non-diatonic)`, () => {
				const result = analyzeChordFunction(chord, cMajorKey);
				assertDeepEqual(result, expected, "Non-diatonic chord should return null.");
			})
		);
	});

	results.push(
		test("Eb major: Cmaj7 → null (wrong quality for bVI)", () => {
			const result = analyzeChordFunction("Cmaj7", getKeyDefinition("Eb", "major"), ["1P", "3M", "5P", "7M"]);
			assertDeepEqual(result, null, "Same-root chord with non-diatonic quality must not pass as borrowed.");
		})
	);

	borrowedTests.forEach(({ chord, expected }) => {
		results.push(
			test(`C major: ${chord} → ${expected.roman} (borrowed)`, () => {
				const result = analyzeChordFunction(chord, cMajorKey);
				assertEqual(result.roman, expected.roman, "Roman numeral mismatch.");
				assertEqual(result.function, expected.function, "Function mismatch.");
			})
		);
	});

	minorTests.forEach(({ chord, expected }) => {
		results.push(
			test(`A minor: ${chord} → ${expected.roman}`, () => {
				const result = analyzeChordFunction(chord, aMinorKey);
				assertEqual(result.roman, expected.roman, "Roman numeral mismatch.");
			})
		);
	});

	return results;
};

export { runChordFunctionTests };
