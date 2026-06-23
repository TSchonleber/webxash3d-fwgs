import struct, re, random, math
SRC="/tmp/de_train.bsp"; OUT="/tmp/de_train_dm.bsp"; random.seed(99)
d=bytearray(open(SRC,"rb").read()); assert struct.unpack_from("<i",d,0)[0]==30
dirs=[list(struct.unpack_from("<ii",d,4+i*8)) for i in range(15)]
lumps=[bytes(d[o:o+l]) for o,l in dirs]
planes=[struct.unpack_from("<ffffi",lumps[1],j*20) for j in range(len(lumps[1])//20)]
verts =[struct.unpack_from("<fff",lumps[3],j*12) for j in range(len(lumps[3])//12)]
edges =[struct.unpack_from("<HH",lumps[12],j*4) for j in range(len(lumps[12])//4)]
sedges=[struct.unpack_from("<i",lumps[13],j*4)[0] for j in range(len(lumps[13])//4)]
ents=lumps[0].split(b"\x00")[0].decode("latin-1")
zs=[int(m[2]) for m in re.findall(r'"origin"\s*"(-?\d+)\s+(-?\d+)\s+(-?\d+)"',ents)]
zref=sorted(zs)[len(zs)//2] if zs else -270

floors=[]
for f in range(len(lumps[7])//20):
    pn,side,fe,ne,ti,a,b,c,e2,lo=struct.unpack_from("<HhihHBBBBi",lumps[7],f*20)
    nz=planes[pn][2]*(-1 if side else 1)
    if nz<0.7: continue
    vs=[verts[edges[se][0] if se>=0 else edges[-se][1]] for se in (sedges[fe+k] for k in range(ne))]
    if len(vs)<3: continue
    xs=[v[0] for v in vs]; ys=[v[1] for v in vs]
    area=(max(xs)-min(xs))*(max(ys)-min(ys))
    cx,cy,cz=sum(xs)/len(vs),sum(ys)/len(vs),sum(v[2] for v in vs)/len(vs)
    if area<6000: continue                 # only sizable open floor
    if cz<zref-80 or cz>zref+460: continue
    floors.append((cx,cy,cz,area))
floors.sort(key=lambda t:-t[3])            # biggest faces first
print("candidate floors:",len(floors))

# greedy min-distance pick -> guaranteed spread, no clusters
MIND=430
picked=[]
for (x,y,z,a) in floors:
    if all((x-px)**2+(y-py)**2 >= MIND*MIND for (px,py,pz) in picked):
        picked.append((x,y,z))
print(f"spread spawns: {len(picked)} (each >= {MIND}u apart)")
# min pairwise check
mn=1e9
for i in range(len(picked)):
    for j in range(i+1,len(picked)):
        dd=math.dist(picked[i][:2],picked[j][:2]); mn=min(mn,dd)
print(f"actual min spacing: {mn:.0f}u | X {min(p[0] for p in picked):.0f}..{max(p[0] for p in picked):.0f} | Y {min(p[1] for p in picked):.0f}..{max(p[1] for p in picked):.0f}")

new=[]
for (x,y,z) in picked:
    for cls in ("info_player_start","info_player_deathmatch"):   # both -> FFA uses all
        new.append('{\n"origin" "%d %d %d"\n"angles" "0 %d 0"\n"classname" "%s"\n}'%(int(x),int(y),int(z)+26,random.randint(0,359),cls))
# weapons: spread similarly (min 480u apart), varied
WEAP=[4,6,10,8,2,11,7,5,13,0,15,16,12,3]; wpick=[]; 
for (x,y,z,a) in floors:
    if all((x-px)**2+(y-py)**2>=480*480 for (px,py,pz) in wpick): wpick.append((x,y,z))
    if len(wpick)>=40: break
for i,(x,y,z) in enumerate(wpick):
    new.append('{\n"origin" "%d %d %d"\n"count" "50"\n"item" "%d"\n"classname" "armoury_entity"\n}'%(int(x),int(y),int(z)+22,WEAP[i%len(WEAP)]))
print(f"weapons: {len(wpick)}")

lumps[0]=(ents.rstrip()+"\n"+"\n".join(new)+"\n").encode("latin-1")+b"\x00"
out=bytearray(4+15*8); struct.pack_into("<i",out,0,30)
for i in range(15):
    off=len(out); out+=lumps[i]
    while len(out)%4: out+=b"\x00"
    struct.pack_into("<ii",out,4+i*8,off,len(lumps[i]))
open(OUT,"wb").write(out); print("wrote",len(out),"bytes")
