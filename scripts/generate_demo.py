#!/usr/bin/env python3
"""Regenerate the self-contained original 24-second NEON CIRCUIT demo WAV."""
import math, random, struct, wave, sys
from pathlib import Path
SAMPLE_RATE = 44100
DURATION = 24.0
BPM = 120
OUT = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path(__file__).resolve().parents[1] / 'public' / 'audio' / 'forge-demo.wav'
random.seed(1337)
frames = int(SAMPLE_RATE * DURATION)
left = [0.0] * frames
right = [0.0] * frames
beat = 60.0 / BPM

def add_tone(t0, duration, freq, amp, decay=12.0, pan=0.0, sweep=0.0):
    start = max(0, int(t0 * SAMPLE_RATE)); end = min(frames, int((t0 + duration) * SAMPLE_RATE))
    for i in range(start, end):
        t = (i / SAMPLE_RATE) - t0
        f = freq + sweep * math.exp(-t * 20)
        env = math.exp(-t * decay)
        sample = amp * env * math.sin(2 * math.pi * f * t)
        left[i] += sample * math.sqrt((1 - pan) * .5)
        right[i] += sample * math.sqrt((1 + pan) * .5)

# Four-on-the-floor low kick and a bright, short snare/clap every other beat.
for b in range(int(DURATION / beat)):
    t = b * beat
    add_tone(t, .22, 55, .72, 17, 0, -25)
    add_tone(t, .12, 110, .18, 25, 0, -45)
    if b % 2 == 1:
        for j in range(int(.10 * SAMPLE_RATE)):
            idx = int(t * SAMPLE_RATE) + j
            if idx >= frames: break
            env = math.exp(-j / SAMPLE_RATE * 34)
            noise = (random.random() * 2 - 1) * .2 * env
            left[idx] += noise * .83
            right[idx] += noise * .83
        add_tone(t, .12, 180, .18, 30, 0)
    # Offbeat hats keep the sample rhythmically varied.
    ht = t + beat / 2
    start = int(ht * SAMPLE_RATE)
    length = int(.035 * SAMPLE_RATE)
    pan = -.35 if b % 2 == 0 else .35
    for j in range(length):
        idx = start + j
        if idx >= frames: break
        env = math.exp(-j / SAMPLE_RATE * 110)
        noise = (random.random() * 2 - 1) * .09 * env
        left[idx] += noise * math.sqrt((1 - pan) * .5)
        right[idx] += noise * math.sqrt((1 + pan) * .5)
    # Simple melodic stabs alternate every 2 seconds.
    if b % 4 == 0:
        note = [220.0, 261.63, 329.63, 293.66][(b // 4) % 4]
        add_tone(t + .03, .42, note, .16, 4.5, -.22 if b % 8 == 0 else .22)

OUT.parent.mkdir(parents=True, exist_ok=True)
peak = max(max(abs(x) for x in left), max(abs(x) for x in right), 1e-9)
gain = min(0.90 / peak, 1.8)
with wave.open(str(OUT), 'wb') as wav:
    wav.setnchannels(2); wav.setsampwidth(2); wav.setframerate(SAMPLE_RATE)
    payload = bytearray()
    for l, r in zip(left, right):
        payload.extend(struct.pack('<hh', int(max(-1, min(1, l * gain)) * 32767), int(max(-1, min(1, r * gain)) * 32767)))
    wav.writeframes(payload)
print(f'Generated {OUT} ({OUT.stat().st_size:,} bytes)')
