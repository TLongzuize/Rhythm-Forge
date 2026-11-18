"""Render the welcome films with Pillow, Node and FFmpeg.

V2: open on the audio signal, scan its peaks against a grid, cut to a real
generated chart, compare hold share and compute time, then show the choices
available to the player before the final product lockup.
V3: use the familiar four lanes as the starting point. Turn them into a moving
perspective grid and then a V3 reveal. Label the sequence as a concept teaser.
Art direction: midnight, pale type, pink and cyan. Give every scene a distinct
motion device and cut on the demo's half-second pulse.
"""
from array import array
from functools import lru_cache
import json
import math
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
W, H, FPS = 1280, 720, 30
PINK, CYAN, WHITE, MUTED = '#ff66aa', '#7fe3ff', '#f7f5fc', '#b5b0c5'
SOUND = ROOT / 'public/audio/forge-demo.wav'
LANES = (PINK, '#c5a4ff', CYAN, '#91f0cf')


@lru_cache
def font(size, bold):
    family = ('Supplemental/Arial Bold.ttf' if bold else 'HelveticaNeue.ttc')
    return ImageFont.truetype('/System/Library/Fonts/' + family, size)


def text(draw, xy, value, size, color=WHITE, bold=False, anchor='la'):
    draw.text(xy, value, font=font(size, bold), fill=color, anchor=anchor)


def ease(t):
    t = min(1, max(0, t))
    return t * t * (3 - 2 * t)


def backdrop():
    base = Image.new('RGB', (W, H), '#080910')
    light = Image.new('RGB', (W, H))
    draw = ImageDraw.Draw(light)
    draw.ellipse((20, 210, 825, 970), fill='#210f25')
    draw.ellipse((740, 40, 1430, 660), fill='#0a202b')
    return Image.frombytes('RGB', (W, H), bytes(
        min(255, a + b) for a, b in zip(base.tobytes(),
                                       light.filter(ImageFilter.GaussianBlur(155)).tobytes())
    ))


def waveform(t, draw, peaks, x, y, width, height, reveal=1):
    for index in range(int(144 * reveal)):
        level = peaks[(int(t * 24) + index) % len(peaks)]
        px = x + index * width / 144
        size = 2 + height * level
        draw.line((px, y-size, px, y+size), fill=CYAN if index % 4 == 0 else '#654262', width=3)


def chart(draw, notes, clock):
    hit_y, left, lane_width = 574, 780, 80
    for lane, color in enumerate(LANES):
        x = left + lane * lane_width
        draw.rectangle((x-38,174,x+38,hit_y+24), fill='#171625')
        draw.line((x,174,x,hit_y), fill='#343047')
        draw.rounded_rectangle((x-28,hit_y-8,x+28,hit_y+8), 5, outline=color, width=2)
    for note in notes:
        y = hit_y - (note['timeMs'] / 1000 - clock) * 172
        end = hit_y - (note.get('endTimeMs', note['timeMs']) / 1000 - clock) * 172
        if y < 178 or end > hit_y + 12:
            continue
        lane = note['lane']
        x = left + lane * lane_width
        if end < y:
            draw.rounded_rectangle((x-12,max(174,end),x+12,min(y,hit_y+12)), 8, fill=LANES[lane])
        if y <= hit_y + 12:
            draw.rounded_rectangle((x-29,y-7,x+29,y+7), 5, fill=LANES[lane])


def v2(draw, scene, t, peaks, notes):
    if scene == 0:
        text(draw,(82,155),'Introducing',32,MUTED)
        text(draw,(78,205),'RF Generator V2',89,bold=True)
        text(draw,(82,324),'Our Most Intelligent Generator',34)
        waveform(t,draw,peaks,84,506,1112,98,ease(t/1.1))
    elif scene == 1:
        text(draw,(80,96),'Timing that follows the track',54,bold=True)
        text(draw,(82,192),'Fractional BPM  /  Tempo maps  /  Onset compensation',26,MUTED)
        waveform(t,draw,peaks,85,382,1110,120)
        for tick in range(17):
            x=85+tick*69
            draw.line((x,514,x,546 if tick%4==0 else 526),fill=CYAN if tick%4==0 else '#60566c',width=2)
        scan=85+1110*ease(t/6)
        draw.line((scan,251,scan,550),fill=PINK,width=3)
        text(draw,(84,610),'Signal and beat grid illustration',20,MUTED)
    elif scene == 2:
        text(draw,(80,160),'From audio',60,bold=True)
        text(draw,(80,236),'to four lanes',60,PINK,True)
        text(draw,(83,352),'Sustains guide holds.',27,MUTED)
        text(draw,(83,395),'Section energy shapes patterns.',27,MUTED)
        text(draw,(83,525),'Generated demo chart',20,CYAN)
        chart(draw,notes,1+t)
    elif scene == 3:
        text(draw,(80,98),'Long notes in the benchmark',53,bold=True)
        for label, number, y, color in [('V1',26.8,225,PINK),('V2',4.4,365,CYAN)]:
            text(draw,(82,y),label,26,color)
            text(draw,(155,y-15),f'{number:.1f}%',62,bold=True)
            width=740*number/30*ease(t/1.15)
            draw.rounded_rectangle((390,y+14,390+max(2,width),y+30),8,fill=color)
        text(draw,(82,562),'Hold share across 12 tracks and 48 charts per engine',24,MUTED)
    elif scene == 4:
        text(draw,(80,98),'More time spent on chart planning',49,bold=True)
        for x, label, value, color in [(82,'V1','2 ms',PINK),(669,'V2','161 ms',CYAN)]:
            draw.line((x,225,x+480*ease(t/1.1),225),fill=color,width=3)
            text(draw,(x,258),label,26,color)
            text(draw,(x,310),value,84,bold=True)
        text(draw,(82,508),'Median generation time on the same Hard demo input',27)
        text(draw,(82,561),'12 local Node.js runs each. Audio analysis excluded.',22,MUTED)
    elif scene == 5:
        text(draw,(80,105),'Make the chart your own',55,bold=True)
        for i,label in enumerate(['Easy','Normal','Hard','Expert']):
            if t < i*.23:
                continue
            x=82+i*291
            text(draw,(x,258),label,40,LANES[i],True)
            draw.line((x,324,x+220*ease((t-i*.23)/.6),324),fill=LANES[i],width=3)
        text(draw,(82,410),'Balanced  /  Beat Focus  /  Melodic  /  Technical  /  Relax',26)
        text(draw,(82,483),'Seeded variation. Audio processed locally.',27,MUTED)
    else:
        lockup(draw,'V2','Our Most Intelligent Generator','Available in Rhythm Forge')


