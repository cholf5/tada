import sys
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
NAMES=sys.argv[1:]
SIZES=[48,32,24,16]; Z=3
DARK=(24,24,28); LIGHT=(233,233,238); SS=4
def rmask(im,size):
    src=im.resize((size,size),Image.LANCZOS)
    m=Image.new('L',(size*SS,size*SS),0)
    ImageDraw.Draw(m).rounded_rectangle([0,0,size*SS-1,size*SS-1],radius=int(size*.234*SS),fill=255)
    m=m.resize((size,size),Image.LANCZOS)
    out=Image.new('RGBA',(size,size),(0,0,0,0)); out.paste(src,(0,0),m); return out
pad=16; labelw=150; gap=20
strip_h=48*Z+24
rowh=strip_h*2+34
w=pad*2+labelw+sum(s*Z for s in SIZES)+gap*(len(SIZES)-1)
h=pad*2+rowh*len(NAMES)
sheet=Image.new('RGB',(w,h),(110,110,116)); d=ImageDraw.Draw(sheet)
f=ImageFont.load_default(size=14); y=pad
for name in NAMES:
    d.text((pad,y),name,fill=(255,255,255),font=f); y0=y+20
    for bg in (DARK,LIGHT):
        d.rectangle([pad,y0,w-pad,y0+strip_h],fill=bg)
        x=pad+labelw
        for size in SIZES:
            im=rmask(Image.open(Path('out')/f'{name}-{size}.png').convert('RGBA'),size)
            big=im.resize((size*Z,size*Z),Image.NEAREST)
            sheet.paste(big,(x,y0+(strip_h-size*Z)//2-6),big)
            d.text((x,y0+strip_h-20),str(size),fill=(200,200,205) if bg==DARK else (80,80,85),font=f)
            x+=size*Z+gap
        y0+=strip_h+2
    y+=rowh
sheet.save('small-sheet.png'); print(sheet.size)
