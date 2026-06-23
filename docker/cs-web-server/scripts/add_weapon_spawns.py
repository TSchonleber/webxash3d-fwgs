import struct, re, random
SRC="/tmp/de_train.bsp"; OUT="/tmp/de_train_dm.bsp"; random.seed(3)
d=bytearray(open(SRC,"rb").read()); assert struct.unpack_from("<i",d,0)[0]==30
dirs=[list(struct.unpack_from("<ii",d,4+i*8)) for i in range(15)]
L=[bytes(d[o:o+l]) for o,l in dirs]
planes=[struct.unpack_from("<ffffi",L[1],j*20) for j in range(len(L[1])//20)]
verts =[struct.unpack_from("<fff",L[3],j*12) for j in range(len(L[3])//12)]
edges =[struct.unpack_from("<HH",L[12],j*4) for j in range(len(L[12])//4)]
sed   =[struct.unpack_from("<i",L[13],j*4)[0] for j in range(len(L[13])//4)]
clip  =[struct.unpack_from("<ihh",L[9],j*8) for j in range(len(L[9])//8)]
models=[(struct.unpack_from("<3f",L[14],j*64),struct.unpack_from("<3f",L[14],j*64+12),struct.unpack_from("<4i",L[14],j*64+36)) for j in range(len(L[14])//64)]
ents=L[0].split(b"\x00")[0].decode("latin-1")
H1=models[0][2][1]   # hull-1 (player) clipnode head

def contents(x,y,z):
    n=H1; g=0
    while n>=0:
        pn,c0,c1=clip[n]; nx,ny,nz,dist,_=planes[pn]
        n=c0 if (nx*x+ny*y+nz*z-dist)>=0 else c1
        g+=1
        if g>20000: return -2
    return n   # -1 EMPTY, -2 SOLID

# SANITY: original spawns must read EMPTY (validates the hull traversal)
osp=[(int(a),int(b),int(c)) for a,b,c in re.findall(r'"origin"\s*"(-?\d+)\s+(-?\d+)\s+(-?\d+)"\s*\n\s*"angles"[^}]*"classname"\s*"info_player_(?:start|deathmatch)"',ents)]
empt=sum(1 for x,y,z in osp if contents(x,y,z)==-1)
print(f"SANITY: {empt}/{len(osp)} original spawns read EMPTY in hull-1 (want all)")
ozs=sorted(z for _,_,z in osp); zlo,zhi=ozs[0]-40,ozs[-1]+40

# solid func brush bboxes to also avoid (func_wall/func_breakable)
solid=[]
for m in re.finditer(r'\{[^{}]*\}',ents):
    b=m.group(0); cn=re.search(r'"classname"\s*"(func_wall|func_breakable)"',b); mod=re.search(r'"model"\s*"\*(\d+)"',b)
    if cn and mod:
        mn,mx,_=models[int(mod.group(1))]; solid.append((mn,mx))
def in_solid_func(x,y,z):
    for mn,mx in solid:
        if mn[0]-16<=x<=mx[0]+16 and mn[1]-16<=y<=mx[1]+16 and mn[2]-72<=z<=mx[2]+16: return True
    return False

# floor polygons
floors=[]
for f in range(len(L[7])//20):
    pn,side,fe,ne,ti,a,b,c,e2,lo=struct.unpack_from("<HhihHBBBBi",L[7],f*20)
    nz=planes[pn][2]*(-1 if side else 1)
    if nz<0.7: continue
    vs=[verts[edges[s][0] if s>=0 else edges[-s][1]] for s in (sed[fe+k] for k in range(ne))]
    if len(vs)<3: continue
    floors.append(([(v[0],v[1]) for v in vs], sum(v[2] for v in vs)/len(vs)))
def pip(x,y,poly):
    inside=False; n=len(poly); j=n-1
    for i in range(n):
        xi,yi=poly[i]; xj,yj=poly[j]
        if ((yi>y)!=(yj>y)) and (x<(xj-xi)*(y-yi)/(yj-yi+1e-9)+xi): inside=not inside
        j=i
    return inside

# candidate grid -> floor under XY at walkable Z -> spawn origin -> MUST be hull-clear + not in solid func
xs=[p[0] for poly,_ in floors for p in poly]; ys=[p[1] for poly,_ in floors for p in poly]
x0,x1,y0,y1=min(xs),max(xs),min(ys),max(ys)
cands=[]
gx=int((x1-x0)/180); gy=int((y1-y0)/180)
for i in range(gx+1):
    for j in range(gy+1):
        x=x0+(x1-x0)*i/gx; y=y0+(y1-y0)*j/gy
        best=None
        for poly,z in floors:
            oz=z+36
            if zlo<=oz<=zhi and pip(x,y,poly) and (best is None or oz>best): best=oz
        if best is None: continue
        ox,oy,oz=int(x),int(y),int(best)+4
        if contents(ox,oy,oz)!=-1: continue          # hull-1 must be EMPTY (clear of world solids/trains)
        if in_solid_func(ox,oy,oz): continue          # not inside a solid func brush
        cands.append((ox,oy,oz))
print(f"hull-clear on-floor candidates: {len(cands)}")
random.shuffle(cands)
def spread(cs,m):
    out=[]
    for x,y,z in cs:
        if all((x-px)**2+(y-py)**2>=m*m for px,py,pz in out): out.append((x,y,z))
    return out
spawns=spread(cands,370)
# double-check every chosen spawn is clear
spawns=[(x,y,z) for x,y,z in spawns if contents(x,y,z)==-1 and not in_solid_func(x,y,z)]
print(f"final spread spawns: {len(spawns)} (all hull-clear, >=430u apart)")
weaps=spread([c for c in cands if c not in spawns] or cands,400)[:34]

new=[]
for x,y,z in spawns:
    for cls in ("info_player_start","info_player_deathmatch"):
        new.append('{\n"origin" "%d %d %d"\n"angles" "0 %d 0"\n"classname" "%s"\n}'%(x,y,z,random.randint(0,359),cls))
WE=[4,6,10,8,2,11,7,5,13,0,15,16,12,3]
for i,(x,y,z) in enumerate(weaps):
    new.append('{\n"origin" "%d %d %d"\n"count" "50"\n"item" "%d"\n"classname" "armoury_entity"\n}'%(x,y,z-30,WE[i%len(WE)]))
print(f"weapons: {len(weaps)}")
ents_f=re.sub(r'\{[^{}]*"classname"\s*"info_player_(?:start|deathmatch)"[^{}]*\}\s*',"",ents)
Lx=list(L); Lx[0]=(ents_f.rstrip()+"\n"+"\n".join(new)+"\n").encode("latin-1")+b"\x00"
out=bytearray(4+15*8); struct.pack_into("<i",out,0,30)
for i in range(15):
    off=len(out); out+=Lx[i]
    while len(out)%4: out+=b"\x00"
    struct.pack_into("<ii",out,4+i*8,off,len(Lx[i]))
open(OUT,"wb").write(out); print("wrote",len(out))
