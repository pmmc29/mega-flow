const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

let pollTimer = null;
let bundleDirty = false;
let latestStatus = null;
let forceShow4in1Cards = false;
const openProjectFormatModules = new Set();
const openGlobalFormatModules = new Set();

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

function renderOutputs(outputs, config = {}) {
  const scenes = outputs.scenes || [];
  const storyboard = outputs.storyboard;
  const timestamps = outputs.timestamps;

  $("#count-scenes").textContent = String(scenes.length);

  // Scenes tab (Google Flow + previews)
  const scenesGrid = $("#scenes-grid");
  const emptyScenes = $("#empty-scenes");
  const scenesToolbar = $("#scenes-toolbar");
  const scenesProgressText = $("#scenes-progress-text");
  const existingSet = new Set(scenes);
  const styleAnchor = config?.styleAnchor || "";
  const characterPrefix = config?.characterPrefix || "";

  if (storyboard?.scenes?.length) {
    emptyScenes.classList.add("hidden");
    scenesToolbar?.classList.remove("hidden");
    const loadedCount = storyboard.scenes.filter((s) =>
      existingSet.has(`scene_${String(s.id).padStart(3, "0")}.png`),
    ).length;
    if (scenesProgressText) {
      scenesProgressText.textContent = `${loadedCount} / ${storyboard.scenes.length} escenas listas`;
    }

    scenesGrid.innerHTML = storyboard.scenes
      .map((meta) => {
        const filename = `scene_${String(meta.id).padStart(3, "0")}.png`;
        const hasImage = existingSet.has(filename);
        const flowPromptParts = [];
        if (meta.use_character && characterPrefix) flowPromptParts.push(characterPrefix.trim());
        flowPromptParts.push(meta.image_prompt);
        if (styleAnchor) flowPromptParts.push(styleAnchor);
        const fullFlowPrompt = flowPromptParts.join(" ").replace(/\s+/g, " ").trim();
        const escapedPrompt = fullFlowPrompt.replace(/"/g, "&quot;");

        return `
          <article class="scene-card" data-scene-id="${meta.id}">
            ${
              hasImage
                ? `<img src="/media/scenes/${filename}?t=${Date.now()}" alt="Escena ${meta.id}" loading="lazy" />`
                : `<label class="scene-dropzone" data-scene-drop="${meta.id}">
                    <span>Arrastra o haz clic para subir<br/><strong>${filename}</strong></span>
                    <input type="file" class="scene-file-input" data-scene-id="${meta.id}" accept="image/png,image/jpeg,image/webp" hidden />
                  </label>`
            }
            <div class="scene-card-body">
              <div class="scene-meta-row">
                <span>Escena ${meta.id}</span>
                <span>${meta.start.toFixed(1)}s – ${meta.end.toFixed(1)}s</span>
              </div>
              <div class="scene-tags">
                <span class="tag ${meta.use_character ? "tag-character" : ""}">${
                  meta.use_character ? "Personaje (adjuntar ref)" : "Conceptual"
                }</span>
                <span class="tag">${meta.camera_motion}</span>
              </div>
              <p class="scene-prompt" title="${escapedPrompt}">${meta.image_prompt}</p>
              <div class="scene-actions">
                <button type="button" class="btn btn-primary btn-xs btn-copy-flow-prompt" data-flow-prompt="${escapedPrompt}">
                  Copiar prompt
                </button>
                <button type="button" class="btn btn-secondary btn-xs btn-regen-flow-scene" data-scene-id="${meta.id}">
                  Regenerar Flow
                </button>
                <button type="button" class="btn btn-ghost btn-xs btn-toggle-scene-edit" data-scene-id="${meta.id}">
                  Editar
                </button>
                ${
                  hasImage
                    ? `<label class="btn btn-secondary btn-xs scene-upload-label">
                        Reemplazar
                        <input type="file" class="scene-file-input" data-scene-id="${meta.id}" accept="image/png,image/jpeg,image/webp" hidden />
                      </label>
                      <button type="button" class="btn btn-ghost btn-xs btn-delete-scene" data-scene-id="${meta.id}">
                        Quitar
                      </button>`
                    : ""
                }
              </div>
              <div class="scene-edit-panel hidden" id="scene-edit-${meta.id}">
                <textarea class="scene-edit-prompt" data-scene-id="${meta.id}">${meta.image_prompt}</textarea>
                <div class="scene-edit-row">
                  <select class="scene-edit-motion" data-scene-id="${meta.id}">
                    ${["zoom_in", "zoom_out", "pan_left", "pan_right"]
                      .map(
                        (m) =>
                          `<option value="${m}" ${meta.camera_motion === m ? "selected" : ""}>${m}</option>`,
                      )
                      .join("")}
                  </select>
                  <label style="display:flex;align-items:center;gap:4px;">
                    <input type="checkbox" class="scene-edit-char" data-scene-id="${meta.id}" ${
                      meta.use_character ? "checked" : ""
                    } />
                    Personaje
                  </label>
                  <button type="button" class="btn btn-primary btn-xs btn-save-scene-edit" data-scene-id="${meta.id}">
                    Guardar
                  </button>
                </div>
              </div>
            </div>
          </article>
        `;
      })
      .join("");
  } else if (scenes.length === 0) {
    scenesToolbar?.classList.add("hidden");
    emptyScenes.classList.remove("hidden");
    scenesGrid.innerHTML = "";
  } else {
    scenesToolbar?.classList.remove("hidden");
    if (scenesProgressText) {
      scenesProgressText.textContent = `${scenes.length} escenas cargadas`;
    }
    emptyScenes.classList.add("hidden");
    scenesGrid.innerHTML = scenes
      .map((filename) => {
        const match = filename.match(/scene_(\d+)\.png/);
        const id = match ? Number(match[1]) : 0;
        return `
          <article class="scene-card" data-scene-id="${id}">
            <img src="/media/scenes/${filename}?t=${Date.now()}" alt="Escena ${id}" loading="lazy" />
            <div class="scene-card-body">
              <div class="scene-meta-row">
                <span>Escena ${id || filename}</span>
              </div>
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
  const isEditingTs = Boolean(
    tsContent && document.activeElement && tsContent.contains(document.activeElement),
  );
  if (!timestamps) {
    emptyTs.classList.remove("hidden");
    tsContent.classList.add("hidden");
  } else if (!isEditingTs) {
    emptyTs.classList.add("hidden");
    tsContent.classList.remove("hidden");
    const tsSourceLabel =
      timestamps.source === "estimated"
        ? "Vista previa estándar (del guion)"
        : "Whisper (sincronizado con audio)";
    tsContent.innerHTML = `
      <div class="timestamps-box">
        <div class="ts-editor-toolbar">
          <div style="font-size:0.88rem;font-weight:600;display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
            <span>Duración total: ${timestamps.duration}s · ${timestamps.words.length} palabras</span>
            <span class="badge">${tsSourceLabel}</span>
          </div>
          <button type="button" class="btn btn-primary btn-xs" id="btn-save-timestamps">
            Guardar Timestamps
          </button>
        </div>
        <div class="ts-editor-grid" id="ts-editor-grid">
          ${timestamps.words
            .map(
              (w, idx) => `
              <div class="ts-word-row" data-word-idx="${idx}">
                <input type="text" class="ts-word-input" value="${String(w.word).replace(/"/g, "&quot;")}" aria-label="Palabra ${idx + 1}" />
                <input type="number" step="0.01" min="0" class="ts-start-input" value="${w.start}" title="Inicio (s)" />
                <input type="number" step="0.01" min="0" class="ts-end-input" value="${w.end}" title="Fin (s)" />
              </div>`,
            )
            .join("")}
        </div>
      </div>
    `;
  }

  // Video Final tab
  const finalVideo = outputs.finalVideo;
  const emptyVideo = $("#empty-video");
  const videoContent = $("#video-content");
  const videoPlayer = $("#final-video-player");
  if (!finalVideo || !finalVideo.exists) {
    emptyVideo.classList.remove("hidden");
    videoContent.classList.add("hidden");
  } else {
    emptyVideo.classList.add("hidden");
    videoContent.classList.remove("hidden");
    $("#meta-final-video").textContent = formatBytes(finalVideo.size);
    if (videoPlayer.dataset.loadedAt !== finalVideo.updatedAt) {
      videoPlayer.src = `/media/final_video?t=${encodeURIComponent(finalVideo.updatedAt || Date.now())}`;
      videoPlayer.dataset.loadedAt = finalVideo.updatedAt || "";
      videoPlayer.load();
    }
  }
}

async function fetchStatus() {
  const res = await fetch("/api/status", { cache: "no-store" });
  if (!res.ok) return;
  const data = await res.json();

  if (data.env.transcriberProvider === "openai") {
    updateChip("#chip-openai", data.env.openai, "OpenAI Whisper");
  } else {
    updateChip("#chip-openai", true, "Whisper Local (Gratis)");
  }

  const aceChip = $("#chip-acestep");
  const aceToggleBtn = $("#btn-acestep-toggle");
  const aceState = data.env?.aceStep || {};
  if (aceChip) {
    aceChip.classList.remove("is-ok", "is-missing", "is-starting");
    if (aceState.available) {
      aceChip.classList.add("is-ok");
      aceChip.querySelector("span:last-child").textContent = "ACE-Step: Conectado";
    } else if (aceState.starting || aceState.managed) {
      aceChip.classList.add("is-starting");
      aceChip.querySelector("span:last-child").textContent = "ACE-Step: Iniciando...";
    } else {
      aceChip.classList.add("is-missing");
      aceChip.querySelector("span:last-child").textContent = "ACE-Step: Apagado";
    }
  }
  if (aceToggleBtn) {
    const canStop = Boolean(aceState.managed);
    if (canStop) {
      aceToggleBtn.textContent = "Detener ACE-Step";
      aceToggleBtn.disabled = false;
      aceToggleBtn.title = "Detener el servicio local de ACE-Step";
    } else if (aceState.available) {
      aceToggleBtn.textContent = "Externo activo";
      aceToggleBtn.disabled = true;
      aceToggleBtn.title = "ACE-Step ya está corriendo en otra terminal";
    } else {
      aceToggleBtn.textContent = "Iniciar ACE-Step";
      aceToggleBtn.disabled = false;
      aceToggleBtn.title = "Iniciar ACE-Step 1.5 en segundo plano y ver logs en Paso 2";
    }
  }

  // Projects
  if (data.activeProject && Array.isArray(data.projects)) {
    const select = $("#project-select");
    select.innerHTML = data.projects
      .map(
        (p) =>
          `<option value="${p.slug}" ${p.slug === data.activeProject.slug ? "selected" : ""}>${p.name}</option>`,
      )
      .join("");
    select.value = data.activeProject.slug;
    $("#active-project-path").textContent = `projects/${data.activeProject.slug}/`;
    const deleteBtn = $("#btn-delete-project");
    deleteBtn.disabled = data.projects.length <= 1;
    deleteBtn.title =
      data.projects.length <= 1 ? "Debe existir al menos un proyecto" : "Eliminar este proyecto";

    const toneSelect = $("#gen-tone");
    if (toneSelect && data.activeProject.tone && document.activeElement !== toneSelect) {
      toneSelect.value = data.activeProject.tone;
    }

    const durationSelect = $("#gen-duration");
    if (
      durationSelect &&
      data.activeProject.durationSeconds &&
      document.activeElement !== durationSelect
    ) {
      const targetVal = String(data.activeProject.durationSeconds);
      if ([...durationSelect.options].some((o) => o.value === targetVal)) {
        durationSelect.value = targetVal;
      }
    }
  }

  // Script & 3-in-1 bundle
  const scriptMeta = data.files.script;
  const elevenMeta = data.files.scriptElevenLabs;
  const remotionMeta = data.files.remotionStyle;
  const scriptState = $("#state-script");
  const hasCleanScript = Boolean(scriptMeta?.exists && scriptMeta.content.trim().length > 0);
  const hasEleven = Boolean(elevenMeta?.exists && elevenMeta.content.trim().length > 0);
  const hasRemotion = Boolean(remotionMeta?.exists && remotionMeta.content.trim().length > 0);

  if (hasCleanScript) {
    scriptState.textContent = "Guardado";
    scriptState.classList.add("is-ready");
  } else {
    scriptState.textContent = "Pendiente";
    scriptState.classList.remove("is-ready");
  }

  const hasStoryboard = Boolean(data.outputs?.storyboard?.scenes?.length);

  if (!bundleDirty) {
    const parts = [];
    if (hasCleanScript) {
      parts.push(`=== GUION_LIMPIO ===\n${scriptMeta.content.trim()}`);
    }
    if (hasEleven) {
      parts.push(`=== ELEVENLABS ===\n${elevenMeta.content.trim()}`);
    }
    if (hasRemotion) {
      parts.push(`=== REMOTION_JSON ===\n${remotionMeta.content.trim()}`);
    }
    if (hasStoryboard) {
      parts.push(`=== STORYBOARD_JSON ===\n${JSON.stringify(data.outputs.storyboard, null, 2)}`);
    }
    const bundleArea = $("#bundle-textarea");
    if (bundleArea) {
      bundleArea.value = parts.join("\n\n");
    }
  }

  const bundleStatusEl = $("#bundle-status");
  if (bundleStatusEl && !bundleDirty) {
    if (hasCleanScript || hasEleven || hasRemotion || hasStoryboard) {
      bundleStatusEl.textContent = [
        `Guion ${hasCleanScript ? "✓" : "—"}`,
        `ElevenLabs ${hasEleven ? "✓" : "—"}`,
        `Remotion ${hasRemotion ? "✓" : "preset"}`,
        `Storyboard ${hasStoryboard ? "✓" : "—"}`,
      ].join(" · ");
    } else {
      bundleStatusEl.textContent = "Pendiente de importar";
    }
  }

  const voBox = $("#vo-elevenlabs-box");
  const voText = $("#vo-elevenlabs-textarea");
  if (voBox && voText) {
    if (hasEleven) {
      voBox.classList.remove("hidden");
      voText.value = elevenMeta.content.trim();
    } else {
      voBox.classList.add("hidden");
      voText.value = "";
    }
  }

  // Assets
  renderAssetPreview("voiceover", data.files.voiceover, "/media/voiceover", false);
  renderAssetPreview("characterRef", data.files.characterRef, "/media/character_ref", true);
  renderAssetPreview("bgMusic", data.files.bgMusic, "/media/bg_music", false);
  renderAssetPreview("watermark", data.files.watermark, "/media/watermark", true);

  const bgMusicPathLabel = $("#bgmusic-path-label");
  const bgMusicState = $("#state-bgMusic");
  if (bgMusicPathLabel && bgMusicState && data.files.bgMusic) {
    if (data.files.bgMusic.scope === "project") {
      bgMusicPathLabel.textContent = "input/bg_music.mp3 (proyecto)";
      bgMusicState.textContent = "Este proyecto";
    } else if (data.files.bgMusic.scope === "brand") {
      bgMusicPathLabel.textContent = "assets/brand/bg_music.mp3 (respaldo)";
      bgMusicState.textContent = "Marca (global)";
    } else {
      bgMusicPathLabel.textContent = "input/bg_music.mp3 (o marca)";
      bgMusicState.textContent = "Opcional";
    }
  }

  // Readiness
  const hasScript = scriptMeta.exists && scriptMeta.content.trim().length > 0;
  const hasAudio = data.files.voiceover.exists;

  const aceStepAvailable = Boolean(data.env?.aceStep?.available);
  const aceStepStarting = Boolean(data.env?.aceStep?.starting);
  const aceStepStatusEl = $("#acestep-status");
  if (aceStepStatusEl) {
    if (aceStepAvailable) {
      aceStepStatusEl.textContent = hasAudio
        ? "ACE-Step 1.5: Conectado"
        : "ACE-Step 1.5: Conectado · Sube locución para generar";
    } else if (aceStepStarting) {
      aceStepStatusEl.textContent = "ACE-Step 1.5: Iniciando (ver logs en Paso 2)...";
    } else {
      aceStepStatusEl.textContent = "ACE-Step 1.5: Apagado · Google Flow disponible";
    }
  }

  const btnMusicPrompt = $("#btn-music-prompt");
  if (btnMusicPrompt) {
    btnMusicPrompt.disabled = !hasScript;
    btnMusicPrompt.title = hasScript
      ? "Generar prompt para Google Flow / ACE-Step en base al guion guardado"
      : "Primero aplica y guarda el guion y estilo 3 en 1";
  }

  const btnGenerateAceStep = $("#btn-generate-acestep");
  if (btnGenerateAceStep) {
    btnGenerateAceStep.disabled = !hasScript || !hasAudio || !aceStepAvailable;
    if (!hasScript) {
      btnGenerateAceStep.title = "Primero aplica y guarda el guion y estilo 3 en 1";
    } else if (!hasAudio) {
      btnGenerateAceStep.title =
        "Primero sube el audio de ElevenLabs para igualar su duración";
    } else if (!aceStepAvailable) {
      btnGenerateAceStep.title =
        "Inicia ACE-Step 1.5 localmente con: uv run acestep-api (puerto 8001)";
    } else {
      btnGenerateAceStep.title = "Generar pista instrumental local con ACE-Step 1.5";
    }
  }

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

  latestStatus = data;

  // Job state
  const { job } = data;
  const hasGemini = Boolean(data.env?.gemini);
  const totalScenes = data.outputs?.storyboard?.scenes?.length || 0;
  const loadedScenes = (data.outputs?.scenes || []).length;
  const allScenesReady = totalScenes > 0 && loadedScenes >= totalScenes;

  const runButtons = $$("[data-run]");
  runButtons.forEach((btn) => {
    const step = btn.dataset.run;

    if (step === "direct") {
      btn.classList.toggle("hidden", !hasGemini);
    }

    if (step === "images") {
      btn.textContent = hasGemini
        ? "3. Generar Imágenes"
        : totalScenes > 0
          ? `2. Subir Escenas Flow (${loadedScenes}/${totalScenes})`
          : "2. Subir Escenas (Google Flow)";
    }

    if (step === "render") {
      const prefix = hasGemini ? "4." : "3.";
      btn.textContent = hasAudio
        ? `${prefix} Renderizar Video Final`
        : `${prefix} Renderizar Vista Previa`;
    }

    if (step === "all") {
      btn.textContent = hasGemini
        ? "Ejecutar Pipeline Completo (1 → 4)"
        : hasAudio
          ? "Transcribir y Renderizar Final"
          : "Renderizar Vista Previa";
    }

    if (step === "transcribe" && !hasAudio) {
      btn.disabled = true;
      btn.title =
        "Sube Audio de Locución para ajustar con Whisper (sin audio se usan timestamps estándar en la vista previa)";
    } else if (!hasGemini && (step === "render" || step === "all") && !allScenesReady) {
      btn.disabled = true;
      btn.title =
        totalScenes === 0
          ? "Primero pega y guarda el bloque 4 en 1 con el storyboard"
          : `Faltan escenas por subir en Paso 3 → Escenas (${loadedScenes}/${totalScenes})`;
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

  const flowLiveBox = $("#flow-live-progress");
  if (flowLiveBox) {
    const showFlowLive = Boolean(job.running && job.step === "flow-batch");
    flowLiveBox.classList.toggle("hidden", !showFlowLive);
    if (showFlowLive) {
      const fp = job.flowProgress || { completed: 0, total: 0, lastSceneId: 0 };
      const pct = fp.total > 0 ? Math.min(100, Math.round((fp.completed / fp.total) * 100)) : 5;
      $("#flow-live-label").textContent = fp.lastSceneId
        ? `Generando en Google Flow (última completada: escena #${fp.lastSceneId})...`
        : "Iniciando generación en Google Flow...";
      $("#flow-live-count").textContent = fp.total > 0 ? `${fp.completed} / ${fp.total}` : "...";
      $("#flow-live-fill").style.width = `${pct}%`;
    }
  }

  const shouldPoll = Boolean(job.running || aceStepStarting);
  if (shouldPoll && !pollTimer) {
    pollTimer = setInterval(fetchStatus, 1200);
  } else if (!shouldPoll && pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }

  renderOutputs(data.outputs, data.config);
  renderInputsSummaryAndVisibility(data);
  renderModularConfigs(data);
}

function resetAssetPreviewCache(assetKey) {
  const img = $(`#img-${assetKey}`);
  if (img) {
    img.dataset.loadedAt = "";
    img.removeAttribute("src");
  }
  const audio = $(`#audio-${assetKey}`);
  if (audio) {
    audio.dataset.loadedAt = "";
    audio.removeAttribute("src");
  }
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
  resetAssetPreviewCache(assetKey);
  showToast(`Archivo guardado (${formatBytes(json.size)})`);
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
        resetAssetPreviewCache(assetKey);
        showToast("Archivo eliminado");
        await fetchStatus();
      }
    });
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
  const selectAllBtn = $("#btn-master-select-all");

  selectAllBtn?.addEventListener("click", () => {
    form.querySelectorAll('input[name="master-module"]').forEach((cb) => {
      cb.checked = true;
    });
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const topic = $("#gen-topic").value.trim();
    if (!topic) return;

    const includedModules = Array.from(
      form.querySelectorAll('input[name="master-module"]:checked'),
    ).map((cb) => cb.value);

    if (includedModules.length === 0) {
      showToast("Selecciona al menos un módulo para el Prompt Maestro", true);
      return;
    }

    const durationSeconds = Number($("#gen-duration").value) || 45;
    const tone = $("#gen-tone").value;
    const customInstructions = $("#gen-custom").value.trim();

    btn.disabled = true;
    btn.textContent = "Armando...";

    try {
      const res = await fetch("/api/script/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          topic,
          durationSeconds,
          tone,
          customInstructions,
          includedModules,
        }),
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

  $("#gen-tone").addEventListener("change", async (e) => {
    const tone = e.target.value;
    const res = await fetch("/api/projects/tone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tone }),
    });
    if (res.ok) {
      showToast(`Tono del proyecto: ${tone}`);
    }
  });
}

async function saveUnifiedBundle() {
  const bundleTextarea = $("#bundle-textarea");
  const bundleStatusEl = $("#bundle-status");
  const raw = bundleTextarea ? bundleTextarea.value : "";
  if (!raw.trim()) {
    showToast("Pega primero el bloque completo generado por tu agente IA", true);
    return false;
  }

  const durationSeconds = Number($("#gen-duration")?.value) || undefined;
  const res = await fetch("/api/script/import-bundle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: raw, durationSeconds }),
  });
  const json = await res.json();
  if (!res.ok) {
    showToast(json.error || "No se pudo importar el bloque", true);
    if (bundleStatusEl) {
      bundleStatusEl.textContent = json.error || "Error al parsear el bloque.";
    }
    return false;
  }

  bundleDirty = false;
  if (bundleStatusEl) {
    bundleStatusEl.textContent = "Guion ✓ · ElevenLabs ✓ · Remotion ✓";
  }
  showToast("Guion limpio, ElevenLabs y Estilo Remotion guardados");
  await fetchStatus();
  return true;
}

