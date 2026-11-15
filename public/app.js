const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

let pollTimer = null;
let scriptDirty = false;
let elevenLabsDirty = false;

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function showToast(message, isError = false) {
  const region = $("#toast-region");
  const toast = document.createElement("div");
  toast.className = `toast${isError ? " is-error" : ""}`;
  toast.textContent = message;
  region.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

function updateScriptStats(text) {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const estSeconds = Math.round((words / 140) * 60);
  $("#script-stats").textContent = `${words} palabras · ~${estSeconds}s estimados`;
}

function updateChip(id, ok, label) {
  const el = $(id);
  el.classList.remove("is-ok", "is-missing");
  el.classList.add(ok ? "is-ok" : "is-missing");
  el.querySelector("span:last-child").textContent = ok ? `${label}: OK` : `${label}: Falta en .env`;
}

function renderAssetPreview(key, meta, mediaUrl, isImage) {
  const stateEl = $(`#state-${key}`);
  const dropEl = $(`#drop-${key}`);
  const previewEl = $(`#preview-${key}`);
  const metaEl = $(`#meta-${key}`);

  if (meta.exists) {
    stateEl.textContent = "Cargado";
    stateEl.classList.add("is-ready");
    dropEl.classList.add("hidden");
    previewEl.classList.remove("hidden");
    metaEl.textContent = formatBytes(meta.size);

    const cacheBust = `?t=${encodeURIComponent(meta.updatedAt || Date.now())}`;
    if (isImage) {
      const img = $(`#img-${key}`);
      if (!img.dataset.loadedAt || img.dataset.loadedAt !== meta.updatedAt) {
        img.src = `${mediaUrl}${cacheBust}`;
        img.dataset.loadedAt = meta.updatedAt || "";
      }
    } else {
      const audio = $(`#audio-${key}`);
      if (!audio.dataset.loadedAt || audio.dataset.loadedAt !== meta.updatedAt) {
        audio.src = `${mediaUrl}${cacheBust}`;
        audio.dataset.loadedAt = meta.updatedAt || "";
      }
    }
  } else {
    stateEl.textContent =
      key === "bgMusic" || key === "watermark" || key === "voiceover" ? "Opcional" : "Pendiente";
    stateEl.classList.remove("is-ready");
    dropEl.classList.remove("hidden");
    previewEl.classList.add("hidden");
  }
}

function renderOutputs(outputs) {
  const scenes = outputs.scenes || [];
  const storyboard = outputs.storyboard;
  const timestamps = outputs.timestamps;

  $("#count-scenes").textContent = String(scenes.length);

  // Scenes tab
  const scenesGrid = $("#scenes-grid");
  const emptyScenes = $("#empty-scenes");
  if (scenes.length === 0) {
    emptyScenes.classList.remove("hidden");
    scenesGrid.innerHTML = "";
  } else {
    emptyScenes.classList.add("hidden");
    const sceneMap = new Map((storyboard?.scenes || []).map((s) => [s.id, s]));
    scenesGrid.innerHTML = scenes
      .map((filename) => {
        const match = filename.match(/scene_(\d+)\.png/);
        const id = match ? Number(match[1]) : 0;
        const meta = sceneMap.get(id);
        return `
          <article class="scene-card">
            <img src="/media/scenes/${filename}?t=${Date.now()}" alt="Escena ${id}" loading="lazy" />
            <div class="scene-card-body">
              <div class="scene-meta-row">
                <span>Escena ${id || filename}</span>
                ${meta ? `<span>${meta.start.toFixed(1)}s – ${meta.end.toFixed(1)}s</span>` : ""}
              </div>
              ${
                meta
                  ? `
                <div class="scene-tags">
                  <span class="tag">${meta.use_character ? "Con personaje" : "Conceptual"}</span>
                  <span class="tag">${meta.camera_motion}</span>
                </div>
                <p class="scene-prompt" title="${meta.image_prompt.replace(/"/g, "&quot;")}">${meta.image_prompt}</p>
              `
                  : ""
              }
            </div>
          </article>
        `;
      })
      .join("");
  }

  // Storyboard tab
  const sbContent = $("#storyboard-content");
  const emptySb = $("#empty-storyboard");
  if (!storyboard) {
    emptySb.classList.remove("hidden");
    sbContent.classList.add("hidden");
  } else {
    emptySb.classList.add("hidden");
    sbContent.classList.remove("hidden");
    sbContent.innerHTML = `
      <div class="storyboard-box">
        <div>
          <strong>${storyboard.title}</strong>
          <p class="card-help" style="margin-top:4px">${storyboard.caption}</p>
        </div>
        <div style="display:flex;flex-direction:column;gap:8px;">
          ${storyboard.scenes
            .map(
              (s) => `
            <div style="padding:10px 12px;border-radius:8px;background:var(--bg-canvas);border:1px solid var(--border-hairline);">
              <div style="display:flex;justify-content:space-between;font-size:0.8rem;font-weight:700;margin-bottom:4px;">
                <span>Escena #${s.id} (${s.start}s → ${s.end}s)</span>
                <span>${s.use_character ? "Personaje" : "Conceptual"} · ${s.camera_motion}</span>
              </div>
              <div style="font-size:0.84rem;color:var(--ink-secondary);">${s.image_prompt}</div>
            </div>
          `,
            )
            .join("")}
        </div>
      </div>
    `;
  }

  // Timestamps tab
  const tsContent = $("#timestamps-content");
  const emptyTs = $("#empty-timestamps");
  if (!timestamps) {
    emptyTs.classList.remove("hidden");
    tsContent.classList.add("hidden");
  } else {
    emptyTs.classList.add("hidden");
    tsContent.classList.remove("hidden");
    tsContent.innerHTML = `
      <div class="timestamps-box">
        <div style="font-size:0.88rem;font-weight:600;">
          Duración total: ${timestamps.duration}s · ${timestamps.words.length} palabras detectadas
        </div>
        <div class="word-cloud">
          ${timestamps.words
            .map((w) => `<span class="word-chip">${w.word}<small>${w.start}s</small></span>`)
            .join("")}
        </div>
      </div>
    `;
  }
}

