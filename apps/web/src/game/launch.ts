// Wires the ported Xash3DWebRTC embed + asset URLs into a single launch routine.
// Mirrors examples/react-typescript-cs16-webrtc/src/App.tsx. Imported lazily.
import { loadAsync } from "jszip";
import { Xash3DWebRTC } from "./webrtc";
import { assetUrls } from "./assets";

export interface LaunchHandle {
  game: Xash3DWebRTC;
}

/**
 * Boot the engine and (attempt to) connect to a cs-web-server.
 * Throws if assets (valve.zip) or the server are unavailable — the caller
 * surfaces the "assets required / connecting" state.
 */
export async function launchGame(canvas: HTMLCanvasElement): Promise<LaunchHandle> {
  const game = new Xash3DWebRTC({
    canvas,
    arguments: ["-windowed", "-game", "cstrike"],
    libraries: {
      filesystem: assetUrls.filesystem,
      xash: assetUrls.xash,
      menu: assetUrls.menu,
      server: assetUrls.server,
      client: assetUrls.client,
      render: { gles3compat: assetUrls.gles3compat },
    },
    dynamicLibraries: ["dlls/cs_emscripten_wasm32.wasm", "/rodir/filesystem_stdio.wasm"],
    filesMap: {
      "dlls/cs_emscripten_wasm32.wasm": assetUrls.server,
      "/rodir/filesystem_stdio.wasm": assetUrls.filesystem,
    },
  });

  const [zip, extras] = await Promise.all([
    (async () => {
      const res = await fetch("valve.zip");
      if (!res.ok) throw new Error("valve.zip not found — CS 1.6 assets required");
      return loadAsync(await res.arrayBuffer());
    })(),
    (async () => {
      const res = await fetch(assetUrls.extras);
      return res.arrayBuffer();
    })(),
    game.init(),
  ]);

  if (game.exited) return { game };

  await Promise.all(
    Object.entries(zip.files).map(async ([filename, file]) => {
      if (file.dir) return;
      const path = "/rodir/" + filename;
      const dir = path.split("/").slice(0, -1).join("/");
      game.em.FS.mkdirTree(dir);
      game.em.FS.writeFile(path, await file.async("uint8array"));
    }),
  );

  game.em.FS.writeFile("/rodir/cstrike/extras.pk3", new Uint8Array(extras));
  game.em.FS.writeFile("/rodir/extras.pk3", new Uint8Array(extras));
  game.em.FS.writeFile("/extras.pk3", new Uint8Array(extras));

  game.em.FS.chdir("/rodir");
  game.main();
  game.Cmd_ExecuteString("_vgui_menus 0");
  game.Cmd_ExecuteString("touch_enable 1");

  return { game };
}
