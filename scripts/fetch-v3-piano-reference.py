"""Fetch three fixed MAESTRO v3 performances for offline qualification."""
import csv
import io
import json
from pathlib import Path
import subprocess
import sys
import zipfile
import mido

BASE = 'https://storage.googleapis.com/magentadata/datasets/maestro/v3.0.0/maestro-v3.0.0'


class Archive(io.RawIOBase):
    def __init__(self):
        self.position = 0
        headers = subprocess.check_output(['curl','-fsSI',BASE+'.zip'], text=True)
        self.length = int(next(line.split(':')[1] for line in headers.splitlines()
                               if line.lower().startswith('x-goog-stored-content-length:')))

    def tell(self):
        return self.position

    def seek(self, offset, whence=0):
        self.position = (0, self.position, self.length)[whence] + offset
        return self.position

    def seekable(self):
        return True

    def read(self, length=-1):
        if length < 0:
            length = self.length - self.position
        length = min(length,self.length-self.position)
        if length <= 0:
            return b''
        if length > 48*1024*1024:
            raise ValueError('Unexpected member size')
        span = f'{self.position}-{self.position+length-1}'
        data = subprocess.check_output(['curl','-fsSL','--retry','2','--max-time','120',
                                       '--range',span,'--max-filesize',str(length),BASE+'.zip?range='+span])
        assert len(data) == length
        self.position += length
        return data


def main(directory):
    directory.mkdir(parents=True, exist_ok=True)
    meta = subprocess.check_output(['curl','-fsSL',BASE+'.csv'],text=True)
    records = list(csv.DictReader(meta.splitlines()))
    with zipfile.ZipFile(Archive()) as archive:
        for output, split, rank in [('train','train',0), ('validation','validation',0), ('test','test',0),
                                    ('unseen-validation','validation',1), ('unseen-test','test',1)]:
            # Choose independently of generated charts or musical statistics.
            entry = sorted((r for r in records if r['split']==split and float(r['duration'])>=35),
                           key=lambda r: (float(r['duration']),r['audio_filename']))[rank]
            for ext,key in [('wav','audio_filename'),('midi','midi_filename')]:
                path = directory / f'{output}.{ext}'
                if not path.exists():
                    member = 'maestro-v3.0.0/'+entry[key]
                    data = archive.read(member)  # also validates the ZIP CRC
                    path.write_bytes(data)
            t = 0
            on = {}
            notes = []
            for m in mido.MidiFile(directory/f'{output}.midi'):
                t += m.time
                if m.type == 'note_on' and m.velocity:
                    on[m.note] = (t,m.velocity)
                elif m.type in ('note_off','note_on') and m.note in on:
                    attack,velocity = on.pop(m.note)
                    notes.append(dict(startMs=round(1000*attack,2), keyUpMs=round(1000*t,2),
                                      pitch=m.note, velocity=velocity))
            (directory/f'{output}.json').write_text(json.dumps(dict(source=entry,notes=sorted(notes,key=lambda n:n['startMs']))))


if __name__ == '__main__':
    main(Path(sys.argv[1]))
