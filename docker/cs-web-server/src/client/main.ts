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

// Voice chat is disabled, but the engine (and iOS) can still pop a "use your
// microphone" prompt during init. Intercept audio-only getUserMedia and reject it
// so the prompt never appears — gameplay needs no mic.
if (navigator.mediaDevices?.getUserMedia) {
    const realGUM = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
    navigator.mediaDevices.getUserMedia = (constraints?: MediaStreamConstraints) => {
        if (constraints && constraints.audio && !constraints.video) {
            return Promise.reject(new DOMException('microphone disabled', 'NotAllowedError'))
        }
        return realGUM(constraints)
    }
}

// Mobile audio unlock: browsers start every AudioContext suspended until a user
// gesture, and our control overlay can starve the engine's own unlock. Patch the
// constructor (before the engine creates its context) to capture instances, then
// resume them on the first tap/click. Keeps resuming in case iOS re-suspends.
const audioCtxs: AudioContext[] = []
for (const key of ['AudioContext', 'webkitAudioContext'] as const) {
    const Orig = (window as unknown as Record<string, typeof AudioContext>)[key]
    if (!Orig) continue
    ;(window as unknown as Record<string, unknown>)[key] = class extends Orig {
        constructor(...args: ConstructorParameters<typeof AudioContext>) { super(...args); audioCtxs.push(this) }
    }
}
const resumeAudio = () => { for (const c of audioCtxs) if (c.state === 'suspended') c.resume().catch(() => {}) }
for (const ev of ['touchend', 'pointerup', 'click']) window.addEventListener(ev, resumeAudio)

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

// The engine instance, exposed so the top-level control poll can wire to it
// regardless of where main() is in its async flow.
let engine: { Cmd_ExecuteString: (cmd: string) => void } | null = null

