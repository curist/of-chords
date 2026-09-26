import type { ChordQuality, ChordShape, Inversion, ScaleDegree } from './chords';
import { romanNumeral } from './chords';
import { normalizePitchClass, noteName, type PitchClass } from './notes';
import { SCALES, scaleTone, type Mode } from './scales';

export interface ChordIntent {
  readonly tonic: PitchClass;
  readonly mode: Mode;
  readonly degree: ScaleDegree;
  readonly shape: ChordShape;
  readonly inversion: Inversion;
}

export interface AbstractChord extends ChordIntent {
  readonly root: PitchClass;
  readonly pitchClasses: readonly PitchClass[];
  readonly intervals: readonly number[];
  readonly quality: ChordQuality;
  readonly name: string;
  readonly roman: string;
}

function qualityFor(intervals: readonly number[], shape: ChordShape): ChordQuality {
  if (shape === 'sus2' || shape === 'sus4') return 'suspended';
  if (intervals[1] === 3 && intervals[2] === 6) return 'diminished';
  return intervals[1] === 4 ? 'major' : 'minor';
}

function chordName(root: PitchClass, quality: ChordQuality, shape: ChordShape, intervals: readonly number[]): string {
  const rootName = noteName(root);
  if (shape === 'sus2' || shape === 'sus4') return `${rootName}${shape}`;
  const triadSuffix = quality === 'minor' ? 'm' : quality === 'diminished' ? 'dim' : '';
  if (shape !== 'seventh') return `${rootName}${triadSuffix}`;
  const seventhSuffix = intervals[3] === 11
    ? 'maj7'
    : quality === 'diminished'
      ? intervals[3] === 9 ? 'dim7' : 'm7♭5'
      : `${triadSuffix}7`;
  return `${rootName}${seventhSuffix}`;
}

export function resolveChord(intent: ChordIntent): AbstractChord {
  const rootTone = scaleTone(intent.tonic, intent.mode, intent.degree - 1);
  let tones: number[];

  if (intent.shape === 'sus2' || intent.shape === 'sus4') {
    tones = [rootTone, rootTone + (intent.shape === 'sus2' ? 2 : 5), rootTone + 7];
  } else {
    const count = intent.shape === 'seventh' ? 4 : 3;
    tones = Array.from({ length: count }, (_, index) => scaleTone(intent.tonic, intent.mode, intent.degree - 1 + index * 2));
  }

  const intervals = tones.map((tone) => tone - rootTone);
  const root = normalizePitchClass(rootTone);
  const quality = qualityFor(intervals, intent.shape);
  return {
    ...intent,
    root,
    intervals,
    pitchClasses: tones.map(normalizePitchClass),
    quality,
    name: chordName(root, quality, intent.shape, intervals),
    roman: romanNumeral(SCALES[intent.mode].romanTriads[intent.degree - 1], intent.shape, intervals),
  };
}
