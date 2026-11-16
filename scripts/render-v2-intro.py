"""RF technology launch film. Requires Pillow and ffmpeg.

Creative prompt: 66 seconds, midnight RF palette, pink and cyan edge lighting.
Begin with a luminous audio signal. Resolve it into four precise channels inside
a processor outline. Reveal an oversized V2. Finish with Introducing / RF Generator
V2 / Our most intelligent generator. Spacious centered typography, slow reveals,
deliberate transitions, no UI cards, decorative labels, or stock footage.
"""
from pathlib import Path
import math
import subprocess
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / 'public/video/rf-generator-v2.mp4'
OUTPUT.parent.mkdir(parents=True, exist_ok=True)
W, H, FPS, DURATION = 1280, 720, 30, 66
PINK, CYAN = (255,102,170), (127,227,255)
fonts = {}

# Hold-share figures are note-weighted totals from
# benchmarks/real-audio-v1-v2-report.json (2026-11-15):
# V1 = 10011 / 37358, V2 = 1762 / 40337, across 12 tracks x 4 difficulties.
# Generation timing measured 2026-11-16, Node v24.16.0, on this local machine:
# demoAnalysis(), Hard, seeds 42..53, one warm-up per engine, 12 timed calls.
# generateChart median 2.0 ms, generateRfV2 median 160.5 ms.
# Analysis creation excluded. These are fixture measurements, not speed claims
# across arbitrary audio files or devices.

def smooth(v):
    v = max(0,min(1,v))
    return v*v*(3-2*v)

def rgba(rgb, opacity):
    return (*rgb,round(255*max(0,min(1,opacity))))

def title(layer, value, y, size, opacity, bold=False, rgb=(247,245,252)):
    key=(size,bold)
    if key not in fonts:
        path='/System/Library/Fonts/Supplemental/Arial Bold.ttf' if bold else '/System/Library/Fonts/HelveticaNeue.ttc'
        fonts[key]=ImageFont.truetype(path,size)
    ImageDraw.Draw(layer).text((W/2,y),value,font=fonts[key],anchor='mt',fill=rgba(rgb,opacity))

base=Image.new('RGBA',(W,H),'#080910')
light=Image.new('RGBA',(W,H))
draw=ImageDraw.Draw(light)
draw.ellipse((150,260,760,830),fill=(88,24,75,90))
draw.ellipse((720,140,1280,720),fill=(22,65,86,65))
base=Image.alpha_composite(base,light.filter(ImageFilter.GaussianBlur(125)))
command=['ffmpeg','-y','-f','rawvideo','-pix_fmt','rgb24','-s','1280x720','-r',str(FPS),
         '-i','-','-stream_loop','-1','-i',str(ROOT/'public/audio/forge-demo.wav'),'-t',str(DURATION),
         '-vf','fade=t=in:d=0.6,fade=t=out:st=65:d=1',
         '-af','afade=t=in:d=1,afade=t=out:st=64:d=2,volume=0.5',
         '-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p',
         '-c:a','aac','-b:a','128k','-movflags','+faststart',str(OUTPUT)]