// Lightweight DOM controls (move pad + look + fire). Inputs go through the engine's
// +/- button commands — no textures to load (no OOM), transport untouched. Uses
// Pointer Events so it works with touch (phone) AND mouse (desktop demo).
let touchWired = false
function setupTouchControls(x: { Cmd_ExecuteString: (cmd: string) => void }): boolean {
    const mctl = document.getElementById('mctl')
    if (mctl) mctl.hidden = false              // always reveal the overlay if present
    if (touchWired) return true                 // wire the handlers only once
    const pad = document.getElementById('mpad')
    const nub = document.getElementById('mnub')
    const fire = document.getElementById('mfire')
    const look = document.getElementById('mlook')
    if (!mctl || !pad || !nub || !fire || !look) return false   // not ready — caller retries
    touchWired = true

    const active = new Set<string>()
    const set = (cmd: string, on: boolean) => {
        if (on && !active.has(cmd)) { active.add(cmd); x.Cmd_ExecuteString('+' + cmd) }
        else if (!on && active.has(cmd)) { active.delete(cmd); x.Cmd_ExecuteString('-' + cmd) }
    }

    // ---- move pad (left) ----
    const clearMove = () => { ['forward', 'back', 'moveleft', 'moveright'].forEach((c) => set(c, false)); nub.style.transform = '' }
    let padId: number | null = null
    const padMove = (cx: number, cy: number) => {
        const r = pad.getBoundingClientRect()
        const max = r.width / 2
        let dx = cx - (r.left + max), dy = cy - (r.top + max)
        const dist = Math.hypot(dx, dy)
        if (dist > max) { dx *= max / dist; dy *= max / dist }
        nub.style.transform = `translate(${dx}px, ${dy}px)`
        const dz = max * 0.28
        set('forward', dy < -dz); set('back', dy > dz)
        set('moveleft', dx < -dz); set('moveright', dx > dz)
    }
    pad.addEventListener('pointerdown', (e) => { e.preventDefault(); padId = e.pointerId; pad.setPointerCapture(e.pointerId); padMove(e.clientX, e.clientY) })
    pad.addEventListener('pointermove', (e) => { if (e.pointerId === padId) { e.preventDefault(); padMove(e.clientX, e.clientY) } })
    const padEnd = (e: PointerEvent) => { if (e.pointerId === padId) { padId = null; clearMove() } }
    pad.addEventListener('pointerup', padEnd); pad.addEventListener('pointercancel', padEnd)

    // ---- fire (right) ----
    const fireUp = () => x.Cmd_ExecuteString('-attack')
    fire.addEventListener('pointerdown', (e) => { e.preventDefault(); fire.setPointerCapture(e.pointerId); x.Cmd_ExecuteString('+attack') })
    fire.addEventListener('pointerup', fireUp); fire.addEventListener('pointercancel', fireUp); fire.addEventListener('pointerleave', fireUp)

    // ---- look/aim (right-side drag): joystick-style keyboard-look ----
    // Hold the drag off-center to keep turning that way; release to stop.
    // NOTE: never call Cmd_ExecuteString at wire time — if the engine isn't fully
    // ready it throws and aborts the rest of the control wiring. Set turn speed
    // lazily on the first drag instead.
    const clearLook = () => ['left', 'right', 'lookup', 'lookdown'].forEach((c) => set(c, false))
    let lookId: number | null = null, lsx = 0, lsy = 0, lookSpeedSet = false
    const lookMove = (cx: number, cy: number) => {
        const dx = cx - lsx, dy = cy - lsy, dz = 16
        set('right', dx > dz); set('left', dx < -dz)
        set('lookup', dy < -dz); set('lookdown', dy > dz)
    }
    look.addEventListener('pointerdown', (e) => {
        e.preventDefault()
        if (!lookSpeedSet) { x.Cmd_ExecuteString('cl_yawspeed 130'); x.Cmd_ExecuteString('cl_pitchspeed 110'); lookSpeedSet = true }
        lookId = e.pointerId; look.setPointerCapture(e.pointerId); lsx = e.clientX; lsy = e.clientY
    })
    look.addEventListener('pointermove', (e) => { if (e.pointerId === lookId) { e.preventDefault(); lookMove(e.clientX, e.clientY) } })
    const lookEnd = (e: PointerEvent) => { if (e.pointerId === lookId) { lookId = null; clearLook() } }
    look.addEventListener('pointerup', lookEnd); look.addEventListener('pointercancel', lookEnd)

    // ---- tap action buttons ----
    const tap = (id: string, cmd: string) => {
        document.getElementById(id)?.addEventListener('pointerdown', (e) => { e.preventDefault(); x.Cmd_ExecuteString(cmd) })
    }
    tap('mswap', 'invnext')   // cycle to next weapon
    tap('mdrop', 'drop')      // drop current weapon
    document.getElementById('mquit')?.addEventListener('pointerdown', (e) => { e.preventDefault(); goToLobby() })

    // ---- hold buttons (+cmd while pressed) ----
    const hold = (id: string, cmd: string) => {
        const el = document.getElementById(id); if (!el) return
        const up = () => x.Cmd_ExecuteString('-' + cmd)
        el.addEventListener('pointerdown', (e) => { e.preventDefault(); el.setPointerCapture((e as PointerEvent).pointerId); x.Cmd_ExecuteString('+' + cmd) })
        el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('pointerleave', up)
    }
    hold('mjump', 'jump')
    hold('mcrouch', 'duck')
    hold('mreload', 'reload')
    hold('malt', 'attack2')   // right-click: silencer / zoom / burst depending on weapon

    // ---- sound toggle ----
    let muted = false
    const snd = document.getElementById('msound')
    snd?.addEventListener('pointerdown', (e) => {
        e.preventDefault()
        muted = !muted
        x.Cmd_ExecuteString('volume ' + (muted ? '0' : '1'))
        snd.textContent = muted ? '🔇' : '🔊'
    })

}

