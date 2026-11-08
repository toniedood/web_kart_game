// Wraps every letter of each .logo element in a <span> so the CSS can colour them one by one.
export function colourLogos() {
  for (const el of document.querySelectorAll(".logo")) {
    const text = el.textContent;
    el.textContent = "";
    for (const ch of text) {
      const span = document.createElement("span");
      span.textContent = ch;
      el.append(span);
    }
  }
}
