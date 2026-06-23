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
    private wsAttempts = 0
    private reconnectTimer?: ReturnType<typeof setTimeout>

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
        this.peer = new RTCPeerConnection()
        this.peer.onicecandidate = e => {
            if (!e.candidate) {
                return
            }
            this.wsSend('candidate', e.candidate.toJSON())
        }
        let el: HTMLAudioElement | undefined
        this.peer.ontrack = (e) => {
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
        this.peer.onconnectionstatechange = () => {
            if (el?.parentNode) {
                el.parentNode.removeChild(el)
                el = undefined
            }
            if (this.peer?.connectionState === 'failed') {
                this.connectWs()
            }
        }
        this.stream?.getTracks()?.forEach(t => {
            this.peer!.addTrack(t, this.stream!)
        })
        let channelsCount = 0
        this.peer.ondatachannel = (e) => {
            if (e.channel.label === 'write') {
                e.channel.onmessage = (ee) => {
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

    private connectWs() {
        if (this.ws) {
            this.ws.close()
        }
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
        this.ws = new WebSocket(`${protocol}://${host}/websocket`);
        // Back off on error instead of reconnecting in a tight loop — a hammering
        // retry loop is what tips a memory-pressured mobile tab into "a problem
        // repeatedly occurred". Cap attempts, then surface a friendly message.
        this.ws.onerror = () => {
            if (this.wsAttempts >= 8) {
                const w = document.getElementById('warning')
                if (w) { w.textContent = "Can't reach the match server — check your connection and reload."; w.style.opacity = '1' }
                return
            }
            this.wsAttempts += 1
            clearTimeout(this.reconnectTimer)
            this.reconnectTimer = setTimeout(() => this.connectWs(), Math.min(1000 * this.wsAttempts, 6000))
        }
        this.ws.addEventListener('message', handler)
        this.ws.onopen = () => {
            this.wsAttempts = 0
            this.startConnection()
        }
    }

    async connect() {
        // Voice chat is disabled server-side, so we never request the microphone.
        // Skipping getUserMedia removes the mobile permission prompt and the
        // associated connect stall — gameplay runs entirely over data channels.
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