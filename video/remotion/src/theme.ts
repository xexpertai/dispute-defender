import { loadFont as loadArchivo } from "@remotion/google-fonts/Archivo";
import { loadFont as loadInter } from "@remotion/google-fonts/Inter";
import { loadFont as loadMono } from "@remotion/google-fonts/JetBrainsMono";
import { Easing } from "remotion";

// The app's "case file" tokens (app/globals.css): ink-navy desk, paper cards, manila tabs.
export const C = {
  bg: "#0b1220", desk: "#101a2e", surface: "#131c2f", surface2: "#1a2540", line: "#243250",
  ink: "#e8edf5", muted: "#929eb2", paper: "#fffefb", paperInk: "#101c33", paperMuted: "#596476",
  manila: "#ecd593", manilaDeep: "#c9ad66", manilaInk: "#4a3a12",
  win: "#4cc98a", loss: "#ff7a80", amber: "#f2b450", pp: "#5cc8e0", ai: "#b79cff",
  focus: "#b07a12", stampRed: "#c0262d", stampGreen: "#147a3d", stampNavy: "#14284b",
};
export const display = loadArchivo("normal", { weights: ["700", "800", "900"], subsets: ["latin"] }).fontFamily;
export const sans = loadInter("normal", { weights: ["400", "500", "600", "700"], subsets: ["latin"] }).fontFamily;
export const mono = loadMono("normal", { weights: ["400", "500"], subsets: ["latin"] }).fontFamily;

export const ease = Easing.bezier(0.2, 0.8, 0.2, 1);
export const PIC_H = 990; // picture area; the caption band is the 90 px below it