process=subprocess.Popen(command,stdin=subprocess.PIPE,stderr=subprocess.DEVNULL)
for frame in range(FPS*DURATION):
    t=frame/FPS
    image=base.copy()
    geometry=Image.new('RGBA',(W,H))
    draw=ImageDraw.Draw(geometry)
    if t<12:
        formation=smooth((t-4)/3)
        visibility=smooth(t/1.5)*(1-smooth((t-10.5)/1.5))
        for channel in range(4):
            points=[]
            for sample in range(241):
                u=sample/240
                x=180+u*920
                wave=math.sin(u*36+t*2.8+channel*.45)*68*math.sin(u*math.pi)**2
                y=400+(channel-1.5)*(12+formation*44)+wave*(1-formation)
                points.append((x,y))
            rgb=PINK if channel%2==0 else CYAN
            draw.line(points,fill=rgba(rgb,visibility*.8),width=2)
            for event in range(8):
                u=(event/8+t*.045)%1
                x=180+u*920
                y=400+(channel-1.5)*(12+formation*44)
                y+=math.sin(u*36+t*2.8+channel*.45)*68*math.sin(u*math.pi)**2*(1-formation)
                draw.rounded_rectangle((x-9,y-3,x+9,y+3),radius=3,fill=rgba(rgb,visibility*formation))
        alpha=formation*visibility
        draw.rounded_rectangle((370,265,910,535),radius=34,outline=rgba((198,185,220),alpha*.35),width=1)
        for pin in range(12):
            x=404+pin*43
            draw.line((x,253,x,265),fill=rgba(CYAN,alpha*.5),width=2)
            draw.line((x,535,x,547),fill=rgba(PINK,alpha*.5),width=2)
    if t<12:
        image=Image.alpha_composite(image,geometry.filter(ImageFilter.GaussianBlur(12)))
    image=Image.alpha_composite(image,geometry)
    typography=Image.new('RGBA',(W,H))
    if t<11:
        alpha=smooth((t-.7))*(1-smooth((t-8.5)/1.5))
        title(typography,'Introducing',175+18*(1-smooth(t-.7)),42,alpha)
    if 10<=t<17:
        entrance=smooth((t-10)/1.5)
        alpha=entrance*(1-smooth((t-15)/1.5))
        title(typography,'V2',180+30*(1-entrance),250,alpha,True)
        span=300*entrance
        ImageDraw.Draw(typography).line((640-span,495,640+span,495),fill=rgba(PINK,alpha*.8),width=2)
    if 16<=t<58:
        scenes=[
            ('Timing, in greater detail.', 'Fractional BPM refinement', 'Continuous tempo maps. Onset latency compensation.'),
            ('Holds with musical evidence.', 'Sustain-aware planning', 'Lane clearance. Grid-safe tails. Active-hold limits.'),
            ('More room to play.', '26.8%  →  4.4%', 'Hold-note share · V1 to V2 · 12 tracks, 48 charts per engine'),
            ('Patterns that follow the music.', 'Section-aware composition', 'Energy, accents and transitions shape the chart.'),
            ('Your level. Your play style.', '4 difficulties. 5 modes.', 'Balanced · Beat Focus · Melodic · Technical · Relax'),
            ('More analysis. More compute.', '2 ms  →  161 ms', 'V1 to V2 · median generation time on the same demo Hard chart'),
            ('Built for repeatable results.', 'Same seed. Same chart.', 'Local audio processing. Reproducible variations.'),
        ]
        index=int((t-16)//6)
        local=(t-16)%6
        alpha=smooth(local/.7)*(1-smooth((local-5.3)/.7))
        heading,main,detail=scenes[index]
        title(typography,heading,160,30,alpha,rgb=(174,169,190))
        title(typography,main,248+18*(1-smooth(local/.7)),58,alpha,True)
        title(typography,detail,350,25,alpha,rgb=(187,180,200))
        draw=ImageDraw.Draw(typography)
        if index==2:
            # Archived real-audio report, note-weighted hold share.
            for row,(label,value,rgb) in enumerate([('V1',.268,PINK),('V2',.044,CYAN)]):
                y=444+row*56
                title(typography,label,y-5,20,alpha,rgb=rgb)
                length=700*value/.3*smooth(local/1.5)
                draw.rounded_rectangle((290,y+23,290+max(2,length),y+33),radius=5,fill=rgba(rgb,alpha))
        elif index==5:
            title(typography,'12 measured runs per engine · warm-up excluded · audio analysis excluded',408,19,alpha,rgb=(145,141,162))
            title(typography,'Local Node.js measurement · timings vary by device and track',445,19,alpha,rgb=(145,141,162))
        else:
            for lane in range(4):
                x=440+lane*132
                rgb=PINK if lane%2==0 else CYAN
                draw.line((x,443,x,566),fill=rgba(rgb,alpha*.22),width=1)
                for note in range(3):
                    y=452+(note*37+lane*17+local*22)%100
                    draw.rounded_rectangle((x-16,y,x+16,y+5),radius=2,fill=rgba(rgb,alpha*.8))
    if t>=58:
        entrance=smooth((t-58)/1.3)
        title(typography,'Introducing',210,27,entrance,rgb=(174,169,190))
        title(typography,'RF Generator V2',283+22*(1-entrance),76,entrance,True)
        title(typography,'Our most intelligent generator',399+12*(1-smooth((t-59)/1.2)),30,smooth((t-59)/1.2),rgb=(187,180,200))
        draw=ImageDraw.Draw(typography)
        for index,height in enumerate([18,34,26,12]):
            x=610+index*18
            draw.rounded_rectangle((x,535-height,x+9,535),radius=4,fill=rgba(PINK if index%2==0 else CYAN,entrance))
    image=Image.alpha_composite(image,typography)
    process.stdin.write(image.convert('RGB').tobytes())
process.stdin.close()
if process.wait():
    raise SystemExit('Video encoding failed')
print(OUTPUT)
