import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { PATHS } from "./styleConfig.js";

export const PROJECTS_DIR = path.join(PATHS.root, "projects");
const ACTIVE_FILE = path.join(PROJECTS_DIR, ".active");

export interface ProjectMeta {
  slug: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectPaths {
  slug: string;
  root: string;
  metaFile: string;
  inputDir: string;
  workspaceDir: string;
  outputDir: string;
  script: string;
  voiceover: string;
  timestamps: string;
  storyboard: string;
  scriptElevenLabs: string;
  scriptStructure: string;
  scenesDir: string;
  finalVideo: string;
}

export function slugifyProjectName(name: string): string {
  const base = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  return base || `video-${Date.now()}`;
}

export function getProjectPaths(slug: string): ProjectPaths {
  const root = path.join(PROJECTS_DIR, slug);
  const inputDir = path.join(root, "input");
  const workspaceDir = path.join(root, "workspace");
  const outputDir = path.join(root, "output");

  return {
    slug,
    root,
    metaFile: path.join(root, "project.json"),
    inputDir,
    workspaceDir,
    outputDir,
    script: path.join(inputDir, "script.txt"),
    voiceover: path.join(inputDir, "voiceover.mp3"),
    timestamps: path.join(workspaceDir, "timestamps.json"),
    storyboard: path.join(workspaceDir, "storyboard.json"),
    scriptElevenLabs: path.join(workspaceDir, "script_elevenlabs.txt"),
    scriptStructure: path.join(workspaceDir, "script_structure.json"),
    scenesDir: path.join(workspaceDir, "scenes"),
    finalVideo: path.join(outputDir, "final_video.mp4"),
  };
}

async function ensureProjectDirs(paths: ProjectPaths): Promise<void> {
  await Promise.all([
    fsp.mkdir(paths.inputDir, { recursive: true }),
    fsp.mkdir(paths.scenesDir, { recursive: true }),
    fsp.mkdir(paths.outputDir, { recursive: true }),
  ]);
}

async function copyIfExists(src: string, dest: string): Promise<void> {
  if (fs.existsSync(src) && !fs.existsSync(dest)) {
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    await fsp.copyFile(src, dest);
  }
}

export async function ensureProjectsInitialized(): Promise<void> {
  await fsp.mkdir(PROJECTS_DIR, { recursive: true });
  const entries = await fsp.readdir(PROJECTS_DIR, { withFileTypes: true });
  const existingDirs = entries.filter((e) => e.isDirectory());

  if (existingDirs.length === 0) {
    const defaultSlug = "proyecto-inicial";
    const paths = getProjectPaths(defaultSlug);
    await ensureProjectDirs(paths);

    // Migrar archivos existentes en la raíz si el usuario ya había trabajado antes
    await Promise.all([
      copyIfExists(PATHS.script, paths.script),
      copyIfExists(PATHS.voiceover, paths.voiceover),
      copyIfExists(PATHS.timestamps, paths.timestamps),
      copyIfExists(PATHS.storyboard, paths.storyboard),
      copyIfExists(PATHS.scriptElevenLabs, paths.scriptElevenLabs),
      copyIfExists(PATHS.scriptStructure, paths.scriptStructure),
      copyIfExists(PATHS.finalVideo, paths.finalVideo),
    ]);

    if (fs.existsSync(PATHS.scenesDir)) {
      const sceneFiles = await fsp.readdir(PATHS.scenesDir);
      await Promise.all(
        sceneFiles
          .filter((f) => f.endsWith(".png"))
          .map((f) =>
            copyIfExists(path.join(PATHS.scenesDir, f), path.join(paths.scenesDir, f)),
          ),
      );
    }

    const now = new Date().toISOString();
    const meta: ProjectMeta = {
      slug: defaultSlug,
      name: "Proyecto inicial",
      createdAt: now,
      updatedAt: now,
    };
    await fsp.writeFile(paths.metaFile, JSON.stringify(meta, null, 2), "utf-8");
    await fsp.writeFile(ACTIVE_FILE, defaultSlug, "utf-8");
  }
}

export async function listProjects(): Promise<ProjectMeta[]> {
  await ensureProjectsInitialized();
  const entries = await fsp.readdir(PROJECTS_DIR, { withFileTypes: true });
  const projects: ProjectMeta[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const p = getProjectPaths(entry.name);
    try {
      const raw = await fsp.readFile(p.metaFile, "utf-8");
      projects.push(JSON.parse(raw) as ProjectMeta);
    } catch {
      const now = new Date().toISOString();
      projects.push({
        slug: entry.name,
        name: entry.name,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getActiveProject(): Promise<{ meta: ProjectMeta; paths: ProjectPaths }> {
  const projects = await listProjects();
  let activeSlug = "";

  try {
    activeSlug = (await fsp.readFile(ACTIVE_FILE, "utf-8")).trim();
  } catch {
    activeSlug = "";
  }

  const found = projects.find((p) => p.slug === activeSlug) ?? projects[0];
  await fsp.writeFile(ACTIVE_FILE, found.slug, "utf-8");
  const paths = getProjectPaths(found.slug);
  await ensureProjectDirs(paths);

  return { meta: found, paths };
}

export async function setActiveProject(slug: string): Promise<ProjectMeta> {
  const projects = await listProjects();
  const found = projects.find((p) => p.slug === slug);
  if (!found) {
    throw new Error(`No existe el proyecto "${slug}".`);
  }
  await fsp.writeFile(ACTIVE_FILE, slug, "utf-8");
  return found;
}

export async function createProject(name: string): Promise<{ meta: ProjectMeta; paths: ProjectPaths }> {
  await ensureProjectsInitialized();
  const cleanName = name.trim();
  if (!cleanName) {
    throw new Error("El nombre o tema del video no puede estar vacío.");
  }

  let slug = slugifyProjectName(cleanName);
  let counter = 2;
  while (fs.existsSync(path.join(PROJECTS_DIR, slug))) {
    slug = `${slugifyProjectName(cleanName)}-${counter}`;
    counter += 1;
  }

  const paths = getProjectPaths(slug);
  await ensureProjectDirs(paths);

  const now = new Date().toISOString();
  const meta: ProjectMeta = {
    slug,
    name: cleanName,
    createdAt: now,
    updatedAt: now,
  };

  await fsp.writeFile(paths.metaFile, JSON.stringify(meta, null, 2), "utf-8");
  await fsp.writeFile(ACTIVE_FILE, slug, "utf-8");

  return { meta, paths };
}

export async function touchProject(slug: string): Promise<void> {
  const paths = getProjectPaths(slug);
  try {
    const raw = await fsp.readFile(paths.metaFile, "utf-8");
    const meta = JSON.parse(raw) as ProjectMeta;
    meta.updatedAt = new Date().toISOString();
    await fsp.writeFile(paths.metaFile, JSON.stringify(meta, null, 2), "utf-8");
  } catch {
    // Ignore if metadata doesn't exist
  }
}

export async function deleteProject(slug: string): Promise<ProjectMeta> {
  const projects = await listProjects();
  const target = projects.find((p) => p.slug === slug);
  if (!target) {
    throw new Error(`No existe el proyecto "${slug}".`);
  }

  if (projects.length <= 1) {
    throw new Error("Debe existir al menos un proyecto. Crea otro antes de eliminar este.");
  }

  const paths = getProjectPaths(slug);
  await fsp.rm(paths.root, { recursive: true, force: true });

  const remaining = projects.filter((p) => p.slug !== slug);
  const nextActive = remaining[0];
  await fsp.writeFile(ACTIVE_FILE, nextActive.slug, "utf-8");

  return nextActive;
}
