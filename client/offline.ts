import "./offline.css";

const root = document.querySelector<HTMLElement>("#offline-root");

if (root) {
  const panel = document.createElement("section");
  panel.className = "offline-panel";

  const title = document.createElement("h1");
  title.textContent = "You’re offline";

  const explanation = document.createElement("p");
  explanation.textContent =
    "Ferry FYI needs a connection to load ferry information.";

  const retry = document.createElement("button");
  retry.type = "button";
  retry.textContent = "Try again";
  retry.addEventListener("click", () => window.location.reload());

  panel.append(title, explanation, retry);
  root.append(panel);
}
