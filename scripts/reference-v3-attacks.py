"""Generate chart-blind machine reference cues. Requires NumPy and FFmpeg."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import numpy as np

RATE = 22050
HOP = 110
# Fixed before engine tuning. The alternate Galaxy cut and final two tracks
# are evaluation material. Only source names are read from the corpus manifest.
CUTS = dict(galaxy=[200, 140], unity=[20], mutilator=[24], pistachio=[24],
            fishin=[24], vibeace=[24], nutcracker=[12], brahms=[24],
            **{"no-no-no": [24], "abnormal": [24]})
BANDS = [(45, 180), (180, 650), (650, 2200), (2200, 8000)]


def local_peaks(curve, floor):
    padded = np.pad(curve, (24, 24), mode="edge")
    blocks = np.lib.stride_tricks.sliding_window_view(padded, 49)
    median = np.median(blocks, axis=1)
    mad = np.median(np.abs(blocks - median[:, None]), axis=1)
    threshold = median + np.maximum(floor, 2.8 * mad)
    peaks = np.flatnonzero((curve > threshold) & (curve == blocks[:, 21:28].max(axis=1)))
    accepted = []
    for p in peaks:
        if accepted and p - accepted[-1] < 7:
            if curve[p] > curve[accepted[-1]]:
                accepted[-1] = p
        else:
            accepted.append(p)
    return accepted


def estimate(samples):
    # Complex-domain prediction error of growing bins. A phase jump in an
    # otherwise steady sinusoid cannot qualify through this path alone.
    width = 1024
    frames = np.lib.stride_tricks.sliding_window_view(np.pad(samples, width // 2), width)[::HOP]
    spec = np.fft.rfft(frames * np.hanning(width))
    mag = np.abs(spec)
    unit = spec / np.maximum(mag, 1e-8)
    pred = mag[1:-1] * unit[1:-1] ** 2 * unit[:-2].conj()
    novelty = np.abs(spec[2:] - pred) * (mag[2:] > mag[1:-1])
    hz = np.fft.rfftfreq(width, 1 / RATE)
    curves = []
    for lo, hi in BANDS:
        band = (hz >= lo) & (hz < hi)
        curve = novelty[:, band].sum(axis=1) / np.sqrt(band.sum())
        curves.append(np.r_[0, 0, curve])
    complex_curve = sum(np.log1p(x) for x in curves)
    phase_peaks = local_peaks(complex_curve, 0.46)

    # Independent continuous band envelopes. Symmetric cosine shoulders avoid
    # sharp cutoffs. Observe measured energy over disjoint 5 ms blocks.
    padded = np.pad(samples, RATE // 2)
    fft = np.fft.rfft(padded)
    freq = np.fft.rfftfreq(len(padded), 1 / RATE)
    envelopes = []
    for lo, hi in BANDS:
        up = np.clip((freq - lo * 0.7) / (lo * 0.3), 0, 1)
        down = np.clip((hi * 1.25 - freq) / (hi * 0.25), 0, 1)
        band = np.fft.irfft(fft * np.sin(np.pi / 2 * np.minimum(up, down))**2,
                            n=len(padded))[RATE//2:RATE//2+len(samples)]
        blocks = band[:len(band)//HOP*HOP].reshape(-1, HOP)
        envelopes.append(np.sqrt(np.mean(blocks ** 2, axis=1)))
    env = np.column_stack(envelopes)
    smooth = np.vstack([env[0], (env[1:] + env[:-1]) / 2])
    before = np.vstack([np.repeat(smooth[:1], 4, axis=0), smooth[:-4]])
    rises = np.maximum(0, np.log((0.012 + smooth) / (0.012 + before)))
    strongest = np.sort(rises, axis=1)
    curve = strongest[:, -1] + 0.5 * strongest[:, -2]
    envelope_peaks = local_peaks(curve, 0.22)
    # One-to-one agreement, with ambiguous single-method cues kept separately.
    edges = sorted((abs(p-e), p, e) for p in phase_peaks for e in envelope_peaks if abs(p-e) <= 4)
    used_p, used_e, cues = set(), set(), []
    for _, p, e in edges:
        if p in used_p or e in used_e:
            continue
        used_p.add(p)
        used_e.add(e)
        # Walk to the observed leading edge of the envelope contrast.
        start = e
        while start > e-4 and start > 0 and curve[start-1] >= curve[e]*0.26:
            start -= 1
        active = np.flatnonzero(rises[e] >= max(0.26, rises[e].max()*0.55))
        # Divergent post-attack envelopes in separated registers offer evidence
        # for layering. This cannot distinguish every single broadband drum.
        post = smooth[e+1:e+14] / np.maximum(0.01, smooth[e])
        split = any(b-a >= 2 and len(post) >= 10 and
                    abs(np.median(post[5:, a]) - np.median(post[5:, b])) > 0.45
                    for a in active for b in active)
        cues.append(dict(ms=round(start*HOP*1000/RATE, 2), evidence="agreement",
                         bands=active.tolist(), divergentDecay=bool(split)))
    for kind, peaks, used in [('phase-only',phase_peaks,used_p), ('envelope-only',envelope_peaks,used_e)]:
        cues.extend(dict(ms=round(p*HOP*1000/RATE, 2), evidence=kind) for p in peaks if p not in used)
    return sorted(cues, key=lambda e: e["ms"])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("ogg_directory", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    sources = {row['track']: row['filename'] for row in
               json.loads(Path('benchmarks/v3-player-acceptance/exports/results.json').read_text())['rows']}
    sources.update({'no-no-no':'TheFatRat - No No No.mp3','abnormal':'FUNK ABNORMAL (Slowed) - DJ V12.mp3'})
    result = []
    for name, starts in CUTS.items():
        filename = sources[name]
        path = (args.ogg_directory if filename.endswith('.ogg') else Path('audio_file_to_test')) / filename
        raw = subprocess.check_output(['ffmpeg','-v','error','-i',str(path),'-ac','1','-ar',str(RATE),'-f','f32le','-'])
        samples = np.frombuffer(raw, '<f4')
        for start in starts:
            segment = samples[(start-1)*RATE:(start+21)*RATE]
            cues = [dict(row, ms=round(row['ms']+(start-1)*1000,2)) for row in estimate(segment)
                    if 1000 <= row['ms'] < 21000]
            result.append(dict(track=name, start=start, end=start+20, sourceSha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                               pcmSha256=hashlib.sha256(raw).hexdigest(), cues=cues))
    args.output.write_text(json.dumps(dict(kind='chart-blind machine estimates', rate=RATE, bandsHz=BANDS, cuts=result),
                                      separators=(',', ':'))+'\n')


if __name__ == '__main__':
    main()
