import struct, re, random
SRC = "/tmp/de_train.bsp"      # clean original
OUT = "/tmp/de_train_dm.bsp"
random.seed(42)

data = bytearray(open(SRC, "rb").read())
assert struct.unpack_from("<i", data, 0)[0] == 30
NLUMP = 15
dirs = [list(struct.unpack_from("<ii", data, 4+i*8)) for i in range(NLUMP)]
lumps = [bytes(data[off:off+ln]) for off,ln in dirs]
ent_text = lumps[0].split(b"\x00")[0].decode("latin-1")

# collect valid floor origins from existing spawns
spawns = []
for m in re.finditer(r'\{[^{}]*\}', ent_text):
    b = m.group(0)
    cn = re.search(r'"classname"\s*"([^"]+)"', b)
    og = re.search(r'"origin"\s*"(-?\d+)\s+(-?\d+)\s+(-?\d+)"', b)
    if cn and og and cn.group(1) in ("info_player_start","info_player_deathmatch","info_vip_start"):
        spawns.append(tuple(int(x) for x in og.groups()))
spawns = list(dict.fromkeys(spawns))
print("existing spawns:", len(spawns))

new = []
# 1) MORE spawn points: jittered copies of each existing spawn (engine skips any
#    that land blocked), spread players out for 30-slot FFA.
nsp = 0
for (x,y,z) in spawns:
    for _ in range(3):
        jx = x + random.randint(-112, 112)
        jy = y + random.randint(-112, 112)
        new.append('{\n"origin" "%d %d %d"\n"angles" "0 %d 0"\n"classname" "info_player_deathmatch"\n}'
                    % (jx, jy, z+1, random.randint(0,359)))
        nsp += 1

# 2) Scattered weapons: lerp between random pairs of spawns -> points spread
#    AROUND the map, distinct from the spawn locations themselves.
WEAPONS = [4,6,10,8,2,11,7,5,13,0,15,16,12,3]  # ak,m4,awp,scout,p90,m3,aug,sg552,m249,mp5,he,kevlar,xm1014,mac10
nw = 0
for i in range(34):
    a, b = random.sample(spawns, 2)
    t = random.uniform(0.3, 0.7)
    wx = int(a[0] + (b[0]-a[0])*t)
    wy = int(a[1] + (b[1]-a[1])*t)
    wz = int(a[2] + (b[2]-a[2])*t) + 18
    item = WEAPONS[i % len(WEAPONS)]
    new.append('{\n"origin" "%d %d %d"\n"count" "50"\n"item" "%d"\n"classname" "armoury_entity"\n}' % (wx,wy,wz,item))
    nw += 1

print(f"added {nsp} spawn points, {nw} scattered weapons")
new_text = ent_text.rstrip() + "\n" + "\n".join(new) + "\n"
lumps[0] = new_text.encode("latin-1") + b"\x00"

out = bytearray(4 + NLUMP*8)
struct.pack_into("<i", out, 0, 30)
for i in range(NLUMP):
    off = len(out); out += lumps[i]
    while len(out) % 4: out += b"\x00"
    struct.pack_into("<ii", out, 4+i*8, off, len(lumps[i]))
open(OUT,"wb").write(out)
print(f"wrote {OUT}: {len(out)} bytes")
