import struct, re, math, random
SRC="/tmp/de_train.bsp"; OUT="/tmp/de_train_dm.bsp"; random.seed(7)
d=bytearray(open(SRC,"rb").read()); assert struct.unpack_from("<i",d,0)[0]==30
dirs=[list(struct.unpack_from("<ii",d,4+i*8)) for i in range(15)]
L=[bytes(d[o:o+l]) for o,l in dirs]
planes=[struct.unpack_from("<ffffi",L[1],j*20) for j in range(len(L[1])//20)]
verts =[struct.unpack_from("<fff",L[3],j*12) for j in range(len(L[3])//12)]
edges =[struct.unpack_from("<HH",L[12],j*4) for j in range(len(L[12])//4)]
sed   =[struct.unpack_from("<i",L[13],j*4)[0] for j in range(len(L[13])//4)]
ents=L[0].split(b"\x00")[0].decode("latin-1")

# original spawns -> ground-truth walkable Z band
ospawn=[(int(m[1]),int(m[2]),int(m[3])) for m in re.finditer(r'"origin"\s*"(-?\d+)\s+(-?\d+)\s+(-?\d+)"\s*\n?\s*"angles"[^}]*"classname"\s*"info_player_(?:start|deathmatch)"',ents)]
if not ospawn:  # fallback: any info_player origin
    ospawn=[(int(a),int(b),int(c)) for a,b,c in re.findall(r'"origin"\s*"(-?\d+)\s+(-?\d+)\s+(-?\d+)"',ents)]
ozs=sorted(z for _,_,z in ospawn)
zlo,zhi=ozs[0]-40, ozs[-1]+40
print(f"{len(ospawn)} original spawns, origin-Z {ozs[0]}..{ozs[-1]} -> walkable band {zlo}..{zhi}")

# floor polygons (upward normal) with XY verts + Z
floors=[]
for f in range(len(L[7])//20):
    pn,side,fe,ne,ti,a,b,c,e2,lo=struct.unpack_from("<HhihHBBBBi",L[7],f*20)
    nz=planes[pn][2]*(-1 if side else 1)
    if nz<0.7: continue
    vs=[verts[edges[s][0] if s>=0 else edges[-s][1]] for s in (sed[fe+k] for k in range(ne))]
    if len(vs)<3: continue
    poly=[(v[0],v[1]) for v in vs]; z=sum(v[2] for v in vs)/len(vs)
    floors.append((poly,z))

def pip(x,y,poly):  # ray cast
    inside=False; n=len(poly); j=n-1
    for i in range(n):
        xi,yi=poly[i]; xj,yj=poly[j]
        if ((yi>y)!=(yj>y)) and (x < (xj-xi)*(y-yi)/(yj-yi+1e-9)+xi): inside=not inside
        j=i
    return inside

# floor Z under a given XY, restricted to walkable band; pick the one nearest the spawn-floor (~ origin_z-36 -> face z). Match by origin-z: face z + ~36 ~= origin z.
def floor_origin_at(x,y):
    best=None
    for poly,z in floors:
        oz=z+36                       # player origin sits ~36u above floor
        if oz<zlo or oz>zhi: continue
        if pip(x,y,poly):
            if best is None or oz>best: best=oz   # highest valid floor at this XY
    return best

# candidate XY grid across the map, snap to real floor
xs=[p[0] for poly,_ in floors for p in poly]; ys=[p[1] for poly,_ in floors for p in poly]
x0,x1,y0,y1=min(xs),max(xs),min(ys),max(ys)
cands=[]
gx=int((x1-x0)/200); gy=int((y1-y0)/200)
for i in range(gx+1):
    for j in range(gy+1):
        x=x0+(x1-x0)*i/gx; y=y0+(y1-y0)*j/gy
        oz=floor_origin_at(x,y)
        if oz is not None: cands.append((x,y,oz))
print(f"valid on-floor candidates: {len(cands)}")
random.shuffle(cands)
# min-distance spread
def spread(cs,mind):
    out=[]
    for x,y,z in cs:
        if all((x-px)**2+(y-py)**2>=mind*mind for px,py,pz in out): out.append((x,y,z))
    return out
spawns=spread(cands,430)
print(f"spread spawns: {len(spawns)} (>=430u apart)")
weaps=spread([c for c in cands if c not in spawns] or cands,400)[:36]

new=[]
for x,y,z in spawns:
    for cls in ("info_player_start","info_player_deathmatch"):
        new.append('{\n"origin" "%d %d %d"\n"angles" "0 %d 0"\n"classname" "%s"\n}'%(int(x),int(y),int(z)+4,random.randint(0,359),cls))
WE=[4,6,10,8,2,11,7,5,13,0,15,16,12,3]
for i,(x,y,z) in enumerate(weaps):
    new.append('{\n"origin" "%d %d %d"\n"count" "50"\n"item" "%d"\n"classname" "armoury_entity"\n}'%(int(x),int(y),int(z)-30,WE[i%len(WE)]))
print(f"weapons: {len(weaps)}")

# re-render ASCII with NEW spawns (*)
W,H=64,30
g=[[' ']*W for _ in range(H)]
def cell(x,y): return min(W-1,int((x-x0)/(x1-x0+1)*W)), min(H-1,int((y-y0)/(y1-y0+1)*H))
for poly,z in floors:
    cx,cy=cell(sum(p[0] for p in poly)/len(poly),sum(p[1] for p in poly)/len(poly))
    if g[cy][cx]==' ': g[cy][cx]='.'
for x,y,z in spawns:
    cx,cy=cell(x,y); g[cy][cx]='*'
print("NEW spawns (*) over floor (.):")
for row in reversed(g): print('   '+''.join(row))

ents_f=__import__("re").sub(r'\{[^{}]*"classname"\s*"info_player_(?:start|deathmatch)"[^{}]*\}\s*',"",ents)
print("removed originals; remaining info_player in base:", ents_f.count("info_player_"))
L=list(L); L[0]=(ents_f.rstrip()+"\n"+"\n".join(new)+"\n").encode("latin-1")+b"\x00"
out=bytearray(4+15*8); struct.pack_into("<i",out,0,30)
for i in range(15):
    off=len(out); out+=L[i]
    while len(out)%4: out+=b"\x00"
    struct.pack_into("<ii",out,4+i*8,off,len(L[i]))
open(OUT,"wb").write(out); print("wrote",len(out))
