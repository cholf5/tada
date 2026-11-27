import subprocess, sys, tempfile, shutil
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
SIZES=[128,48,32,24,16]
DARK=(24,24,28); LIGHT=(233,233,238); SS=4
def raster(svg,out):
    subprocess.run(["qlmanage","-t","-s","1024","-o",str(out),str(svg)],capture_output=True,check=True)
    return Image.open(out/(svg.name+".png")).convert("RGBA")
def rounded(im,size):
    src=im.resize((size,size),Image.LANCZOS)
    m=Image.new("L",(size*SS,size*SS),0)
    ImageDraw.Draw(m).rounded_rectangle([0,0,size*SS-1,size*SS-1],radius=int(size*0.234*SS),fill=255)
    m=m.resize((size,size),Image.LANCZOS)
    out=Image.new("RGBA",(size,size),(0,0,0,0)); out.paste(src,(0,0),m); return out
svgs=[Path(a) for a in sys.argv[1:]]
tmp=Path(tempfile.mkdtemp())
r={s:raster(s,tmp) for s in svgs}
gap,pad,label=20,20,210
w=pad*2+label+sum(SIZES)+gap*(len(SIZES)-1)
rowh=150*2+40
h=pad*2+rowh*len(svgs)
sheet=Image.new("RGBA",(w,h),(110,110,116,255)); d=ImageDraw.Draw(sheet)
f=ImageFont.load_default(size=15)
y=pad
for s in svgs:
    d.text((pad,y),s.stem,fill=(255,255,255,255),font=f); y0=y+24
    for bg in (DARK,LIGHT):
        d.rectangle([pad,y0,w-pad,y0+148],fill=bg)
        x=pad+label
        for size in SIZES:
            c=rounded(r[s],size)
            sheet.alpha_composite(c,(x+size//2-c.width//2,y0+74-c.height//2))
            d.text((x,y0+126),str(size),fill=(190,190,195) if bg==DARK else (90,90,95),font=f)
            x+=size+gap
        y0+=152
    y+=rowh
sheet.convert("RGB").save("compact.png")
print(sheet.size)
shutil.rmtree(tmp,ignore_errors=True)
