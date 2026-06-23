# add_weapon_spawns.py

Edits a GoldSrc BSP (v30) entity lump (no recompile) into an FFA DM arena with
**surgically placed** spawns + weapon pickups that actually spread players out.

Why the naive versions failed: sampling floor-face centroids grabbed elevated
geometry (train-tops, ledges) that the engine rejects, so it fell back to the
map's original spawns — which on de_train are bunched in two team zones.

This version:
1. Reads the original info_player spawns to learn the **walkable origin-Z band**.
2. Grids the map; for each XY does a **point-in-polygon** test against floor
   faces, keeping only points that sit on a real floor within that Z band, and
   snaps the spawn to it. (No off-floor / elevated spawns.)
3. **Greedy min-distance (~430u) pick** so no two spawns are close.
4. **Removes the original clustered spawns** and writes only the spread set
   (both info_player_start + info_player_deathmatch so FFA uses all of them).
5. Spreads armoury_entity weapon pickups the same way.

Map CRC excludes the entity lump -> edited server map stays consistent with the
stock client map (no valve.zip re-pack).

cfg: mp_freeforall 1 ; mp_randomspawn 1 ; mp_weapons_allow_map_placed 1 ;
     mp_weapon_respawn_time 15 ; mp_item_staytime 90 ; default primaries "".
Deploy: bind-mount edited bsp over /xashds/cstrike/maps/de_train.bsp, restart.
