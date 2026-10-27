/**
 * The prompts view of the Prompt Manager: the tag filter and the prompt list.
 *
 * A row delivers its prompt on press (copy, or insert when the user chose
 * that), asking for template values first when the prompt has `{{name}}`
 * placeholders. Rows can be pinned, reordered (#1009), edited and deleted.
 * The tag filter is remembered locally across sessions (#729) and heals
 * itself when a selected tag no longer exists.
 */
import { StorageKeys } from '@/core/types/common';
import type { PromptItem } from '@/core/types/sync';
import { askConfirm } from '@/core/ui/confirm';
import { isPromptTemplate } from '@/features/prompt/model/promptTemplate';
import type { TranslationKey } from '@/utils/translations';

import {
  type TemplateFillHandle,
  highlightTemplateVariables,
  openTemplateFill,
} from './PromptTemplateFill';
import { extractPlainTitle } from './compactTitle';
import type { PromptLibraryState } from './promptLibraryState';
import { renderPromptMarkdown } from './promptMarkdownLoader';
import { getPromptNameConflictIds } from './promptName';
import { isPinned, pinGroupOf, sortPinnedFirst } from './promptPinning';
import { writePromptPref } from './promptPrefs';
import type { PromptPreview } from './promptPreview';
import { createPromptReorder } from './promptReorder';
import { collectAllTags } from './promptTags';
import { getScrollHintState } from './scrollHint';
import { sanitizeSelectedTags } from './tagFilterState';

export interface PromptListSettings {
  readonly viewMode: 'compact' | 'comfortable';
  readonly insertOnClick: boolean;
  /** Experiment: the row itself takes the drag and its primary action moves to pointerup. */
  readonly rowDrag: boolean;
}

export interface PromptListView {
  renderTags: () => void;
  /** Rebuilds the prompt rows, keeping the scroll position. */
  render: () => void;
  /** Shows the "more tags below" hint when the tag area overflows. */
  syncTagScrollHint: () => void;
  scheduleTagScrollHint: () => void;
  /** Closes surfaces anchored to a row that is going away. */
  closeTransient: () => void;
  destroy: () => void;
}

export interface PromptListViewOptions {
  list: HTMLElement;
  tagsWrap: HTMLElement;
  /** Holds `tagsWrap` and the scroll hint. */
  tagsWrapOuter: HTMLElement;
  library: PromptLibraryState;
  preview: Pick<PromptPreview, 'attach' | 'hide'>;
  /** Read on every render, so changes apply from the next one. */
  settings: PromptListSettings;
  /** The tag filter saved in an earlier session. */
  savedTags: string[];
  t: (key: TranslationKey) => string;
  setNotice: (text: string, kind: 'ok' | 'err') => void;
  /** Puts a prompt into the page's composer; false when there is none. */
  insert: (text: string) => boolean;
  getQuery: () => string;
  getTheme: () => string;
  onEdit: (item: PromptItem) => void;
  /** Re-renders whichever view is showing; called after a change made from this view. */
  rerender: () => void;
}

