# Harmonia Domain Glossary

## Core Concepts

### Chord (和弦)
A group of notes played together. Represented by a **chord symbol** (e.g., Cmaj7, F#m7b5). The fundamental unit of Harmonia.

### Chord Symbol (和弦代號)
The textual representation of a chord (e.g., "Cmaj7", "Bb13"). Input by the user to look up chord structure.

### Constituent Notes (組成音)
The individual notes that make up a chord. For Cmaj7: C, E, G, B. Can be input to detect possible chords.

### Chord Progression (和弦進行 / 進程)
An ordered sequence of chords. Users build progressions by adding chords one at a time. Persisted in localStorage.

---

## Key & Mode

### Key Root (調性根音)
The tonic note of a key (e.g., "C" in C Major). Determines which notes are "in key."

### Key Mode (調式)
Either **major** or **minor**. Determines the scale pattern and harmonic function assignments.

---

## Harmonic Function

### Chord Function (和弦功能)
The role a chord plays within a key. Three primary functions:

#### Tonic (主音功能)
Stable, home function. Scale degrees: I, iii, vi. Color: **green**.

#### Subdominant (下屬音功能)
Moving away from home. Scale degrees: ii, IV. Color: **blue**.

#### Dominant (屬音功能)
Creating tension, wanting to resolve. Scale degrees: V, vii°. Color: **red**.

### Roman Numeral (羅馬數字)
The notation for chord function. Uppercase = major (I, IV, V), lowercase = minor (ii, iii, vi), with ° = diminished (vii°).

### Secondary Dominant (副屬和弦)
A major chord functioning as the dominant of a diatonic chord (e.g., V/V). Notated with a dot prefix (•V).

### Borrowed Chord (借用和弦)
A chord borrowed from the parallel mode (e.g., iv in a major key). Distinct from secondary dominants.

---

## Rendering

### ABC Notation (ABC記譜法)
Text-based music notation format used by abcjs library to render sheet music on the staff.

### Enharmonic (等音)
Notes with the same pitch but different spelling (e.g., F# = Gb). Harmonia suggests preferred spelling based on key context.

---

## UI Components

### Floating Window (浮動視窗)
The draggable, resizable Progression panel. Can be opened/closed via FAB button.

### Chip (和弦方塊)
Visual representation of a chord in the progression. Color-coded by harmonic function.

### FAB (浮動動作按鈕)
The circular button in the bottom-right that toggles the Progression floating window.
