import {loadAsync} from 'jszip'
import xashURL from 'xash3d-fwgs/xash.wasm?url'
import gl4esURL from 'xash3d-fwgs/libref_webgl2.wasm?url'
import {Xash3DWebRTC} from "./webrtc";

// The in-game menu is now the native ChainStrike mainui (compiled into
// menu_emscripten_wasm32.wasm). Its "Quit to Lobby" button can't navigate the
// browser from inside the wasm sandbox, so it emits the token below (and then
// quits, firing onExit). Either signal redirects the page here.
const LOBBY_URL = 'https://chainstrike.fun'
const QUIT_TOKEN = '__CS_QUIT_LOBBY__'
let leavingToLobby = false
function goToLobby() {
    if (leavingToLobby) return
    leavingToLobby = true
    window.location.href = LOBBY_URL
}

// Keep the browser tab branded — the CS engine renames document.title to
// "Counter-Strike" once it boots, so re-assert ChainStrike continuously.
document.title = 'ChainStrike'
setInterval(() => { if (document.title !== 'ChainStrike') document.title = 'ChainStrike' }, 1000)

// Block the in-game developer console — players shouldn't reach it. The console
// toggle is the backtick/tilde key; swallow it at the window capture phase so it
// never reaches the engine's canvas key handler.
const blockConsoleKey = (e: KeyboardEvent) => {
    if (e.code === 'Backquote' || e.key === '`' || e.key === '~') {
        e.preventDefault()
        e.stopImmediatePropagation()
    }
}
window.addEventListener('keydown', blockConsoleKey, true)
window.addEventListener('keyup', blockConsoleKey, true)

const touchControls = document.getElementById('touchControls') as HTMLInputElement
touchControls.addEventListener('change', () => {
    localStorage.setItem('touchControls', String(touchControls.checked))
})

// Landscape-first on mobile: on the first tap, go fullscreen and (where supported)
// lock to landscape. iOS Safari ignores orientation.lock — the #rotate prompt
// (CSS, portrait only) covers that. Pure UX; does not touch the game transport.
if (window.matchMedia('(pointer: coarse)').matches) {
    const rotate = document.getElementById('rotate')
    const lockLandscape = () => {
        const el = document.documentElement as HTMLElement & { requestFullscreen?: () => Promise<void> }
        Promise.resolve(el.requestFullscreen?.())
            .then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> })?.lock?.('landscape'))
            .catch(() => { /* unsupported — rotate prompt handles it */ })
    }
    window.addEventListener('touchend', lockLandscape, { once: true })
    // The prompt is never a hard block: tapping it dismisses and drops you in.
    // Essential for phones with rotation lock on (turning the device won't switch
    // the browser to landscape, so the media query alone would trap the player).
    rotate?.addEventListener('click', () => { if (rotate) rotate.hidden = true })
}

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

