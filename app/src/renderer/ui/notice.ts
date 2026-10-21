// Notice: the small toast in the top-right corner (obsidian API).

let container: HTMLElement | null = null;

export class Notice {
  noticeEl: HTMLElement;
  containerEl: HTMLElement;
  messageEl: HTMLElement;
  private timer: any = null;

  constructor(message: string | DocumentFragment, duration?: number) {
    if (!container || !container.isConnected) {
      container = document.body.createDiv("notice-container");
    }
    this.containerEl = container.createDiv("notice-container-item");
    this.noticeEl = this.containerEl.createDiv("notice");
    this.messageEl = this.noticeEl.createDiv("notice-message");
    this.setMessage(message);
    this.noticeEl.addEventListener("click", () => this.hide());
    if (duration !== 0) this.timer = setTimeout(() => this.hide(), duration ?? 5000);
  }

  setMessage(message: string | DocumentFragment): this {
    this.messageEl.empty();
    if (typeof message === "string") this.messageEl.setText(message);
    else this.messageEl.appendChild(message);
    return this;
  }

  hide(): void {
    clearTimeout(this.timer);
    this.containerEl.addClass("mod-fading");
    setTimeout(() => this.containerEl.remove(), 150);
  }
}