async function fetchStatus() {
  const res = await fetch("/api/status");
  if (!res.ok) return;
  const data = await res.json();

  if (data.env.transcriberProvider === "openai") {
    updateChip("#chip-openai", data.env.openai, "OpenAI Whisper");
  } else {
    updateChip("#chip-openai", true, "Whisper Local (Gratis)");
  }
  updateChip("#chip-gemini", data.env.gemini, "Gemini API");

  // Projects
  if (data.activeProject && Array.isArray(data.projects)) {
    const select = $("#project-select");
    select.innerHTML = data.projects
      .map(
        (p) =>
          `<option value="${p.slug}" ${p.slug === data.activeProject.slug ? "selected" : ""}>${p.name}</option>`,
      )
      .join("");
    $("#active-project-path").textContent = `projects/${data.activeProject.slug}/`;
    const deleteBtn = $("#btn-delete-project");
    deleteBtn.disabled = data.projects.length <= 1;
    deleteBtn.title =
      data.projects.length <= 1 ? "Debe existir al menos un proyecto" : "Eliminar este proyecto";
  }

  // Script
  const scriptMeta = data.files.script;
  const scriptState = $("#state-script");
  if (scriptMeta.exists && scriptMeta.content.trim().length > 0) {
    scriptState.textContent = "Guardado";
    scriptState.classList.add("is-ready");
  } else {
    scriptState.textContent = "Pendiente";
    scriptState.classList.remove("is-ready");
  }

  if (!scriptDirty) {
    const textarea = $("#script-textarea");
    textarea.value = scriptMeta.content || "";
    updateScriptStats(textarea.value);
  }

  const elevenMeta = data.files.scriptElevenLabs;
  if (!elevenLabsDirty && elevenMeta) {
    $("#elevenlabs-textarea").value = elevenMeta.content || "";
  }

  // Assets
  renderAssetPreview("voiceover", data.files.voiceover, "/media/voiceover", false);
  renderAssetPreview("characterRef", data.files.characterRef, "/media/character_ref", true);
  renderAssetPreview("bgMusic", data.files.bgMusic, "/media/bg_music", false);
  renderAssetPreview("watermark", data.files.watermark, "/media/watermark", true);

  // Readiness
  const hasScript = scriptMeta.exists && scriptMeta.content.trim().length > 0;
  const hasAudio = data.files.voiceover.exists;
  const readinessEl = $("#readiness-summary");
  if (hasScript && hasAudio) {
    readinessEl.textContent = "Listo (guion + audio)";
    readinessEl.classList.add("is-ready");
  } else if (hasScript) {
    readinessEl.textContent = "Listo para storyboard y escenas (sin audio)";
    readinessEl.classList.add("is-ready");
  } else {
    readinessEl.textContent = "Falta el guion";
    readinessEl.classList.remove("is-ready");
  }

  // Job state
  const { job } = data;
  const runButtons = $$("[data-run]");
  runButtons.forEach((btn) => {
    if (btn.dataset.run === "transcribe" && !hasAudio) {
      btn.disabled = true;
      btn.title = "Sube primero un archivo en Audio de Locución";
    } else {
      btn.disabled = job.running;
      btn.title = "";
    }
  });

  const jobStatusText = $("#job-status-text");
  const consoleBadge = $("#console-step-badge");
  const consoleLog = $("#console-log");

  if (job.running) {
    jobStatusText.textContent = `Ejecutando: ${job.step}...`;
    consoleBadge.textContent = job.step || "Running";
  } else if (job.error) {
    jobStatusText.textContent = "Error en la última ejecución";
    consoleBadge.textContent = "Error";
  } else if (job.finishedAt) {
    jobStatusText.textContent = "Última ejecución completada";
    consoleBadge.textContent = "Done";
  } else {
    jobStatusText.textContent = "En espera";
    consoleBadge.textContent = "Idle";
  }

  if (job.logs && job.logs.length > 0) {
    consoleLog.textContent = job.logs.join("\n");
    consoleLog.scrollTop = consoleLog.scrollHeight;
  }

  if (job.running && !pollTimer) {
    pollTimer = setInterval(fetchStatus, 1200);
  } else if (!job.running && pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  renderOutputs(data.outputs);
}

async function uploadAsset(assetKey, file) {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch(`/api/upload/${assetKey}`, { method: "POST", body: form });
  const json = await res.json();
  if (!res.ok) {
    showToast(json.error || "Error al subir archivo", true);
    return;
  }
  showToast(`Archivo guardado (${formatBytes(json.size)})`);
  await fetchStatus();
}

async function saveScriptText(content) {
  const res = await fetch("/api/upload/script", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  const json = await res.json();
  if (!res.ok) {
    showToast(json.error || "Error al guardar guion", true);
    return;
  }
  scriptDirty = false;
  showToast("Guion guardado en input/script.txt");
  await fetchStatus();
}

function setupDropzones() {
  $$(".dropzone").forEach((zone) => {
    const assetKey = zone.dataset.asset;
    const input = zone.querySelector('input[type="file"]');

    zone.addEventListener("click", () => input.click());
    zone.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        input.click();
      }
    });

    zone.addEventListener("dragover", (e) => {
      e.preventDefault();
      zone.classList.add("is-dragover");
    });

    zone.addEventListener("dragleave", () => {
      zone.classList.remove("is-dragover");
    });

    zone.addEventListener("drop", (e) => {
      e.preventDefault();
      zone.classList.remove("is-dragover");
      const file = e.dataTransfer?.files?.[0];
      if (file) void uploadAsset(assetKey, file);
    });

    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (file) void uploadAsset(assetKey, file);
      input.value = "";
    });
  });

  // Delete buttons
  $$("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const assetKey = btn.dataset.delete;
      const res = await fetch(`/api/upload/${assetKey}`, { method: "DELETE" });
      if (res.ok) {
        showToast("Archivo eliminado");
        await fetchStatus();
      }
    });
  });
}

