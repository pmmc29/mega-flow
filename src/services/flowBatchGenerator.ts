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
    "textarea",
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

async function attachCharacterReference(page: Page, characterRefPath: string): Promise<boolean> {
  if (!fs.existsSync(characterRefPath)) return false;

  const fileInput = page.locator('input[type="file"]').first();
  if ((await fileInput.count()) > 0) {
    await fileInput.setInputFiles(characterRefPath);
    await page.waitForTimeout(800);
    return true;
  }

  const addButtons = [
    'button[aria-label*="Add image" i]',
    'button[aria-label*="Upload" i]',
    'button:has-text("Add image")',
    'button:has-text("Ingredients")',
    'button:has-text("Reference")',
  ];
  for (const sel of addButtons) {
    const btn = page.locator(sel).first();
    if ((await btn.count()) > 0 && (await btn.isVisible().catch(() => false))) {
      await btn.click().catch(() => {});
      await page.waitForTimeout(500);
      const afterInput = page.locator('input[type="file"]').first();
      if ((await afterInput.count()) > 0) {
        await afterInput.setInputFiles(characterRefPath);
        await page.waitForTimeout(800);
        return true;
      }
    }
  }

  return false;
}

async function selectVerticalAspectRatio(page: Page): Promise<void> {
  const ratioButtons = [
    'button:has-text("9:16")',
    'button:has-text("Portrait")',
    '[role="option"]:has-text("9:16")',
  ];
  for (const sel of ratioButtons) {
    const btn = page.locator(sel).first();
    if ((await btn.count()) > 0 && (await btn.isVisible().catch(() => false))) {
      await btn.click().catch(() => {});
      return;
    }
  }
}

async function clickGenerateButton(page: Page): Promise<boolean> {
  const generateSelectors = [
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
  const flowUrl = getGoogleFlowUrl();

  try {
    await page.goto(flowUrl, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(2000);

    if (page.url().includes("accounts.google.com")) {
      throw new Error(
        "Google Flow pidió iniciar sesión. Usa primero el botón 'Abrir Flow (Login)' en la pestaña Escenas.",
      );
    }

    const input = await findPromptInput(page);
    if (!input) {
      throw new Error(
        "No se encontró el campo de prompt en Google Flow. Verifica que la URL esté en el generador de imágenes o que hayas iniciado sesión.",
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
