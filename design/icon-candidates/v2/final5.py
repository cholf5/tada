from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
NAMES=[
 ('01-notebook','01 笔记本','珊瑚红封面 + 米色书脊 + 压凸对勾。','暖、像一本随身本子'),
 ('02-seal','02 火漆印','深酒红底 + 奶油火漆 + 压印对勾。','“已完成”盖了章'),
 ('03-ribbon','03 纸与丝带','横线纸 + 珊瑚红剪纸对勾 + 暖投影。','手工、纸质'),
 ('05-signet','05 签名火漆','火漆印章 + 小写 t 压印，非对勾。','品牌字母方向'),
 ('04-enamel','04 珐琅勾','珊瑚底 + 金边 + 珐琅高光。','材质最接近 v1，保守选项'),
]
SIZES=[48,32,24,16]; Z=2; SS=4
DARK=(24,24,28); LIGHT=(233,233,238); CARD=(30,30,34); INK=(236,236,239); MUT=(160,160,168)
def font(sz): return ImageFont.truetype('/System/Library/Fonts/Hiragino Sans GB.ttc', sz)
def rmask(im,size):
    src=im.resize((size,size),Image.LANCZOS)
    m=Image.new('L',(size*SS,size*SS),0)
    ImageDraw.Draw(m).rounded_rectangle([0,0,size*SS-1,size*SS-1],radius=int(size*.234*SS),fill=255)
    m=m.resize((size,size),Image.LANCZOS)
    out=Image.new('RGBA',(size,size),(0,0,0,0)); out.paste(src,(0,0),m); return out
pad=22; hero=200; gapx=22; stripw=8+sum(s*Z for s in SIZES)+8*(len(SIZES)-1)+8
rowh=336
w=pad*2+14+hero+gapx+stripw
h=pad*2+rowh*len(NAMES)
sheet=Image.new('RGB',(w,h),(104,104,110)); d=ImageDraw.Draw(sheet)
f=font(16); fs=font(12)
y=pad
for name,label,cap,tag in NAMES:
    d.rectangle([pad,y,w-pad,y+rowh-18],fill=CARD)
    d.text((pad+14,y+10),label,fill=INK,font=f)
    d.text((pad+14,y+34),cap,fill=MUT,font=fs)
    heroimg=rmask(Image.open(Path('out')/f'{name}-512.png').convert('RGBA'),hero)
    sheet.paste(heroimg,(pad+14,y+58),heroimg)
    d.text((pad+14,y+hero+66),tag,fill=(200,200,206),font=fs)
    sx=pad+14+hero+gapx
    sy=y+58
    for bg in (DARK,LIGHT):
        d.rectangle([sx,sy,sx+stripw,sy+112],fill=bg)
        x=sx+8
        for size in SIZES:
            im=rmask(Image.open(Path('out')/f'{name}-{size}.png').convert('RGBA'),size)
            big=im.resize((size*Z,size*Z),Image.NEAREST)
            sheet.paste(big,(x,sy+52-size),big)
            x+=size*Z+8
        sy+=118
    d.text((sx+8,y+292),'48 / 32 / 24 / 16 px',fill=(200,200,206),font=fs)
    y+=rowh
sheet.save('preview2-all.png'); print(sheet.size)