function setupScriptEditor() {
  const textarea = $("#script-textarea");
  const fileInput = $("#file-script");
  const saveBtn = $("#btn-save-script");

  textarea.addEventListener("input", () => {
    scriptDirty = true;
    updateScriptStats(textarea.value);
  });

  saveBtn.addEventListener("click", () => {
    void saveScriptText(textarea.value);
  });

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    const text = await file.text();
    textarea.value = text;
    updateScriptStats(text);
    await saveScriptText(text);
    fileInput.value = "";
  });
}

function showGeneratedPrompt(promptText) {
  const wrap = $("#prompt-output-wrap");
  const area = $("#generated-prompt-textarea");
  area.value = promptText;
  wrap.classList.remove("hidden");
  wrap.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function setupScriptGenerator() {
  const form = $("#script-generator-form");
  const btn = $("#btn-generate-script");
  const copyPromptBtn = $("#btn-copy-prompt");
  const closePromptBtn = $("#btn-close-prompt");

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const topic = $("#gen-topic").value.trim();
    if (!topic) return;

    const durationSeconds = Number($("#gen-duration").value) || 45;
    const tone = $("#gen-tone").value;
    const customInstructions = $("#gen-custom").value.trim();

    btn.disabled = true;
    btn.textContent = "Armando...";

    try {
      const res = await fetch("/api/script/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, durationSeconds, tone, customInstructions }),
      });
      const json = await res.json();
      if (!res.ok) {
        showToast(json.error || "Error al armar el prompt", true);
        return;
      }

      showGeneratedPrompt(json.prompt);
      showToast("Prompt listo para copiar y pegar en tu agente IA");
    } finally {
      btn.disabled = false;
      btn.textContent = "Generar Prompt";
    }
  });

  copyPromptBtn.addEventListener("click", async () => {
    const text = $("#generated-prompt-textarea").value;
    if (!text.trim()) return;
    await navigator.clipboard.writeText(text);
    showToast("Prompt copiado al portapapeles");
  });

  closePromptBtn.addEventListener("click", () => {
    $("#prompt-output-wrap").classList.add("hidden");
  });
}

