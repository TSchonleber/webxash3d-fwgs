# add_weapon_spawns.py

Edits a GoldSrc BSP (v30) **entity lump only** — no recompile — to turn a map
into an FFA DM arena:

1. **Spawn points** — adds jittered `info_player_deathmatch` entities (3 per
   existing spawn) so a 30-player free-for-all spreads out instead of stacking.
   Blocked jitters are skipped by the engine's spawn-validity check.
2. **Weapon pickups** — scatters `armoury_entity` weapons at interpolated points
   *between* spawn pairs (AK/M4/AWP/Scout/P90/M3/AUG/SG552/M249/MP5/XM1014/MAC10
   + HE/kevlar), away from the spawns themselves.

The map CRC excludes the entity lump, so the edited server map stays consistent
with the stock client map (no valve.zip re-pack needed).

Pair with (configs/cstrike/server-dm.cfg):
  mp_freeforall 1 ; mp_randomspawn 1
  mp_weapons_allow_map_placed 1
  mp_weapon_respawn_time 15 ; mp_item_staytime 90
  mp_t/ct_default_weapons_primary ""   # pistol start so pickups matter

Deploy: bind-mount the edited bsp over /xashds/cstrike/maps/de_train.bsp, restart.
