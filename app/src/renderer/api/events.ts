// Events and Component: the lifecycle/event primitives of the Obsidian API.

export interface EventRef {
  e: Events;
  name: string;
  fn: (...a: any[]) => any;
  ctx?: any;
}

export class Events {
  private _events: Record<string, EventRef[]> = {};

  on(name: string, callback: (...data: any[]) => any, ctx?: any): EventRef {
    const ref: EventRef = { e: this, name, fn: callback, ctx };
    (this._events[name] ??= []).push(ref);
    return ref;
  }

  off(name: string, callback: (...data: any[]) => any): void {
    const arr = this._events[name];
    if (!arr) return;
    this._events[name] = arr.filter((r) => r.fn !== callback);
  }

  offref(ref: EventRef): void {
    const arr = this._events[ref?.name];
    if (!arr) return;
    const i = arr.indexOf(ref);
    if (i >= 0) arr.splice(i, 1);
  }

  trigger(name: string, ...data: any[]): void {
    const arr = this._events[name];
    if (!arr) return;
    for (const ref of arr.slice()) this.tryTrigger(ref, data);
  }

  tryTrigger(ref: EventRef, args: any[]): void {
    try {
      ref.fn.apply(ref.ctx, args);
    } catch (e) {
      console.error(e);
    }
  }
}

export class Component {
  _loaded = false;
  _children: Component[] = [];
  _events: (() => any)[] = [];

  load(): void {
    if (this._loaded) return;
    this._loaded = true;
    this.onload();
    for (const c of this._children.slice()) c.load();
  }
  onload(): void {}

  unload(): void {
    if (!this._loaded) return;
    this._loaded = false;
    for (const c of this._children.splice(0)) c.unload();
    for (const fn of this._events.splice(0)) {
      try {
        fn();
      } catch (e) {
        console.error(e);
      }
    }
    this.onunload();
  }
  onunload(): void {}

  addChild<T extends Component>(c: T): T {
    this._children.push(c);
    if (this._loaded) c.load();
    return c;
  }

  removeChild<T extends Component>(c: T): T {
    const i = this._children.indexOf(c);
    if (i >= 0) {
      this._children.splice(i, 1);
      c.unload();
    }
    return c;
  }

  register(cb: () => any): void {
    this._events.push(cb);
  }

  registerEvent(ref: EventRef): void {
    this.register(() => ref.e.offref(ref));
  }

  registerDomEvent(el: any, type: string, cb: any, options?: boolean | AddEventListenerOptions): void {
    el.addEventListener(type, cb, options);
    this.register(() => el.removeEventListener(type, cb, options));
  }

  registerScopeEvent(handler: any): void {
    this.register(() => handler?.scope?.unregister?.(handler));
  }

  registerInterval(id: number): number {
    this.register(() => clearInterval(id));
    return id;
  }
}
