/**
 * Read-only views of ChatGPT's projects for the `project.*` ops, driven by the
 * site's `projects` data (measured on chatgpt.com, zh-CN, 2026-10-18; see
 * `sites/sections/projectsData.ts`). Structure and attributes only, so every
 * UI language reads the same; the composer's placeholder is the one text,
 * from tables per language. The chat/Work pair is in `modeSwitch.ts`.
 */
import {
  PROJECT_ID_PATTERN,
  type ProjectFile,
  type ProjectSummary,
} from '@/features/bridge/protocol';
import { chatgptPageData } from '@/features/plugins/builtin/chatgptPageData';
import type { LocalizedLabels } from '@/features/plugins/sites/sections/modelPickerData';
import type { ProjectsSection } from '@/features/plugins/sites/sections/projectsData';
import type { SiteAdapter } from '@/features/plugins/types';
import { isRendered } from '@/pages/content/export/adapter/chatgptThread';

import { GRANT_MARGIN_MS, type OpContext } from '../opContext';
import { siteOf } from './pageReaders';

const NAME = '{name}';
const QUOTES = /[“”„‟″＂「」『』]/g;

export function projectsDataOf(adapter: SiteAdapter | null): ProjectsSection | null {
  return siteOf(adapter).projects ?? null;
}

export function requireProjectsData(ctx: OpContext, adapter: SiteAdapter | null): ProjectsSection {
  const data = projectsDataOf(adapter);
  if (!data) ctx.fail('unsupported-data', 'This site has no project data.');
  return data;
}

/** What is left of the grant for page work, never more than `cap`. */
export function timeLeft(ctx: OpContext, cap: number): number {
  return Math.max(0, Math.min(cap, ctx.grant.deadline - GRANT_MARGIN_MS - ctx.now()));
}

export function allLabels(labels: LocalizedLabels): string[] {
  return Object.values(labels).flat();
}

/**
 * The `{name}` a text fills into `template`, or null. `loose` compares runs of
 * spaces and quote styles as one (ChatGPT's placeholder quotes were seen typed
 * both ways); otherwise only the text's outer spaces are ignored.
 */
export function matchTemplate(template: string, text: string, loose = false): string | null {
  const shape = (value: string): string =>
    loose ? value.normalize('NFC').replace(/\s+/g, ' ').replace(QUOTES, '"') : value;
  const [before = '', after = ''] = template.split(NAME).map(shape);
  const subject = shape(text).trim();
  if (subject.length <= before.length + after.length) return null;
  if (!subject.startsWith(before) || !subject.endsWith(after)) return null;
  return subject.slice(before.length, subject.length - after.length).trim() || null;
}