def lockup(draw, version, tagline, status):
    text(draw,(640,159),'Introducing',29,MUTED,anchor='mt')
    text(draw,(640,238),'RF Generator '+version,85,WHITE,True,'mt')
    text(draw,(640,365),tagline,34,MUTED,anchor='mt')
    text(draw,(640,500),status,27,PINK,anchor='mt')


def v3(draw, scene, t, peaks, notes):
    if scene == 0:
        text(draw,(82,123),'The next RF generator',64,bold=True)
        text(draw,(85,224),'Concept teaser',26,MUTED)
        for i,color in enumerate(LANES):
            waveform(t,draw,peaks,84+i*23,342+i*61,1112-i*46,27,ease(t/1.2))
            draw.ellipse((88+i*23,337+i*61,98+i*23,347+i*61),fill=color)
    elif scene == 1:
        text(draw,(640,100),'Four lanes. A new chapter.',48,WHITE,True,'mt')
        for i,color in enumerate(LANES):
            far=576+i*43
            near=273+i*244
            draw.line((far,239,near,650),fill=color,width=2)
            for j in range(6):
                z=((j/6+t*.26)%1)**2
                x=far+(near-far)*z
                y=239+411*z
                r=2+16*z
                draw.rounded_rectangle((x-r,y-r*.35,x+r,y+r*.35),4,fill=color)
    elif scene == 2:
        for i,color in enumerate(LANES):
            r=110+i*35+18*ease(t/3)
            angle=t*48+i*80
            draw.arc((640-r,350-r,640+r,350+r),angle,angle+210,fill=color,width=2)
        text(draw,(640,220-20*ease(t/2)),'V3',223,WHITE,True,'mt')
    else:
        lockup(draw,'V3','Our Flagship Generator','Coming soon...')


def render(version, base, peaks, notes):
    scene_length=6 if version==2 else 7
    duration=scene_length*(7 if version==2 else 4)
    scene_renderer=v2 if version==2 else v3
    target=ROOT/f'public/video/rf-generator-v{version}.mp4'
    with TemporaryDirectory(dir=target.parent) as temp:
        output=Path(temp)/target.name
        command=['ffmpeg','-v','error','-y','-f','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}',
                 '-r',str(FPS),'-i','-','-stream_loop','-1','-i',str(SOUND),'-t',str(duration),
                 '-af',f'volume=0.55,afade=t=in:d=0.5,afade=t=out:st={duration-1}:d=1',
                 '-c:v','libx264','-preset','veryfast','-crf','19','-pix_fmt','yuv420p',
                 '-c:a','aac','-movflags','+faststart',str(output)]
        with subprocess.Popen(command,stdin=subprocess.PIPE) as encoder:
            for frame in range(duration*FPS):
                t=frame/FPS
                scene,local=divmod(t,scene_length)
                image=base.copy()
                draw=ImageDraw.Draw(image)
                scene_renderer(draw,int(scene),local,peaks,notes)
                fade=ease(local/.34)*ease((scene_length-local)/.28)
                encoder.stdin.write(Image.blend(base,image,fade).tobytes())
            encoder.stdin.close()
            if encoder.wait():
                raise RuntimeError('FFmpeg failed')
        output.replace(target)
    print(target)


if __name__=='__main__':
    samples=array('h',subprocess.check_output([
        'ffmpeg','-v','error','-i',str(SOUND),'-ac','1','-ar','4000','-f','s16le','-']))
    peaks=[max(map(abs,samples[i:i+80]))/32768 for i in range(0,len(samples),80)]
    notes=json.loads(subprocess.check_output(['node','--input-type=module','-e',
        "import {demoAnalysis} from './core.js'; import {generateRfV2} from './rfgen-v2.js'; "
        "console.log(JSON.stringify(generateRfV2(demoAnalysis(),'RF Demo',{difficulty:'hard',seed:42}).chart.notes));"],
        cwd=ROOT))
    base=backdrop()
    for version in map(int,sys.argv[1:] or ['2','3']):
        render(version,base,peaks,notes)
