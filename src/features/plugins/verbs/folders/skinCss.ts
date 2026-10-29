import type { FolderSkin, FolderSkinColors } from '../../sites/sections/folderSkinData';

/** Only these packaged destinations can be styled by online folder tokens. */
const COLOR_PROPERTIES = {
  heading: '--gv-site-folder-section__heading',
  text: '--gv-floating-folder-panel__text',
  textMuted: '--gv-floating-folder-panel__text-muted',
  surface: '--gv-floating-folder-panel__surface',
  surfaceContainer: '--gv-floating-folder-panel__surface-container',
  surfaceHover: '--gv-floating-folder-panel__surface-hover',
  surfaceActive: '--gv-floating-folder-panel__surface-active',
  outline: '--gv-floating-folder-panel__outline',
  danger: '--gv-site-folder-section__danger',
  dangerSoft: '--gv-site-folder-section__danger-soft',
  sidebar: '--gv-site-folder-section__sidebar',
} satisfies Record<keyof FolderSkinColors, string>;

/**
 * The shadow host mirrors html[data-gv-scheme] (shadowHost.ts); page selectors
 * cannot cross that boundary. The body-level tree popover receives this sheet
 * too, without acquiring the sidebar section's layout rules.
 */
export function folderSkinCss(className: string, skin: FolderSkin): string {
  const hosts = (condition = '') =>
    `:host(.${className}${condition}), :host(.gv-folder-tree-popover-layer${condition})`;
  const colors = (tokens: Partial<FolderSkinColors>): string =>
    (Object.keys(COLOR_PROPERTIES) as (keyof FolderSkinColors)[])
      .flatMap((key) =>
        tokens[key] === undefined ? [] : [`${COLOR_PROPERTIES[key]}: ${tokens[key]};`],
      )
      .join('\n');
  const css = `
    ${hosts()} {
      --gv-site-folder-section__row-height: ${skin.rowHeight};
      --gv-site-folder-section__row-radius: ${skin.rowRadius};
      ${skin.header ? `--gv-site-folder-section__header-height: ${skin.header.height}px;` : ''}
    }
    ${hosts('[data-gv-scheme]')} { ${colors(skin.light)} }
    ${hosts("[data-gv-scheme='dark']")} { ${colors(skin.dark)} }
    ${skin.header ? stickyHeaderCss(className, skin.header) : ''}
  `;
  return css.replaceAll('gv-site-folder-section', className);
}

function stickyHeaderCss(className: string, header: NonNullable<FolderSkin['header']>): string {
  return `
    .${className}__header {
      position: sticky;
      top: 0;
      z-index: 3;
      box-sizing: border-box;
      height: var(--gv-site-folder-section__header-height);
      padding-inline-end: ${header.paddingInlineEnd}px;
      background: var(--gv-site-folder-section__sidebar);
    }
    :host(.${className}[data-gv-scheme])
      .${className}__header.gv-floating-folder-panel__drop-target {
      background: linear-gradient(
        var(--gv-floating-folder-panel__surface-active),
        var(--gv-floating-folder-panel__surface-active)
      ), var(--gv-site-folder-section__sidebar) !important;
    }
    .${className}__selection { top: var(--gv-site-folder-section__header-height); }
  `;
}
