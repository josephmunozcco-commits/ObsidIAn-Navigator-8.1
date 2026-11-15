// Dynamic interactive spotlight tutorial highlighting key ObsidIAn Navigator controls.

const TOUR_STORAGE_KEY = "obsidian_navigator_tour_v1";

const STEPS = [
  {
    selector: ".map-wrap",
    inset: true,
    badge: "VISOR ORBITAL",
    title: "Explora Marte en tiempo real",
    desc: "Arrastra y usa el zoom para recorrer el cráter Jezero. Toca cualquier punto del mapa para leer su elevación, pendiente y contexto geológico.",
  },
  {
    selector: ".view-toggle",
    badge: "MODO 2D / 3D",
    title: "Cambia entre mapa 2D y relieve 3D",
    desc: "Alterna entre la vista orbital 2D y el modelo 3D real del terreno MOLA con mosaicos NASA y exageración vertical ajustable.",
  },
  {
    selector: ".header-actions",
    badge: "ACCESOS RÁPIDOS",
    title: "Capas cartográficas y centrar",
    desc: "Pulsa ▱ para activar HiRISE (25 cm), pendientes >15° o mapas térmicos, y usa ⌖ para volver al instante a Jezero.",
  },
  {
    selector: ".overview",
    badge: "TELEMETRÍA",
    title: "Elevación y pendiente del sector",
    desc: "Consulta al instante la cota MOLA en metros, los grados de inclinación y el nivel de riesgo del punto que toques.",
  },
  {
    selector: '.bottom-nav a[href="#points"]',
    badge: "PUNTOS CIENTÍFICOS",
    title: "Objetivos reales de Jezero",
    desc: "Explora zonas clave de la misión (Delta Front, Séítah, Neretva, Belva) y úsalas directamente como origen o destino.",
  },
  {
    selector: '.bottom-nav a[href="#planner"]',
    badge: "RUTAS Y ROVER",
    title: "Planifica rutas y simula el rover",
    desc: "Fija los puntos A y B para trazar la ruta de menor pendiente y simular el recorrido de Perseverance o Curiosity con telemetría.",
  },
  {
    selector: '.bottom-nav a[href="#plans"]',
    badge: "EXPORTACIÓN",
    title: "Descarga y comparte tus planes",
    desc: "Exporta tu ruta en GeoJSON, GPX, KML, PNG, CSV, PDF o TXT, y compártela con un enlace directo.",
  },
];

