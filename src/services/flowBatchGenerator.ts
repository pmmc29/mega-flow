import crypto from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
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

async function clearAttachedIngredients(page: Page): Promise<void> {
  // En la caja de prompt de Flow, los ingredientes adjuntos muestran un chip/miniatura con botón de cierre
  for (let pass = 0; pass < 4; pass++) {
    const removed = await page.evaluate(() => {
      const textbox = document.querySelector('[role="textbox"][contenteditable="true"], textarea');
      let promptBox: Element | null = textbox;
      while (promptBox && promptBox.parentElement && promptBox.parentElement !== document.body) {
        if (
          promptBox.querySelector(
            'button[aria-label*="Iniciar generación" i], button[aria-label*="Start generation" i], button[aria-label*="Activador de ajustes" i], button[aria-label*="Añadir ingredientes" i]',
          )
        ) {
          break;
        }
        promptBox = promptBox.parentElement;
      }
      const root = promptBox || document.body;

      const closeButtons = Array.from(
        root.querySelectorAll(
          'button[aria-label*="Quitar" i], button[aria-label*="Eliminar" i], button[aria-label*="Remove" i], button[aria-label*="Delete" i], button[aria-label*="Clear" i], button[aria-label*="Cerrar" i]',
        ),
      ).filter((btn) => {
        const rect = btn.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      if (closeButtons.length > 0) {
        (closeButtons[0] as HTMLElement).click();
        return true;
      }

      const chipImgs = Array.from(root.querySelectorAll("img")).filter((img) => {
        const rect = img.getBoundingClientRect();
        return rect.width > 16 && rect.width < 180 && rect.height > 16;
      });
      for (const img of chipImgs) {
        const chip = img.closest("div, span, li");
        const buttons = Array.from(chip?.querySelectorAll("button") ?? []);
        const closeBtn = buttons.find((b) => {
          const label = `${b.getAttribute("aria-label") || ""} ${b.textContent || ""}`.toLowerCase();
          return /close|cancel|clear|remove|delete|quitar|eliminar|cerrar|×|✕/.test(label);
        });
        if (closeBtn) {
          closeBtn.click();
          return true;
        }
      }
      return false;
    });
    if (!removed) break;
    await page.waitForTimeout(250);
  }
}

async function hasAttachedIngredientInPrompt(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const textbox = document.querySelector('[role="textbox"][contenteditable="true"], textarea');
    if (!textbox) return false;
    let promptBox: Element | null = textbox;
    while (promptBox && promptBox.parentElement && promptBox.parentElement !== document.body) {
      if (
        promptBox.querySelector(
          'button[aria-label*="Iniciar generación" i], button[aria-label*="Start generation" i], button[aria-label*="Activador de ajustes" i], button[aria-label*="Añadir ingredientes" i]',
        )
      ) {
        break;
      }
      promptBox = promptBox.parentElement;
    }
    if (!promptBox) return false;
    return Array.from(promptBox.querySelectorAll("img")).some((img) => {
      const rect = img.getBoundingClientRect();
      return rect.width > 16 && rect.width < 180 && rect.height > 16;
    });
  });
}

async function closeIngredientModalIfOpen(page: Page): Promise<void> {
  const modalMarker = page
    .locator(
      'button:has-text("Añadir a petición"), button:has-text("Add to prompt"), button:has-text("Subir archivo"), .cdk-overlay-backdrop-showing',
    )
    .first();

  if ((await modalMarker.count()) === 0 || !(await modalMarker.isVisible().catch(() => false))) {
    return;
  }

  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(250);

  const backdrop = page.locator(".cdk-overlay-backdrop-showing").first();
  if ((await backdrop.count()) > 0 && (await backdrop.isVisible().catch(() => false))) {
    await backdrop.click({ position: { x: 20, y: 20 }, force: true }).catch(() => {});
    await page.waitForTimeout(250);
  }
}

