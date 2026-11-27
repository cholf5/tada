# 用“只渲染墨迹”的办法量包围盒，避免肉眼估计
import subprocess, tempfile, sys
from pathlib import Path
from PIL import Image
INK = {
  '02-seal': '<path d="M 360 510 L 495 645 L 735 395" fill="none" stroke="#000" stroke-width="158" stroke-linecap="round" stroke-linejoin="round"/>',
  '05-signet': '<path d="M 360 460 H 680 M 490 320 V 660 Q 490 700 545 700 H 670" fill="none" stroke="#000" stroke-width="126" stroke-linecap="round" stroke-linejoin="round"/>',
}
tmp = Path(tempfile.mkdtemp())
for name, path in INK.items():
    svg = tmp / f'{name}.svg'
    svg.write_text(f'<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">{path}</svg>')
    subprocess.run(['qlmanage','-t','-s','1024','-o',str(tmp),str(svg)],capture_output=True,check=True)
    im = Image.open(tmp / (svg.name + '.png')).convert('RGBA')
    bb = im.getbbox()
    cx, cy = (bb[0]+bb[2])/2, (bb[1]+bb[3])/2
    print(f'{name}: bbox={bb} center=({cx:.1f},{cy:.1f}) offset=({512-cx:+.1f},{512-cy:+.1f})')
