"""Optional offline benchmark, using the upstream madmom onset processors."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import numpy as np
from madmom.audio.signal import Signal
from madmom.features.onsets import CNNOnsetProcessor, RNNOnsetProcessor, OnsetPeakPickingProcessor


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('reference', type=Path)
    parser.add_argument('ogg_directory', type=Path)
    parser.add_argument('annotations', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    cuts = json.loads(args.reference.read_text())['cuts']
    filenames = {r['track']:r['filename'] for r in json.loads(Path('benchmarks/v3-player-acceptance/exports/results.json').read_text())['rows']}
    filenames.update({'no-no-no':'TheFatRat - No No No.mp3','abnormal':'FUNK ABNORMAL (Slowed) - DJ V12.mp3'})
    jobs = []
    for cut in cuts:
        name = filenames[cut['track']]
        file = (args.ogg_directory if name.endswith('.ogg') else Path('audio_file_to_test')) / name
        assert hashlib.sha256(file.read_bytes()).hexdigest() == cut['sourceSha256']
        jobs.append((cut['track'], file, cut['start'], cut['end']))
    jobs.extend((file.stem, file, 0, None) for file in sorted(args.annotations.glob('*.wav')))
    networks = [RNNOnsetProcessor(), CNNOnsetProcessor()]
    # Same peak policy on each onset activation. Preserve disagreements.
    picker = OnsetPeakPickingProcessor(threshold=0.5, pre_max=.03, post_max=.03, combine=.035, fps=100)
    rows = []
    for track, file, start, end in jobs:
        offset = max(0, start-1)
        options = ['-ss',str(offset),'-t',str(end-offset+1)] if end else []
        raw = subprocess.check_output(['ffmpeg','-v','error','-i',str(file),*options,'-ac','1','-ar','44100','-f','s16le','-'])
        signal = Signal(np.frombuffer(raw, '<i2'), sample_rate=44100)
        times = []
        for network in networks:
            at = picker(network(signal)) + offset
            times.append([int(round(t*1000)) for t in at if t >= start and (end is None or t < end)])
        pairs = sorted((abs(a-b),a,b) for a in times[0] for b in times[1] if abs(a-b)<=20)
        used_left, used_right, joint = set(), set(), []
        for _,a,b in pairs:
            if a not in used_left and b not in used_right:
                used_left.add(a); used_right.add(b); joint.append((a+b)/2)
        rows.append(dict(track=track,start=start,end=end,sourceSha256=hashlib.sha256(file.read_bytes()).hexdigest(),
                         rnn=times[0],cnn=times[1],agreement=sorted(joint)))
    args.output.write_text(json.dumps(dict(kind='external machine onset estimates', rows=rows),separators=(',',':'))+'\n')


if __name__ == '__main__':
    main()
