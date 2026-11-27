import subprocess, sys, tempfile, shutil
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
DARK=(24,24,28); LIGHT=(233,233,238); MID=(118,118,124)
SS=4
def raster(svg,out):
    subprocess.run(["qlmanage","-t","-s","1024","-o",str(out),str(svg)],capture_output=True,check=True)
    return Image.open(out/(svg.name+".png")).convert("RGBA")
def rmask(im,size,r):
    src=im.resize((size,size),Image.LANCZOS)
    m=Image.new("L",(size*SS,size*SS),0)
    ImageDraw.Draw(m).rounded_rectangle([0,0,size*SS-1,size*SS-1],radius=int(r*SS),fill=255)
    m=m.resize((size,size),Image.LANCZOS)
    out=Image.new("RGBA",(size,size),(0,0,0,0)); out.paste(src,(0,0),m); return out
def cmask(im,size):
    src=im.resize((size,size),Image.LANCZOS)
    m=Image.new("L",(size*SS,size*SS),0)
    ImageDraw.Draw(m).ellipse([0,0,size*SS-1,size*SS-1],fill=255)
    m=m.resize((size,size),Image.LANCZOS)
    out=Image.new("RGBA",(size,size),(0,0,0,0)); out.paste(src,(0,0),m); return out
svgs=[Path(a) for a in sys.argv[1:]]
tmp=Path(tempfile.mkdtemp()); r={s:raster(s,tmp) for s in svgs}
pad=24; hero=150; circ=96; sizes=[48,32,24,16]; gap=14
strip_w=sum(sizes)+gap*(len(sizes)-1)
w=pad+hero+28+circ+28+strip_w+pad
rowh=hero+40
h=pad*2+rowh*len(svgs)
sheet=Image.new("RGBA",(w,h),(104,104,110,255)); d=ImageDraw.Draw(sheet)
f=ImageFont.load_default(size=15)
y=pad
for s in svgs:
    d.text((pad,y),s.stem,fill=(255,255,255,255),font=f)
    yy=y+26
    # hero on dark
    d.rectangle([pad,yy,pad+hero+24,yy+hero+24],fill=DARK)
    hc=rmask(r[s],hero,int(hero*0.234))
    sheet.alpha_composite(hc,(pad+12,yy+12))
    # circle mask
    d.rectangle([pad+hero+24+12,yy,pad+hero+24+12+circ+24,yy+hero+24],fill=MID)
    cc=cmask(r[s],circ)
    sheet.alpha_composite(cc,(pad+hero+36+12,yy+(hero+24-circ)//2))
    # small strips
    x0=pad+hero+24+12+circ+24+12
    for band,bg in ((DARK,DARK),(LIGHT,LIGHT)):
        d.rectangle([x0,yy+((hero+24)//2+4 if band==LIGHT else 0)- (0), x0+strip_w,yy+((hero+24)//2-4 if band==DARK else hero+24)],fill=bg)
    yy2=yy
    for band,bg in ((DARK,DARK),(LIGHT,LIGHT)):
        bh=(hero+24)//2
        d.rectangle([x0,yy2,x0+strip_w,yy2+bh],fill=bg)
        xx=x0
        for size in sizes:
            c=rmask(r[s],size,int(size*0.234))
            sheet.alpha_composite(c,(xx,yy2+(bh-size)//2))
            xx+=size+gap
        yy2+=bh
    y+=rowh
sheet.convert("RGB").save("final-sheet.png")
print(sheet.size)
shutil.rmtree(tmp,ignore_errors=True)