// Lightweight DOM touch controls (move pad + fire). Inputs are injected via the
// engine's +/- button commands, so there are no textures to load (no OOM) and the
// transport is untouched. Step 1: move + fire; look/jump/etc come next.
function setupTouchControls(x: { Cmd_ExecuteString: (cmd: string) => void }) {
    const mctl = document.getElementById('mctl')
    const pad = document.getElementById('mpad')
    const nub = document.getElementById('mnub')
    const fire = document.getElementById('mfire')
    if (!mctl || !pad || !nub || !fire) return
    mctl.hidden = false

    const active = new Set<string>()
    const set = (cmd: string, on: boolean) => {
        if (on && !active.has(cmd)) { active.add(cmd); x.Cmd_ExecuteString('+' + cmd) }
        else if (!on && active.has(cmd)) { active.delete(cmd); x.Cmd_ExecuteString('-' + cmd) }
    }
    const clearMove = () => { ['forward', 'back', 'moveleft', 'moveright'].forEach((c) => set(c, false)); nub.style.transform = '' }

    let padId: number | null = null
    const padMove = (t: Touch) => {
        const r = pad.getBoundingClientRect()
        const max = r.width / 2
        let dx = t.clientX - (r.left + max)
        let dy = t.clientY - (r.top + max)
        const dist = Math.hypot(dx, dy)
        if (dist > max) { dx *= max / dist; dy *= max / dist }
        nub.style.transform = `translate(${dx}px, ${dy}px)`
        const dz = max * 0.28
        set('forward', dy < -dz); set('back', dy > dz)
        set('moveleft', dx < -dz); set('moveright', dx > dz)
    }
    pad.addEventListener('touchstart', (e) => { e.preventDefault(); const t = e.changedTouches[0]; padId = t.identifier; padMove(t) }, { passive: false })
    pad.addEventListener('touchmove', (e) => { e.preventDefault(); for (const t of Array.from(e.changedTouches)) if (t.identifier === padId) padMove(t) }, { passive: false })
    const padEnd = (e: TouchEvent) => { for (const t of Array.from(e.changedTouches)) if (t.identifier === padId) { padId = null; clearMove() } }
    pad.addEventListener('touchend', padEnd); pad.addEventListener('touchcancel', padEnd)

    fire.addEventListener('touchstart', (e) => { e.preventDefault(); x.Cmd_ExecuteString('+attack') }, { passive: false })
    const fireEnd = (e: TouchEvent) => { e.preventDefault(); x.Cmd_ExecuteString('-attack') }
    fire.addEventListener('touchend', fireEnd, { passive: false }); fire.addEventListener('touchcancel', fireEnd)

    // Look/aim: right-side drag zone. Mouse injection doesn't reach the engine on
    // mobile, so use the keyboard-look button commands (+left/+right/+lookup/
    // +lookdown) — the same Cmd_ExecuteString path that move uses. Joystick-style:
    // hold the drag off-center to keep turning that way; release to stop.
    const look = document.getElementById('mlook')
    x.Cmd_ExecuteString('cl_yawspeed 280')
    x.Cmd_ExecuteString('cl_pitchspeed 240')
    let lookId: number | null = null, lsx = 0, lsy = 0
    const clearLook = () => ['left', 'right', 'lookup', 'lookdown'].forEach((c) => set(c, false))
    const lookMove = (t: Touch) => {
        const dx = t.clientX - lsx, dy = t.clientY - lsy
        const dz = 16
        set('right', dx > dz); set('left', dx < -dz)
        set('lookup', dy < -dz); set('lookdown', dy > dz)
    }
    look?.addEventListener('touchstart', (e) => { e.preventDefault(); const t = e.changedTouches[0]; lookId = t.identifier; lsx = t.clientX; lsy = t.clientY }, { passive: false })
    look?.addEventListener('touchmove', (e) => { e.preventDefault(); for (const t of Array.from(e.changedTouches)) if (t.identifier === lookId) lookMove(t) }, { passive: false })
    const lookEnd = (e: TouchEvent) => { for (const t of Array.from(e.changedTouches)) if (t.identifier === lookId) { lookId = null; clearLook() } }
    look?.addEventListener('touchend', lookEnd); look?.addEventListener('touchcancel', lookEnd)
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
        module: {
            // native "Quit to Lobby" -> echo token; catch it in console output
            print: (text: string) => {
                if (typeof text === 'string' && text.includes(QUIT_TOKEN)) goToLobby()
            },
            // fallback: engine quit tears down the runtime -> redirect anyway
            onExit: () => goToLobby(),
        },
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
    // Mobile gets the lightweight DOM control overlay — the engine's touch_enable
    // loads a button texture set that OOMs low-memory phones. Desktop = kbd+mouse.
    const isTouchDevice = window.matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints ?? 0) > 0
    if (isTouchDevice) {
        setupTouchControls(x)
    } else if (touchControls.checked) {
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

    // hide the load splash once we've dropped into the match. The in-game
    // menu (ESC) is now handled entirely by the native ChainStrike mainui.
    setTimeout(() => {
        const c = document.getElementById('connecting')
        if (c) { c.style.opacity = '0'; setTimeout(() => { c.style.display = 'none' }, 600) }
    }, 7000)

    // Guard accidental tab-close, but let an intentional "Quit to Lobby"
    // (which sets leavingToLobby) navigate away without a prompt.
    window.addEventListener('beforeunload', (event) => {
        if (leavingToLobby) return
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
    form.style.display = 'none'; document.getElementById('connecting')!.style.display = 'flex'
    usernamePromiseResolve(username)
})

document.getElementById('spectate')!.addEventListener('click', () => {
    spectateMode = true
    form.style.display = 'none'; document.getElementById('connecting')!.style.display = 'flex'
    const name = (document.getElementById('username') as HTMLInputElement).value || 'spectator'
    usernamePromiseResolve(name)
})

// ?name=<callsign> -> the dashboard launched us with a registered callsign;
// skip the form and drop straight in under that exact name (so the leaderboard
// resolves it to the player's wallet for payouts).
const presetName = new URLSearchParams(window.location.search).get('name')
if (presetName && !spectateMode) {
    localStorage.setItem('username', presetName)
    ;(document.getElementById('username') as HTMLInputElement).value = presetName
    form.style.display = 'none'; document.getElementById('connecting')!.style.display = 'flex'
    usernamePromiseResolve(presetName)
}

// ?spectate -> jump straight into spectator view, no form
if (spectateMode) {
    form.style.display = 'none'; document.getElementById('connecting')!.style.display = 'flex'
    usernamePromiseResolve('spectator')
}

main()