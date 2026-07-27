const statusElements = {
  badge: document.querySelector("#whatsapp-badge"),
  phase: document.querySelector("#whatsapp-phase"),
  detail: document.querySelector("#whatsapp-detail"),
  count: document.querySelector("#message-count"),
  qr: document.querySelector("#qr-image"),
  qrPlaceholder: document.querySelector("#qr-placeholder"),
};

const statusTones = ["success", "pending", "danger", "muted"];

function statusTone(phase) {
  if (phase === "ready") return "success";
  if (["qr_required", "authenticated", "starting"].includes(phase)) {
    return "pending";
  }
  if (["error", "disconnected"].includes(phase)) return "danger";
  return "muted";
}

async function refreshStatus() {
  if (!statusElements.phase) return;
  try {
    const response = await fetch("/api/status", {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return;
    const payload = await response.json();
    const status = payload.whatsapp;
    const label = status.phase.replaceAll("_", " ");

    statusElements.phase.textContent = label;
    statusElements.detail.textContent = status.detail;
    statusElements.count.textContent = Number(
      payload.messageCount,
    ).toLocaleString();

    if (statusElements.badge) {
      statusElements.badge.textContent = label;
      statusElements.badge.classList.remove(...statusTones);
      statusElements.badge.classList.add(statusTone(status.phase));
    }

    if (statusElements.qr && statusElements.qrPlaceholder) {
      if (status.qrDataUrl) {
        statusElements.qr.src = status.qrDataUrl;
        statusElements.qr.hidden = false;
        statusElements.qrPlaceholder.hidden = true;
      } else {
        statusElements.qr.removeAttribute("src");
        statusElements.qr.hidden = true;
        statusElements.qrPlaceholder.hidden = false;
        const strong = statusElements.qrPlaceholder.querySelector("strong");
        const small = statusElements.qrPlaceholder.querySelector("small");
        if (strong) {
          strong.textContent =
            status.phase === "ready" ? "Connected" : "Waiting for WhatsApp";
        }
        if (small) small.textContent = status.detail;
      }
    }
  } catch {
    // The next poll will retry. Avoid turning a transient restart into UI noise.
  }
}

if (statusElements.phase) {
  window.setInterval(refreshStatus, 3000);
  void refreshStatus();
}

for (const form of document.querySelectorAll("form[data-confirm]")) {
  form.addEventListener("submit", (event) => {
    const message = form.dataset.confirm;
    if (message && !window.confirm(message)) {
      event.preventDefault();
    }
  });
}

const typewriterText = document.querySelector("[data-typewriter-text]");
if (
  typewriterText &&
  !window.matchMedia("(prefers-reduced-motion: reduce)").matches
) {
  const phrases = [
    "messistant",
    "messages get messy?",
    "messi scores but...",
    "messi also assists.",
    "messistant",
    "messaging, assisted.",
  ];
  const phrasePauses = [1700, 1700, 1700, 1700, 2600, 1700];
  const prefix = "mess";
  const pause = (milliseconds) =>
    new Promise((resolve) => window.setTimeout(resolve, milliseconds));

  void (async () => {
    let phraseIndex = 0;
    while (typewriterText.isConnected) {
      await pause(phrasePauses[phraseIndex]);
      while ([...typewriterText.textContent].length > prefix.length) {
        typewriterText.textContent = [
          ...typewriterText.textContent,
        ].slice(0, -1).join("");
        await pause(38);
      }
      await pause(650);

      phraseIndex = (phraseIndex + 1) % phrases.length;
      const phrase = phrases[phraseIndex];
      for (const character of phrase.slice(prefix.length)) {
        typewriterText.textContent += character;
        await pause(62);
      }
    }
  })();
}

const capabilityTabs = document.querySelector("[data-capability-tabs]");
if (capabilityTabs) {
  const tabs = [...capabilityTabs.querySelectorAll("[data-capability-target]")];
  const panels = [
    ...capabilityTabs.querySelectorAll("[data-capability-panel]"),
  ];

  const activateCapability = (id, updateUrl = true) => {
    for (const tab of tabs) {
      const active = tab.dataset.capabilityTarget === id;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
    }
    for (const panel of panels) {
      panel.hidden = panel.dataset.capabilityPanel !== id;
    }
    if (updateUrl) {
      const url = new URL(window.location.href);
      url.searchParams.set("selected", id);
      window.history.replaceState({}, "", url);
    }
  };

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", (event) => {
      event.preventDefault();
      activateCapability(tab.dataset.capabilityTarget);
    });
    tab.addEventListener("keydown", (event) => {
      let nextIndex = null;
      if (["ArrowDown", "ArrowRight"].includes(event.key)) {
        nextIndex = (index + 1) % tabs.length;
      } else if (["ArrowUp", "ArrowLeft"].includes(event.key)) {
        nextIndex = (index - 1 + tabs.length) % tabs.length;
      } else if (event.key === "Home") {
        nextIndex = 0;
      } else if (event.key === "End") {
        nextIndex = tabs.length - 1;
      }
      if (nextIndex !== null) {
        event.preventDefault();
        const nextTab = tabs[nextIndex];
        activateCapability(nextTab.dataset.capabilityTarget);
        nextTab.focus();
      }
    });
  });
}