async function clickAddToPromptIfVisible(page: Page): Promise<boolean> {
  const addToPromptSelectors = [
    'button:has-text("Añadir a petición")',
    'button:has-text("Add to prompt")',
    'button:has-text("Agregar a petición")',
    'button[aria-label*="Añadir a petición" i]',
    'button[aria-label*="Add to prompt" i]',
  ];

  for (const sel of addToPromptSelectors) {
    const btn = page.locator(sel).first();
    if ((await btn.count()) > 0 && (await btn.isVisible().catch(() => false))) {
      await btn.click({ force: true }).catch(() => {});
      await page.waitForTimeout(450);
      return true;
    }
  }
  return false;
}

async function uploadViaOpenIngredientModal(
  page: Page,
  characterRefPath: string,
): Promise<boolean> {
  const uploadButtons = [
    'button:has-text("Subir archivo")',
    'button[aria-label*="Subir archivo" i]',
    'button:has-text("Upload file")',
    'button:has-text("Subir")',
    'button:has-text("Upload")',
    '[role="menuitem"]:has-text("Subir")',
    '[role="menuitem"]:has-text("Upload")',
  ];

  for (const sel of uploadButtons) {
    const uploadBtn = page.locator(sel).first();
    if ((await uploadBtn.count()) === 0 || !(await uploadBtn.isVisible().catch(() => false))) {
      continue;
    }
    const chooserPromise = page.waitForEvent("filechooser", { timeout: 2500 }).catch(() => null);
    await uploadBtn.click({ force: true }).catch(() => {});
    const chooser = await chooserPromise;
    if (chooser) {
      await chooser.setFiles(characterRefPath);
      await page.waitForTimeout(1500);
      return true;
    }
  }

  const afterInput = page.locator('input[type="file"]').first();
  if ((await afterInput.count()) > 0) {
    await afterInput.setInputFiles(characterRefPath);
    await page.waitForTimeout(1500);
    return true;
  }

  return false;
}

async function uploadCharacterReferenceOnce(
  page: Page,
  characterRefPath: string,
): Promise<boolean> {
  if (!fs.existsSync(characterRefPath)) return false;

  await closeIngredientModalIfOpen(page);

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

    const fileChooserPromise = page.waitForEvent("filechooser", { timeout: 1200 }).catch(() => null);
    await btn.click({ force: true }).catch(() => {});
    const chooser = await fileChooserPromise;
    if (chooser) {
      await chooser.setFiles(characterRefPath);
      await page.waitForTimeout(1500);
      await closeIngredientModalIfOpen(page);
      return true;
    }

    await page.waitForTimeout(500);
    const uploaded = await uploadViaOpenIngredientModal(page, characterRefPath);
    if (uploaded) {
      await closeIngredientModalIfOpen(page);
      return true;
    }
    await closeIngredientModalIfOpen(page);
  }

  const directInput = page.locator('input[type="file"]').first();
  if ((await directInput.count()) > 0) {
    await directInput.setInputFiles(characterRefPath);
    await page.waitForTimeout(1500);
    await closeIngredientModalIfOpen(page);
    return true;
  }

  return false;
}