// Chat — works on all devices. Mobile opens it via the CHAT button; desktop via
// the Y or Enter key (CS convention). Messages go through the engine's `say`.
let chatWired = false
function setupChat(x: { Cmd_ExecuteString: (cmd: string) => void }): boolean {
    const chatbar = document.getElementById('chatbar')
    const chatinput = document.getElementById('chatinput') as HTMLInputElement | null
    if (!chatbar || !chatinput) return false
    if (chatWired) return true
    chatWired = true
    const open = () => { chatbar.classList.add('show'); chatinput.focus() }
    const close = () => { chatbar.classList.remove('show'); chatinput.blur() }
    const send = () => {
        // strip quotes/semicolons/newlines so a message can't break out of the
        // `say "..."` command into arbitrary console commands.
        const t = chatinput.value.replace(/["';\n\r]/g, '').trim().slice(0, 120)
        if (t) x.Cmd_ExecuteString(`say "${t}"`)
        chatinput.value = ''
        close()
    }
    document.getElementById('mchat')?.addEventListener('pointerdown', (e) => { e.preventDefault(); open() })
    document.getElementById('chatsend')?.addEventListener('pointerdown', (e) => { e.preventDefault(); send() })
    // keep typed keys out of the game engine while the chat field is focused
    for (const ev of ['keydown', 'keyup', 'keypress']) chatinput.addEventListener(ev, (e) => e.stopPropagation())
    chatinput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); send() }
        else if (e.key === 'Escape') close()
    })
    // Desktop: open chat with Y / Enter when not already typing (capture so the
    // engine doesn't also act on the key).
    window.addEventListener('keydown', (e) => {
        if (chatbar.classList.contains('show')) return
        const tag = (document.activeElement?.tagName ?? '').toLowerCase()
        if (tag === 'input' || tag === 'textarea') return
        if (e.key === 'y' || e.key === 'Y' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); open() }
    }, true)
    return true
}

