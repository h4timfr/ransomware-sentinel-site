// The only script on the site. Everything works without it: it adds a
// "Copy" button beside the checksum, closes the mobile menu after a tap and
// collapses the documentation contents on narrow screens.
// It makes no network requests and stores nothing.
(() => {
  "use strict";

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
