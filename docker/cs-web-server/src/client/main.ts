import {loadAsync} from 'jszip'
import xashURL from 'xash3d-fwgs/xash.wasm?url'
import gl4esURL from 'xash3d-fwgs/libref_webgl2.wasm?url'
import {Xash3DWebRTC} from "./webrtc";

const touchControls = document.getElementById('touchControls') as HTMLInputElement
touchControls.addEventListener('change', () => {
    localStorage.setItem('touchControls', String(touchControls.checked))
})

let usernamePromiseResolve: (name: string) => void
const usernamePromise = new Promise<string>(resolve => {
    usernamePromiseResolve = resolve
})

let spectateMode = new URLSearchParams(window.location.search).has('spectate')

async function fetchWithProgress(url: string) {
    const progress = document.getElementById('progress') as HTMLProgressElement
    const res = await fetch(url);

    const contentLength = res.headers.get('Content-Length');

    const total = contentLength ? parseInt(contentLength, 10) : null;
    const reader = res.body!.getReader();
    const chunks = [];
    let received = 0;

    while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        chunks.push(value);
        received += value.length;

        if ( total !== null) {
            progress.value = received / total
        } else {
            progress.value = received
        }
    }

    progress.style.opacity = '0'

    const blob = new Blob(chunks);
    return blob.arrayBuffer()
}

async function main() {
    // Load dynamic configuration from server (environment variables)
    const config = await fetch("/config").then(res => res.json()) as Awaited<{
        arguments: string[];
        console: string[];
        game_dir: string;
        libraries: {
            client: string;
            server: string;
            extras: string;
            menu: string;
            filesystem: string;
        };
        dynamic_libraries: string[];
        files_map: Record<string, string>;
    }>

    // Use URLs directly from server config (no imports needed)
    const x = new Xash3DWebRTC({
        canvas: document.getElementById('canvas') as HTMLCanvasElement,
        arguments: config.arguments || ['-windowed'],
        libraries: {
            filesystem: config.libraries.filesystem,
            xash: xashURL,
            menu: config.libraries.menu,
            server: config.libraries.server,
            client: config.libraries.client,
            render: {
                gl4es: gl4esURL,
            }
        },
        dynamicLibraries: config.dynamic_libraries,
        filesMap: config.files_map,
    });

    const [zip, extras] = await Promise.all([
        (async () => {
            const res = await fetchWithProgress('valve.zip')
            return await loadAsync(res);
        })(),
        (async () => {
            const res = await fetch(config.libraries.extras)
            return await res.arrayBuffer();
        })(),
        x.init(),
    ])

    await Promise.all(Object.entries(zip.files).map(async ([filename, file]) => {
        if (file.dir) return;

        const path = '/rodir/' + filename;
        const dir = path.split('/').slice(0, -1).join('/');

        x.em.FS.mkdirTree(dir);
        x.em.FS.writeFile(path, await file.async("uint8array"));
    }))

    x.em.FS.writeFile(`/rodir/${config.game_dir}/extras.pk3`, new Uint8Array(extras))
    x.em.FS.chdir('/rodir')

    const logo = document.getElementById('logo')
    if (logo) {
        logo.style.animationName = 'pulsate-end'
        logo.style.animationFillMode = 'forwards'
        logo.style.animationIterationCount = '1'
        logo.style.animationDirection = 'normal'
    }

    const username = await usernamePromise
    x.main()
    if (touchControls.checked) {
        x.Cmd_ExecuteString('touch_enable 1')
    }
    x.Cmd_ExecuteString(`name "${username}"`)
    
    // Execute custom server commands
    if (config.console && Array.isArray(config.console)) {
        config.console.forEach((cmd: string) => {
            x.Cmd_ExecuteString(cmd)
        })
    }
    
    // Drop straight into the configured session; retry in case the first
    // connect fires before the engine has left the main menu.
    const joinServer = () => x.Cmd_ExecuteString('connect 127.0.0.1:8080')
    joinServer()
    setTimeout(joinServer, 2000)
    setTimeout(joinServer, 5000)
    if (spectateMode) {
        setTimeout(() => x.Cmd_ExecuteString('spectate'), 6000)
    }

    window.addEventListener('beforeunload', (event) => {
        event.preventDefault();
        event.returnValue = '';
        return '';
    });
}
const enableTouch = localStorage.getItem('touchControls')
if (enableTouch === null) {
    const isMobile = !window.matchMedia('(hover: hover)').matches;
    touchControls.checked = isMobile
    localStorage.setItem('touchControls', String(isMobile))
} else {
    touchControls.checked = enableTouch === 'true'
}

const username = localStorage.getItem('username')
if (username) {
    (document.getElementById('username') as HTMLInputElement).value = username
}

const form = document.getElementById('form') as HTMLFormElement

form.addEventListener('submit', (e) => {
    e.preventDefault()
    const username = (document.getElementById('username') as HTMLInputElement).value
    localStorage.setItem('username', username)
    form.style.display = 'none'
    usernamePromiseResolve(username)
})

document.getElementById('spectate')!.addEventListener('click', () => {
    spectateMode = true
    form.style.display = 'none'
    const name = (document.getElementById('username') as HTMLInputElement).value || 'spectator'
    usernamePromiseResolve(name)
})

// ?spectate -> jump straight into spectator view, no form
if (spectateMode) {
    form.style.display = 'none'
    usernamePromiseResolve('spectator')
}

main()