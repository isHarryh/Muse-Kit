// lib_chordino.js — Offline Chordino (NNLS-Chroma) chord detection.
// Ported from the "NNLS Chroma" Vamp plugin by Matthias Mauch, Chris Cannam,
// and Mark Levy (Queen Mary University of London).
//
// Requires: lib_nnls.js (loaded first)

'use strict';

const Chordino = (() => {

// ═══════════════════════════════════════════════════
//  Constants
// ═══════════════════════════════════════════════════

const BPS = 3;              // bins per semitone
const N_NOTE = 256;         // 7·12·3 + 2·(3/2+1) = 256 pitch bins
const N_SEMITONES = 85;     // MIDI 20‑104
const NOTE_NAMES = ['Ab','A','Bb','B','C','C#','D','Eb','E','F','F#','G'];
const N_CHORD_TYPES = 18;
const N_CHORDS = N_CHORD_TYPES * 12 + 1;  // 217

// ═══════════════════════════════════════════════════
//  Static chord data (18 types × 24 values)
// ═══════════════════════════════════════════════════

// First 12 = bass pitch class, last 12 = treble pitch class
const CHORD_PROFILES = [
    [1,0,0,0,0,0,0,0,0,0,0,0, 1,0,0,0,1,0,0,1,0,0,0,0],  // major w/ root bass
    [0,0,0,0,0,0,0,0,0,0,0,0, 1,0,0,0,1,0,0,1,0,0,0,0],  // major w/o root bass
    [1,0,0,0,0,0,0,0,0,0,0,0, 1,0,0,1,0,0,0,1,0,0,0,0],  // minor w/ root
    [0,0,0,0,0,0,0,0,0,0,0,0, 1,0,0,1,0,0,0,1,0,0,0,0],  // minor w/o root
    [0,0,0,0,0,0,0,0,0,0,1,0, 1,0,0,1,0,0,1,0,0,0,1,0],  // m7b5 w/o root
    [1,0,0,0,0,0,0,0,0,0,0,0, 1,0,0,1,0,0,1,0,0,0,1,0],  // m7b5 w/ root
    [1,0,0,0,0,0,0,0,0,0,0,0, 1,0,0,0,1,0,0,1,0,1,0,0],  // 6
    [1,0,0,0,0,0,0,0,0,0,0,0, 1,0,0,0,1,0,0,1,0,0,1,0],  // 7
    [1,0,0,0,0,0,0,0,0,0,0,0, 1,0,0,0,1,0,0,1,0,0,0,1],  // maj7
    [1,0,0,0,0,0,0,0,0,0,0,0, 1,0,0,1,0,0,0,1,0,0,1,0],  // m7
    [1,0,0,0,0,0,0,0,0,0,0,0, 1,0,0,1,0,0,0,1,0,1,0,0],  // m6
    [0,0,0,0,1,0,0,0,0,0,0,0, 1,0,0,0,1,0,0,1,0,0,0,0],  // 2nd inv major
    [0,0,0,0,0,0,1,0,0,0,0,0, 1,0,0,0,1,0,0,1,0,0,0,0],  // 1st inv major
    [1,0,0,0,0,0,0,0,0,0,0,0, 1,0,0,1,0,0,1,0,0,0,0,0],  // dim
    [1,0,0,0,0,0,0,0,0,0,0,0, 1,0,0,0,1,0,0,0,1,0,0,0],  // aug
    [0,0,1,0,0,0,0,0,0,0,0,0, 1,0,0,0,1,0,0,1,0,0,0,0],  // bass=3rd major
    [0,0,0,0,0,0,0,0,0,0,1,0, 1,0,0,0,1,0,0,1,0,0,0,0],  // bass=7th major
    [0,0,0,0,1,0,0,0,0,0,0,0, 1,0,0,0,1,0,0,1,0,0,1,0],  // 7 bass=5th
];
const CHORD_SUFFIXES = ['','','m','m','m7b5','m7b5','6','7','maj7','m7','m6','','','dim','aug','','','7'];

const BASS_SLASH_NAMES = [
    ['Ab','A','Bb','B','C','C#','D','Eb','E','F','F#','G'],
    ['A','A','Bb','B','C','C#','D','Eb','E','F','F#','G'],
    ['Bb','Bb','Bb','B','C','C#','D','Eb','E','F','F#','G'],
    ['B','B','B','B','C','C#','D','Eb','E','F','F#','G'],
    ['C','C','C','C','C','C#','D','Eb','E','F','F#','G'],
    ['C#','C#','C#','C#','C#','C#','D','Eb','E','F','F#','G'],
    ['D','D','D','D','D','D','D','Eb','E','F','F#','G'],
    ['Eb','Eb','Eb','Eb','Eb','Eb','Eb','Eb','E','F','F#','G'],
    ['E','E','E','E','E','E','E','E','E','F','F#','G'],
    ['F','F','F','F','F','F','F','F','F','F','F#','G'],
    ['F#','F#','F#','F#','F#','F#','F#','F#','F#','F#','F#','G'],
    ['G','G','G','G','G','G','G','G','G','G','G','G'],
];

// ═══════════════════════════════════════════════════
//  Bass & treble windows (from chromamethods.h)
// ═══════════════════════════════════════════════════

const basswindow = new Float32Array([
    0.001769,0.015848,0.043608,0.084265,0.136670,0.199341,0.270509,0.348162,
    0.430105,0.514023,0.597545,0.678311,0.754038,0.822586,0.882019,0.930656,
    0.967124,0.990393,0.999803,0.995091,0.976388,0.944223,0.899505,0.843498,
    0.777785,0.704222,0.624888,0.542025,0.457975,0.375112,0.295778,0.222215,
    0.156502,0.100495,0.055777,0.023612,0.004909,0,...new Float32Array(47)
]);
const treblewindow = new Float32Array([
    0.000350,0.003144,0.008717,0.017037,0.028058,0.041719,0.057942,0.076638,
    0.097701,0.121014,0.146447,0.173856,0.203090,0.233984,0.266366,0.300054,
    0.334860,0.370590,0.407044,0.444018,0.481304,0.518696,0.555982,0.592956,
    0.629410,0.665140,0.699946,0.733634,0.766016,0.796910,0.826144,0.853553,
    0.878986,0.902299,0.923362,0.942058,0.958281,0.971942,0.982963,0.991283,
    0.996856,0.999650,0.999650,0.996856,0.991283,0.982963,0.971942,0.958281,
    0.942058,0.923362,0.902299,0.878986,0.853553,0.826144,0.796910,0.766016,
    0.733634,0.699946,0.665140,0.629410,0.592956,0.555982,0.518696,0.481304,
    0.444018,0.407044,0.370590,0.334860,0.300054,0.266366,0.233984,0.203090,
    0.173856,0.146447,0.121014,0.097701,0.076638,0.057942,0.041719,0.028058,
    0.017037,0.008717,0.003144,0.000350
]);

// ═══════════════════════════════════════════════════
//  DSP helpers
// ═══════════════════════════════════════════════════

const cospuls = (x, centre, width) => {
    const dx = x - centre;
    return Math.abs(dx) > width / 2 ? 0
        : Math.cos(dx * 2 * Math.PI / width) * 0.5 + 0.5;
};

const pitchCospuls = (x, centre, binsPerOctave) => {
    const w = -binsPerOctave * (Math.log2(centre) - Math.log2(x));
    const out = cospuls(w, 0, 2);
    const c = Math.LN2 / binsPerOctave;
    return x > 0 ? out / (c * x) : 0;
};

// 1-D convolution with edge replication. Output = same length as convolvee.
// Kernel must be odd-length (used with 19-element Hamming window).
const specialConvolve = (convolvee, kernel) => {
    const halfK = (kernel.length - 1) / 2;
    const out = new Float32Array(N_NOTE);
    for (let n = kernel.length - 1; n < convolvee.length; n++) {
        let s = 0;
        for (let m = 0; m < kernel.length; m++) s += convolvee[n - m] * kernel[m];
        out[n - halfK] = s;
    }
    const first = out[halfK], last = out[convolvee.length - halfK - 1];
    for (let n = 0; n < halfK; n++) out[n] = first;
    for (let n = convolvee.length; n < convolvee.length + halfK; n++) out[n - halfK] = last;
    return out;
};

// ═══════════════════════════════════════════════════
//  Radix-2 Cooley-Tukey FFT (in-place)
// ═══════════════════════════════════════════════════

const fftInPlace = (re, im) => {
    const N = re.length;
    const levels = Math.round(Math.log2(N));
    if (1 << levels !== N) throw new Error('FFT length must be a power of 2');

    // Bit-reversal permutation
    for (let i = 0; i < N; i++) {
        let j = 0;
        for (let b = 0; b < levels; b++) j = (j << 1) | ((i >> b) & 1);
        if (j > i) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
    }

    for (let size = 2; size <= N; size *= 2) {
        const half = size / 2;
        const wRe = Math.cos(-2 * Math.PI / size);
        const wIm = Math.sin(-2 * Math.PI / size);
        for (let start = 0; start < N; start += size) {
            let curRe = 1, curIm = 0;
            for (let k = 0; k < half; k++) {
                const e = start + k, o = start + k + half;
                const tRe = curRe * re[o] - curIm * im[o];
                const tIm = curRe * im[o] + curIm * re[o];
                re[o] = re[e] - tRe; im[o] = im[e] - tIm;
                re[e] += tRe;        im[e] += tIm;
                [curRe, curIm] = [curRe * wRe - curIm * wIm, curRe * wIm + curIm * wRe];
            }
        }
    }
};

// ═══════════════════════════════════════════════════
//  Matrix builders
// ═══════════════════════════════════════════════════

// Sparse matrix: FFT magnitude → log‑frequency (256‑bin) spectrum
function buildLogFreqMatrix(sampleRate, blockSize) {
    const nFFT = blockSize / 2;
    const over = 80, BPO = BPS * 12;
    const TWO_POW_0084 = 2 ** 0.084;
    const TWO_POW_NEG_0168 = 2 ** (-0.084 * 2);

    // FFT bin frequencies
    const fft_f = Float32Array.from({ length: nFFT }, (_, i) => i * sampleRate / blockSize);
    // Oversampled frequencies
    const nOver = over * nFFT;
    const oversampled_f = Float32Array.from({ length: nOver }, (_, i) => i * sampleRate / blockSize / over);
    // CQ grid
    const cq_f = new Float32Array(N_NOTE);
    let idx = 0;
    for (let midi = 20; midi <= 104; midi++)
        for (let k = 0; k < BPS; k++) cq_f[idx++] = 440 * 2 ** ((midi + k / BPS - 69) / 12);
    cq_f[idx] = 440 * 2 ** ((105 - 69) / 12);

    const fftWidth = sampleRate * 2 / blockSize;
    const actLen = 2 * over;

    // Output matrix (nFFT × N_NOTE, column-major)
    const out = new Float32Array(nFFT * N_NOTE);
    const fftAct = new Float32Array(actLen);
    for (let iFFT = 1; iFFT < nFFT; iFFT++) {
        const start = over * iFFT - over;
        const freq = fft_f[iFFT];
        for (let i = 0; i < actLen; i++) fftAct[i] = cospuls(oversampled_f[start + i], freq, fftWidth);
        for (let iCQ = 0; iCQ < N_NOTE; iCQ++) {
            const cq = cq_f[iCQ];
            if (cq * TWO_POW_0084 + fftWidth > freq && cq * TWO_POW_NEG_0168 - fftWidth < freq) {
                for (let iOS = 0; iOS < actLen; iOS++) {
                    out[iFFT + nFFT * iCQ] += pitchCospuls(oversampled_f[start + iOS], cq, BPO) * fftAct[iOS];
                }
            }
        }
    }

    // Convert to sparse
    const values = [], noteIdx = [], fftIdx = [];
    for (let iCQ = 0; iCQ < N_NOTE; iCQ++)
        for (let iFFT = 0; iFFT < nFFT; iFFT++) {
            const v = out[iFFT + nFFT * iCQ];
            if (v !== 0) { values.push(v); noteIdx.push(iCQ); fftIdx.push(iFFT); }
        }
    return { values: new Float32Array(values), noteIndices: new Int32Array(noteIdx), fftIndices: new Int32Array(fftIdx) };
}

// Note dictionary matrix: N_NOTE × 84 (12 semitones × 7 octaves)
// Each column = expected spectral profile of one note with s‑parameter harmonic decay
function buildDictionaryMatrix(sParam) {
    const cq_f = new Float32Array(N_NOTE);
    let idx = 0;
    for (let midi = 20; midi <= 104; midi++)
        for (let k = 0; k < BPS; k++) cq_f[idx++] = 440 * 2 ** ((midi + k / BPS - 69) / 12);
    cq_f[idx] = 440 * 2 ** ((105 - 69) / 12);

    const dm = new Float32Array(N_NOTE * 84);
    for (let iOut = 0; iOut < 84; iOut++) {
        for (let h = 1; h <= 20; h++) {
            const floatbin = (iOut + 1) * BPS + 1 - BPS + BPS * 12 * Math.log2(h);
            const amp = sParam ** (h - 1);
            for (let iNote = 0; iNote < N_NOTE; iNote++) {
                const dx = (iNote + 1) - floatbin;
                if (Math.abs(dx) < 2 && Math.abs(dx) <= BPS / 2) {
                    dm[iNote + N_NOTE * iOut] += cospuls(iNote + 1, floatbin, BPS) * amp;
                }
            }
        }
    }
    return dm;
}

// Build 217 chord templates + names from static data
function buildChordDictionary(boostN) {
    const bassPC = new Float32Array(N_CHORDS * 12);
    const trebPC = new Float32Array(N_CHORDS * 12);
    const names = [];

    for (let t = 0; t < N_CHORD_TYPES; t++) {
        const bTemp = CHORD_PROFILES[t].slice(0, 12);
        const cTemp = CHORD_PROFILES[t].slice(12, 24);
        for (let s = 0; s < 12; s++) {
            const ci = t * 12 + s;
            const rootName = NOTE_NAMES[s];

            for (let j = 0; j < 12; j++) {
                const src = (j - s + 12) % 12;
                bassPC[ci * 12 + j] = bTemp[src] ? 1 : cTemp[src] ? 0.5 : 0;
                trebPC[ci * 12 + j] = cTemp[src];
            }

            let name = rootName + CHORD_SUFFIXES[t];
            let bassP = -1;
            for (let j = 0; j < 12; j++) if (bTemp[j]) { bassP = (j + s) % 12; break; }
            if (bassP >= 0 && bassP !== s) name += '/' + BASS_SLASH_NAMES[bassP][s];
            names.push(name);
        }
    }

    // N (no chord) state
    const nIdx = N_CHORDS - 1;
    for (let j = 0; j < 12; j++) { bassPC[nIdx * 12 + j] = 0.5; trebPC[nIdx * 12 + j] = 1; }
    names.push('N');

    const dict = new Float32Array(N_CHORDS * 24);
    for (let i = 0; i < N_CHORDS; i++) {
        for (let j = 0; j < 12; j++) {
            dict[i * 24 + j] = bassPC[i * 12 + j];
            dict[i * 24 + 12 + j] = trebPC[i * 12 + j];
        }
        let norm = Math.sqrt(dict.subarray(i * 24, (i + 1) * 24).reduce((a, v) => a + v * v, 0) / 24);
        if (i === nIdx) norm /= (1 + boostN);
        if (norm > 0) for (let j = 0; j < 24; j++) dict[i * 24 + j] /= norm;
    }
    return { chordDict: dict, chordNames: names };
}

// ═══════════════════════════════════════════════════
//  Viterbi decoder
// ═══════════════════════════════════════════════════

function viterbi(init, trans, obs) {
    const nState = init.length, nFrame = obs.length;
    const delta = new Float64Array(nFrame * nState);
    const psi = new Uint16Array(nFrame * nState);

    // First frame
    let sum = 0;
    for (let s = 0; s < nState; s++) sum += delta[s] = init[s] * obs[0][s];
    for (let s = 0; s < nState; s++) delta[s] /= sum || 1;

    // Forward pass
    for (let f = 1; f < nFrame; f++) {
        const prev = (f - 1) * nState, cur = f * nState;
        let sumF = 0;
        for (let j = 0; j < nState; j++) {
            let bestVal = 0, bestIdx = 0;
            if (obs[f][j] > 0) {
                for (let i = 0; i < nState; i++) {
                    const val = delta[prev + i] * trans[i * nState + j];
                    if (val > bestVal) { bestVal = val; bestIdx = i; }
                }
            }
            delta[cur + j] = bestVal * obs[f][j];
            psi[cur + j] = bestIdx;
            sumF += delta[cur + j];
        }
        const scale = sumF > 0 ? sumF : 1;
        for (let j = 0; j < nState; j++) delta[cur + j] /= scale;
    }

    // Backtrack
    const last = (nFrame - 1) * nState;
    let best = nState - 1, bestVal = delta[last + nState - 1];
    for (let s = 0; s < nState; s++) if (delta[last + s] > bestVal) { bestVal = delta[last + s]; best = s; }

    const path = new Uint16Array(nFrame);
    path.fill(nState - 1);
    path[nFrame - 1] = best;
    for (let f = nFrame - 1; f > 0; f--) path[f - 1] = psi[f * nState + path[f]];
    return { path, terminalDelta: bestVal };
}

// Helper: chord state index → info object
function stateToChord(state) {
    if (state === N_CHORDS - 1) return { chord: 'N', root: -1, cssRoot: -1, suffix: '' };
    const t = (state / 12) | 0, s = state % 12;
    return { chord: NOTE_NAMES[s] + CHORD_SUFFIXES[t], root: s, cssRoot: (s + 3) % 12, suffix: CHORD_SUFFIXES[t] };
}

// ═══════════════════════════════════════════════════
//  Chordino — offline batch processor
// ═══════════════════════════════════════════════════

function ChordinoConstructor(sampleRate, options = {}) {
    const {
        useNNLS = true,
        whitening = 1,
        boostN = 0.1,
        spectralShape = 0.7,
        rollon = 0,
        blockSize = 16384,
        stepSize = 2048,
        onProgress = null,
    } = options;

    const nFFT = blockSize / 2;

    // Build static matrices
    const logFreqMatrix = buildLogFreqMatrix(sampleRate, blockSize);
    const dictMatrix = buildDictionaryMatrix(spectralShape);
    const { chordDict, chordNames } = buildChordDictionary(boostN);

    // Hann analysis window (amplitude‑compensated: sum/N = 1)
    const win = new Float64Array(blockSize);
    for (let i = 0; i < blockSize; i++) win[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / blockSize);
    const winScale = blockSize / win.reduce((a, v) => a + v, 0);
    for (let i = 0; i < blockSize; i++) win[i] *= winScale;

    // Hamming for running mean/std (length BPS*6+1 = 19)
    const hlen = BPS * 6 + 1;
    const hamming = new Float32Array(hlen);
    for (let i = 0; i < hlen; i++) hamming[i] = 0.54 - 0.46 * Math.cos(2 * Math.PI * i / (hlen - 1));
    const hSum = hamming.reduce((a, v) => a + v, 0);
    for (let i = 0; i < hlen; i++) hamming[i] /= hSum;

    // Sin/cos for tuning
    const sinTbl = new Float64Array(BPS), cosTbl = new Float64Array(BPS);
    for (let i = 0; i < BPS; i++) { sinTbl[i] = Math.sin(2 * Math.PI * i / BPS); cosTbl[i] = Math.cos(2 * Math.PI * i / BPS); }

    // Viterbi transition matrix + init (start at N)
    const trans = new Float64Array(N_CHORDS * N_CHORDS);
    const self = 0.99, other = (1 - self) / (N_CHORDS - 1);
    for (let i = 0; i < N_CHORDS; i++)
        for (let j = 0; j < N_CHORDS; j++) trans[i * N_CHORDS + j] = i === j ? self : other;
    const init = new Float64Array(N_CHORDS);
    init[N_CHORDS - 1] = 1;

    // ═══════════════════════════════════════════════════════
    //  process(audioBuffer, callback)
    // ═══════════════════════════════════════════════════════

    this.process = function (audioBuffer, callback) {
        const total = audioBuffer.length;
        const nCh = audioBuffer.numberOfChannels;
        const chData = Array.from({ length: nCh }, (_, c) => audioBuffer.getChannelData(c));
        const nFrames = Math.max(0, Math.floor((total - blockSize) / stepSize) + 1);
        if (nFrames <= 0) { callback([]); return; }

        const fftRe = new Float64Array(blockSize);
        const fftIm = new Float64Array(blockSize);
        const mag = new Float64Array(nFFT);
        const meanTune = new Float64Array(BPS);
        const localTune = new Float64Array(BPS);
        const spectra = [];

        let frameCount = 0;

        // ── Phase 1: baseProcess — accumulate log‑freq spectra ──
        (function p1() {
            const end = Math.min(frameCount + 100, nFrames);
            for (; frameCount < end; frameCount++) {
                const off = frameCount * stepSize;
                // Mix to mono + apply window
                for (let i = 0; i < blockSize; i++) {
                    let s = 0;
                    for (let c = 0; c < nCh; c++) s += chData[c][off + i];
                    fftRe[i] = s / nCh * win[i];
                    fftIm[i] = 0;
                }
                fftInPlace(fftRe, fftIm);

                // Magnitude spectrum with silence gate
                let maxMag = 0;
                for (let i = 0; i < nFFT; i++) {
                    mag[i] = Math.hypot(fftRe[i], fftIm[i]);
                    if (mag[i] > blockSize) mag[i] = blockSize;
                    if (mag[i] > maxMag) maxMag = mag[i];
                }

                // Bass roll‑on
                if (rollon > 0) {
                    const totalE = mag.reduce((a, v) => a + v * v, 0);
                    let cum = 0;
                    for (let i = 2; i < nFFT; i++) {
                        cum += mag[i] * mag[i];
                        if (cum < totalE * rollon / 100) mag[i - 2] = 0; else break;
                    }
                }

                // Silence gate
                if (maxMag < blockSize * 2 / 16384) mag.fill(0);

                // Sparse matmul → log‑freq spectrum
                const nm = new Float32Array(N_NOTE);
                for (let k = 0; k < logFreqMatrix.values.length; k++) {
                    nm[logFreqMatrix.noteIndices[k]] += mag[logFreqMatrix.fftIndices[k]] * logFreqMatrix.values[k];
                }

                // Update tuning estimates (port of NNLSBase.cpp:492-504)
                const oon = 1 / (frameCount + 1);
                const maxTone = Math.round(N_NOTE * 0.62 / BPS) * BPS;
                for (let b = 0; b < BPS; b++) {
                    meanTune[b] *= frameCount * oon;
                    for (let t = 0; t <= maxTone; t += BPS) meanTune[b] += nm[t + b] * oon;
                    for (let t = 0; t <= maxTone; t += BPS) localTune[b] = 0.997 * localTune[b] + 0.003 * nm[t + b];
                }
                spectra.push(nm);
            }

            onProgress?.(0.5 * frameCount / nFrames);
            frameCount < nFrames ? setTimeout(p1, 0) : p2setup();
        })();

        // ── Phase 2: getRemainingFeatures ──
        let intShift, floatShift, chordogram, p2i;

        function p2setup() {
            if (!spectra.length) { callback([]); return; }
            let real = 0, imag = 0;
            for (let b = 0; b < BPS; b++) { real += meanTune[b] * cosTbl[b]; imag += meanTune[b] * sinTbl[b]; }
            const nt = Math.atan2(imag, real) / (2 * Math.PI);
            intShift = Math.floor(nt * BPS);
            floatShift = nt * BPS - intShift;
            chordogram = new Array(spectra.length);
            p2i = 0;
            setTimeout(p2, 0);
        }

        function p2() {
            const end = Math.min(p2i + 100, spectra.length);
            for (; p2i < end; p2i++) {
                const src = spectra[p2i];

                // Tuning‑corrected shift
                const shifted = new Float32Array(N_NOTE);
                for (let k = 2; k < N_NOTE - 3; k++) {
                    const si = k + intShift;
                    shifted[k] = si >= 0 && si + 1 < N_NOTE ? src[si] * (1 - floatShift) + src[si + 1] * floatShift
                        : si >= 0 && si < N_NOTE ? src[si] : 0;
                }

                // Spectral whitening
                const mean = specialConvolve(shifted, hamming);
                const sqDev = new Float32Array(N_NOTE);
                for (let i = 0; i < N_NOTE; i++) sqDev[i] = (shifted[i] - mean[i]) ** 2;
                const std = specialConvolve(sqDev, hamming).map(v => Math.sqrt(Math.max(v, 1e-10)));
                const white = new Float32Array(N_NOTE);
                for (let i = 0; i < N_NOTE; i++) {
                    const dev = shifted[i] - mean[i];
                    white[i] = std[i] > 0 && dev > 0 ? dev / (std[i] ** whitening) : 0;
                }

                // NNLS or simple binning → chroma
                const chroma = new Float32Array(24);
                const hasSignal = white.some(v => v > 0);

                if (hasSignal && useNNLS && NNLS?.nnls) {
                    // Find significant semitones
                    const sig = [];
                    let idx = 0;
                    for (let n = (BPS >> 1) + 2; n < N_NOTE - (BPS >> 1); n += BPS) {
                        let v = 0;
                        for (let b = -(BPS >> 1); b <= (BPS >> 1); b++) v += white[n + b];
                        if (v > 0) sig.push(idx);
                        idx++;
                    }
                    if (sig.length) {
                        const nSig = sig.length;
                        const cd = new Float32Array(N_NOTE * nSig);
                        for (let n = 0; n < nSig; n++) {
                            const col = sig[n];
                            for (let b = 0; b < N_NOTE; b++) cd[n * N_NOTE + b] = dictMatrix[col * N_NOTE + b];
                        }
                        const bCopy = Float32Array.from(white);
                        const x = new Float32Array(nSig + 1000);
                        NNLS.nnls(cd, N_NOTE, N_NOTE, nSig, bCopy, x);
                        for (let n = 0; n < nSig; n++) {
                            const s = sig[n];
                            chroma[s % 12] += x[n] * treblewindow[s];
                            chroma[12 + s % 12] += x[n] * basswindow[s];
                        }
                    }
                } else if (hasSignal) {
                    let si = 0;
                    for (let n = (BPS >> 1) + 2; n < N_NOTE - (BPS >> 1); n += BPS) {
                        let v = 0;
                        for (let b = -(BPS >> 1); b <= (BPS >> 1); b++) v += white[n + b] * (1 - Math.abs(b / ((BPS >> 1) + 1)));
                        chroma[si % 12] += v * treblewindow[si];
                        chroma[12 + si % 12] += v * basswindow[si];
                        si++;
                    }
                }

                // Chord scoring
                const scores = new Float64Array(N_CHORDS);
                let sumScores = 0;
                for (let c = 0; c < N_CHORDS; c++) {
                    let dot = 0;
                    for (let j = 0; j < 24; j++) dot += chordDict[c * 24 + j] * chroma[j];
                    if (c === N_CHORDS - 1) dot *= 0.7;
                    dot = Math.max(0, Math.min(200, dot));
                    scores[c] = 1.3 ** dot;
                    sumScores += scores[c];
                }
                if (sumScores > 0) {
                    for (let c = 0; c < N_CHORDS; c++) scores[c] /= sumScores;
                } else {
                    scores[N_CHORDS - 1] = 1;
                }
                chordogram[p2i] = scores;
            }

            onProgress?.(0.5 + 0.5 * p2i / spectra.length);
            p2i < spectra.length ? setTimeout(p2, 0) : finish();
        }

        // ── Phase 3: Viterbi + segment aggregation ──
        function finish() {
            const { path: chordpath, terminalDelta } = viterbi(init, trans, chordogram);

            // Build segments from Viterbi path
            const segs = [];
            let oldState = N_CHORDS - 1, segStart = 0;
            for (let f = 0; f < chordpath.length; f++) {
                if (chordpath[f] !== oldState) {
                    if (f > 0) segs.push({ start: segStart, end: f - 1, state: oldState });
                    segStart = f;
                    oldState = chordpath[f];
                }
            }
            segs.push({ start: segStart, end: chordpath.length - 1, state: oldState });

            // Per‑segment: average chordogram → top-3 candidates → altLabel
            const results = [];
            for (const seg of segs) {
                const len = seg.end - seg.start + 1;
                const avg = new Float64Array(N_CHORDS);
                for (let f = seg.start; f <= seg.end; f++) {
                    const fp = chordogram[f];
                    for (let c = 0; c < N_CHORDS; c++) avg[c] += fp[c];
                }
                for (let c = 0; c < N_CHORDS; c++) avg[c] /= len;

                // Top 3 by probability
                const topIdx = [-1, -1, -1], topVal = [0, 0, 0];
                for (let c = 0; c < N_CHORDS; c++) {
                    const p = avg[c];
                    if (p <= 0) continue;
                    if (p > topVal[0]) { topVal[2] = topVal[1]; topIdx[2] = topIdx[1]; topVal[1] = topVal[0]; topIdx[1] = topIdx[0]; topVal[0] = p; topIdx[0] = c; }
                    else if (p > topVal[1]) { topVal[2] = topVal[1]; topIdx[2] = topIdx[1]; topVal[1] = p; topIdx[1] = c; }
                    else if (p > topVal[2]) { topVal[2] = p; topIdx[2] = c; }
                }

                const candidates = [];
                for (let ti = 0; ti < 3 && topIdx[ti] >= 0; ti++) {
                    const info = stateToChord(topIdx[ti]);
                    info.probability = topVal[ti];
                    candidates.push(info);
                }

                // altLabel = "Am/C7" if #2 ≥ 90% of #1 and different root
                let altLabel = null;
                const c1 = candidates[0], c2 = candidates.find(c => c.root !== c1?.root);
                if (c1 && c2 && c1.probability > 0 && c2.probability / c1.probability >= 0.9) {
                    altLabel = c1.chord + '/' + c2.chord;
                }

                const t = (seg.state / 12) | 0, s = seg.state % 12;
                const isN = seg.state === N_CHORDS - 1;
                results.push({
                    time: (seg.start * stepSize) / sampleRate,
                    endTime: ((seg.end + 1) * stepSize) / sampleRate,
                    chord: isN ? 'N' : NOTE_NAMES[s] + CHORD_SUFFIXES[t],
                    root: isN ? -1 : s,
                    cssRoot: isN ? -1 : (s + 3) % 12,
                    suffix: isN ? '' : CHORD_SUFFIXES[t],
                    confidence: terminalDelta,
                    altLabel,
                    candidates,
                });
            }

            // Terminal N sentinel
            const lastT = ((chordpath.length - 1) * stepSize) / sampleRate;
            const last = results[results.length - 1];
            if (!last || last.chord !== 'N') {
                results.push({ time: lastT, endTime: (chordpath.length * stepSize) / sampleRate, chord: 'N', root: -1, cssRoot: -1, suffix: '', confidence: terminalDelta, altLabel: null, candidates: [{ chord: 'N', root: -1, cssRoot: -1, suffix: '', probability: 1 }] });
            }

            callback(results);
        }
    };
}

return ChordinoConstructor;
})();
