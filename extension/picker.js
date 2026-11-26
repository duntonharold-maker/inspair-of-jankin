// Remembers where the last right-click happened. Sites such as 小红书 and 花瓣 lay a transparent layer over
// their pictures or paint them as CSS backgrounds, so the browser doesn't see an image under the pointer;
// 「收藏到 inspair」 then looks for the picture at this spot instead (background.js, findPicture).
addEventListener(
  "contextmenu",
  (e) => {
    window.__inspairPoint = { x: e.clientX, y: e.clientY, at: Date.now() };
  },
  { capture: true, passive: true },
);
