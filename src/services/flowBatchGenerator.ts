import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import pLimit from "p-limit";
import { chromium, type BrowserContext, type Page } from "playwright";
import {
  CHARACTER_CONSISTENCY_PREFIX,
  PATHS,
  STYLE_ANCHOR,
} from "../config/styleConfig.js";
import type { Scene, Storyboard } from "../types/pipeline.js";

const DEFAULT_FLOW_URL = "https://labs.google/fx/tools/flow";
const PROFILE_DIR = path.join(PATHS.root, ".mega-flow-profile");

let loginContext: BrowserContext | null = null;

export function getGoogleFlowUrl(): string {
  return (process.env.GOOGLE_FLOW_URL || DEFAULT_FLOW_URL).trim();
}

function resolveBrowserExecutable(): string | undefined {
  const custom = process.env.FLOW_BROWSER_EXECUTABLE?.trim();
  if (custom && fs.existsSync(custom)) return custom;

  const candidates = [
    "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ];
  return candidates.find((p) => fs.existsSync(p));
}

async function launchFlowContext(): Promise<BrowserContext> {
  await fsp.mkdir(PROFILE_DIR, { recursive: true });
  const executablePath = resolveBrowserExecutable();

  return chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    ...(executablePath ? { executablePath } : {}),
    viewport: { width: 1280, height: 860 },
    args: ["--disable-blink-features=AutomationControlled"],
  });
}

export async function openFlowLoginSession(): Promise<{ url: string; alreadyOpen: boolean }> {
  const url = getGoogleFlowUrl();
  if (loginContext) {
    try {
      const pages = loginContext.pages();
      if (pages.length > 0) {
        await pages[0].bringToFront();
        return { url, alreadyOpen: true };
      }
    } catch {
      loginContext = null;
    }
  }

  const context = await launchFlowContext();
  loginContext = context;
  context.on("close", () => {
    if (loginContext === context) {
      loginContext = null;
    }
  });

  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  return { url, alreadyOpen: false };
}

function buildFullFlowPrompt(scene: Scene): string {
  const parts: string[] = [];
  if (scene.use_character) {
    parts.push(CHARACTER_CONSISTENCY_PREFIX.trim());
  }
  parts.push(scene.image_prompt.trim());
  parts.push(STYLE_ANCHOR);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

async function findPromptInput(page: Page) {
  const selectors = [
    'textarea[placeholder*="Describe" i]',
    'textarea[placeholder*="prompt" i]',
    'textarea[placeholder*="Create" i]',
    'textarea[placeholder*="Write" i]',
    'textarea[placeholder*="Escribe" i]',
    'textarea:not([placeholder*="Search" i]):not([placeholder*="Buscar" i])',
    '[role="textbox"][contenteditable="true"]',
    '[contenteditable="true"]',
  ];

  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    if ((await loc.count()) > 0 && (await loc.isVisible().catch(() => false))) {
      return loc;
    }
  }
  return null;
}

