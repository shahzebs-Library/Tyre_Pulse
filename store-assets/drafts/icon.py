from PIL import Image, ImageDraw, ImageFilter
import math
N=2048
def bg():
    im=Image.new('RGB',(N,N))
    d=ImageDraw.Draw(im)
    top=(22,163,74); bot=(6,64,32)
    for y in range(N):
        t=y/N
        # diagonal-ish: blend by y plus slight radial later
        c=tuple(int(top[i]*(1-t)+bot[i]*t) for i in range(3))
        d.line([(0,y),(N,y)],fill=c)
    # soft light spot top-left
    glow=Image.new('L',(N,N),0); gd=ImageDraw.Draw(glow)
    gd.ellipse((-600,-700,1300,1100),fill=90)
    glow=glow.filter(ImageFilter.GaussianBlur(260))
    im=Image.composite(Image.new('RGB',(N,N),(74,222,128)),im,glow)
    return im
def mark(im, scale=1.0, cx=N/2, cy=N/2):
    d=ImageDraw.Draw(im)
    W=(255,255,255); L=(190,242,100)
    R=640*scale; th=150*scale
    # tyre ring
    d.ellipse((cx-R,cy-R,cx+R,cy+R),outline=W,width=int(th))
    # tread notches: cut small gaps on outer edge
    bgc=None
    n=28
    for k in range(n):
        a=2*math.pi*k/n
        r1=R-th*0.02; r2=R-th*0.42
        x1,y1=cx+r1*math.cos(a),cy+r1*math.sin(a)
        x2,y2=cx+r2*math.cos(a),cy+r2*math.sin(a)
        d.line([(x1,y1),(x2,y2)],fill=(0,0,0,0) if False else None,width=1)
    return d
im=bg()
# draw mark on RGBA layer for tread cut-outs
layer=Image.new('RGBA',(N,N),(0,0,0,0)); d=ImageDraw.Draw(layer)
cx=cy=N/2; R=660; th=170
d.ellipse((cx-R,cy-R,cx+R,cy+R),outline=(255,255,255,255),width=th)
# tread grooves: slanted cuts across outer half of ring
cut=Image.new('L',(N,N),0); cd=ImageDraw.Draw(cut)
n=30
for k in range(n):
    a=2*math.pi*k/n
    r1=R+4; r2=R-th*0.48
    a2=a+0.07
    cd.line([(cx+r1*math.cos(a),cy+r1*math.sin(a)),(cx+r2*math.cos(a2),cy+r2*math.sin(a2))],fill=255,width=34)
alpha=layer.split()[3]
from PIL import ImageChops
alpha=ImageChops.subtract(alpha,cut)
layer.putalpha(alpha)
# inner hub ring thin
d=ImageDraw.Draw(layer)
r=R-th-70
d.ellipse((cx-r,cy-r,cx+r,cy+r),outline=(255,255,255,120),width=26)
# pulse line across
lime=(190,242,100,255)
pts=[(cx-R-120,cy+30),(cx-300,cy+30),(cx-200,cy-120),(cx-80,cy+300),(cx+60,cy-330),(cx+180,cy+140),(cx+270,cy+30),(cx+R+120,cy+30)]
# dark outline under pulse for contrast
d.line(pts,fill=(6,64,32,255),width=150,joint='curve')
d.line(pts,fill=lime,width=92,joint='curve')
for p in (pts[0],pts[-1]):
    d.ellipse((p[0]-46,p[1]-46,p[0]+46,p[1]+46),fill=lime)
im=Image.alpha_composite(im.convert('RGBA'),layer)
im.convert('RGB').resize((512,512),Image.LANCZOS).save('play_icon_512.png')
im.save('icon_2048.png')
# foreground-only for adaptive icon (transparent), mark scaled into 66% safe zone
fg=Image.new('RGBA',(N,N),(0,0,0,0))
fg.alpha_composite(layer.resize((int(N*0.62),int(N*0.62)),Image.LANCZOS),(int(N*0.19),int(N*0.19)))
fg.save('fg_2048.png')
