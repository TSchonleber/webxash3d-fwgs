# add_weapon_spawns.py

Edits a GoldSrc BSP (v30) **entity lump only** — no recompile — to scatter
`armoury_entity` weapon pickups across the map at its spawn points.

Used to turn de_train into a DM arena with weapon pickups (AK/M4/AWP/Scout/P90/
M3/AUG/SG552/M249/MP5/HE/kevlar). The map CRC excludes the entity lump, so the
edited server map stays consistent with the stock client map (no re-pack of
valve.zip needed).

Pair with these server cvars (configs/cstrike/server-dm.cfg):
  mp_weapons_allow_map_placed 1
  mp_weapon_respawn_time 15 ; mp_item_staytime 90
  mp_t/ct_default_weapons_primary ""   # pistol start so pickups matter

Deploy: bind-mount the edited bsp over /xashds/cstrike/maps/de_train.bsp.
