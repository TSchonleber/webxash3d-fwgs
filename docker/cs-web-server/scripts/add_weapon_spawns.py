import struct, re, random
SRC="/tmp/de_train.bsp"; OUT="/tmp/de_train_dm.bsp"; random.seed(11)
d=bytearray(open(SRC,"rb").read())
assert struct.unpack_from("<i",d,0)[0]==30
dirs=[list(struct.unpack_from("<ii",d,4+i*8)) for i in range(15)]
def lump(i): off,ln=dirs[i]; return bytes(d[off:off+ln])
lumps=[lump(i) for i in range(15)]

planes=[struct.unpack_from("<ffffi",lumps[1],j*20) for j in range(len(lumps[1])//20)]
verts =[struct.unpack_from("<fff",lumps[3],j*12) for j in range(len(lumps[3])//12)]
edges =[struct.unpack_from("<HH",lumps[12],j*4) for j in range(len(lumps[12])//4)]
sedges=[struct.unpack_from("<i",lumps[13],j*4)[0] for j in range(len(lumps[13])//4)]
nface=len(lumps[7])//20

# spawn Z reference
ents=lumps[0].split(b"\x00")[0].decode("latin-1")
spawn_zs=[int(m.group(3)) for m in re.finditer(r'"origin"\s*"(-?\d+)\s+(-?\d+)\s+(-?\d+)"',ents) if True]
# (rough) use the bulk of origins as ground reference
spawn_zs=sorted(spawn_zs); zref=spawn_zs[len(spawn_zs)//2] if spawn_zs else -270

floors=[]
for f in range(nface):
    planenum,side,firstedge,numedges,texinfo,s0,s1,s2,s3,lightofs=struct.unpack_from("<HhihHBBBBi",lumps[7],f*20)
    nx,ny,nz,dist,ptype=planes[planenum]
    if side: nz=-nz
    if nz<0.7: continue  # not a floor
    vs=[]
    for e in range(numedges):
        se=sedges[firstedge+e]
        v= edges[se][0] if se>=0 else edges[-se][1]
        vs.append(verts[v])
    if len(vs)<3: continue
    cx=sum(v[0] for v in vs)/len(vs); cy=sum(v[1] for v in vs)/len(vs); cz=sum(v[2] for v in vs)/len(vs)
    # rough area filter: bounding box of the face
    xs=[v[0] for v in vs]; ys=[v[1] for v in vs]
    area=(max(xs)-min(xs))*(max(ys)-min(ys))
    if area<2600: continue  # skip tiny faces
    if cz < zref-80 or cz > zref+520: continue  # ground + accessible platforms
    floors.append((cx,cy,cz,area))
print(f"floor faces (filtered): {len(floors)}")

# spread: bucket by 384-unit XY grid, keep largest face per cell
cells={}
for (x,y,z,a) in floors:
    key=(int(x//384),int(y//384))
    if key not in cells or a>cells[key][3]: cells[key]=(x,y,z,a)
pts=[(int(x),int(y),int(z)) for (x,y,z,a) in cells.values()]
random.shuffle(pts)
print(f"spread cells: {len(pts)}")

new=[]
# spawns at MOST cells (whole-map spread), 2 per cell
ns=0
for (x,y,z) in pts:
    for _ in range(2):
        new.append('{\n"origin" "%d %d %d"\n"angles" "0 %d 0"\n"classname" "info_player_deathmatch"\n}'%(x+random.randint(-48,48),y+random.randint(-48,48),z+24,random.randint(0,359))); ns+=1
# weapons spread across distinct cells
WEAP=[4,6,10,8,2,11,7,5,13,0,15,16,12,3]
nw=0
wcells=pts[:] ; random.shuffle(wcells)
for i,(x,y,z) in enumerate(wcells[:40]):
    new.append('{\n"origin" "%d %d %d"\n"count" "50"\n"item" "%d"\n"classname" "armoury_entity"\n}'%(x,y,z+20,WEAP[i%len(WEAP)])); nw+=1
print(f"added {ns} spawns, {nw} weapons across {len(pts)} map cells")

new_text=ents.rstrip()+"\n"+"\n".join(new)+"\n"
lumps[0]=new_text.encode("latin-1")+b"\x00"
out=bytearray(4+15*8); struct.pack_into("<i",out,0,30)
for i in range(15):
    off=len(out); out+=lumps[i]
    while len(out)%4: out+=b"\x00"
    struct.pack_into("<ii",out,4+i*8,off,len(lumps[i]))
open(OUT,"wb").write(out); print(f"wrote {OUT}: {len(out)} bytes")
