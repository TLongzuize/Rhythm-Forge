"""RF V3 teaser. Render with Pillow and ffmpeg.

Creative prompt: 36-second flagship technology teaser in the established RF
midnight / pink / cyan art direction. Audio ribbons converge into an engine,
four channels build a spatial lattice, an iris opens, and a large V3 emerges.
Use deliberate typography and restrained light trails. Present anticipation
and visual concepts, without unannounced feature or benchmark claims.
Close with RF Generator V3 / Our Flagship Generator / Coming soon...
"""
from pathlib import Path
import math
import subprocess
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT=Path(__file__).resolve().parents[1]
OUTPUT=ROOT/'public/video/rf-generator-v3.mp4'
OUTPUT.parent.mkdir(parents=True,exist_ok=True)
W,H,FPS,DURATION=1280,720,30,36
PINK=(255,102,170)
CYAN=(127,227,255)
fonts={}

def smooth(value):
    value=max(0,min(1,value))
    return value*value*(3-2*value)

def rgba(rgb,opacity):
    return (*rgb,round(255*max(0,min(1,opacity))))

def title(layer,value,y,size,opacity,bold=False,rgb=(247,245,252)):
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
         '-i','-','-stream_loop','-1','-i',str(ROOT/'public/audio/forge-demo.wav'),
         '-t',str(DURATION),'-vf','fade=t=in:d=0.8,fade=t=out:st=35:d=1',
         '-af','afade=t=in:d=1,afade=t=out:st=34:d=2,volume=0.5',
         '-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p',
         '-c:a','aac','-b:a','128k','-movflags','+faststart',str(OUTPUT)]
process=subprocess.Popen(command,stdin=subprocess.PIPE,stderr=subprocess.DEVNULL)
for frame in range(FPS*DURATION):
    t=frame/FPS
    scene=min(5,int(t/6))
    local=t-scene*6
    opacity=smooth(local/.8)*(1-smooth((local-5.4)/.6))
    geometry=Image.new('RGBA',(W,H))
    draw=ImageDraw.Draw(geometry)
    if scene<2:
        convergence=smooth((t-4)/6)
        for ribbon in range(12):
            points=[]
            for sample in range(201):
                u=sample/200
                x=140+1000*u
                spread=(ribbon-5.5)*16*(1-convergence*.7)
                y=405+spread+math.sin(u*math.pi*6-t*1.8+ribbon*.16)*48*math.sin(u*math.pi)
                points.append((x,y))
            draw.line(points,fill=rgba(PINK if ribbon%2 else CYAN,opacity*.45),width=2)
        title(geometry,'A new chapter.',165,52,opacity,True)
        if scene==1:
            title(geometry,'Taking shape.',235,28,opacity,rgb=(174,169,190))
    elif scene==2:
        title(geometry,'Built around rhythm.',140,48,opacity,True)
        for depth in range(9):
            scale=(depth+1)/9
            width=340*scale
            height=105*scale
            cy=400+depth*10
            points=[(640-width,cy),(640,cy-height),(640+width,cy),(640,cy+height),(640-width,cy)]
            draw.line(points,fill=rgba(PINK if depth%2 else CYAN,opacity*scale*.65),width=2)
        for lane in range(4):
            x=490+lane*100
            y=360+((local*50+lane*32)%150)
            draw.rounded_rectangle((x-14,y-4,x+14,y+4),radius=4,fill=rgba(CYAN,opacity))
    elif scene==3:
        title(geometry,'The next RF engine.',150,44,opacity)
        for ring in range(5):
            radius=70+ring*24+10*math.sin(local*.65)
            start=local*18+ring*47
            draw.arc((640-radius,415-radius,640+radius,415+radius),start,start+240,
                     fill=rgba(PINK if ring%2 else CYAN,opacity*(.9-ring*.12)),width=2)
        title(geometry,'V3',365,76,opacity,True)
    elif scene==4:
        title(geometry,'V3',180+20*(1-smooth(local)),250,opacity,True)
        title(geometry,'Our Flagship Generator',490,32,opacity,rgb=(187,180,200))
    else:
        title(geometry,'Introducing',190,27,opacity,rgb=(174,169,190))
        title(geometry,'RF Generator V3',260,76,opacity,True)
        title(geometry,'Our Flagship Generator',372,32,opacity,rgb=(187,180,200))
        title(geometry,'Coming soon...',472,30,opacity,rgb=PINK)
    image=Image.alpha_composite(base,geometry)
    process.stdin.write(image.convert('RGB').tobytes())
process.stdin.close()
if process.wait():
    raise SystemExit('Video encoding failed')
print(OUTPUT)