async function ensureInFlowProject(page: Page): Promise<void> {
  const baseUrl = getGoogleFlowUrl();
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForTimeout(2500);

  if (page.url().includes("accounts.google.com")) {
    throw new Error(
      "Google Flow pidió iniciar sesión. Usa primero el botón 'Abrir Flow (Login)' en la pestaña Escenas.",
    );
  }

  if (page.url().includes("/project/")) {
    return;
  }

  const newProjectSelectors = [
    'button:has-text("New project")',
    'button:has-text("Nuevo proyecto")',
    'a:has-text("New project")',
    'a:has-text("Nuevo proyecto")',
    'button:has-text("Create new")',
    'button:has-text("Crear nuevo")',
    '[data-testid*="new-project" i]',
  ];

  for (const sel of newProjectSelectors) {
    const btn = page.locator(sel).first();
    if ((await btn.count()) > 0 && (await btn.isVisible().catch(() => false))) {
      await btn.click();
      try {
        await page.waitForURL(/\/project\//, { timeout: 15000 });
        await page.waitForTimeout(2000);
        return;
      } catch {
        await page.waitForTimeout(2500);
        if (page.url().includes("/project/")) return;
      }
    }
  }

  const directInput = await findPromptInput(page);
  if (directInput) return;

  const visibleButtons = await listVisibleButtonLabels(page);
  throw new Error(
    `No se pudo entrar a un proyecto en Google Flow (URL: ${page.url()}). Botones: ${visibleButtons.join(" | ")}`,
  );
}

async function listVisibleButtonLabels(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll("button, [role='button'], [role='combobox']"))
      .filter((el) => {
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
      .map((el) => {
        const text = (el.textContent || "").trim().replace(/\s+/g, " ");
        const aria = el.getAttribute("aria-label") || "";
        return aria && aria !== text ? `${text} [${aria}]`.trim() : text;
      })
      .filter((t) => t.length > 0 && t.length < 60)
      .slice(0, 20),
  );
}

async function attachCharacterReference(page: Page, characterRefPath: string): Promise<boolean> {
  if (!fs.existsSync(characterRefPath)) return false;

  const addButtons = [
    'button[aria-label*="Añadir ingredientes" i]',
    'button[aria-label*="Add ingredients" i]',
    'button[aria-label*="ingredient" i]',
    'button:has-text("Ingredients")',
    'button:has-text("Ingredientes")',
    'button[aria-label*="Reference" i]',
  ];

  for (const sel of addButtons) {
    const btn = page.locator(sel).first();
    if ((await btn.count()) === 0 || !(await btn.isVisible().catch(() => false))) continue;

    const fileChooserPromise = page.waitForEvent("filechooser", { timeout: 1500 }).catch(() => null);
    await btn.click().catch(() => {});
    const chooser = await fileChooserPromise;
    if (chooser) {
      await chooser.setFiles(characterRefPath);
      await page.waitForTimeout(1000);
      return true;
    }

    await page.waitForTimeout(450);
    const afterInput = page.locator('input[type="file"]').first();
    if ((await afterInput.count()) > 0) {
      await afterInput.setInputFiles(characterRefPath);
      await page.waitForTimeout(1000);
      return true;
    }

    // Si abrió un menú con opción Upload/Subir
    const uploadItem = page
      .locator(
        '[role="menuitem"]:has-text("Subir"), [role="menuitem"]:has-text("Upload"), button:has-text("Subir"), button:has-text("Upload")',
      )
      .first();
    if ((await uploadItem.count()) > 0 && (await uploadItem.isVisible().catch(() => false))) {
      const menuChooserPromise = page.waitForEvent("filechooser", { timeout: 2000 }).catch(() => null);
      await uploadItem.click().catch(() => {});
      const menuChooser = await menuChooserPromise;
      if (menuChooser) {
        await menuChooser.setFiles(characterRefPath);
        await page.waitForTimeout(1000);
        return true;
      }
    }
  }

  const directInput = page.locator('input[type="file"]').first();
  if ((await directInput.count()) > 0) {
    await directInput.setInputFiles(characterRefPath);
    await page.waitForTimeout(1000);
    return true;
  }

  const labels = await listVisibleButtonLabels(page);
  console.log(`[Flow] Botones visibles al intentar adjuntar personaje: ${labels.join(" | ")}`);
  return false;
}

async function clickVerticalOptionIfVisible(page: Page): Promise<boolean> {
  const ratioTargets = [
    'button:has-text("9:16")',
    '[role="option"]:has-text("9:16")',
    '[role="menuitem"]:has-text("9:16")',
    '[role="menuitemradio"]:has-text("9:16")',
    '[role="tab"]:has-text("9:16")',
    'button:has-text("Vertical")',
    '[role="option"]:has-text("Vertical")',
    '[role="tab"]:has-text("Vertical")',
    'button:has-text("Portrait")',
    '[role="option"]:has-text("Portrait")',
    '[role="tab"]:has-text("Portrait")',
    'button:has-text("crop_9_16")',
    'button:has-text("crop_portrait")',
    'button[aria-label*="9:16" i]',
    'button[aria-label*="Vertical" i]',
    'button[aria-label*="Portrait" i]',
  ];

  for (const sel of ratioTargets) {
    const el = page.locator(sel).first();
    if ((await el.count()) > 0 && (await el.isVisible().catch(() => false))) {
      await el.click().catch(() => {});
      await page.waitForTimeout(300);
      return true;
    }
  }
  return false;
}

async function clickSingleOutputIfVisible(page: Page): Promise<boolean> {
  const x1Targets = [
    'button:has-text("x1")',
    '[role="tab"]:has-text("x1")',
    '[role="option"]:has-text("x1")',
    '[role="menuitemradio"]:has-text("x1")',
    'button[aria-label*="x1" i]',
  ];

  for (const sel of x1Targets) {
    const el = page.locator(sel).first();
    if ((await el.count()) > 0 && (await el.isVisible().catch(() => false))) {
      await el.click().catch(() => {});
      await page.waitForTimeout(200);
      return true;
    }
  }
  return false;
}

async function selectVerticalAspectRatio(page: Page): Promise<boolean> {
  if (await clickVerticalOptionIfVisible(page)) return true;

  const menuTriggers = [
    'button[aria-label="Activador de ajustes"]',
    'button[aria-label*="Activador de ajustes" i]',
    'button:has-text("crop_16_9")',
    'button[aria-label*="Settings trigger" i]',
    'button:has-text("16:9")',
    'button:has-text("Landscape")',
    'button[aria-label*="aspect" i]',
    'button[aria-label*="ratio" i]',
  ];

  for (const triggerSel of menuTriggers) {
    const trigger = page.locator(triggerSel).first();
    if ((await trigger.count()) === 0 || !(await trigger.isVisible().catch(() => false))) continue;
    await trigger.click().catch(() => {});
    await page.waitForTimeout(500);

    const verticalOk = await clickVerticalOptionIfVisible(page);
    await clickSingleOutputIfVisible(page);

    if (verticalOk) {
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(200);
      return true;
    }
    const openLabels = await listVisibleButtonLabels(page);
    console.log(`[Flow] Popover abierto (${triggerSel}), botones visibles: ${openLabels.join(" | ")}`);
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(200);
  }

  return false;
}

async function clickGenerateButton(page: Page): Promise<boolean> {
  const generateSelectors = [
    'button[aria-label*="Iniciar generación" i]',
    'button[aria-label*="Start generation" i]',
    'button[aria-label*="Generate" i]',
    'button[aria-label*="Create" i]',
    'button[aria-label*="Send" i]',
    'button:has-text("Generate")',
    'button:has-text("Create")',
    'button[type="submit"]',
  ];

  for (const sel of generateSelectors) {
    const btn = page.locator(sel).last();
    if (
      (await btn.count()) > 0 &&
      (await btn.isVisible().catch(() => false)) &&
      (await btn.isEnabled().catch(() => false))
    ) {
      await btn.click();
      return true;
    }
  }
  return false;
}

async function collectLargeImageSrcs(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll("img"));
    return imgs
      .filter((img) => {
        const w = img.naturalWidth || img.width || 0;
        const h = img.naturalHeight || img.height || 0;
        return w >= 350 && h >= 350 && Boolean(img.src);
      })
      .map((img) => img.src);
  });
}

