# add_weapon_spawns.py

Edits a GoldSrc BSP (v30) entity lump (no recompile) into an FFA DM arena with
spawns that are **spread out AND in clear walkable space**.

The hard part on de_train: its train cars are *solid world geometry* (no
func_train entity), so a point can sit on a floor face yet be inside a train.
Earlier passes only checked for a floor below the point and spawned players
inside trains/walls.

This version:
1. Reads original spawns to learn the walkable origin-Z band, and as a SANITY
   CHECK confirms every original reads EMPTY in the player collision hull
   (validates the hull traversal before trusting it).
2. For a grid of XY points: finds the floor under it (point-in-polygon) at the
   walkable Z, then **traces the world hull-1 (player) clipnodes** at the spawn
   origin and keeps it only if EMPTY (clear of solid world geometry incl. trains).
3. Also excludes points inside solid func_wall / func_breakable brush volumes.
4. Greedy min-distance (~370u) spread; both info_player_start + _deathmatch per
   location; original clustered spawns stripped so only the spread set remains.
5. Spreads armoury_entity weapon pickups the same way.

Map CRC excludes the entity lump -> edited server map stays consistent with the
stock client map (no valve.zip re-pack).

cfg: mp_freeforall 1 ; mp_randomspawn 1 ; mp_weapons_allow_map_placed 1 ;
     mp_weapon_respawn_time 15 ; mp_item_staytime 90 ; default primaries "".
Deploy: bind-mount edited bsp over /xashds/cstrike/maps/de_train.bsp, restart.