function setupBundleEditor() {
  const bundleTextarea = $("#bundle-textarea");
  const importBundleBtn = $("#btn-import-bundle");
  const bundleStatusEl = $("#bundle-status");
  const copyVoElevenBtn = $("#btn-copy-vo-elevenlabs");
  const voElevenTextarea = $("#vo-elevenlabs-textarea");

  bundleTextarea.addEventListener("input", () => {
    bundleDirty = true;
    if (bundleStatusEl) {
      bundleStatusEl.textContent = "Cambios sin guardar...";
    }
  });

  importBundleBtn.addEventListener("click", async () => {
    importBundleBtn.disabled = true;
    importBundleBtn.textContent = "Guardando...";
    try {
      await saveUnifiedBundle();
    } finally {
      importBundleBtn.disabled = false;
      importBundleBtn.textContent = "Aplicar y guardar todo";
    }
  });

  if (copyVoElevenBtn && voElevenTextarea) {
    copyVoElevenBtn.addEventListener("click", async () => {
      if (!voElevenTextarea.value.trim()) {
        showToast("No hay guion ElevenLabs para copiar", true);
        return;
      }
      await navigator.clipboard.writeText(voElevenTextarea.value);
      showToast("Guion ElevenLabs copiado al portapapeles");
    });
  }
}