async function saveSceneFromFlowPage(
  page: Page,
  beforeSrcs: Set<string>,
  destPath: string,
): Promise<void> {
  const deadline = Date.now() + 120_000;
  let newSrc = "";

  while (Date.now() < deadline) {
    const currentSrcs = await collectLargeImageSrcs(page);
    const found = currentSrcs.find((src) => !beforeSrcs.has(src));
    if (found) {
      newSrc = found;
      break;
    }
    await page.waitForTimeout(1500);
  }

  if (!newSrc) {
    throw new Error(
      "Tiempo de espera agotado esperando la imagen generada en Google Flow (120s).",
    );
  }

  await fsp.mkdir(path.dirname(destPath), { recursive: true });

  if (newSrc.startsWith("data:image/")) {
    const base64 = newSrc.split(",")[1] || "";
    await fsp.writeFile(destPath, Buffer.from(base64, "base64"));
    return;
  }

  if (newSrc.startsWith("blob:")) {
    const base64 = await page.evaluate(async (blobUrl) => {
      const res = await fetch(blobUrl);
      const blob = await res.blob();
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("No se pudo leer el blob de imagen"));
        reader.readAsDataURL(blob);
      });
    }, newSrc);
    const dataPart = base64.split(",")[1] || "";
    await fsp.writeFile(destPath, Buffer.from(dataPart, "base64"));
    return;
  }

  const response = await page.context().request.get(newSrc);
  if (!response.ok()) {
    throw new Error(`No se pudo descargar la imagen generada (${response.status()}).`);
  }
  const buffer = await response.body();
  await fsp.writeFile(destPath, buffer);
}

