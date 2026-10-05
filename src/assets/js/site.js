// The only script on the site. Everything works without it: it adds a
// "Copy" button beside the checksum, closes the mobile menu after a tap,
// collapses the documentation contents on narrow screens, and forwards links
// to anchors that have moved to their new home.
// It makes no network requests and stores nothing.
(() => {
  "use strict";

  // A link to a moved anchor (for example "/#how-it-works" from before the
  // How it works page existed) is forwarded to where that content lives now.
  // Without JavaScript the anchor still exists and points there.
  let anchor = "";
  try { anchor = decodeURIComponent(location.hash.slice(1)); } catch { /* malformed hash: ignore it */ }
  if (anchor) {
    const moved = [...document.querySelectorAll("a[data-legacy-anchor]")]
      .find((a) => a.dataset.legacyAnchor === anchor);
    if (moved) {
      location.replace(moved.href);
      return;
    }
  }

  for (const button of document.querySelectorAll("[data-copy]")) {
    const target = document.getElementById(button.dataset.copy);
    const status = document.getElementById(button.dataset.status);
    if (!target || !navigator.clipboard) continue;
    button.hidden = false;
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(target.textContent.trim());
        if (status) status.textContent = "Copied to the clipboard.";
      } catch {
        if (status) status.textContent = "Could not copy. Select the text and copy it instead.";
      }
    });
  }

  const menu = document.querySelector(".nav-menu");
  if (menu) {
    menu.addEventListener("click", (event) => {
      if (event.target.closest("a")) menu.removeAttribute("open");
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && menu.hasAttribute("open")) {
        menu.removeAttribute("open");
        menu.querySelector("summary").focus();
      }
    });
  }

  // The contents list is open in the HTML so it is always reachable; on narrow
  // screens (where it sits above the text) start it collapsed. Wide layouts hide
  // the summary, so the list must be open there.
  const contents = document.querySelector(".docs-nav details");
  if (contents) {
    const narrow = window.matchMedia("(max-width: 920px)");
    const sync = () => { contents.open = !narrow.matches; };
    sync();
    narrow.addEventListener("change", sync);
    contents.addEventListener("click", (event) => {
      if (narrow.matches && event.target.closest("a")) contents.open = false;
    });
  }
})();
