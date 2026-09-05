/**
 * MYRAA — voice client.
 *
 * Bridges the React UI to the Node backend over the /live WebSocket:
 *  - captures microphone audio (echo cancellation + NS + AGC), downsamples to
 *    16 kHz mono PCM16 and streams base64 chunks to the Gemini Live session;
 *  - receives 24 kHz model audio chunks and plays them with gapless queueing;
 *  - supports interruption: any model speech stops immediately when the
 *    server signals "interrupted" or the user clicks STOP;
 *  - streams shared-screen JPEG frames with a coarse changeScore so the
 *    cognitive layer can rate visual novelty;
 *  - emits conversationEvents so the cognition layer can observe turn-taking.
 */

export type ConnectionState =
  | "disconnected"
  | "checking"
  | "connecting"
  | "connected"
  | "listening"
  | "error";

export interface TranscriptEntry {
  role: "user" | "model";
  text: string;
  at: number;
}

export interface ToolCallInfo {
  callId: string;
  name: string;
  args: Record<string, unknown>;
}

interface VoiceClientHandlers {
  onState: (state: ConnectionState, detail?: string) => void;
  onTranscription: (entry: TranscriptEntry) => void;
  onTurnComplete: () => void;
  onInterrupted: () => void;
  onToolCall: (info: ToolCallInfo) => void;
  onMemorySync: (memories: unknown[]) => void;
  onError: (message: string, code?: string) => void;
  onScreenVisionState: (state: string, activeWindow: string | null, error: string | null) => void;
  onStatus: (status: string) => void;
  onOutputAnalyser: (analyser: AnalyserNode) => void;
  onInputAnalyser: (analyser: AnalyserNode) => void;
}

const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;

