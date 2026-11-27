from PIL import Image, ImageDraw, ImageFont
from pathlib import Path
NAMES=[
 ('01-notebook','01 笔记本','珊瑚红封面、米色书脊与缝线，压凸的米色对勾。'),
 ('02-seal','02 火漆印','深酒红底、奶油色火漆与压印对勾，像盖下的“已完成”。'),
 ('03-ribbon','03 纸与丝带','横线纸底、珊瑚红剪纸对勾，带暖色投影。'),
 ('05-signet','05 签名火漆','火漆印章里压一个小写 t，品牌字母方向，不是对勾。'),
]
SS=4; DARK=(24,24,28); CARD=(30,30,34); INK=(235,235,238); MUT=(158,158,166)
def font(sz): return ImageFont.truetype('/System/Library/Fonts/Hiragino Sans GB.ttc', sz)
def rmask(im,size):
    src=im.resize((size,size),Image.LANCZOS)
    m=Image.new('L',(size*SS,size*SS),0)
    ImageDraw.Draw(m).rounded_rectangle([0,0,size*SS-1,size*SS-1],radius=int(size*.234*SS),fill=255)
    m=m.resize((size,size),Image.LANCZOS)
    out=Image.new('RGBA',(size,size),(0,0,0,0)); out.paste(src,(0,0),m); return out
pad=24; cw=392; ch=432
w=pad*2+cw*2+24; h=pad*2+ch*2+24
sheet=Image.new('RGB',(w,h),(104,104,110)); d=ImageDraw.Draw(sheet)
f=font(17); fs=font(13)
for idx,(name,label,cap) in enumerate(NAMES):
    cx=pad+(idx%2)*(cw+24); cy=pad+(idx//2)*(ch+24)
    d.rectangle([cx,cy,cx+cw,cy+ch],fill=CARD)
    d.text((cx+18,cy+12),label,fill=INK,font=f)
    hero=rmask(Image.open(Path('out')/f'{name}-512.png').convert('RGBA'),300)
    sheet.paste(hero,(cx+(cw-300)//2,cy+46),hero)
    d.text((cx+18,cy+362),cap,fill=INK,font=fs)
    d.text((cx+18,cy+396),'16 / 24 / 32 / 48px 见尺寸评审页',fill=MUT,font=fs)
sheet.save('preview2.png'); print(sheet.size)