export function createPromptListView({
  list,
  tagsWrap,
  tagsWrapOuter,
  library,
  preview,
  settings,
  savedTags,
  t,
  setNotice,
  insert,
  getQuery,
  getTheme,
  onEdit,
  rerender,
}: PromptListViewOptions): PromptListView {
  // Reconciled against the tags that still exist so a deleted/renamed tag
  // can't strand the list on a chip-less filter. Local-only on purpose — see
  // StorageKeys.PROMPT_SELECTED_TAGS / tagFilterState.ts.
  let selectedTags = new Set<string>(
    sanitizeSelectedTags(savedTags, collectAllTags(library.items)),
  );
  /* The template fill surface is modal-ish but not a modal: at most one is
   * open, and closing the panel must take it with it. */
  let templateFill: TemplateFillHandle | null = null;
  const lifetime = new AbortController();
  const frames = new Set<number>();

  function nextFrame(callback: () => void): void {
    const frame = requestAnimationFrame(() => {
      frames.delete(frame);
      callback();
    });
    frames.add(frame);
  }

  function cancelFrames(): void {
    // Detached rows must not start Markdown rendering or measure tags after teardown.
    for (const frame of frames) cancelAnimationFrame(frame);
    frames.clear();
  }

  const scheduleTagScrollHint = () => nextFrame(syncTagScrollHint);

  function syncTagScrollHint(): void {
    const { isOverflowing, showHint } = getScrollHintState(
      tagsWrap.scrollTop,
      tagsWrap.clientHeight,
      tagsWrap.scrollHeight,
    );
    tagsWrapOuter.classList.toggle('gv-pm-tags-scrollable', isOverflowing);
    tagsWrapOuter.classList.toggle('gv-pm-tags-scroll-end', !showHint);
  }

  // Fire-and-forget: the in-memory Set drives the UI; a failed write just
  // means the filter isn't restored next session. Never blocks a click.
  function persistSelectedTags(): void {
    void writePromptPref(StorageKeys.PROMPT_SELECTED_TAGS, Array.from(selectedTags));
  }

  function renderTags(): void {
    const all = collectAllTags(library.items);
    // Self-heal: if a previously selected tag's prompts were all deleted or
    // retagged this session, drop it so the filter can't get stuck on a
    // chip-less ghost tag that hides every prompt. Persist only on a real
    // change to avoid redundant writes on every render.
    const valid = sanitizeSelectedTags(Array.from(selectedTags), all);
    if (valid.length !== selectedTags.size) {
      selectedTags = new Set(valid);
      persistSelectedTags();
    }
    tagsWrap.innerHTML = '';
    const allBtn = createEl('button', 'gv-pm-tag');
    allBtn.textContent = t('pm_all_tags') || 'All';
    allBtn.classList.toggle('active', selectedTags.size === 0);
    allBtn.addEventListener('click', () => {
      selectedTags = new Set();
      persistSelectedTags();
      renderTags();
      rerender();
    });
    tagsWrap.appendChild(allBtn);
    for (const tag of all) {
      const btn = createEl('button', 'gv-pm-tag');
      btn.textContent = tag;
      btn.classList.toggle('active', selectedTags.has(tag));
      btn.addEventListener('click', () => {
        if (selectedTags.has(tag)) selectedTags.delete(tag);
        else selectedTags.add(tag);
        persistSelectedTags();
        renderTags();
        rerender();
      });
      tagsWrap.appendChild(btn);
    }
    scheduleTagScrollHint();
  }

  /* Manual ordering (#1009): the list renders `items` in stored order, so a
   * move is a splice plus one write. The gesture lives in promptReorder.ts. */
  let confirmLifetime = new AbortController();
  function closeConfirm(): void {
    confirmLifetime.abort();
    confirmLifetime = new AbortController();
  }
  /** Rebuilt every render; a whole-row tap resolves its action through this. */
  const rowActivators = new Map<string, () => void>();
  const reorder = createPromptReorder<PromptItem>({
    list,
    getItems: () => library.items,
    commit: (next) => {
      library.reorder(next);
      rerender();
    },
    onDragStart: () => {
      preview.hide();
      closeConfirm();
    },
    onTap: (id) => rowActivators.get(id)?.(),
    groupOf: (id) => pinGroupOf(library.items, id),
  });

  async function confirmDelete(it: PromptItem, anchor: HTMLElement): Promise<void> {
    const id = it.id;
    const signal = confirmLifetime.signal;
    const theme = getTheme();
    const answer = await askConfirm({
      anchor,
      side: 'beside',
      scheme: theme === 'light' || theme === 'dark' ? theme : undefined,
      message: t('pm_delete_confirm') || 'Delete this prompt?',
      tone: 'danger',
      choices: [{ id: 'delete', label: t('pm_delete') || 'Delete' }],
      cancelLabel: t('pm_cancel') || 'Cancel',
      signal,
    });
    // A re-render or panel close can invalidate an answer before its continuation runs.
    if (answer !== 'delete' || signal.aborted || !library.items.some((item) => item.id === id))
      return;
    void library.remove(id).then((ok) => ok && setNotice(t('pm_deleted'), 'ok'));
    renderTags();
    rerender();
  }

  // Copying is also the fallback when insert-on-click finds no composer.
  function deliverPromptText(body: string, insertOnClick = settings.insertOnClick): void {
    if (insertOnClick && insert(body)) {
      setNotice(t('pm_inserted') || 'Inserted', 'ok');
      return;
    }
    void copyText(body).then(() => setNotice(t('pm_copied') || 'Copied', 'ok'));
  }

  // A prompt carrying `{{name}}` placeholders asks for their values first,
  // so whatever reaches the composer is already resolved. A prompt with
  // no placeholders keeps today's behaviour exactly.
  function activateRow(it: PromptItem, anchor: HTMLElement): void {
    preview.hide();
    if (!isPromptTemplate(it.text)) {
      deliverPromptText(it.text);
      return;
    }
    templateFill?.close();
    // Keep this surface's label and action together if the popup changes
    // the preference while the user is filling it in.
    const insertOnClick = settings.insertOnClick;
    templateFill = openTemplateFill({
      text: it.text,
      name: it.name,
      anchor,
      signal: lifetime.signal,
      theme: getTheme(),
      labels: {
        // `deliverPromptText` copies unless insert-on-click is enabled,
        // and that setting is off by default - so a fixed "Insert" told
        // most users the composer was about to change when the body was
        // only going to the clipboard.
        insert: insertOnClick ? t('pm_fill_insert') || 'Insert' : t('pm_fill_copy') || 'Copy',
        keepRaw: t('pm_fill_keep_raw') || 'Keep as is',
        title: t('pm_fill_title') || 'Fill in the variables',
      },
      onSubmit: (filled) => {
        templateFill = null;
        deliverPromptText(filled, insertOnClick);
      },
      onCancel: () => {
        templateFill = null;
      },
    });
  }

  function render(): void {
    // Rebuilding the list destroys every row's DOM. Any pending hover-open
    // timer would fire against a detached target (getBoundingClientRect()
    // returns zeros → tooltip mispositioned) and any visible tooltip would
    // display stale content. Close it up front so every re-render starts
    // from a clean state.
    preview.hide();
    closeConfirm();

    // Preserve the user's scroll position across the wipe-and-rebuild.
    // Without this, actions like expand/collapse, search, tag filter,
    // view-mode toggle, and cloud-sync updates all snap the list back to
    // the top — most painful on the expand button, which fires a re-render
    // right as the user is reading further down the list.
    const savedScrollTop = list.scrollTop;

    const q = getQuery().trim().toLowerCase();
    const selectedTagList = Array.from(selectedTags);
    const nameConflictIds = getPromptNameConflictIds(library.items);
    const filtered = library.items.filter((it) => {
      const okTag = selectedTagList.every((tag) => it.tags.includes(tag));
      if (!okTag) return false;
      if (!q) return true;
      // Include the user-authored name so searching for the label shown in
      // compact mode always finds the prompt even when the Markdown body
      // doesn't contain that string.
      return (
        it.text.toLowerCase().includes(q) ||
        it.tags.some((tag) => tag.includes(q)) ||
        (it.name ? it.name.toLowerCase().includes(q) : false)
      );
    });
    list.innerHTML = '';
    rowActivators.clear();
    if (filtered.length === 0) {
      const empty = createEl('div', 'gv-pm-empty');
      empty.textContent = t('pm_empty') || 'No prompts yet';
      list.appendChild(empty);
      // Nothing to scroll back to; avoid setting scrollTop on an empty list.
      return;
    }
    const ordered = sortPinnedFirst(filtered);
    const frag = document.createDocumentFragment();
    let dividerDone = false;
    for (const it of ordered) {
      if (!dividerDone && !isPinned(it) && ordered[0] && isPinned(ordered[0])) {
        frag.appendChild(createEl('div', 'gv-pm-pin-divider'));
        dividerDone = true;
      }
      frag.appendChild(renderRow(it, filtered.length, nameConflictIds.has(it.id)));
    }
    list.appendChild(frag);
    // Restore scroll position after the DOM is laid out. Clamped to the
    // new scrollHeight so a re-filter that shrinks the list doesn't leave
    // us at an impossible offset.
    const maxScroll = Math.max(0, list.scrollHeight - list.clientHeight);
    list.scrollTop = Math.min(savedScrollTop, maxScroll);
  }

  function renderRow(it: PromptItem, visibleCount: number, nameConflict: boolean): HTMLElement {
    const row = createEl('div', 'gv-pm-item');

    const textContainer = createEl('div', 'gv-pm-item-text-container');
    const textBtn = createEl('button', 'gv-pm-item-text');

    // Compact mode collapses each prompt to a single-line plaintext title
    // to maximize density; comfortable mode shows the rich Markdown preview,
    // clamped to five lines. Either way the full body is one hover away.
    const compactCollapsed = settings.viewMode === 'compact';
    if (compactCollapsed) row.classList.add('gv-pm-item-compact');

    // Render Markdown + KaTeX preview (sanitized)
    const md = document.createElement('div');
    md.className = 'gv-md';

    if (compactCollapsed) {
      md.classList.add('gv-pm-compact-title');
      // User-authored `name` takes precedence so prompts can be labeled
      // independently of their Markdown body.
      md.textContent = (it.name && it.name.trim()) || extractPlainTitle(it.text);
      // Attach a lightweight, fast-opening hover tooltip for peek.
      preview.attach(textBtn, it.text);
    } else {
      md.classList.add('gv-md-collapsed');
    }

    // Insert element into DOM first, then render to ensure KaTeX can detect document mode correctly
    textBtn.appendChild(md);

    if (!compactCollapsed) {
      const paintMarkdown = (html: string): void => {
        md.innerHTML = html;
        // Placeholders become chips so the list shows which prompts
        // are templates, and where their variables sit.
        highlightTemplateVariables(md);
        // Past the five-line clamp, the hover preview is how the rest is read.
        if (md.scrollHeight - md.clientHeight > 1) {
          preview.attach(textBtn, it.text);
        }
      };
      // Defer rendering to next frame to ensure element is fully attached
      nextFrame(() => {
        void renderPromptMarkdown(it.text)
          .then(paintMarkdown)
          .catch(() => {
            md.textContent = it.text;
          });
      });
    }

    const activate = (): void => activateRow(it, textBtn);
    rowActivators.set(it.id, activate);
    // In row-drag mode the gesture owns the press, and the tap that never
    // travelled comes back through the controller's onTap.
    if (!settings.rowDrag) {
      textBtn.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        activate();
      });
    }
    textBtn.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      e.stopPropagation();
      activate();
    });

    textContainer.appendChild(textBtn);

    const editBtn = createEl('button', 'gv-pm-edit');
    editBtn.setAttribute('aria-label', t('pm_edit') || 'Edit');
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      onEdit(it);
    });
    const bottom = createEl('div', 'gv-pm-bottom');
    const meta = createEl('div', 'gv-pm-item-meta');
    if (nameConflict) {
      row.classList.add('gv-pm-item-name-conflict');
      const conflict = createEl('span', 'gv-pm-chip gv-pm-name-conflict');
      conflict.textContent = t('pm_name_conflict_badge') || 'Duplicate name. Rename to use /';
      meta.appendChild(conflict);
    }
    for (const tag of it.tags) {
      const chip = createEl('span', 'gv-pm-chip');
      chip.textContent = tag;
      // Filters for this session only; the tag bar is what the user saves.
      chip.addEventListener('click', () => {
        if (selectedTags.has(tag)) selectedTags.delete(tag);
        else selectedTags.add(tag);
        renderTags();
        rerender();
      });
      meta.appendChild(chip);
    }
    // Actions container at row bottom-right
    const actions = createEl('div', 'gv-pm-actions');
    const del = createEl('button', 'gv-pm-del');
    del.title = t('pm_delete') || 'Delete';
    del.addEventListener('click', (e) => {
      e.stopPropagation();
      void confirmDelete(it, del);
    });

    row.appendChild(textContainer);

    // The reorder handle leads the actions cluster in both view modes, so
    // it reads [⠿] [✎] [🗑] from left to right. A single visible row has
    // nothing to reorder against, so the handle is left out entirely.
    if (settings.rowDrag) {
      reorder.bindRow(row, it.id);
    } else if (visibleCount > 1) {
      const reorderBtn = createEl('button', 'gv-pm-reorder');
      reorderBtn.type = 'button';
      reorderBtn.title = t('pm_reorder') || 'Drag to reorder (↑/↓ keys)';
      reorderBtn.setAttribute('aria-label', reorderBtn.title);
      reorder.bind(row, reorderBtn, it.id);
      actions.appendChild(reorderBtn);
    }
    actions.appendChild(editBtn);
    actions.appendChild(del);
    // Trails the cluster: on a pinned row it is the one icon that stays
    // visible at rest, and it sits flush with the row's trailing edge.
    const pinBtn = createEl('button', 'gv-pm-pin');
    pinBtn.type = 'button';
    pinBtn.title = isPinned(it) ? t('pm_unpin') || 'Unpin' : t('pm_pin') || 'Pin to top';
    pinBtn.setAttribute('aria-label', pinBtn.title);
    pinBtn.setAttribute('aria-pressed', isPinned(it) ? 'true' : 'false');
    pinBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      library.togglePin(it.id);
      rerender();
    });
    actions.appendChild(pinBtn);
    // Compact keeps the chips with the title they label, leaving the
    // trailing side to the actions alone — see contentStyle.css.
    (compactCollapsed ? textContainer : bottom).appendChild(meta);
    bottom.appendChild(actions);
    row.appendChild(bottom);
    return row;
  }

  tagsWrap.addEventListener('scroll', syncTagScrollHint, { passive: true });

  function closeTemplateFill(): void {
    templateFill?.close();
    templateFill = null;
  }

  return {
    renderTags,
    render,
    syncTagScrollHint,
    scheduleTagScrollHint,
    closeTransient: () => {
      closeConfirm();
      closeTemplateFill();
    },
    destroy: () => {
      cancelFrames();
      lifetime.abort();
      // Drops the reorder listeners and auto-scroll frame on a mid-drag teardown.
      reorder.destroy();
      confirmLifetime.abort();
      tagsWrap.removeEventListener('scroll', syncTagScrollHint);
      closeTemplateFill();
    },
  };
}

function copyText(text: string): Promise<void> {
  try {
    return navigator.clipboard.writeText(text);
  } catch {
    return new Promise<void>((resolve) => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand('copy');
      } catch {}
      ta.remove();
      resolve();
    });
  }
}

function createEl<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (className) el.className = className;
  return el;
}
