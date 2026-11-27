import sys
from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
NAMES = sys.argv[1:]
SIZES = [256,128,48,32,24,16]
ZOOM = [48,32,24,16]
DARK=(24,24,28); LIGHT=(233,233,238); SS=4
def rmask(im,size):
    src=im.resize((size,size),Image.LANCZOS)
    m=Image.new('L',(size*SS,size*SS),0)
    ImageDraw.Draw(m).rounded_rectangle([0,0,size*SS-1,size*SS-1],radius=int(size*.234*SS),fill=255)
    m=m.resize((size,size),Image.LANCZOS)
    out=Image.new('RGBA',(size,size),(0,0,0,0)); out.paste(src,(0,0),m); return out
def load(name,size):
    p=Path('out')/f'{name}-{size}.png'
    return Image.open(p).convert('RGBA')
pad=20; labelw=150; gap=22
roww=sum(SIZES)+gap*(len(SIZES)-1)
w=pad*2+labelw+roww
rowh=(256+30)*2+40
h=pad*2+rowh*len(NAMES)
sheet=Image.new('RGB',(w,h),(110,110,116)); d=ImageDraw.Draw(sheet)
f=ImageFont.load_default(size=15)
y=pad
for name in NAMES:
    d.text((pad,y),name,fill=(255,255,255),font=f); y0=y+24
    for bg in (DARK,LIGHT):
        d.rectangle([pad,y0,w-pad,y0+286],fill=bg)
        x=pad+labelw
        for size in SIZES:
            cell=rmask(load(name,size),size)
            sheet.paste(cell,(x+(256-size)//2,y0+8+(256-size)//2),cell)
            d.text((x,y0+270),str(size),fill=(200,200,205) if bg==DARK else (80,80,85),font=f)
            x+=size+gap
        y0+=292
    y+=rowh
sheet.save('sheet.png')
print(sheet.size)