async function attachExistingProjectIngredient(
  page: Page,
  characterRefPath: string,
): Promise<boolean> {
  if (await hasAttachedIngredientInPrompt(page)) {
    return true;
  }

  await closeIngredientModalIfOpen(page);

  const addButtons = [
    'button[aria-label*="Añadir ingredientes" i]',
    'button[aria-label*="Add ingredients" i]',
    'button[aria-label*="ingredient" i]',
  ];

  for (const sel of addButtons) {
    const btn = page.locator(sel).first();
    if ((await btn.count()) === 0 || !(await btn.isVisible().catch(() => false))) continue;

    await btn.click({ force: true }).catch(() => {});
    await page.waitForTimeout(500);

    // Seleccionar character_ref.png en la lista del modal (si no está ya seleccionado)
    const refEntry = page
      .locator('.cdk-overlay-container :text("character_ref"), [role="dialog"] :text("character_ref")')
      .first();
    if ((await refEntry.count()) > 0 && (await refEntry.isVisible().catch(() => false))) {
      await refEntry.click({ force: true }).catch(() => {});
      await page.waitForTimeout(250);
    }

    // Hacer clic en el botón "Añadir a petición" / "Add to prompt"
    if (await clickAddToPromptIfVisible(page)) {
      await closeIngredientModalIfOpen(page);
      if (await hasAttachedIngredientInPrompt(page)) {
        return true;
      }
    }

    // Si aún no había archivo en el modal, subirlo aquí mismo y luego pulsar "Añadir a petición"
    if (await uploadViaOpenIngredientModal(page, characterRefPath)) {
      await clickAddToPromptIfVisible(page);
      await closeIngredientModalIfOpen(page);
      if (await hasAttachedIngredientInPrompt(page)) {
        return true;
      }
    }

    await closeIngredientModalIfOpen(page);
  }

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

async function closeSettingsPopover(page: Page, trigger: ReturnType<Page["locator"]>): Promise<void> {
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(200);

  const backdrop = page.locator(".cdk-overlay-backdrop-showing").first();
  if ((await backdrop.count()) > 0 && (await backdrop.isVisible().catch(() => false))) {
    await backdrop.click({ position: { x: 20, y: 20 }, force: true }).catch(() => {});
    await page.waitForTimeout(250);
  }

  const popoverMarker = page.locator('.credit-cost-label, button:has-text("4:3"), button:has-text("x4")').first();
  if ((await popoverMarker.count()) > 0 && (await popoverMarker.isVisible().catch(() => false))) {
    await trigger.click({ force: true }).catch(() => {});
    await page.waitForTimeout(250);
  }

  if ((await popoverMarker.count()) > 0 && (await popoverMarker.isVisible().catch(() => false))) {
    await page.mouse.click(24, 200).catch(() => {});
    await page.waitForTimeout(250);
  }
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
    await closeSettingsPopover(page, trigger);

    if (verticalOk) {
      return true;
    }
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
      await btn.click({ force: true });
      return true;
    }
  }
  return false;
}

interface CandidateImage {
  src: string;
  isVertical: boolean;
  cardText: string;
  taggedSceneId: number | null;
}

const FEED_CARD_SELECTOR =
  "article, [role='listitem'], [class*='card' i], [class*='tile' i], [class*='item' i], [class*='generation' i], [data-testid*='generation' i]";

async function markExistingFeedCards(page: Page): Promise<void> {
  await page.evaluate((sel) => {
    const cards = Array.from(document.querySelectorAll(sel));
    for (const card of cards) {
      if (card.closest('[role="textbox"], [class*="prompt" i], [class*="composer" i], .cdk-overlay-container')) {
        continue;
      }
      const rect = card.getBoundingClientRect();
      if (rect.width < 120 || rect.height < 120) continue;
      if (!card.hasAttribute("data-mega-scene-id")) {
        card.setAttribute("data-mega-seen", "1");
      }
    }
  }, FEED_CARD_SELECTOR);
}

async function tagNewlyCreatedFeedCard(page: Page, sceneId: number): Promise<boolean> {
  const deadline = Date.now() + 1400;
  while (Date.now() < deadline) {
    const tagged = await page.evaluate(
      ({ sel, id }) => {
        const cards = Array.from(document.querySelectorAll(sel));
        for (const card of cards) {
          if (
            card.closest('[role="textbox"], [class*="prompt" i], [class*="composer" i], .cdk-overlay-container')
          ) {
            continue;
          }
          if (card.hasAttribute("data-mega-seen") || card.hasAttribute("data-mega-scene-id")) {
            continue;
          }
          const rect = card.getBoundingClientRect();
          if (rect.width < 120 || rect.height < 120) continue;
          card.setAttribute("data-mega-scene-id", String(id));
          return true;
        }
        return false;
      },
      { sel: FEED_CARD_SELECTOR, id: sceneId },
    );
    if (tagged) return true;
    await page.waitForTimeout(180);
  }
  return false;
}