function setupRunner() {
  $$("[data-run]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const step = btn.dataset.run;
      if (bundleDirty && $("#bundle-textarea")?.value.trim()) {
        const ok = await saveUnifiedBundle();
        if (!ok) return;
      }

      if (step === "images" && !latestStatus?.env?.gemini) {
        const scenesTab = $(`[data-tab="scenes"]`);
        scenesTab?.click();
        $("#panel-scenes")?.scrollIntoView({ behavior: "smooth", block: "start" });
        const totalScenes = latestStatus?.outputs?.storyboard?.scenes?.length || 0;
        const loadedScenes = (latestStatus?.outputs?.scenes || []).length;
        if (totalScenes === 0) {
          showToast("Primero pega y guarda el bloque 4 en 1 con el storyboard", true);
        } else if (loadedScenes < totalScenes) {
          showToast(
            `Copia los prompts de cada tarjeta en Google Flow y sube las ${totalScenes - loadedScenes} escena(s) faltante(s).`,
          );
        } else {
          showToast(`Las ${totalScenes} escenas están listas para renderizar.`);
        }
        return;
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
    bundleDirty = false;
    const bundleArea = $("#bundle-textarea");
    if (bundleArea) bundleArea.value = "";
    const voBox = $("#vo-elevenlabs-box");
    if (voBox) voBox.classList.add("hidden");
    const voText = $("#vo-elevenlabs-textarea");
    if (voText) voText.value = "";
    const promptWrap = $("#prompt-output-wrap");
    if (promptWrap) promptWrap.classList.add("hidden");
    resetAssetPreviewCache("voiceover");
    const finalVideoPlayer = $("#final-video-player");
    if (finalVideoPlayer) {
      finalVideoPlayer.dataset.loadedAt = "";
      finalVideoPlayer.removeAttribute("src");
    }
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

function setupMusicPrompt() {
  const genBtn = $("#btn-music-prompt");
  const copyBtn = $("#btn-copy-music-prompt");
  const area = $("#music-prompt-textarea");

  if (genBtn && copyBtn && area) {
    genBtn.addEventListener("click", async () => {
      genBtn.disabled = true;
      genBtn.textContent = "Armando...";
      try {
        const topic = $("#gen-topic")?.value.trim() || "";
        const durationSeconds = Number($("#gen-duration")?.value) || 45;
        const tone = $("#gen-tone")?.value || "curioso y dinámico";

        const res = await fetch("/api/music/prompt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ topic, durationSeconds, tone }),
        });
        const json = await res.json();
        if (!res.ok) {
          showToast(json.error || "Error al armar el prompt musical", true);
          return;
        }

        area.value = json.prompt;
        area.classList.remove("hidden");
        copyBtn.classList.remove("hidden");
        showToast("Prompt musical listo para Google Flow");
      } finally {
        genBtn.disabled = false;
        genBtn.textContent = "Generar prompt";
      }
    });
  }

  if (copyBtn && area) {
    copyBtn.addEventListener("click", async () => {
      if (!area.value.trim()) return;
      await navigator.clipboard.writeText(area.value);
      showToast("Prompt musical copiado al portapapeles");
    });
  }

  const aceBtn = $("#btn-generate-acestep");
  if (aceBtn) {
    aceBtn.addEventListener("click", async () => {
      aceBtn.disabled = true;
      aceBtn.textContent = "Generando...";
      try {
        const topic = $("#gen-topic")?.value.trim() || "";
        const durationSeconds = Number($("#gen-duration")?.value) || undefined;
        const tone = $("#gen-tone")?.value || "";
        const customPrompt = area.value.trim();

        const res = await fetch("/api/music/generate-acestep", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            topic,
            durationSeconds,
            tone,
            ...(customPrompt ? { prompt: customPrompt } : {}),
          }),
        });
        const json = await res.json();
        if (!res.ok) {
          showToast(json.error || "Error al generar música con ACE-Step 1.5", true);
          return;
        }

        if (json.prompt) {
          area.value = json.prompt;
          area.classList.remove("hidden");
          copyBtn.classList.remove("hidden");
        }
        resetAssetPreviewCache("bgMusic");
        const sourceLabel =
          json.durationSource === "voiceover" ? "match ElevenLabs" : "duración proyecto";
        showToast(
          `Música generada con ACE-Step (${json.durationSeconds}s · ${sourceLabel} · ${formatBytes(json.size)})`,
        );
        await fetchStatus();
      } finally {
        aceBtn.disabled = false;
        aceBtn.textContent = "Generar con ACE-Step";
      }
    });
  }

  const aceToggleBtn = $("#btn-acestep-toggle");
  if (aceToggleBtn) {
    aceToggleBtn.addEventListener("click", async () => {
      const isManaged = Boolean(latestStatus?.env?.aceStep?.managed);
      aceToggleBtn.disabled = true;
      aceToggleBtn.textContent = isManaged ? "Deteniendo..." : "Iniciando...";
      try {
        const endpoint = isManaged ? "/api/acestep/stop" : "/api/acestep/start";
        const res = await fetch(endpoint, { method: "POST" });
        const json = await res.json();
        if (!res.ok) {
          showToast(json.error || "No se pudo cambiar el estado de ACE-Step", true);
        } else if (isManaged) {
          showToast("ACE-Step detenido");
        } else if (json.alreadyRunning) {
          showToast("ACE-Step ya estaba activo");
        } else {
          showToast("Iniciando ACE-Step 1.5 (revisa el registro en Paso 2)");
        }
      } catch (err) {
        showToast(err instanceof Error ? err.message : "Error de red con ACE-Step", true);
      } finally {
        await fetchStatus();
        if (isManaged && latestStatus?.env?.aceStep?.available) {
          setTimeout(() => {
            void fetchStatus();
          }, 800);
        }
      }
    });
  }
}

