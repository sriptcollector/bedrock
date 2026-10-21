// Renders assets/icon.svg and assets/tray.svg into the PNG / ICO / ICNS files the app and the
// installers use (app/build-res). Run after changing the artwork: npm run icons -w app
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";
import png2icons from "png2icons";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const out = path.resolve(here, "../build-res");
fs.mkdirSync(out, { recursive: true });

const render = (svgFile, size, recolor) => {
  let svg = fs.readFileSync(path.join(root, "assets", svgFile), "utf8");
  if (recolor) svg = svg.replaceAll("#000", recolor);
  return new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();
};

const icon1024 = render("icon.svg", 1024);
fs.writeFileSync(path.join(out, "icon.png"), icon1024);
fs.writeFileSync(path.join(out, "icon-512.png"), render("icon.svg", 512));
fs.writeFileSync(path.join(root, "assets", "icon.png"), render("icon.svg", 512));
fs.writeFileSync(path.join(out, "icon.ico"), png2icons.createICO(icon1024, png2icons.BICUBIC2, 0, false, true));
fs.writeFileSync(path.join(out, "icon.icns"), png2icons.createICNS(icon1024, png2icons.BICUBIC2, 0));
// Windows/Linux tray: light strokes on the dark taskbar; macOS: template image (black + alpha).
fs.writeFileSync(path.join(out, "tray.png"), render("tray.svg", 16, "#ffffff"));
fs.writeFileSync(path.join(out, "tray@2x.png"), render("tray.svg", 32, "#ffffff"));
fs.writeFileSync(path.join(out, "trayTemplate.png"), render("tray.svg", 16));
fs.writeFileSync(path.join(out, "trayTemplate@2x.png"), render("tray.svg", 32));
console.log("icons written to", out);
