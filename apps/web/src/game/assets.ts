// Vite resolves these to emitted asset URLs via the `?url` suffix.
// Imported dynamically by GamePanel so the build is not gated on them.
import filesystemURL from "xash3d-fwgs/filesystem_stdio.wasm?url";
import xashURL from "xash3d-fwgs/xash.wasm?url";
import gles3URL from "xash3d-fwgs/libref_gles3compat.wasm?url";
import menuURL from "cs16-client/cl_dll/menu_emscripten_wasm32.wasm?url";
import clientURL from "cs16-client/cl_dll/client_emscripten_wasm32.wasm?url";
import serverURL from "cs16-client/dlls/cs_emscripten_wasm32.wasm?url";
import extrasURL from "cs16-client/extras.pk3?url";

export const assetUrls = {
  filesystem: filesystemURL,
  xash: xashURL,
  gles3compat: gles3URL,
  menu: menuURL,
  client: clientURL,
  server: serverURL,
  extras: extrasURL,
};