function floatTo16BitPCM(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length);
  for (let i = 0; i < input.length; i += 1) {
    const s = Math.max(-1, Math.min(1, input[i]));
    output[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return output;
}

function downsampleBuffer(buffer: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (toRate === fromRate) return buffer;
  const ratio = fromRate / toRate;
  const length = Math.round(buffer.length / ratio);
  const result = new Float32Array(length);
  let offsetResult = 0;
  let offsetBuffer = 0;
  while (offsetResult < result.length) {
    const nextOffset = Math.round((offsetResult + 1) * ratio);
    let sum = 0;
    let count = 0;
    for (; offsetBuffer < nextOffset && offsetBuffer < buffer.length; offsetBuffer += 1) {
      sum += buffer[offsetBuffer];
      count += 1;
    }
    result[offsetResult] = count ? sum / count : 0;
    offsetResult += 1;
  }
  return result;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export class MyraaVoiceClient {
  private handlers: VoiceClientHandlers;
  private ws: WebSocket | null = null;
  private inputAudioCtx: AudioContext | null = null;
  private outputAudioCtx: AudioContext | null = null;
  private micStream: MediaStream | null = null;
  private micSourceNode: MediaStreamAudioSourceNode | null = null;
  private micProcessorNode: ScriptProcessorNode | null = null;
  private inputAnalyser: AnalyserNode | null = null;
  private outputAnalyser: AnalyserNode | null = null;
  private playQueue: AudioBufferSourceNode[] = [];
  private stateValue: ConnectionState = "disconnected";
  private useMicrophone = true;
  private screenStream: MediaStream | null = null;
  private screenVideo: HTMLVideoElement | null = null;
  private screenCanvas: HTMLCanvasElement | null = null;
  private screenTimer: number | null = null;
  private previousFrame: Uint8ClampedArray | null = null;
  private screenActive = false;
  private screenPaused = false;

  constructor(handlers: VoiceClientHandlers) {
    this.handlers = handlers;
  }

  get state(): ConnectionState {
    return this.stateValue;
  }

  get inputAnalyserNode(): AnalyserNode | null {
    return this.inputAnalyser;
  }

  get outputAnalyserNode(): AnalyserNode | null {
    return this.outputAnalyser;
  }

  private setState(state: ConnectionState, detail?: string) {
    this.stateValue = state;
    this.handlers.onState(state, detail);
  }

  // -------------------------------------------------------------------------
  // Connection
  // -------------------------------------------------------------------------
  async connect(options: { useMicrophone?: boolean } = {}): Promise<void> {
    this.useMicrophone = options.useMicrophone !== false;
    this.setState("connecting");
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${protocol}//${window.location.host}/live`);
    socket.binaryType = "arraybuffer";
    this.ws = socket;

    socket.onopen = () => {
      this.handlers.onStatus("connecting_gemini");
    };
    socket.onclose = () => {
      this.setState("disconnected");
      this.disposeAudio();
    };
    socket.onerror = () => {
      this.handlers.onError("WebSocket connection closed");
    };
    socket.onmessage = (event) => this.handleMessage(event);

    // Audio contexts must be created inside the user gesture that calls
    // connect(); resume() is a no-op when already running.
    this.inputAudioCtx = new AudioContext({ sampleRate: INPUT_SAMPLE_RATE });
    this.outputAudioCtx = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
    await this.inputAudioCtx.resume();
    await this.outputAudioCtx.resume();

    this.outputAnalyser = this.outputAudioCtx.createAnalyser();
    this.outputAnalyser.fftSize = 256;
    this.outputAnalyser.connect(this.outputAudioCtx.destination);
    this.handlers.onOutputAnalyser(this.outputAnalyser);

    if (!this.useMicrophone) {
      this.setState("listening");
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error(
        "Microphone access is unavailable in this browser. Open MYRAA in Chrome at http://localhost:3000 and allow microphone access.",
      );
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      stream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch {
          /* already stopped */
        }
      });
      return;
    }
    this.micStream = stream;
    this.inputAnalyser = this.inputAudioCtx.createAnalyser();
    this.inputAnalyser.fftSize = 256;
    this.handlers.onInputAnalyser(this.inputAnalyser);
    this.micSourceNode = this.inputAudioCtx.createMediaStreamSource(stream);
    this.micSourceNode.connect(this.inputAnalyser);
    this.micProcessorNode = this.inputAudioCtx.createScriptProcessor(1024, 1, 1);
    this.micProcessorNode.onaudioprocess = (event) => this.onAudioProcess(event);
    this.micSourceNode.connect(this.micProcessorNode);
    this.micProcessorNode.connect(this.inputAudioCtx.destination);

    this.setState("listening");
  }

  private onAudioProcess(event: AudioProcessingEvent) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.stateValue !== "listening" && this.stateValue !== "connected") return;
    const input = event.inputBuffer.getChannelData(0);
    const downsampled = downsampleBuffer(input, this.inputAudioCtx?.sampleRate || INPUT_SAMPLE_RATE, INPUT_SAMPLE_RATE);
    const pcm = floatTo16BitPCM(downsampled);
    const payload = arrayBufferToBase64(pcm.buffer as ArrayBuffer);
    this.send({ audio: payload });
  }

  private handleMessage(event: MessageEvent) {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(typeof event.data === "string" ? event.data : "");
    } catch {
      return;
    }
    if (msg.type === "status") {
      this.handlers.onStatus(String(msg.status));
      if (msg.status === "connected") this.setState("connected");
      return;
    }
    if (msg.type === "audio" && typeof msg.audio === "string") {
      this.playAudioChunk(String(msg.audio));
      return;
    }
    if (msg.type === "interrupted") {
      this.stopPlayback();
      this.handlers.onInterrupted();
      return;
    }
    if (msg.type === "turnComplete") {
      this.handlers.onTurnComplete();
      return;
    }
    if (msg.type === "transcription") {
      this.handlers.onTranscription({
        role: msg.role === "user" ? "user" : "model",
        text: String(msg.text),
        at: Date.now(),
      });
      return;
    }
    if (msg.type === "toolCall") {
      this.handlers.onToolCall({
        callId: String(msg.callId ?? ""),
        name: String(msg.name ?? ""),
        args: (msg.args as Record<string, unknown>) || {},
      });
      return;
    }
    if (msg.type === "memory_sync") {
      this.handlers.onMemorySync((msg.memories as unknown[]) || []);
      return;
    }
    if (msg.type === "screenVisionState") {
      this.handlers.onScreenVisionState(
        String(msg.state ?? ""),
        (msg.activeWindow as string | null) ?? null,
        (msg.error as string | null) ?? null,
      );
      return;
    }
    if (msg.type === "error") {
      this.handlers.onError(String(msg.error ?? "Unknown error"), msg.code ? String(msg.code) : undefined);
      return;
    }
  }

  // -------------------------------------------------------------------------
  // Output playback
  // -------------------------------------------------------------------------
  private playAudioChunk(base64: string) {
    if (!this.outputAudioCtx) return;
    try {
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      const pcm = new Int16Array(bytes.buffer);
      const buffer = this.outputAudioCtx.createBuffer(1, pcm.length, OUTPUT_SAMPLE_RATE);
      const channel = buffer.getChannelData(0);
      for (let i = 0; i < pcm.length; i += 1) channel[i] = pcm[i] / 0x8000;
      const source = this.outputAudioCtx.createBufferSource();
      source.buffer = buffer;
      source.connect(this.outputAnalyser!);
      source.start();
      this.playQueue.push(source);
      source.onended = () => {
        this.playQueue = this.playQueue.filter((item) => item !== source);
      };
    } catch {
      /* malformed chunk — skip */
    }
  }

  stopPlayback() {
    for (const source of this.playQueue) {
      try {
        source.stop();
      } catch {
        /* already stopped */
      }
    }
    this.playQueue = [];
  }

  // -------------------------------------------------------------------------
  // Outgoing messages
  // -------------------------------------------------------------------------
  send(payload: Record<string, unknown>) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload));
    }
  }

  sendText(text: string) {
    this.send({ type: "text", text });
  }

  sendConversationEvent(eventName: string, rms?: number) {
    this.send({ type: "conversationEvent", event: eventName, rms });
  }

  respondToTool(callId: string, name: string, output: unknown) {
    this.send({ type: "toolResponse", id: callId, name, output });
  }

  // -------------------------------------------------------------------------
  // Screen sharing
  // -------------------------------------------------------------------------
  async startScreenShare(): Promise<void> {
    if (this.screenActive) return;
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 2 } },
      audio: false,
    });
    const track = stream.getVideoTracks()[0];
    if (!track) {
      stream.getTracks().forEach((item) => item.stop());
      throw new Error("The selected screen did not provide a video track.");
    }
    this.screenStream = stream;
    const video = document.createElement("video");
    video.srcObject = stream;
    video.muted = true;
    video.playsInline = true;
    await video.play().catch(() => undefined);
    this.screenVideo = video;
    this.screenCanvas = document.createElement("canvas");
    this.screenActive = true;
    this.screenPaused = false;
    this.previousFrame = null;
    track.onended = () => this.stopScreenShare();

    if (this.screenTimer) clearInterval(this.screenTimer);
    this.screenTimer = window.setInterval(() => void this.captureScreenFrame(), 500);
  }

  pauseScreenShare() {
    this.screenPaused = true;
  }

  resumeScreenShare() {
    this.screenPaused = false;
  }

  stopScreenShare() {
    this.screenActive = false;
    if (this.screenTimer) {
      clearInterval(this.screenTimer);
      this.screenTimer = null;
    }
    this.screenStream?.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch {
        /* already stopped */
      }
    });
    this.screenStream = null;
    this.screenVideo = null;
    this.screenCanvas = null;
    this.previousFrame = null;
  }

  get isScreenSharing(): boolean {
    return this.screenActive;
  }

  get isScreenPaused(): boolean {
    return this.screenPaused;
  }

  private computeChangeScore(current: Uint8ClampedArray): number {
    const previous = this.previousFrame;
    this.previousFrame = current;
    if (!previous || previous.length !== current.length) return 0;
    let diff = 0;
    const stride = Math.max(4, Math.floor(current.length / 4 / 2048) * 4);
    let samples = 0;
    for (let i = 0; i < current.length; i += stride) {
      diff += Math.abs(current[i] - previous[i]);
      samples += 1;
    }
    return samples ? Math.min(100, (diff / samples) * 2.2) : 0;
  }

  private async captureScreenFrame(): Promise<void> {
    if (!this.screenActive || this.screenPaused) return;
    const video = this.screenVideo;
    const canvas = this.screenCanvas;
    if (!video || !canvas || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    try {
      const width = 640;
      const height = Math.max(1, Math.round((video.videoHeight / video.videoWidth) * width) || 360);
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.drawImage(video, 0, 0, width, height);
      const pixels = context.getImageData(0, 0, width, height).data;
      const changeScore = this.computeChangeScore(pixels);
      const base64 = canvas.toDataURL("image/jpeg", 0.45).split(",")[1] as string;
      this.send({ type: "video", video: base64, changeScore, heartbeat: false });
    } catch (error) {
      console.error("[Screen Capture] Failed drawing frame to canvas:", error);
    }
  }

  // -------------------------------------------------------------------------
  // Teardown
  // -------------------------------------------------------------------------
  private disposeAudio() {
    this.micProcessorNode?.disconnect();
    this.micSourceNode?.disconnect();
    this.micStream?.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch {
        /* already stopped */
      }
    });
    this.micProcessorNode = null;
    this.micSourceNode = null;
    this.micStream = null;
    this.inputAnalyser = null;
    this.stopPlayback();
    this.stopScreenShare();
    try {
      this.inputAudioCtx?.close();
      this.outputAudioCtx?.close();
    } catch {
      /* contexts already closed */
    }
    this.inputAudioCtx = null;
    this.outputAudioCtx = null;
    this.outputAnalyser = null;
  }

  disconnect() {
    this.send({ type: "stop" });
    try {
      this.ws?.close();
    } catch {
      /* already closed */
    }
    this.ws = null;
    this.disposeAudio();
    this.setState("disconnected");
  }
}
