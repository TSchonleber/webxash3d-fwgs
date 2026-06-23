import {Net, Packet, Xash3D, Xash3DOptions} from "xash3d-fwgs";

export class Xash3DWebRTC extends Xash3D {
    private channel?: RTCDataChannel
    private resolve?: (value?: unknown) => void
    private ws?: WebSocket
    private peer?: RTCPeerConnection
    private remoteDescription?: RTCSessionDescription
    private candidates: RTCIceCandidateInit[] = []
    private wasRemote = false
    private timeout?: ReturnType<typeof setTimeout>
    private stream?: MediaStream
    private connected = false                                // true once both data channels open (in-game)
    private reconnectTimer?: ReturnType<typeof setTimeout>   // debounce reconnects to prevent a storm
    packetsIn = 0                                            // server->client game packets; >0 means the match connect took

    constructor(opts?: Xash3DOptions) {
        super(opts);
        this.net = new Net(this)
    }

    async init() {
        await Promise.all([
            super.init(),
            this.connect()
        ]);
    }

    startConnection() {
        const peer = new RTCPeerConnection()
        this.peer = peer
        peer.onicecandidate = e => {
            if (!e.candidate) {
                return
            }
            this.wsSend('candidate', e.candidate.toJSON())
        }
        let el: HTMLAudioElement | undefined
        peer.ontrack = (e) => {
            el = document.createElement(e.track.kind) as HTMLAudioElement
            el.srcObject = e.streams[0]
            el.autoplay = true
            el.controls = true
            document.body.appendChild(el)

            e.track.onmute = () => {
                el?.play()
            }

            e.streams[0].onremovetrack = () => {
                if (el?.parentNode) {
                    el?.parentNode?.removeChild(el)
                    el = undefined
                }
            }
        }
        peer.onconnectionstatechange = () => {
            if (el?.parentNode) {
                el.parentNode.removeChild(el)
                el = undefined
            }
            // Ignore events from peers we've already replaced.
            if (peer !== this.peer) return
            if (peer.connectionState === 'failed') {
                this.connected = false
                this.reconnect()   // debounced + full teardown, not an immediate storm
            }
        }
        this.stream?.getTracks()?.forEach(t => {
            peer.addTrack(t, this.stream!)
        })
        let channelsCount = 0
        peer.ondatachannel = (e) => {
            if (e.channel.label === 'write') {
                e.channel.onmessage = (ee) => {
                    this.packetsIn++   // server is sending game data -> the match connect succeeded
                    const packet: Packet = {
                        ip: [127, 0, 0, 1],
                        port: 8080,
                        data: ee.data
                    }
                    if (ee.data.arrayBuffer) {
                        ee.data.arrayBuffer().then((data: Int8Array) => {
                            packet.data = data;
                            (this.net as Net).incoming.enqueue(packet)
                        })
                    } else {
                        (this.net as Net).incoming.enqueue(packet)
                    }
                }
            }
            e.channel.onopen = () => {
                channelsCount += 1
                if (e.channel.label === 'read') {
                    this.channel = e.channel
                }
                if (channelsCount === 2) {
                    this.connected = true   // in-game; the ws is now idle, don't reconnect on its blips
                    if (this.resolve) {
                        const r = this.resolve
                        this.resolve = undefined
                        if (this.timeout) {
                            clearTimeout(this.timeout)
                            this.timeout = undefined
                        }
                        document.getElementById('warning')!.style.opacity = '0'
                        r()
                    }
                }
            }
        }
        this.handleDescription()
    }

    private wsSend(event: string, data: unknown) {
        const msg = JSON.stringify({
            event,
            data
        })
        this.ws?.send(msg)
    }

    private async handleDescription() {
        if (!this.remoteDescription || !this.peer) return

        await this.peer!.setRemoteDescription(this.remoteDescription)
        this.remoteDescription = undefined
        const answer = await this.peer!.createAnswer()
        await this.peer!.setLocalDescription(answer)
        this.wsSend('answer', answer)
        this.wasRemote = true
        this.handleCandidates()
    }

    private handleCandidates() {
        if (!this.candidates.length || !this.peer) return

        const candidates = this.candidates
        this.candidates = []
        candidates.forEach(c => {
            this.peer!.addIceCandidate(c).catch(() => {
                this.candidates.push(c)
            })
        })
    }

    // Debounced reconnect: collapse repeated triggers into one delayed attempt so a
    // flapping connection can't hammer the server (the cause of the handler leak/storm).
    private reconnect() {
        if (this.reconnectTimer) return
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = undefined
            this.connectWs()
        }, 3000)
    }

    private connectWs() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer)
            this.reconnectTimer = undefined
        }
        // Fully tear down the previous attempt — closing the old peer releases the
        // server's per-peer handler. Abandoned peers were the connection leak.
        if (this.ws) {
            this.ws.onerror = null
            try { this.ws.close() } catch { /* ignore */ }
            this.ws = undefined
        }
        if (this.peer) {
            try { this.peer.close() } catch { /* ignore */ }
            this.peer = undefined
        }
        this.wasRemote = false
        this.candidates = []
        const protocol = window.location.protocol === "https:" ? "wss" : "ws";
        const host = window.location.host;
        const handler = async (e: MessageEvent) => {
            const parsed = JSON.parse(e.data)
            switch (parsed.event) {
                case 'offer':
                    this.remoteDescription = parsed.data
                    await this.handleDescription()
                    break
                case 'candidate':
                    this.candidates.push(parsed.data)
                    if (this.wasRemote) {
                        this.handleCandidates()
                    }
                    break
            }
        }
        // Server selection: the chosen session sets __csServerPath ('' = de_train,
        // '/d2' = de_dust2) before the engine connects, routing the signaling socket
        // (and thus the WebRTC game tunnel) to that server via Caddy.
        const serverPath = (window as unknown as { __csServerPath?: string }).__csServerPath || ''
        this.ws = new WebSocket(`${protocol}://${host}${serverPath}/websocket`);
        this.ws.onerror = () => {
            // Only retry while still establishing the tunnel. Once in-game the ws is
            // idle, so a blip must NOT trigger a reconnect (that caused re-joins/churn).
            if (!this.connected) this.reconnect()
        }
        this.ws.addEventListener('message', handler)
        this.ws.onopen = () => {
            this.startConnection()
            if (!this.stream) {
                this.timeout = setTimeout(() => {
                    this.timeout = undefined
                    document.getElementById('warning')!.style.opacity = '1'
                }, 10000)
            }
        }
    }

    async connect() {
        // No microphone: voice chat is disabled server-side, so we skip the
        // getUserMedia prompt that stalls the connect on mobile. Gameplay runs
        // over the data channels; the handshake doesn't need an audio track.
        this.stream = undefined
        return new Promise(resolve => {
            this.resolve = resolve;
            this.connectWs()
        })
    }

    sendto(packet: Packet) {
        if (!this.channel) return
        this.channel.send(packet.data)
    }
}