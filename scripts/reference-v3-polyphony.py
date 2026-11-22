"""Independent mixed-audio pitch estimates using Basic Pitch 0.4.0 ONNX."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import sysconfig

import numpy as np
import onnxruntime as ort
from scipy.signal import find_peaks


def groups(session, audio):
    # Upstream 2-second framing, overlapping borders and model time correction.
    size, hop, border = 43844, 256, 15
    padded = np.pad(audio, (border*hop, size))
    result = []
    for start in range(0, len(audio)+border*hop, size-2*border*hop):
        part = padded[start:start+size].reshape(1,size,1)
        note, onset = session.run(['StatefulPartitionedCall:1','StatefulPartitionedCall:2'],
                                  {'serving_default_input_2:0':part})
        result.append(np.stack([note[0,border:-border],onset[0,border:-border]]))
    note, onset = np.concatenate(result, axis=1)[:,:int(len(audio)*86/22050)]
    events = []
    for key in range(88):
        peaks = find_peaks(onset[:,key], height=.5, distance=4)[0]
        for f in peaks:
            if np.count_nonzero(note[f:f+7,key] >= .3) < 4:
                continue
            correction = ((172-size/hop)*hop/22050+.0018)*(f//172)
            events.append((round(1000*(f*hop/22050-correction),2),key+21))
    found = []
    for time,key in sorted(events):
        if not found or time-found[-1]['ms'] > 25:
            found.append(dict(ms=time,pitches=[]))
        found[-1]['pitches'].append(key)
    return found


def main(ogg_directory, output):
    path = Path(sysconfig.get_paths()['purelib'])/'basic_pitch/saved_models/icassp_2022/nmp.onnx'
    options = ort.SessionOptions()
    options.intra_op_num_threads = 1
    session = ort.InferenceSession(str(path),options,providers=['CPUExecutionProvider'])
    folder = Path('benchmarks/v3-event-validation')
    files = {r['track']:r['filename'] for r in json.loads(Path('benchmarks/v3-player-acceptance/exports/results.json').read_text())['rows']}
    files.update({'no-no-no':'TheFatRat - No No No.mp3','abnormal':'FUNK ABNORMAL (Slowed) - DJ V12.mp3'})
    rows = []
    for cut in json.loads((folder/'reference.json').read_text())['cuts']:
        filename = files[cut['track']]
        file = (ogg_directory if filename.endswith('.ogg') else Path('audio_file_to_test'))/filename
        b = subprocess.check_output(['ffmpeg','-v','error','-i',str(file),'-ac','1','-ar','22050','-f','f32le','-'])
        assert hashlib.sha256(b).hexdigest() == cut['pcmSha256']
        origin = cut['start']-2
        x = np.frombuffer(b,'<f4')[origin*22050:(cut['end']+2)*22050]
        cues = [dict(c, ms=round(c['ms']+1000*origin,2)) for c in groups(session,x)
                if 2000 <= c['ms'] < 22000]
        rows.append(dict(track=cut['track'],start=cut['start'],end=cut['end'],groups=cues))
    output.write_text(json.dumps(dict(modelSha256=hashlib.sha256(path.read_bytes()).hexdigest(),rows=rows),separators=(',',':'))+'\n')


if __name__ == '__main__':
    main(Path(sys.argv[1]),Path(sys.argv[2]))
