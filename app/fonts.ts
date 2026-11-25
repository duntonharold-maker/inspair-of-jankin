import localFont from "next/font/local";

/**
 * Aventina, the site's Latin face (Chinese falls back to the system fonts in --font). Only the weights
 * the styles use are loaded. Its own vertical metrics differ between platforms (taller ascent on macOS
 * than on Windows) and sit text low in its line, so they are set here: the content area is centred on
 * the capitals, and lines are as tall as line-height says. The family is named here, so --font in
 * globals.css can name it too ("aventina", and the metric-matched "aventina Fallback" Next adds).
 */
export const aventina = localFont({
  src: [
    { path: "./fonts/aventina-400.woff2", weight: "400", style: "normal" },
    { path: "./fonts/aventina-500.woff2", weight: "500", style: "normal" },
    { path: "./fonts/aventina-600.woff2", weight: "600", style: "normal" },
    { path: "./fonts/aventina-700.woff2", weight: "700", style: "normal" },
  ],
  display: "swap",
  declarations: [
    { prop: "font-family", value: "aventina" },
    { prop: "ascent-override", value: "95%" },
    { prop: "descent-override", value: "25%" },
    { prop: "line-gap-override", value: "0%" },
  ],
});
