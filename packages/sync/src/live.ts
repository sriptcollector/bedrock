// Websocket client for /v1/live. The server pushes {type:"seq", seq} when the vault changes and
// {type:"ping"} every 25 s. The token goes in Sec-WebSocket-Protocol ("bearer.<base64url>") so it
// never appears in a URL. Reconnects with capped exponential backoff and jitter.

import { WS_PROTOCOL } from './constants.js';

export type WebSocketCtor = new (url: string, protocols?: string | string[]) => WebSocketLike;
export interface WebSocketLike {
  readyState: number;
  onopen: ((ev: any) => void) | null;
  onmessage: ((ev: { data: any }) => void) | null;
  onclose: ((ev: { code?: number }) => void) | null;
  onerror: ((ev: any) => void) | null;
  close(code?: number, reason?: string): void;
}

export class LiveClient {
  private ws: WebSocketLike | null = null;
  private stopped = true;
  private attempt = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private watchdog: NodeJS.Timeout | null = null;
  connected = false;

  constructor(
    private readonly serverUrl: string,
    private readonly getToken: () => Promise<string | null>,
    private readonly Ctor: WebSocketCtor | undefined,
    private readonly onSeq: (seq: number) => void,
    private readonly onState: (connected: boolean) => void,
    private readonly silenceMs = 70_000,
  ) {}

  start(): void {
    if (!this.Ctor) return;
    this.stopped = false;
    void this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.watchdog) clearTimeout(this.watchdog);
    this.reconnectTimer = this.watchdog = null;
    const ws = this.ws;
    this.ws = null;
    try {
      ws?.close(1000, 'bye');
    } catch {
      /* ignore */
    }
    this.setConnected(false);
  }

  /** Reconnect now (e.g. after the token changed or the network came back). */
  kick(): void {
    if (this.stopped || this.connected) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.attempt = 0;
    void this.connect();
  }

  private setConnected(v: boolean): void {
    if (this.connected !== v) {
      this.connected = v;
      this.onState(v);
    }
  }

  private feed(): void {
    if (this.watchdog) clearTimeout(this.watchdog);
    this.watchdog = setTimeout(() => {
      try {
        this.ws?.close(4000, 'silent');
      } catch {
        /* ignore */
      }
    }, this.silenceMs);
    this.watchdog.unref?.();
  }

  private async connect(): Promise<void> {
    if (this.stopped || this.ws) return;
    let token: string | null = null;
    try {
      token = await this.getToken();
    } catch {
      token = null;
    }
    if (this.stopped) return;
    if (!token) return this.scheduleReconnect();
    const url = this.serverUrl.replace(/^http/, 'ws').replace(/\/+$/, '') + '/v1/live';
    let ws: WebSocketLike;
    try {
      ws = new this.Ctor!(url, [WS_PROTOCOL, 'bearer.' + Buffer.from(token).toString('base64url')]);
    } catch {
      return this.scheduleReconnect();
    }
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.setConnected(true);
      this.feed();
    };
    ws.onmessage = (ev) => {
      this.feed();
      try {
        const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8'));
        if (msg?.type === 'seq' && typeof msg.seq === 'number') this.onSeq(msg.seq);
      } catch {
        /* ignore junk */
      }
    };
    ws.onerror = () => {};
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.watchdog) clearTimeout(this.watchdog);
      this.setConnected(false);
      this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const base = Math.min(60_000, 1000 * 2 ** this.attempt++);
    const delay = base / 2 + Math.random() * (base / 2);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
    this.reconnectTimer.unref?.();
  }
}
