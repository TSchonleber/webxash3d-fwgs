# add_weapon_spawns.py

Edits a GoldSrc BSP (v30) **entity lump only** (no recompile) to make an FFA DM
arena with well-spread spawns and weapon pickups.

Key fix vs naive approaches: it samples the map's real **floor faces** (upward
normal, sizable area, ground Z band), then does a **greedy minimum-distance
(Poisson-disk) pick** so no two spawns are closer than ~430 units. That stops
players respawning on top of each other / right next to whoever just killed them.
Both `info_player_start` AND `info_player_deathmatch` are placed at each location
so FFA uses all spawns regardless of nominal team. Weapons (armoury_entity) are
spread the same way.

Map CRC excludes the entity lump, so the edited server map stays consistent with
the stock client map (no valve.zip re-pack).

Pair with (configs/cstrike/server-dm.cfg):
  mp_freeforall 1 ; mp_randomspawn 1
  mp_weapons_allow_map_placed 1
  mp_weapon_respawn_time 15 ; mp_item_staytime 90
  mp_t/ct_default_weapons_primary ""

Deploy: bind-mount edited bsp over /xashds/cstrike/maps/de_train.bsp, restart.