async function collectLargeImageSrcs(page: Page): Promise<CandidateImage[]> {
  return page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll("img"));
    return imgs
      .filter((img) => {
        if (img.closest('[role="textbox"], [class*="ingredient" i], [class*="prompt" i], .cdk-overlay-container')) {
          return false;
        }
        const w = img.naturalWidth || img.width || 0;
        const h = img.naturalHeight || img.height || 0;
        return w >= 350 && h >= 350 && Boolean(img.src);
      })
      .map((img) => {
        const w = img.naturalWidth || img.width || 0;
        const h = img.naturalHeight || img.height || 0;
        const taggedEl = img.closest("[data-mega-scene-id]");
        const taggedRaw = Number(taggedEl?.getAttribute("data-mega-scene-id") || 0);
        const taggedSceneId = Number.isInteger(taggedRaw) && taggedRaw > 0 ? taggedRaw : null;

        const textParts: string[] = [
          img.getAttribute("alt") || "",
          img.getAttribute("title") || "",
          img.getAttribute("aria-label") || "",
        ];
        let node: Element | null = img.parentElement;
        for (let depth = 0; depth < 4 && node && node !== document.body; depth++) {
          textParts.push(
            node.getAttribute("aria-label") || "",
            node.getAttribute("title") || "",
            node.textContent || "",
          );
          node = node.parentElement;
        }

        const cardText = textParts
          .join(" ")
          .trim()
          .replace(/\s+/g, " ")
          .slice(0, 500);
        return { src: img.src, isVertical: h > w, cardText, taggedSceneId };
      });
  });
}

function sha256(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

async function downloadCandidateBuffer(page: Page, src: string): Promise<Buffer> {
  if (src.startsWith("data:image/")) {
    const base64 = src.split(",")[1] || "";
    return Buffer.from(base64, "base64");
  }

  if (src.startsWith("blob:")) {
    const base64 = await page.evaluate(async (blobUrl) => {
      const res = await fetch(blobUrl);
      const blob = await res.blob();
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("No se pudo leer el blob de imagen"));
        reader.readAsDataURL(blob);
      });
    }, src);
    const dataPart = base64.split(",")[1] || "";
    return Buffer.from(dataPart, "base64");
  }

  const response = await page.context().request.get(src);
  if (!response.ok()) {
    throw new Error(`No se pudo descargar la imagen generada (${response.status()}).`);
  }
  return response.body();
}

function normalizeForMatch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface InFlightScene {
  scene: Scene;
  startedAt: number;
  attempts: number;
  keywords: string[];
  snippet: string;
}

function matchCandidateToInFlight(
  candidate: CandidateImage,
  inFlight: InFlightScene[],
  requireVertical: boolean,
): InFlightScene | null {
  if (inFlight.length === 0) return null;
  if (requireVertical && !candidate.isVertical) {
    const oldestAge = Date.now() - inFlight[0].startedAt;
    if (oldestAge < 25_000) return null;
  }

  // 1. Coincidencia exacta por tarjeta etiquetada en el DOM al pulsar Generar
  if (candidate.taggedSceneId !== null) {
    const taggedMatch = inFlight.find((item) => item.scene.id === candidate.taggedSceneId);
    if (taggedMatch) return taggedMatch;
  }

  // 2. Coincidencia por texto del prompt en el árbol DOM de la tarjeta
  const normCard = normalizeForMatch(candidate.cardText);
  if (normCard.length > 0) {
    let bestItem: InFlightScene | null = null;
    let bestScore = 0;

    for (const item of inFlight) {
      let score = 0;
      if (item.snippet.length >= 14 && normCard.includes(item.snippet)) {
        score += 10;
      }
      for (const kw of item.keywords) {
        if (normCard.includes(kw)) score += 1;
      }
      if (score > bestScore) {
        bestScore = score;
        bestItem = item;
      }
    }

    if (bestItem && bestScore >= 2) {
      return bestItem;
    }
  }

  // 3. Si solo hay 1 en vuelo, es esa; si hay varias sin etiqueta, esperar antes de adivinar
  if (inFlight.length === 1) {
    return inFlight[0];
  }
  const oldestAge = Date.now() - inFlight[0].startedAt;
  if (oldestAge > 45_000) {
    return inFlight[0];
  }
  return null;
}

export interface FlowBatchOptions {
  storyboardPath: string;
  characterRefPath: string;
  scenesDir: string;
  concurrency?: number;
  sceneIds?: number[];
  onProgress?: (progress: { completed: number; total: number; lastSceneId: number }) => void;
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

  const requestedIds = options.sceneIds?.length ? new Set(options.sceneIds) : null;
  const targetScenes = storyboard.scenes.filter((s) => {
    if (requestedIds) {
      return requestedIds.has(s.id);
    }
    const filename = `scene_${String(s.id).padStart(3, "0")}.png`;
    return !fs.existsSync(path.join(options.scenesDir, filename));
  });

