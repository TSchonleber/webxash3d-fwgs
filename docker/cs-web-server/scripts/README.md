# add_weapon_spawns.py

Turns a GoldSrc map into an FFA DM arena by editing the BSP **entity lump only**
(no recompile). Crucially, it samples the map's real **floor geometry** rather
than anchoring to the existing spawns (which on de_train are bunched in the two
team-spawn zones), so spawns and weapons spread across the whole level.

How:
1. Parse PLANES/VERTEXES/EDGES/SURFEDGES/FACES; keep faces whose normal points
   up (floor), above a min area, within a ground+platform Z band.
2. Bucket floor-face centroids into a 384-unit XY grid → even map-wide coverage.
3. Place ~2 `info_player_deathmatch` spawns per cell (jittered) and ~40
   `armoury_entity` weapons across distinct cells (AK/M4/AWP/Scout/P90/M3/AUG/
   SG552/M249/MP5/XM1014/MAC10 + HE/kevlar).

Map CRC excludes the entity lump → edited server map stays consistent with the
stock client map (no valve.zip re-pack).

Pair with (configs/cstrike/server-dm.cfg):
  mp_freeforall 1 ; mp_randomspawn 1
  mp_weapons_allow_map_placed 1
  mp_weapon_respawn_time 15 ; mp_item_staytime 90
  mp_t/ct_default_weapons_primary ""

Deploy: bind-mount edited bsp over /xashds/cstrike/maps/de_train.bsp, restart.