function wasTourDone() {
  try {
    return localStorage.getItem(TOUR_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function markTourDone() {
  try {
    localStorage.setItem(TOUR_STORAGE_KEY, "1");
  } catch {
    /* ignore storage errors */
  }
}

export function setupGuide() {
  const layer = document.getElementById("tour-layer");
  const spotlight = document.getElementById("tour-spotlight");
  const card = document.getElementById("tour-card");
  const reopen = document.getElementById("tour-reopen");
  const labelEl = document.getElementById("tour-step-label");
  const fillEl = document.getElementById("tour-progress-fill");
  const titleEl = document.getElementById("tour-title");
  const descEl = document.getElementById("tour-desc");
  const dotsEl = document.getElementById("tour-dots");
  const prevBtn = document.getElementById("tour-prev");
  const nextBtn = document.getElementById("tour-next");
  const skipBtn = document.getElementById("tour-skip");

  if (!layer || !spotlight || !card || !reopen) return;

  let current = 0;
  let active = false;

  dotsEl.innerHTML = STEPS.map(() => "<i></i>").join("");
  const dots = [...dotsEl.querySelectorAll("i")];

  function getTargetRect(step) {
    const el = document.querySelector(step.selector);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (step.inset) {
      const padX = Math.min(26, r.width * 0.08);
      const padTop = Math.min(54, r.height * 0.16);
      const padBottom = Math.min(42, r.height * 0.12);
      return {
        left: r.left + padX,
        top: r.top + padTop,
        width: Math.max(80, r.width - padX * 2),
        height: Math.max(80, r.height - padTop - padBottom),
        radius: 14,
      };
    }
    const pad = 6;
    return {
      left: Math.max(4, r.left - pad),
      top: Math.max(4, r.top - pad),
      width: Math.min(window.innerWidth - 8, r.width + pad * 2),
      height: Math.min(window.innerHeight - 8, r.height + pad * 2),
      radius: 14,
    };
  }

  function positionStep() {
    if (!active) return;
    const step = STEPS[current];
    const rect = getTargetRect(step);
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 12;

    if (rect) {
      spotlight.style.left = `${rect.left}px`;
      spotlight.style.top = `${rect.top}px`;
      spotlight.style.width = `${rect.width}px`;
      spotlight.style.height = `${rect.height}px`;
      spotlight.style.borderRadius = `${rect.radius}px`;
    }

    const cardRect = card.getBoundingClientRect();
    const cw = cardRect.width || Math.min(330, vw - 24);
    const ch = cardRect.height || 180;

    let left = (vw - cw) / 2;
    let top = (vh - ch) / 2;

    if (rect) {
      if (step.inset) {
        left = rect.left + (rect.width - cw) / 2;
        top = rect.top + rect.height - ch - 12;
        if (top < rect.top + 12) top = rect.top + 12;
      } else {
        const spaceBelow = vh - (rect.top + rect.height);
        const spaceAbove = rect.top;
        left = rect.left + rect.width / 2 - cw / 2;
        if (spaceBelow >= ch + 18) {
          top = rect.top + rect.height + 12;
        } else if (spaceAbove >= ch + 18) {
          top = rect.top - ch - 12;
        } else {
          top = (vh - ch) / 2;
        }
      }
    }

    left = Math.max(margin, Math.min(vw - cw - margin, left));
    top = Math.max(margin, Math.min(vh - ch - margin, top));

    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  }

  function render() {
    const step = STEPS[current];
    labelEl.textContent = `${step.badge} · ${current + 1}/${STEPS.length}`;
    fillEl.style.width = `${((current + 1) / STEPS.length) * 100}%`;
    titleEl.textContent = step.title;
    descEl.textContent = step.desc;
    dots.forEach((dot, i) => dot.classList.toggle("on", i === current));
    prevBtn.hidden = current === 0;
    nextBtn.textContent = current === STEPS.length - 1 ? "Empezar" : "Siguiente";
    requestAnimationFrame(positionStep);
  }

  function start() {
    const hadPanelOpen = Boolean(document.querySelector(".workspace.panel-open"));
    if (hadPanelOpen) {
      document.querySelector(".panel-close")?.click();
    }
    current = 0;
    active = true;
    layer.hidden = false;
    reopen.setAttribute("aria-expanded", "true");
    render();
    if (hadPanelOpen) {
      setTimeout(positionStep, 340);
    }
  }

  function close() {
    active = false;
    layer.hidden = true;
    reopen.setAttribute("aria-expanded", "false");
    markTourDone();
  }

  nextBtn.addEventListener("click", () => {
    if (current < STEPS.length - 1) {
      current += 1;
      render();
    } else {
      close();
    }
  });

  prevBtn.addEventListener("click", () => {
    if (current > 0) {
      current -= 1;
      render();
    }
  });

  skipBtn.addEventListener("click", close);
  reopen.addEventListener("click", start);

  layer.addEventListener("click", (event) => {
    if (event.target === layer) close();
  });

  window.addEventListener("resize", () => {
    if (active) requestAnimationFrame(positionStep);
  });

  document.addEventListener("keydown", (event) => {
    if (!active) return;
    if (event.key === "Escape") close();
    else if (event.key === "ArrowRight") nextBtn.click();
    else if (event.key === "ArrowLeft" && current > 0) prevBtn.click();
  });

  if (!wasTourDone()) {
    setTimeout(start, 450);
  }
}