function setupElevenLabsEditor() {
  const elTextarea = $("#elevenlabs-textarea");
  const retagBtn = $("#btn-retag-elevenlabs");
  const copyBtn = $("#btn-copy-elevenlabs");
  const saveBtn = $("#btn-save-elevenlabs");

  elTextarea.addEventListener("input", () => {
    elevenLabsDirty = true;
  });

  $$("[data-script-tab]").forEach((tab) => {
    tab.addEventListener("click", () => {
      const target = tab.dataset.scriptTab;
      $$("[data-script-tab]").forEach((t) => t.classList.toggle("is-active", t === tab));
      $("#script-panel-clean").classList.toggle("hidden", target !== "clean");
      $("#script-panel-elevenlabs").classList.toggle("hidden", target !== "elevenlabs");
      $("#script-file-label").textContent =
        target === "clean" ? "input/script.txt" : "workspace/script_elevenlabs.txt";
    });
  });

  retagBtn.addEventListener("click", async () => {
    if (scriptDirty) {
      await saveScriptText($("#script-textarea").value);
    }
    retagBtn.disabled = true;
    retagBtn.textContent = "Armando...";
    try {
      const tone = $("#gen-tone").value;
      const res = await fetch("/api/script/elevenlabs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ regenerate: true, tone }),
      });
      const json = await res.json();
      if (!res.ok) {
        showToast(json.error || "No se pudo armar el prompt", true);
        return;
      }
      showGeneratedPrompt(json.prompt);
      showToast("Prompt ElevenLabs listo para copiar");
    } finally {
      retagBtn.disabled = false;
      retagBtn.textContent = "Prompt ElevenLabs";
    }
  });

  copyBtn.addEventListener("click", async () => {
    if (!elTextarea.value.trim()) {
      showToast("No hay texto para copiar", true);
      return;
    }
    await navigator.clipboard.writeText(elTextarea.value);
    showToast("Guion ElevenLabs copiado al portapapeles");
  });

  saveBtn.addEventListener("click", async () => {
    const res = await fetch("/api/script/elevenlabs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: elTextarea.value }),
    });
    const json = await res.json();
    if (!res.ok) {
      showToast(json.error || "Error al guardar", true);
      return;
    }
    elevenLabsDirty = false;
    showToast("Formato ElevenLabs guardado");
    await fetchStatus();
  });
}