async function generateSingleFlowScene(
  context: BrowserContext,
  scene: Scene,
  characterRefPath: string,
  destPath: string,
): Promise<void> {
  const page = await context.newPage();

  try {
    await ensureInFlowProject(page);

    const input = await findPromptInput(page);
    if (!input) {
      throw new Error(
        "No se encontró el campo de prompt en Google Flow. Verifica que hayas iniciado sesión.",
      );
    }

    if (scene.use_character) {
      const attached = await attachCharacterReference(page, characterRefPath);
      if (!attached) {
        console.log(
          `[Flow] Escena ${scene.id}: no se pudo adjuntar character_ref.png automáticamente; enviando prompt con descripción.`,
        );
      }
    }

    await selectVerticalAspectRatio(page);

    const beforeSrcs = new Set(await collectLargeImageSrcs(page));
    const fullPrompt = buildFullFlowPrompt(scene);

    await input.click();
    await input.fill(fullPrompt);
    await page.waitForTimeout(400);

    const clicked = await clickGenerateButton(page);
    if (!clicked) {
      await input.press("Enter");
    }

    await saveSceneFromFlowPage(page, beforeSrcs, destPath);
  } finally {
    await page.close().catch(() => {});
  }
}

export interface FlowBatchOptions {
  storyboardPath: string;
  characterRefPath: string;
  scenesDir: string;
  concurrency?: number;
}

export interface FlowBatchResult {
  total: number;
  generated: number;
  skipped: number;
  failed: Array<{ sceneId: number; error: string }>;
}

export async function generateFlowBatchScenes(
  options: FlowBatchOptions,
): Promise<FlowBatchResult> {
  if (!fs.existsSync(options.storyboardPath)) {
    throw new Error("No existe storyboard.json. Pega y guarda primero el bloque 4 en 1.");
  }

  const raw = await fsp.readFile(options.storyboardPath, "utf-8");
  const storyboard = JSON.parse(raw) as Storyboard;
  if (!Array.isArray(storyboard.scenes) || storyboard.scenes.length === 0) {
    throw new Error("El storyboard no contiene escenas.");
  }

  await fsp.mkdir(options.scenesDir, { recursive: true });

  const missingScenes = storyboard.scenes.filter((s) => {
    const filename = `scene_${String(s.id).padStart(3, "0")}.png`;
    return !fs.existsSync(path.join(options.scenesDir, filename));
  });

  if (missingScenes.length === 0) {
    console.log("[Flow] Todas las escenas ya están generadas.");
    return {
      total: storyboard.scenes.length,
      generated: 0,
      skipped: storyboard.scenes.length,
      failed: [],
    };
  }

  if (loginContext) {
    await loginContext.close().catch(() => {});
    loginContext = null;
  }

  const concurrency = Math.max(
    1,
    Math.min(8, Number(options.concurrency || process.env.FLOW_CONCURRENCY || 5)),
  );
  console.log(
    `[Flow] Generando ${missingScenes.length} escena(s) en Google Flow (concurrencia: ${concurrency} en paralelo)...`,
  );

  const context = await launchFlowContext();
  const limit = pLimit(concurrency);
  let generated = 0;
  const failed: Array<{ sceneId: number; error: string }> = [];

  try {
    await Promise.all(
      missingScenes.map((scene) =>
        limit(async () => {
          const filename = `scene_${String(scene.id).padStart(3, "0")}.png`;
          const destPath = path.join(options.scenesDir, filename);

          let lastErr: unknown;
          for (let attempt = 1; attempt <= 2; attempt++) {
            try {
              console.log(
                `[Flow] Escena ${scene.id}/${storyboard.scenes.length} (intento ${attempt})...`,
              );
              await generateSingleFlowScene(
                context,
                scene,
                options.characterRefPath,
                destPath,
              );
              generated += 1;
              console.log(`[Flow] Escena ${scene.id} guardada -> ${filename}`);
              return;
            } catch (err) {
              lastErr = err;
              console.error(
                `[Flow] Error en escena ${scene.id} (intento ${attempt}): ${
                  err instanceof Error ? err.message : String(err)
                }`,
              );
            }
          }

          failed.push({
            sceneId: scene.id,
            error: lastErr instanceof Error ? lastErr.message : String(lastErr),
          });
        }),
      ),
    );
  } finally {
    await context.close().catch(() => {});
  }

  if (failed.length > 0 && generated === 0) {
    throw new Error(failed[0].error);
  }

  return {
    total: storyboard.scenes.length,
    generated,
    skipped: storyboard.scenes.length - missingScenes.length,
    failed,
  };
}