function firstGroup(source: string, path: string): string | null {
  try {
    return new RegExp(source).exec(path)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** The project a route belongs to (its page or one of its chats), or null. */
export function projectIdOf(data: ProjectsSection, pathname = location.pathname): string | null {
  return firstGroup(data.projectRoutePattern, pathname);
}

/** The project whose own page `pathname` is, or null. */
export function projectPageIdOf(
  data: ProjectsSection,
  pathname = location.pathname,
): string | null {
  return firstGroup(data.projectPagePattern, pathname);
}

export function projectPathOf(data: ProjectsSection, projectId: string): string {
  return data.projectPath.replace('{projectId}', projectId);
}

export function isSourcesView(data: ProjectsSection, search = location.search): boolean {
  const [key, value] = data.sourcesQuery.split('=');
  return new URLSearchParams(search).get(key) === value;
}

/** The project's name as the page title gives it. */
export function titleName(data: ProjectsSection): string | null {
  for (const template of data.titleTemplates) {
    const name = matchTemplate(template, document.title, true);
    if (name) return name;
  }
  return null;
}

export function composerSaysProjectChat(data: ProjectsSection, labels: readonly string[]): boolean {
  const templates = allLabels(data.chatComposerLabels);
  return labels.some((label) =>
    templates.some((template) => !!matchTemplate(template, label, true)),
  );
}

export interface ViewSwitch {
  readonly chat: HTMLButtonElement;
  readonly sources: HTMLButtonElement;
}

/** The one rendered element `selector` matches, else null (none, or ambiguous). */
function uniqueRendered<T extends HTMLElement>(selector: string): T | null {
  const found = Array.from(document.querySelectorAll<T>(selector)).filter(isRendered);
  return found.length === 1 ? found[0] : null;
}

export function findViewSwitch(data: ProjectsSection): ViewSwitch | null {
  const chat = uniqueRendered<HTMLButtonElement>(data.views.chat);
  const sources = uniqueRendered<HTMLButtonElement>(data.views.sources);
  return chat && sources ? { chat, sources } : null;
}

/** The link that leads to a project's page, as an anchor's own path. */
function linkPath(anchor: HTMLAnchorElement): string | null {
  const href = anchor.getAttribute('href');
  if (!href?.startsWith('/') || href.startsWith('//')) return null;
  return href.split(/[?#]/)[0];
}

/** The row's name: its label attribute, else the text its `aria-labelledby` points at. */
function rowName(row: Element, labelAttribute: string): string {
  const label = (row.getAttribute(labelAttribute) ?? '').trim();
  if (label) return label;
  return (row.getAttribute('aria-labelledby') ?? '')
    .split(/\s+/)
    .map((id) => (id ? (document.getElementById(id)?.textContent ?? '').trim() : ''))
    .filter(Boolean)
    .join(' ');
}

export interface SidebarProject extends ProjectSummary {
  /** A link inside the row to the project's page, when the sidebar has one. */
  readonly link: HTMLAnchorElement | null;
}

/** Every project the sidebar shows, once each, in sidebar order. */
export function sidebarProjects(data: ProjectsSection): SidebarProject[] {
  const { row: rowSelector, idAttribute, labelAttribute } = data.sidebar;
  const found = new Map<string, SidebarProject>();
  // Project rows are buttons, not links: the links beside them lead to the project's chats.
  for (const row of Array.from(document.querySelectorAll(rowSelector))) {
    const projectId = (row.getAttribute(idAttribute) ?? '').trim();
    const name = rowName(row, labelAttribute);
    if (!PROJECT_ID_PATTERN.test(projectId) || !name || found.has(projectId)) continue;
    const link =
      Array.from(row.querySelectorAll<HTMLAnchorElement>('a[href]')).find((anchor) => {
        const path = linkPath(anchor);
        return path !== null && projectPageIdOf(data, path) === projectId;
      }) ?? null;
    found.set(projectId, { projectId, name, link });
  }
  return [...found.values()];
}

export function findCreateButton(data: ProjectsSection): HTMLButtonElement | null {
  return uniqueRendered<HTMLButtonElement>(data.createButton);
}

export interface FileRow extends ProjectFile {
  readonly row: HTMLElement;
  readonly actions: HTMLButtonElement;
}

/** The sources view's file rows: one element titled with the file's name, and one menu button. */
export function fileRows(data: ProjectsSection): FileRow[] {
  const { row: rowSelector, rowName, rowActions } = data.sources;
  const rows: FileRow[] = [];
  for (const row of Array.from(document.querySelectorAll<HTMLElement>(rowSelector))) {
    const titled = Array.from(row.querySelectorAll(rowName));
    const actions = Array.from(row.querySelectorAll<HTMLButtonElement>(rowActions));
    if (titled.length !== 1 || actions.length !== 1) continue;
    const name = (titled[0].getAttribute('title') ?? '').trim();
    if (!name) continue;
    const uploadedAt =
      row.querySelector(chatgptPageData.sourceUploadedAt)?.getAttribute('datetime') ?? null;
    rows.push({ name, uploadedAt, row, actions: actions[0] });
  }
  return rows;
}

export function filesOf(rows: readonly FileRow[]): ProjectFile[] {
  return rows.map(({ name, uploadedAt }) => ({ name, uploadedAt }));
}

/** Measured: the sources view's upload input is the first in `main` outside any form. */
export function findUploadInput(data: ProjectsSection): HTMLInputElement | null {
  return (
    Array.from(document.querySelectorAll<HTMLInputElement>(data.sources.fileInput)).find(
      (input) => !input.closest(chatgptPageData.composerRootFallback),
    ) ?? null
  );
}

/** Fail unless the tab shows `projectId`; the caller opens it with `project.open` first. */
export function requireProjectPage(ctx: OpContext, data: ProjectsSection, projectId: string): void {
  const shown = projectPageIdOf(data);
  if (shown !== projectId) {
    ctx.fail('unverified', 'The tab does not show this project.', {
      reason: 'project-mismatch',
      expected: projectId,
      actual: shown,
    });
  }
}

const VIEW_TIMEOUT_MS = 10_000;

/** Bring the project's sources view up with its own sources tab, once. */
export async function ensureSourcesView(ctx: OpContext, data: ProjectsSection): Promise<void> {
  if (!isSourcesView(data)) {
    const views = await ctx.waitFor(() => findViewSwitch(data), {
      timeoutMs: timeLeft(ctx, VIEW_TIMEOUT_MS),
    });
    if (!views) ctx.fail('selector-missing', "The project's sources button was not found.");
    ctx.click(views.sources);
  }
  const shown = await ctx.waitFor(() => isSourcesView(data) && !!findUploadInput(data), {
    timeoutMs: timeLeft(ctx, VIEW_TIMEOUT_MS),
  });
  if (!shown) ctx.fail('selector-missing', "The project's sources view did not open.");
}