async function main() {
    // The selected session ('' = de_train, '/d2' = de_dust2). Set by startGame()
    // before main() runs; routes /config, /players and the engine connection.
    const serverPath = (window as unknown as { __csServerPath?: string }).__csServerPath || ''
    // Load dynamic configuration from server (environment variables)
    const config = await fetch(`${serverPath}/config`).then(res => res.json()) as Awaited<{
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
    engine = x   // engine is initialized — only now is it safe for the poll to send console commands
    // Mobile gets the lightweight DOM control overlay — the engine's touch_enable
    // loads a button texture set that OOMs low-memory phones. Desktop = kbd+mouse.
    // Mobile controls are wired by the top-level poll (set up from page load).
    // Desktop may opt into the engine's own touch UI via the checkbox.
    const isTouchDevice = window.matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints ?? 0) > 0
    if (!isTouchDevice && touchControls.checked) x.Cmd_ExecuteString('touch_enable 1')

    // Audio: ensure not muted, and resume the engine's own SDL audio context on a
    // user gesture (the generic AudioContext patch may not catch the engine's one).
    x.Cmd_ExecuteString('volume 1')
    x.Cmd_ExecuteString('voice_enable 0')   // client voice off — no mic needed
    type Ctx = { resume?: () => void }
    const em = (x as unknown as { em?: { SDL2?: { audioContext?: Ctx }, SDL3?: { audioContext?: Ctx } } }).em
    const resumeEngineAudio = () => { try { em?.SDL2?.audioContext?.resume?.(); em?.SDL3?.audioContext?.resume?.() } catch { /* */ } }
    for (const ev of ['pointerdown', 'touchend', 'click']) window.addEventListener(ev, resumeEngineAudio)

    // iOS mutes WebAudio under the ringer switch unless an HTMLMediaElement has
    // played (which flips the audio session to 'playback'). Play a silent clip on
    // the first gesture so game audio is audible even with the switch on.
    const unlockIOS = () => {
        try {
            const a = document.createElement('audio')
            a.setAttribute('playsinline', ''); a.loop = true
            const rate = 8000, n = Math.floor(rate * 0.3), b = new ArrayBuffer(44 + n * 2), v = new DataView(b)
            const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)) }
            w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true)
            v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true)
            v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true)
            let s = ''; const u = new Uint8Array(b); for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i])
            a.src = 'data:audio/wav;base64,' + btoa(s)
            void a.play().catch(() => {})
        } catch { /* */ }
        window.removeEventListener('touchend', unlockIOS); window.removeEventListener('pointerdown', unlockIOS)
    }
    window.addEventListener('touchend', unlockIOS); window.addEventListener('pointerdown', unlockIOS)
    x.Cmd_ExecuteString(`name "${username}"`)
    
    // Execute custom server commands
    if (config.console && Array.isArray(config.console)) {
        config.console.forEach((cmd: string) => {
            x.Cmd_ExecuteString(cmd)
        })
    }
    
    // Join queue: the match caps at 30 players. Poll /players; if it's full, show
    // the queue and auto-join the moment a slot opens. Retry the connect a couple
    // times in case it fires before the engine has left the main menu.
    const joinServer = () => x.Cmd_ExecuteString('connect 127.0.0.1:8080')
    const queueEl = document.getElementById('queue')
    const queueCount = document.getElementById('queue-count')
    const connectingEl = document.getElementById('connecting')
    let joined = false
    const doJoin = () => {
        if (joined) return
        joined = true
        queueEl?.classList.remove('show')
        if (connectingEl) { connectingEl.style.display = 'flex'; connectingEl.style.opacity = '1' }
        joinServer()
        setTimeout(joinServer, 2000)
        setTimeout(joinServer, 5000)
        if (spectateMode) setTimeout(() => x.Cmd_ExecuteString('spectate'), 6000)
        // hide the load splash once we've dropped into the match
        setTimeout(() => {
            if (connectingEl) { connectingEl.style.opacity = '0'; setTimeout(() => { connectingEl.style.display = 'none' }, 600) }
        }, 7000)
    }
    const checkQueue = async () => {
        if (joined) return
        try {
            const res = await fetch(`${serverPath}/players`, { cache: 'no-store' })
            const { count, max } = (await res.json()) as { count: number; max: number }
            if (count < max) { doJoin(); return }
            // full — show the queue and keep polling
            if (connectingEl) connectingEl.style.display = 'none'
            queueEl?.classList.add('show')
            if (queueCount) queueCount.textContent = `${count} / ${max} in match`
        } catch {
            doJoin(); return // if the count check fails, just try to connect
        }
        setTimeout(checkQueue, 3000)
    }
    checkQueue()

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
// skip the form and drop straight in (the name resolves to the player's wallet).
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

// ============================================================================
// PRE-LAUNCH LOCK (ticker: $CS) — currently OPEN.
// To re-lock pre-token-gate: set LOCKED = true. To open at $CS launch WITH a real
// gate, first build the server-side >=1000 $CS check (dashboard verifies the
// wallet balance -> signed pass -> cs-web-server validates before connect), then
// keep LOCKED = false. The client flag alone is bypassable via the direct URL.
// ============================================================================
const LOCKED = false
const BYPASS_KEY = 'cs-unlock-7f3aq92k'
if (new URLSearchParams(window.location.search).get('key') === BYPASS_KEY) {
    localStorage.setItem('cs_unlock', BYPASS_KEY)
}
const unlocked = !LOCKED || localStorage.getItem('cs_unlock') === BYPASS_KEY

if (!unlocked) {
    // Show the lock screen and do NOT load/connect the game.
    const lk = document.getElementById('locked'); if (lk) lk.style.display = 'flex'
    form.style.display = 'none'
} else {
    main()
    // Robust mobile-control bootstrap: wire controls once the engine + elements are
    // ready (visibility handled by CSS). Re-evaluates touch each tick. Cheap.
    let wiredTouch = false, wiredChat = false
    setInterval(() => {
        if (!engine) return
        const isTouch = window.matchMedia('(pointer: coarse)').matches || (navigator.maxTouchPoints ?? 0) > 0
        if (isTouch && !wiredTouch && setupTouchControls(engine)) wiredTouch = true
        if (!wiredChat && setupChat(engine)) wiredChat = true
    }, 600)
}