function setupRunner() {
  $$("[data-run]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const step = btn.dataset.run;
      if (scriptDirty) {
        await saveScriptText($("#script-textarea").value);
      }
      const res = await fetch(`/api/run/${step}`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        showToast(json.error || "No se pudo iniciar el pipeline", true);
        return;
      }
      showToast(`Ejecutando: ${step}`);
      await fetchStatus();
    });
  });
}

function setupTabs() {
  $$("[data-tab]").forEach((tab) => {
    tab.addEventListener("click", () => {
      const target = tab.dataset.tab;
      $$("[data-tab]").forEach((t) => t.classList.toggle("is-active", t === tab));
      $$(".tab-panel").forEach((panel) => {
        panel.classList.toggle("hidden", panel.id !== `panel-${target}`);
      });
    });
  });
}

function setupProjectSwitcher() {
  const select = $("#project-select");
  const newBtn = $("#btn-new-project");
  const cancelBtn = $("#btn-cancel-project");
  const form = $("#new-project-form");
  const nameInput = $("#new-project-name");

  const resetLocalEditorState = () => {
    scriptDirty = false;
    elevenLabsDirty = false;
    const audioVo = $("#audio-voiceover");
    if (audioVo) audioVo.dataset.loadedAt = "";
  };

  select.addEventListener("change", async () => {
    const slug = select.value;
    const res = await fetch("/api/projects/select", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug }),
    });
    const json = await res.json();
    if (!res.ok) {
      showToast(json.error || "No se pudo cambiar de proyecto", true);
      await fetchStatus();
      return;
    }
    resetLocalEditorState();
    showToast(`Proyecto activo: ${json.project.name}`);
    await fetchStatus();
  });

  newBtn.addEventListener("click", () => {
    form.classList.remove("hidden");
    nameInput.focus();
  });

  cancelBtn.addEventListener("click", () => {
    form.classList.add("hidden");
    nameInput.value = "";
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    if (!name) return;

    const res = await fetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    const json = await res.json();
    if (!res.ok) {
      showToast(json.error || "No se pudo crear el proyecto", true);
      return;
    }

    form.classList.add("hidden");
    nameInput.value = "";
    resetLocalEditorState();
    showToast(`Carpeta creada: projects/${json.project.slug}/`);
    await fetchStatus();
  });

  const deleteBtn = $("#btn-delete-project");
  const confirmBar = $("#delete-project-confirm");
  const confirmMsg = $("#delete-project-message");
  const confirmDeleteBtn = $("#btn-confirm-delete-project");
  const cancelDeleteBtn = $("#btn-cancel-delete-project");

  deleteBtn.addEventListener("click", () => {
    const selectedOption = select.options[select.selectedIndex];
    const projectName = selectedOption ? selectedOption.textContent : select.value;
    confirmMsg.textContent = `¿Eliminar permanentemente "${projectName}" y todos sus archivos (guion, audio y escenas)?`;
    form.classList.add("hidden");
    confirmBar.classList.remove("hidden");
  });

  cancelDeleteBtn.addEventListener("click", () => {
    confirmBar.classList.add("hidden");
  });

  confirmDeleteBtn.addEventListener("click", async () => {
    const slug = select.value;
    confirmDeleteBtn.disabled = true;
    try {
      const res = await fetch(`/api/projects/${encodeURIComponent(slug)}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok) {
        showToast(json.error || "No se pudo eliminar el proyecto", true);
        return;
      }
      confirmBar.classList.add("hidden");
      resetLocalEditorState();
      showToast(`Proyecto eliminado. Activo: ${json.activeProject.name}`);
      await fetchStatus();
    } finally {
      confirmDeleteBtn.disabled = false;
    }
  });
}

setupProjectSwitcher();
setupDropzones();
setupScriptEditor();
setupScriptGenerator();
setupElevenLabsEditor();
setupRunner();
setupTabs();
void fetchStatus();
