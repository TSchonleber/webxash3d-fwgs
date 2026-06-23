import struct, sys, re, random

BSP = "/tmp/de_train.bsp"
OUT = "/tmp/de_train_dm.bsp"
random.seed(7)

data = bytearray(open(BSP, "rb").read())
version = struct.unpack_from("<i", data, 0)[0]
assert version == 30, version
# 15 lumps, dir at offset 4: (offset, length) each
NLUMP = 15
dirs = [list(struct.unpack_from("<ii", data, 4 + i*8)) for i in range(NLUMP)]
# read each lump's bytes
lumps = [bytes(data[off:off+ln]) for (off, ln) in dirs]

ent_text = lumps[0].split(b"\x00")[0].decode("latin-1")

# collect spawn origins
origins = []
for m in re.finditer(r'\{[^{}]*\}', ent_text):
    block = m.group(0)
    cn = re.search(r'"classname"\s*"([^"]+)"', block)
    og = re.search(r'"origin"\s*"([^"]+)"', block)
    if cn and og and cn.group(1) in ("info_player_start","info_player_deathmatch","info_vip_start"):
        origins.append(og.group(1).strip())

origins = list(dict.fromkeys(origins))  # dedupe, keep order
print(f"found {len(origins)} spawn origins")

# weapon variety (armoury_entity item enum)
WEAPONS = [4,6,10,8,2,11,7,5,13,0,15,16]  # ak,m4,awp,scout,p90,m3,aug,sg552,m249,mp5,he,kevlar
# place a weapon at ~every spawn (skip a few so not all spawns have one)
new_ents = []
wi = 0
for i, og in enumerate(origins):
    if i % 5 == 4:  # skip 1 of every 5
        continue
    x,y,z = og.split()
    z = str(int(float(z)) + 16)  # nudge up so it rests on the floor cleanly
    item = WEAPONS[wi % len(WEAPONS)]; wi += 1
    new_ents.append('{\n"origin" "%s %s %s"\n"count" "50"\n"item" "%d"\n"classname" "armoury_entity"\n}' % (x,y,z,item))

print(f"placing {len(new_ents)} weapon spawns")
new_text = ent_text.rstrip() + "\n" + "\n".join(new_ents) + "\n"
lumps[0] = new_text.encode("latin-1") + b"\x00"

# repack: header (124 bytes) + lumps in index order
out = bytearray(4 + NLUMP*8)
struct.pack_into("<i", out, 0, version)
cursor = len(out)
for i in range(NLUMP):
    off = cursor
    out += lumps[i]
    # pad to 4-byte boundary
    while len(out) % 4: out += b"\x00"
    struct.pack_into("<ii", out, 4 + i*8, off, len(lumps[i]))
    cursor = len(out)

open(OUT, "wb").write(out)
print(f"wrote {OUT}: {len(out)} bytes (orig {len(data)})")
