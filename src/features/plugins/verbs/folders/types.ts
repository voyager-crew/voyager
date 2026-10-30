/**
 * What a site gives the shared sidebar folders (`activateSiteFolders`): where
 * its sidebar and conversation rows are, how a conversation is named and
 * opened, and its stored names (keys, classes, guide id, message keys), which
 * are serialized user data or DOM output and so stay the site's own. Every
 * site's is built from data by `siteData.ts`.
 */
import type { ConversationReference, FolderData } from '@/core/types/folder';
import type { FolderCommands } from '@/features/folder/commands/folderCommands';
import type { FolderSitePolicy } from '@/features/folder/owner/folderOwnerPolicy';
import type { FolderPlatform } from '@/features/folder/platforms';
import type { FiledConversations } from '@/features/folder/sites/filings';
import type { FolderPrefsKey, FolderSiteTree } from '@/features/folder/sites/folderSiteTable';
import type { FolderExportPayload } from '@/features/folder/types/import-export';
import type { SiteFolderNotify, SiteFolderStore } from '@/pages/content/folder/SiteFolderStore';

/** A conversation row in the site's own sidebar, found by its link. */
export interface SidebarConversation {
  /** The bare conversation id from the row's route. */
  readonly id: string;
  /** The route the row links to, e.g. `/g/g-p-<project>/c/<id>`. */
  readonly path: string;
  readonly link: HTMLAnchorElement;
}

/** Reads a site's sidebar rows. */
export interface SidebarRows {
  /** Every conversation row under `root` right now, in sidebar order. */
  list(root: ParentNode): SidebarConversation[];
  /** A row's title as the site shows it; empty while it has none. */
  title(row: SidebarConversation): string;
}

/** How the site names its conversations in a folder. */
export interface SiteConversationIdentity {
  /** The stored folder id of a bare route id, e.g. `chatgpt:conv:<id>`. */
  storedId(bareId: string): string;
  /** The route id inside a stored id; any other id as is. */
  bareId(conversationId: string): string;
  /** The stored id of the conversation `href` opens, or `null`. */
  conversationIdOf(href: string): string | null;
  /** The link a filed conversation's row shows; empty when it is not this site's. */
  href(conversation: ConversationReference): string;
}

/** The site's store: its own bucket, plus reads by bare conversation id. */
export type SiteFoldersStore = SiteFolderStore & FiledConversations;

/** The section's look in the site's sidebar. */
export interface SectionSite {
  /** The host class; `__header`, `__title` and the like derive from it. */
  readonly className: string;
  /** The section's own sheet, after the shared panel, header and activity sheets. */
  readonly css: string;
  /** Where the section goes: it is inserted just before this element. */
  anchor(sidebar: HTMLElement): HTMLElement | null;
  conversationHref(conversation: ConversationReference): string;
  readonly policy: FolderSitePolicy;
  /** The core table's orders, root heading and refused edits. */
  readonly tree: FolderSiteTree;
}

/** Hiding filed chats from the site's history list. */
export interface HideFiledDom {
  /** History rows hiding applies to (a filed chat stays visible elsewhere). */
  readonly rowSelector: string;
  /** Marks a hidden row; constant CSS hides marked rows. */
  readonly filedAttribute: string;
  /** Marks the injected `<style>`. */
  readonly styleAttribute: string;
  readonly css: string;
  /** Ids that may be marked; anything else is never trusted. */
  readonly idPattern: RegExp;
}

export interface SiteFolderGuideConfig {
  /** The shared coachmark id: seen state is stored under it. */
  readonly id: string;
  /** `document.dispatchEvent(new Event(...))` shows the guide again, seen or not. */
  readonly debugEvent: string;
  readonly titleKey: string;
  readonly bodyKey: string;
  /** Matches an ancestor of the anchor while the sidebar is transient; the guide waits. */
  readonly transientSidebar?: string;
}

/** The site's i18n keys for what it says about filing. */
export interface SiteFolderMessages {
  /** The floating panel's hint. */
  readonly hint: string;
  readonly added: string;
  readonly alreadyFiled: string;
  readonly untitled: string;
  /** "Add current conversation" with no saved conversation open. */
  readonly noConversation: string;
}

/** "Move to folder" in a sidebar row's own menu. */
export interface SiteMoveMenu {
  /** After each sidebar change; true asks for another pass next frame. */
  check(sidebar: HTMLElement | null): boolean;
  /** Drops a pending move and every entry it added. */
  dispose(): void;
}

export interface SiteMoveMenuOptions {
  readonly label: () => string;
  readonly untitled: () => string;
  /** Whether a conversation can be filed right now (the store is ready). */
  readonly canFile: () => boolean;
  readonly onMove: (conversation: ConversationReference) => void;
}

export interface NativeRenameOptions {
  readonly sidebar: () => HTMLElement | null;
  /** Shows a hidden filed row until the release, so its name field can take focus. */
  readonly reveal: (id: string) => () => void;
  /** False once the plugin is off; the wait stops. */
  readonly active: () => boolean;
}

/** The site's own UI the folders ride on; each is optional. */
export interface SiteNativeHooks {
  /** Opens the site's rename for bare id `id`; the title the row showed, or `null`. */
  rename?(id: string, options: NativeRenameOptions): Promise<string | null>;
  /** `null` where the site's menu opens in a way the folders cannot follow. */
  createMoveMenu?(options: SiteMoveMenuOptions): SiteMoveMenu | null;
  /** The sidebar row a press landed on, which a drag onto a folder files. */
  rowAt?(target: EventTarget | null): SidebarConversation | null;
}

export interface SiteFoldersAdapter {
  /** Labels the plugin's effects and its notice channel, e.g. `chatgpt-folders`. */
  readonly key: string;
  readonly platform: FolderPlatform;
  readonly policy: FolderSitePolicy;
  readonly rootBucketId: string;
  /** The site's store and the commands that edit it. */
  createFolders(notify: SiteFolderNotify): {
    store: SiteFoldersStore;
    commands: FolderCommands;
  };
  /** Device-local view state: the floating panel's geometry and the section's view. */
  readonly prefsKeys: { readonly panel: FolderPrefsKey; readonly section: FolderPrefsKey };
  readonly identity: SiteConversationIdentity;
  readonly page: {
    /** The open conversation as a folder entry, or `null` when none can be filed. */
    current(untitled: string): ConversationReference | null;
    /** Opens a filed conversation inside the running app. */
    open(conversation: ConversationReference): void;
    /** A title the site shows before it names a conversation. */
    isPlaceholderTitle(title: string): boolean;
  };
  readonly sidebar: SidebarRows & {
    find(doc?: Document): HTMLElement | null;
    /** Attribute changes inside the sidebar that call for another pass. */
    readonly observedAttributes: readonly string[];
  };
  readonly section: SectionSite;
  readonly hideFiled: HideFiledDom;
  /** `null`: the site shows no first-run guide (a derived site has no texts of its own). */
  readonly guide: SiteFolderGuideConfig | null;
  readonly messages: SiteFolderMessages;
  readonly transfer: {
    export(data: FolderData): FolderExportPayload;
    filename(): string;
  };
  readonly native: SiteNativeHooks;
}