  if (targetScenes.length === 0) {
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

  const maxInFlight = Math.max(
    1,
    Math.min(10, Number(options.concurrency || process.env.FLOW_CONCURRENCY || 5)),
  );
  console.log(
    `[Flow] Modo 1 pestaña / 1 proyecto: generando ${targetScenes.length} escena(s) (máx. ${maxInFlight} en vuelo)...`,
  );

  const context = await launchFlowContext();
  const page = context.pages()[0] ?? (await context.newPage());

  let generated = 0;
  let processed = 0;
  const failed: Array<{ sceneId: number; error: string }> = [];
  const totalTargets = targetScenes.length;
  options.onProgress?.({ completed: 0, total: totalTargets, lastSceneId: 0 });

  try {
    await ensureInFlowProject(page);
    const verticalSelected = await selectVerticalAspectRatio(page);
    console.log(
      `[Flow] Proyecto listo (9:16 + x1: ${verticalSelected ? "OK" : "manual/fallback"}).`,
    );

    const hasAnyCharacter = targetScenes.some((s) => s.use_character);
    let characterRefHash: string | null = null;
    if (hasAnyCharacter && fs.existsSync(options.characterRefPath)) {
      characterRefHash = sha256(await fsp.readFile(options.characterRefPath));
      const uploaded = await uploadCharacterReferenceOnce(page, options.characterRefPath);
      if (uploaded) {
        console.log("[Flow] character_ref.png subido una sola vez al proyecto.");
        const uploadDeadline = Date.now() + 10_000;
        while (Date.now() < uploadDeadline) {
          const imgs = await collectLargeImageSrcs(page);
          if (imgs.length > 0) break;
          await page.waitForTimeout(700);
        }
        await clearAttachedIngredients(page);
      }
    }

    const knownSrcs = new Set<string>(
      (await collectLargeImageSrcs(page)).map((c) => c.src),
    );

    const pending: Array<{ scene: Scene; attempts: number }> = targetScenes.map((scene) => ({
      scene,
      attempts: 0,
    }));
    const inFlight: InFlightScene[] = [];

    while (pending.length > 0 || inFlight.length > 0) {
      // 1. Enviar prompts 1 por 1 mientras inFlight < maxInFlight
      while (pending.length > 0 && inFlight.length < maxInFlight) {
        const next = pending.shift()!;
        const scene = next.scene;

        try {
          const fullPrompt = buildFullFlowPrompt(scene);
          const needsCharacter = Boolean(
            scene.use_character && fs.existsSync(options.characterRefPath),
          );
          const promptNeedle = normalizeForMatch(scene.image_prompt).slice(0, 20);

          let readyToSend = false;
          for (let prepAttempt = 1; prepAttempt <= 5; prepAttempt++) {
            await closeIngredientModalIfOpen(page);

            const input = await findPromptInput(page);
            if (!input) {
              await page.waitForTimeout(400);
              continue;
            }

            const currentVal = normalizeForMatch(
              (await input.inputValue().catch(() => "")) ||
                (await input.innerText().catch(() => "")) ||
                "",
            );
            if (!promptNeedle || !currentVal.includes(promptNeedle)) {
              await input.click({ force: true });
              await input.fill(fullPrompt);
              await page.waitForTimeout(250);
            }

            if (needsCharacter) {
              if (!(await hasAttachedIngredientInPrompt(page))) {
                await attachExistingProjectIngredient(page, options.characterRefPath);
                await page.waitForTimeout(300);
              }
            } else if (await hasAttachedIngredientInPrompt(page)) {
              await clearAttachedIngredients(page);
              await page.waitForTimeout(250);
            }

            const hasChip = await hasAttachedIngredientInPrompt(page);
            const verifiedVal = normalizeForMatch(
              (await input.inputValue().catch(() => "")) ||
                (await input.innerText().catch(() => "")) ||
                "",
            );
            const hasPrompt = !promptNeedle || verifiedVal.includes(promptNeedle);

            if (hasChip === needsCharacter && hasPrompt) {
              readyToSend = true;
              break;
            }

            console.log(
              `[Flow] Escena ${scene.id}: reintentando preparar compositor (intento ${prepAttempt}/5, chip=${hasChip}/${needsCharacter}, prompt=${hasPrompt})...`,
            );
            await page.waitForTimeout(450);
          }

          if (!readyToSend) {
            throw new Error(
              needsCharacter
                ? `No se pudo confirmar el chip del personaje adjunto para la escena ${scene.id}.`
                : `No se pudo preparar el prompt limpio para la escena ${scene.id}.`,
            );
          }

          await markExistingFeedCards(page);
          const clicked = await clickGenerateButton(page);
          if (!clicked) {
            throw new Error("No se encontró el botón de generar en Google Flow.");
          }
          await tagNewlyCreatedFeedCard(page, scene.id);

          const normPrompt = normalizeForMatch(scene.image_prompt);
          const keywords = Array.from(
            new Set(normPrompt.split(" ").filter((w) => w.length >= 4)),
          ).slice(0, 8);

          inFlight.push({
            scene,
            startedAt: Date.now(),
            attempts: next.attempts + 1,
            keywords,
            snippet: normPrompt.slice(0, 28),
          });
          console.log(
            `[Flow] Prompt enviado: Escena ${scene.id}/${storyboard.scenes.length} (en vuelo: ${inFlight.length}/${maxInFlight})`,
          );

          await page.waitForTimeout(950);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[Flow] Error enviando escena ${scene.id}: ${msg}`);
          processed += 1;
          failed.push({ sceneId: scene.id, error: msg });
          options.onProgress?.({
            completed: processed,
            total: totalTargets,
            lastSceneId: scene.id,
          });
        }
      }

      if (inFlight.length === 0) break;

      // 2. Revisar imágenes completadas en la galería
      await page.waitForTimeout(1500);
      const candidates = await collectLargeImageSrcs(page);

      for (const candidate of candidates) {
        if (knownSrcs.has(candidate.src)) continue;
        if (inFlight.length === 0) break;

        try {
          const buffer = await downloadCandidateBuffer(page, candidate.src);
          if (characterRefHash && sha256(buffer) === characterRefHash) {
            knownSrcs.add(candidate.src);
            continue;
          }

          const matched = matchCandidateToInFlight(candidate, inFlight, verticalSelected);
          if (!matched) continue;

          knownSrcs.add(candidate.src);
          const filename = `scene_${String(matched.scene.id).padStart(3, "0")}.png`;
          const destPath = path.join(options.scenesDir, filename);
          await fsp.writeFile(destPath, buffer);

          const idx = inFlight.indexOf(matched);
          if (idx !== -1) inFlight.splice(idx, 1);

          generated += 1;
          processed += 1;
          console.log(
            `[Flow] Escena ${matched.scene.id} guardada -> ${filename} (en vuelo: ${inFlight.length}/${maxInFlight})`,
          );
          options.onProgress?.({
            completed: processed,
            total: totalTargets,
            lastSceneId: matched.scene.id,
          });
        } catch {
          knownSrcs.add(candidate.src);
        }
      }

      // 3. Control de timeouts para escenas atascadas (>150s)
      const now = Date.now();
      for (let i = inFlight.length - 1; i >= 0; i--) {
        const item = inFlight[i];
        if (now - item.startedAt > 150_000) {
          inFlight.splice(i, 1);
          if (item.attempts < 2) {
            console.warn(
              `[Flow] Tiempo agotado en escena ${item.scene.id}; reintentando en cola...`,
            );
            pending.push({ scene: item.scene, attempts: item.attempts });
          } else {
            processed += 1;
            const msg = "Tiempo de espera agotado en Google Flow (150s).";
            console.error(`[Flow] Escena ${item.scene.id} fallida: ${msg}`);
            failed.push({ sceneId: item.scene.id, error: msg });
            options.onProgress?.({
              completed: processed,
              total: totalTargets,
              lastSceneId: item.scene.id,
            });
          }
        }
      }
    }
  } finally {
    await context.close().catch(() => {});
  }

  if (failed.length > 0 && generated === 0) {
    throw new Error(failed[0].error);
  }

  return {
    total: storyboard.scenes.length,
    generated,
    skipped: storyboard.scenes.length - targetScenes.length,
    failed,
  };
}
