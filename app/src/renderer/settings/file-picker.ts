// Pick a vault file (template file, file to open on startup...).
import { FuzzySuggestModal } from "../ui/modal";

export class FilePickerModal extends FuzzySuggestModal<any> {
  constructor(app: any, private filter: ((f: any) => boolean) | undefined, private onPick: (f: any) => void, private exts: string[] = ["md"]) {
    super(app);
    this.setPlaceholder?.("Type to search for a file...");
  }
  getItems(): any[] {
    return this.app.vault.getFiles().filter((f: any) => (this.filter ? this.filter(f) : this.exts.includes(f.extension)));
  }
  getItemText(f: any): string {
    return f.extension === "md" ? f.path.slice(0, -3) : f.path;
  }
  onChooseItem(f: any): void {
    this.onPick(f);
  }
}