async function uploadSingleSceneFile(sceneId, file) {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`/api/scenes/${sceneId}/upload`, {
    method: "POST",
    body: formData,
  });
  const json = await res.json();
  if (!res.ok) {
    showToast(json.error || `Error al subir escena ${sceneId}`, true);
    return;
  }
  showToast(`Escena ${sceneId} guardada (${json.filename})`);
  await fetchStatus();
}

function setupSceneUploaders() {
  const scenesGrid = $("#scenes-grid");
  const batchInput = $("#scenes-batch-input");
  const flowLoginBtn = $("#btn-flow-login");
  const flowBatchBtn = $("#btn-flow-batch");
  const flowConcurrencySelect = $("#flow-concurrency");

  if (flowLoginBtn) {
    flowLoginBtn.addEventListener("click", async () => {
      flowLoginBtn.disabled = true;
      try {
        const res = await fetch("/api/flow/login", { method: "POST" });
        const json = await res.json();
        if (!res.ok) {
          showToast(json.error || "No se pudo abrir Google Flow", true);
          return;
        }
        showToast("Navegador abierto en Google Flow. Inicia sesión y cierra la ventana al terminar.");
      } finally {
        flowLoginBtn.disabled = false;
      }
    });
  }

  if (flowBatchBtn) {
    flowBatchBtn.addEventListener("click", async () => {
      const rawConcurrency = Number(flowConcurrencySelect?.value);
      const concurrency = Number.isFinite(rawConcurrency)
        ? Math.max(1, Math.min(10, Math.round(rawConcurrency)))
        : 5;
      if (flowConcurrencySelect) flowConcurrencySelect.value = String(concurrency);
      flowBatchBtn.disabled = true;
      try {
        const res = await fetch("/api/scenes/generate-flow", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ concurrency }),
        });
        const json = await res.json();
        if (!res.ok) {
          showToast(json.error || "No se pudo iniciar la generación en lote", true);
          return;
        }
        showToast(`Generando en Flow (1 pestaña, máx. ${concurrency} en vuelo)...`);
        await fetchStatus();
      } finally {
        flowBatchBtn.disabled = false;
      }
    });
  }

  if (batchInput) {
    batchInput.addEventListener("change", async () => {
      const files = Array.from(batchInput.files || []);
      if (files.length === 0) return;

      const formData = new FormData();
      for (const f of files) {
        formData.append("files", f);
      }

      const res = await fetch("/api/scenes/upload-batch", {
        method: "POST",
        body: formData,
      });
      const json = await res.json();
      batchInput.value = "";
      if (!res.ok) {
        showToast(json.error || "Error al subir imágenes en lote", true);
        return;
      }
      showToast(`${json.assigned?.length || 0} escena(s) asignadas desde Google Flow`);
      await fetchStatus();
    });
  }

  if (!scenesGrid) return;

  scenesGrid.addEventListener("click", async (event) => {
    const copyBtn = event.target.closest(".btn-copy-flow-prompt");
    if (copyBtn) {
      const prompt = copyBtn.getAttribute("data-flow-prompt") || "";
      if (prompt) {
        await navigator.clipboard.writeText(prompt);
        showToast("Prompt para Google Flow copiado");
      }
      return;
    }

    const toggleEditBtn = event.target.closest(".btn-toggle-scene-edit");
    if (toggleEditBtn) {
      const sceneId = Number(toggleEditBtn.getAttribute("data-scene-id"));
      const panel = $(`#scene-edit-${sceneId}`);
      if (panel) panel.classList.toggle("hidden");
      return;
    }

    const saveEditBtn = event.target.closest(".btn-save-scene-edit");
    if (saveEditBtn) {
      const sceneId = Number(saveEditBtn.getAttribute("data-scene-id"));
      const card = saveEditBtn.closest(".scene-card");
      if (!sceneId || !card) return;
      const image_prompt = card.querySelector(".scene-edit-prompt")?.value?.trim();
      const camera_motion = card.querySelector(".scene-edit-motion")?.value;
      const use_character = Boolean(card.querySelector(".scene-edit-char")?.checked);
      saveEditBtn.disabled = true;
      try {
        const res = await fetch(`/api/scenes/${sceneId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ image_prompt, camera_motion, use_character }),
        });
        const json = await res.json();
        if (!res.ok) {
          showToast(json.error || "No se pudo guardar la escena", true);
          return;
        }
        showToast(`Escena ${sceneId} actualizada`);
        await fetchStatus();
      } finally {
        saveEditBtn.disabled = false;
      }
      return;
    }

    const regenBtn = event.target.closest(".btn-regen-flow-scene");
    if (regenBtn) {
      const sceneId = Number(regenBtn.getAttribute("data-scene-id"));
      if (!sceneId) return;
      regenBtn.disabled = true;
      try {
        const res = await fetch(`/api/scenes/${sceneId}/generate-flow`, { method: "POST" });
        const json = await res.json();
        if (!res.ok) {
          showToast(json.error || "No se pudo regenerar la escena en Flow", true);
          return;
        }
        showToast(`Regenerando escena ${sceneId} en Google Flow...`);
        await fetchStatus();
      } finally {
        regenBtn.disabled = false;
      }
      return;
    }

    const deleteBtn = event.target.closest(".btn-delete-scene");
    if (deleteBtn) {
      const sceneId = Number(deleteBtn.getAttribute("data-scene-id"));
      if (!sceneId) return;
      const res = await fetch(`/api/scenes/${sceneId}`, { method: "DELETE" });
      if (!res.ok) {
        showToast("No se pudo quitar la escena", true);
        return;
      }
      showToast(`Escena ${sceneId} eliminada`);
      await fetchStatus();
    }
  });

  const tsContent = $("#timestamps-content");
  if (tsContent) {
    tsContent.addEventListener("click", async (event) => {
      const saveBtn = event.target.closest("#btn-save-timestamps");
      if (!saveBtn) return;
      const rows = Array.from(tsContent.querySelectorAll(".ts-word-row"));
      const words = rows
        .map((row) => ({
          word: row.querySelector(".ts-word-input")?.value?.trim() || "",
          start: Number(row.querySelector(".ts-start-input")?.value),
          end: Number(row.querySelector(".ts-end-input")?.value),
        }))
        .filter((w) => w.word.length > 0);
      if (words.length === 0) {
        showToast("No hay palabras válidas para guardar", true);
        return;
      }
      saveBtn.disabled = true;
      try {
        const res = await fetch("/api/timestamps", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ words }),
        });
        const json = await res.json();
        if (!res.ok) {
          showToast(json.error || "Error al guardar timestamps", true);
          return;
        }
        showToast("Timestamps guardados");
        document.activeElement?.blur?.();
        await fetchStatus();
      } finally {
        saveBtn.disabled = false;
      }
    });
  }

  scenesGrid.addEventListener("change", async (event) => {
    const input = event.target.closest(".scene-file-input");
    if (!input) return;
    const sceneId = Number(input.getAttribute("data-scene-id"));
    const file = input.files?.[0];
    input.value = "";
    if (!sceneId || !file) return;
    await uploadSingleSceneFile(sceneId, file);
  });

  scenesGrid.addEventListener("dragover", (event) => {
    const dropzone = event.target.closest(".scene-dropzone");
    if (!dropzone) return;
    event.preventDefault();
    dropzone.classList.add("is-dragover");
  });

  scenesGrid.addEventListener("dragleave", (event) => {
    const dropzone = event.target.closest(".scene-dropzone");
    if (!dropzone) return;
    dropzone.classList.remove("is-dragover");
  });

  scenesGrid.addEventListener("drop", async (event) => {
    const dropzone = event.target.closest(".scene-dropzone");
    if (!dropzone) return;
    event.preventDefault();
    dropzone.classList.remove("is-dragover");
    const sceneId = Number(dropzone.getAttribute("data-scene-drop"));
    const file = event.dataTransfer?.files?.[0];
    if (!sceneId || !file) return;
    await uploadSingleSceneFile(sceneId, file);
  });
}

function escHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function switchMainNav(target) {
  $$("[data-main-nav]").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.mainNav === target);
  });
  $("#view-studio")?.classList.toggle("hidden", target !== "studio");
  $("#view-global-config")?.classList.toggle("hidden", target !== "global-config");
}

function switchStudioSubtab(target) {
  $$("[data-studio-subtab]").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.studioSubtab === target);
  });
  $("#subview-panel")?.classList.toggle("hidden", target !== "panel");
  $("#subview-project-config")?.classList.toggle("hidden", target !== "project-config");
}

function setupNavigation() {
  $$("[data-main-nav]").forEach((btn) => {
    btn.addEventListener("click", () => {
      switchMainNav(btn.dataset.mainNav);
    });
  });

  $$("[data-studio-subtab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      switchStudioSubtab(btn.dataset.studioSubtab);
    });
  });

  $("#btn-goto-project-config")?.addEventListener("click", () => {
    switchMainNav("studio");
    switchStudioSubtab("project-config");
  });

  $("#btn-toggle-4in1-cards")?.addEventListener("click", () => {
    forceShow4in1Cards = !forceShow4in1Cards;
    if (latestStatus) {
      renderInputsSummaryAndVisibility(latestStatus);
    }
  });
}

function renderInputsSummaryAndVisibility(data) {
  const hasClean = Boolean(data.files?.script?.exists && data.files.script.content?.trim());
  const hasEleven = Boolean(
    data.files?.scriptElevenLabs?.exists && data.files.scriptElevenLabs.content?.trim(),
  );
  const hasRemotion = Boolean(
    data.files?.remotionStyle?.exists && data.files.remotionStyle.content?.trim(),
  );
  const sceneCount = data.outputs?.storyboard?.scenes?.length || 0;
  const hasStoryboard = sceneCount > 0;
  const bundleComplete = hasClean && hasEleven && hasRemotion && hasStoryboard;

  const hasAudio = Boolean(data.files?.voiceover?.exists);
  const hasCharacter = Boolean(data.files?.characterRef?.exists);
  const hasBgMusic = Boolean(data.files?.bgMusic?.exists);
  const hasWatermark = Boolean(data.files?.watermark?.exists);
  const generatedScenes = (data.outputs?.scenes || []).length;

  const summaryCard = $("#inputs-summary-card");
  const cardGenerator = $("#card-generator");
  const cardScript = $("#card-script");
  const cardCharacter = $("#card-character");
  const cardVoiceover = $("#card-voiceover");
  const optionalDrawer = $("#optional-assets-drawer");
  const toggleBtn = $("#btn-toggle-4in1-cards");

  const showSummary = bundleComplete || hasClean || hasStoryboard;
  const shouldHide4in1 = bundleComplete && !forceShow4in1Cards;
  if (cardGenerator) cardGenerator.classList.toggle("hidden", shouldHide4in1);
  if (cardScript) cardScript.classList.toggle("hidden", shouldHide4in1);
  if (cardCharacter) {
    cardCharacter.classList.toggle("hidden", shouldHide4in1 && hasCharacter);
  }
  if (cardVoiceover) {
    cardVoiceover.classList.toggle("hidden", !showSummary);
  }
  if (optionalDrawer) {
    optionalDrawer.classList.toggle("hidden", !showSummary);
  }
  if (toggleBtn) {
    toggleBtn.textContent = forceShow4in1Cards
      ? "Ocultar importador 4 en 1"
      : "Mostrar importador 4 en 1";
  }

  if (summaryCard) {
    summaryCard.classList.toggle("hidden", !showSummary);
  }

  const appliedChips = [];
  const pendingChips = [];

  if (hasClean) appliedChips.push("Guion limpio");
  else pendingChips.push("Guion limpio");

  if (hasEleven) appliedChips.push("ElevenLabs");
  else pendingChips.push("ElevenLabs");

  if (hasRemotion) appliedChips.push("Remotion JSON");
  else pendingChips.push("Remotion JSON (preset)");

  if (hasStoryboard) {
    const sceneLabel =
      generatedScenes > 0
        ? `Storyboard (${generatedScenes}/${sceneCount} imgs)`
        : `Storyboard (${sceneCount} escenas)`;
    appliedChips.push(sceneLabel);
  } else {
    pendingChips.push("Storyboard JSON");
  }

  if (hasAudio) appliedChips.push("Audio de Locución");
  else pendingChips.push("Audio de Locución (opcional)");

  if (hasCharacter) appliedChips.push("Personaje de Referencia");
  else pendingChips.push("Personaje de Referencia");

  if (hasBgMusic) appliedChips.push("Música de Fondo");
  else pendingChips.push("Música de Fondo (opcional)");

  if (hasWatermark) appliedChips.push("Marca de Agua");
  else pendingChips.push("Marca de Agua (opcional)");

  const appliedEl = $("#summary-applied-chips");
  const pendingEl = $("#summary-pending-chips");
  const subtitleEl = $("#inputs-summary-subtitle");

  if (subtitleEl) {
    subtitleEl.textContent = bundleComplete
      ? "Bloque 4 en 1 aplicado y guardado. Las tarjetas completadas se ocultaron para mantener limpio el panel."
      : "Avance parcial guardado en este proyecto.";
  }

  if (appliedEl) {
    appliedEl.innerHTML =
      appliedChips.length > 0
        ? appliedChips.map((c) => `<span class="summary-chip is-applied">✓ ${escHtml(c)}</span>`).join("")
        : '<span class="meta-text">Nada aplicado aún</span>';
  }

  if (pendingEl) {
    pendingEl.innerHTML =
      pendingChips.length > 0
        ? pendingChips.map((c) => `<span class="summary-chip is-pending">${escHtml(c)}</span>`).join("")
        : '<span class="summary-chip is-applied">✓ Todo listo</span>';
  }
}

const MODULE_FIELD_SPECS = {
  prompt_maestro: [
    { key: "roleIntro", label: "Rol y Datos del Video", rows: 5 },
    { key: "retentionStructure", label: "Estructura de Retención", rows: 6 },
    { key: "outputRules", label: "Reglas de Formato de Salida", rows: 4 },
  ],
  guion_limpio: [
    { key: "rules", label: "Reglas de Guion Limpio", rows: 4 },
    { key: "placeholderHint", label: "Indicador dentro del bloque", rows: 2 },
  ],
  elevenlabs: [
    { key: "tagGuide", label: "Guía de Etiquetas ElevenLabs v3/v4", rows: 6 },
    { key: "placeholderHint", label: "Indicador dentro del bloque", rows: 2 },
  ],
  remotion: [
    { key: "schemaExample", label: "Esquema JSON de Ejemplo", rows: 9 },
    { key: "notes", label: "Notas / Reglas para Remotion", rows: 4 },
  ],
  storyboard: [
    { key: "schemaExample", label: "Esquema JSON de Storyboard", rows: 10 },
    { key: "notes", label: "Notas / Reglas para Storyboard", rows: 5 },
  ],
  flow_visual: [
    { key: "styleAnchor", label: "Ancla de Estilo Visual (STYLE_ANCHOR)", rows: 3 },
    { key: "characterPrefix", label: "Prefijo de Consistencia de Personaje", rows: 2 },
  ],
  musica: [
    { key: "template", label: "Plantilla de Prompt Musical", rows: 4 },
    { key: "moodsJson", label: "Moods por Tono (JSON)", rows: 6 },
  ],
};

function getProjectSectionStatus(moduleKey, data) {
  const files = data.files || {};
  const outputs = data.outputs || {};
  switch (moduleKey) {
    case "guion_limpio": {
      const ok = Boolean(files.script?.exists && files.script.content?.trim());
      return { applied: ok, label: ok ? `Aplicado (${formatBytes(files.script.size)})` : "Pendiente" };
    }
    case "elevenlabs": {
      const ok = Boolean(files.scriptElevenLabs?.exists && files.scriptElevenLabs.content?.trim());
      return {
        applied: ok,
        label: ok ? `Aplicado (${formatBytes(files.scriptElevenLabs.size)})` : "Pendiente",
      };
    }
    case "remotion": {
      const ok = Boolean(files.remotionStyle?.exists && files.remotionStyle.content?.trim());
      return { applied: ok, label: ok ? "Aplicado" : "Preset por defecto" };
    }
    case "storyboard": {
      const count = outputs.storyboard?.scenes?.length || 0;
      return { applied: count > 0, label: count > 0 ? `Aplicado (${count} escenas)` : "Pendiente" };
    }
    case "flow_visual": {
      const count = (outputs.scenes || []).length;
      return { applied: count > 0, label: count > 0 ? `${count} escenas generadas` : "Sin escenas" };
    }
    case "musica": {
      const ok = Boolean(files.bgMusic?.exists && files.bgMusic.scope === "project");
      return {
        applied: ok,
        label: ok ? `Aplicado (${formatBytes(files.bgMusic.size)})` : "Opcional / Sin pista",
      };
    }
    default:
      return { applied: false, label: "Plantilla base" };
  }
}

function buildModuleEditorHtml(moduleMeta, formatObj, scope) {
  const specs = MODULE_FIELD_SPECS[moduleMeta.key] || [];
  const varsHtml =
    moduleMeta.variables && moduleMeta.variables.length > 0
      ? `<div class="config-vars-bar"><span>Variables:</span>${moduleMeta.variables
          .map((v) => `<code class="config-var-pill">${escHtml(v)}</code>`)
          .join("")}</div>`
      : "";

  const fieldsHtml = specs
    .map((spec) => {
      const rawVal =
        spec.key === "moodsJson"
          ? JSON.stringify(formatObj?.moods || {}, null, 2)
          : formatObj?.[spec.key] ?? "";
      return `
        <div class="config-field">
          <label>${escHtml(spec.label)}</label>
          <textarea
            class="mono-textarea config-field-input"
            data-field-key="${escHtml(spec.key)}"
            rows="${spec.rows}"
          >${escHtml(rawVal)}</textarea>
        </div>
      `;
    })
    .join("");

  const resetLabel = scope === "project" ? "Usar Global" : "Restaurar módulo";
  const saveLabel = scope === "project" ? "Guardar en Proyecto" : "Guardar Global";

  return `
    <div class="config-editor-drawer">
      ${varsHtml}
      ${fieldsHtml}
      <div class="editor-actions">
        <button type="button" class="btn btn-primary btn-sm" data-config-save="${escHtml(moduleMeta.key)}" data-config-scope="${scope}">
          ${saveLabel}
        </button>
        <button type="button" class="btn btn-ghost btn-sm" data-config-reset="${escHtml(moduleMeta.key)}" data-config-scope="${scope}">
          ${resetLabel}
        </button>
      </div>
    </div>
  `;
}

function isEditingInside(container) {
  if (!container) return false;
  const active = document.activeElement;
  if (!active || !container.contains(active)) return false;
  return active.tagName === "TEXTAREA" || active.tagName === "INPUT";
}

function renderModularConfigs(data, force = false) {
  const modules = data.formatModules || [];
  const formatsState = data.formats;
  if (!formatsState || modules.length === 0) return;

  const projectList = $("#project-config-list");
  if (projectList && (force || !isEditingInside(projectList))) {
    projectList.innerHTML = modules
      .map((m) => {
        const isOpen = openProjectFormatModules.has(m.key);
        const isCustom = Boolean(formatsState.customized?.[m.key]);
        const sectionStatus = getProjectSectionStatus(m.key, data);
        const effectiveObj = formatsState.effective?.[m.key] || {};

        return `
          <article class="card config-module-card" data-module-card="${escHtml(m.key)}">
            <div class="config-module-head">
              <div>
                <div class="config-module-title-row">
                  <h3>${escHtml(m.label)}</h3>
                  ${
                    m.hasProjectData
                      ? `<span class="summary-chip ${sectionStatus.applied ? "is-applied" : ""}">${escHtml(sectionStatus.label)}</span>`
                      : ""
                  }
                  <span class="badge ${isCustom ? "badge-required" : "badge-recommended"}">
                    ${isCustom ? "Personalizado" : "Heredado de Global"}
                  </span>
                </div>
                <p class="card-help">${escHtml(m.description)}</p>
              </div>
              <div class="config-module-actions">
                ${
                  m.hasProjectData && sectionStatus.applied
                    ? `<button type="button" class="btn btn-ghost btn-xs danger-text" data-clean-section="${escHtml(m.key)}">Limpiar</button>`
                    : ""
                }
                <button type="button" class="btn btn-secondary btn-xs" data-toggle-format="${escHtml(m.key)}" data-config-scope="project">
                  ${isOpen ? "Ocultar Formato" : "Formato"}
                </button>
              </div>
            </div>
            ${isOpen ? buildModuleEditorHtml(m, effectiveObj, "project") : ""}
          </article>
        `;
      })
      .join("");
  }

  const globalList = $("#global-config-list");
  if (globalList && (force || !isEditingInside(globalList))) {
    globalList.innerHTML = modules
      .map((m) => {
        const isOpen = openGlobalFormatModules.has(m.key);
        const globalObj = formatsState.global?.[m.key] || {};

        return `
          <article class="card config-module-card" data-module-card="${escHtml(m.key)}">
            <div class="config-module-head">
              <div>
                <div class="config-module-title-row">
                  <h3>${escHtml(m.label)}</h3>
                </div>
                <p class="card-help">${escHtml(m.description)}</p>
              </div>
              <div class="config-module-actions">
                <button type="button" class="btn btn-secondary btn-xs" data-toggle-format="${escHtml(m.key)}" data-config-scope="global">
                  ${isOpen ? "Ocultar Formato" : "Editar Formato"}
                </button>
              </div>
            </div>
            ${isOpen ? buildModuleEditorHtml(m, globalObj, "global") : ""}
          </article>
        `;
      })
      .join("");
  }
}

function collectModulePayload(cardEl, moduleKey) {
  const payload = {};
  cardEl.querySelectorAll(".config-field-input").forEach((el) => {
    const key = el.getAttribute("data-field-key");
    if (!key) return;
    if (moduleKey === "musica" && key === "moodsJson") {
      payload.moods = JSON.parse(el.value);
    } else {
      payload[key] = el.value;
    }
  });
  return payload;
}

function setupModularConfigHandlers() {
  document.addEventListener("click", async (event) => {
    const toggleBtn = event.target.closest("[data-toggle-format]");
    if (toggleBtn) {
      const moduleKey = toggleBtn.getAttribute("data-toggle-format");
      const scope = toggleBtn.getAttribute("data-config-scope");
      const set = scope === "project" ? openProjectFormatModules : openGlobalFormatModules;
      if (set.has(moduleKey)) set.delete(moduleKey);
      else set.add(moduleKey);
      if (latestStatus) renderModularConfigs(latestStatus, true);
      return;
    }

    const saveBtn = event.target.closest("[data-config-save]");
    if (saveBtn) {
      const moduleKey = saveBtn.getAttribute("data-config-save");
      const scope = saveBtn.getAttribute("data-config-scope");
      const cardEl = saveBtn.closest("[data-module-card]");
      if (!moduleKey || !cardEl) return;

      let payload;
      try {
        payload = collectModulePayload(cardEl, moduleKey);
      } catch {
        showToast("El campo JSON de Moods no tiene un JSON válido.", true);
        return;
      }

      saveBtn.disabled = true;
      try {
        const url =
          scope === "project"
            ? `/api/config/project/${moduleKey}`
            : `/api/config/global/${moduleKey}`;
        const res = await fetch(url, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const json = await res.json();
        if (!res.ok) {
          showToast(json.error || "No se pudo guardar el formato", true);
          return;
        }
        showToast(
          scope === "project"
            ? "Formato guardado en este proyecto"
            : "Formato global actualizado (el Prompt Maestro usará este cambio)",
        );
        await fetchStatus();
        if (latestStatus) renderModularConfigs(latestStatus, true);
      } finally {
        saveBtn.disabled = false;
      }
      return;
    }

    const resetBtn = event.target.closest("[data-config-reset]");
    if (resetBtn) {
      const moduleKey = resetBtn.getAttribute("data-config-reset");
      const scope = resetBtn.getAttribute("data-config-scope");
      const url =
        scope === "project" ? "/api/config/project/reset" : "/api/config/global/reset";
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ moduleKey }),
      });
      if (!res.ok) {
        showToast("No se pudo restaurar el módulo", true);
        return;
      }
      showToast(
        scope === "project" ? "Sección restaurada a Config. Global" : "Módulo global restaurado",
      );
      await fetchStatus();
      if (latestStatus) renderModularConfigs(latestStatus, true);
      return;
    }

    const cleanBtn = event.target.closest("[data-clean-section]");
    if (cleanBtn) {
      const sectionKey = cleanBtn.getAttribute("data-clean-section");
      if (!sectionKey) return;
      cleanBtn.disabled = true;
      try {
        const res = await fetch(`/api/project/section/${sectionKey}`, { method: "DELETE" });
        const json = await res.json();
        if (!res.ok) {
          showToast(json.error || "No se pudo limpiar la sección", true);
          return;
        }
        bundleDirty = false;
        showToast("Sección limpiada del proyecto");
        await fetchStatus();
        if (latestStatus) renderModularConfigs(latestStatus, true);
      } finally {
        cleanBtn.disabled = false;
      }
    }
  });

  $("#btn-reset-all-project-formats")?.addEventListener("click", async () => {
    const res = await fetch("/api/config/project/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (res.ok) {
      showToast("Todos los formatos del proyecto ahora heredan de Config. Global");
      await fetchStatus();
    }
  });

  $("#btn-reset-all-global-formats")?.addEventListener("click", async () => {
    const res = await fetch("/api/config/global/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (res.ok) {
      showToast("Todos los formatos globales restaurados por defecto");
      await fetchStatus();
    }
  });
}

setupNavigation();
setupModularConfigHandlers();
setupProjectSwitcher();
setupDropzones();
setupBundleEditor();
setupScriptGenerator();
setupMusicPrompt();
setupSceneUploaders();
setupRunner();
setupTabs();
void fetchStatus();
