import type { EffectiveSendKey } from '@/core/services/composer/sendKeys/sendKeyCoordinator';
import { isImeKeyEvent } from '@/core/services/composer/sendKeys/sendKeyIntent';
import { inputSiteId } from '@/core/services/composer/siteInputData';
import aistudioPackaged from '@/features/plugins/catalog/sites/aistudio/selector-data/input-packaged.json';
import geminiPackaged from '@/features/plugins/catalog/sites/gemini/selector-data/composer-send-packaged.json';

function sendData(doc: Document = document): typeof geminiPackaged {
  return inputSiteId(doc) === 'aistudio' ? aistudioPackaged : geminiPackaged;
}

/** Selectors and semantic fallbacks shared by send-related content features. */
export function sendButtonSelectors(doc: Document): readonly string[] {
  return sendData(doc)['composer.sendCandidates'];
}

const ACTION_BUTTON_LABEL_ATTRIBUTES = [
  'aria-label',
  'data-tooltip',
  'mattooltip',
  'title',
] as const;

const ACTION_BUTTON_LABEL_PATTERN =
  /\b(send|submit|run|update|save|confirm)\b|发送|提交|傳送|送出|送信|전송|enviar|envoyer|senden|отправ|إرسال|运行|執行|実行|실행|更新|保存|修改/i;

// Unknown wrappers may prove a new send, but not a save/confirmation action from another editor.
const INITIAL_SEND_LABEL_PATTERN =
  /\b(send|submit|run)\b|发送|提交|傳送|送出|送信|전송|enviar|envoyer|senden|отправ|إرسال|运行|執行|実行|실행/i;

const UPDATE_BUTTON_LABEL_PATTERN =
  /\b(update|save|confirm)\b|更新|保存|actualizar|guardar|mettre à jour|enregistrer|atualizar|salvar|обновить|сохранить|更新する|保存する|업데이트|저장|تحديث|حفظ/i;

function getButtonLabel(button: HTMLButtonElement): string {
  const labels = ACTION_BUTTON_LABEL_ATTRIBUTES.map((attribute) => button.getAttribute(attribute));
  labels.push(button.textContent);
  return labels.filter(Boolean).join(' ');
}

function hasSendActionIcon(button: HTMLButtonElement): boolean {
  const icon = button.querySelector<HTMLElement>(
    sendData(button.ownerDocument)['composer.actionIcon'],
  );
  const iconName = (icon?.getAttribute('fonticon') || icon?.textContent || '').trim().toLowerCase();
  return iconName === 'send' || iconName === 'play_arrow';
}

/** Gemini uses the same send-button wrapper for Stop during generation. */
export function isUnavailableSendControl(control: HTMLElement): boolean {
  if (control.closest(sendData(control.ownerDocument)['composer.unavailableAncestors']))
    return true;
  const button = control instanceof HTMLButtonElement ? control : control.querySelector('button');
  if (!button) return control.matches(':disabled');
  return (
    button.disabled ||
    button.matches('[aria-disabled="true"]') ||
    !!button.querySelector(sendData(control.ownerDocument)['composer.stopIcons']) ||
    /\b(stop|cancel)\b|停止|取消|중지|отмен|останов|إيقاف/i.test(getButtonLabel(button))
  );
}

/** Native labels/icons independently identify a send action when its wrapper was renamed. */
export function isSemanticSendActionButton(button: HTMLButtonElement): boolean {
  const label = getButtonLabel(button);
  return (
    !isUnavailableSendControl(button) &&
    (INITIAL_SEND_LABEL_PATTERN.test(label) || hasSendActionIcon(button))
  );
}

/** Recognizes selector-based, localized-label, and icon-only send/action buttons. */
export function isSendActionButton(button: HTMLButtonElement): boolean {
  if (isUnavailableSendControl(button)) return false;
  const matchesKnownSelector = sendButtonSelectors(button.ownerDocument).some((selector) => {
    try {
      return button.matches(selector) || Boolean(button.querySelector(selector));
    } catch {
      return false;
    }
  });
  return (
    matchesKnownSelector ||
    ACTION_BUTTON_LABEL_PATTERN.test(getButtonLabel(button)) ||
    hasSendActionIcon(button)
  );
}

/** Resolves a click target (including an icon child) to a recognized action button. */
export function findClosestSendActionButton(target: Element): HTMLButtonElement | null {
  const button = target.closest('button');
  return button instanceof HTMLButtonElement && isSendActionButton(button) ? button : null;
}

/** Distinguishes an edit submission from the initial Edit action. */
export function isUpdateActionButton(button: HTMLButtonElement): boolean {
  return (
    button.matches(sendData(button.ownerDocument)['composer.updateButton']) ||
    UPDATE_BUTTON_LABEL_PATTERN.test(getButtonLabel(button))
  );
}

/** Finds the editable input owned by a recognized send/update button. */
export function findInputForSendActionButton(button: HTMLButtonElement): HTMLElement | null {
  const data = sendData(button.ownerDocument);
  const inputSelector = data['composer.actionInput'];
  let ancestor = button.parentElement;
  while (ancestor && ancestor !== document.body) {
    if (data['composer.actionOwners'].some((selector) => ancestor?.matches(selector))) {
      const active = document.activeElement;
      if (
        active instanceof HTMLElement &&
        ancestor.contains(active) &&
        active.matches(inputSelector)
      ) {
        return active;
      }
      const input = ancestor.querySelector<HTMLElement>(inputSelector);
      if (input) return input;
    }
    ancestor = ancestor.parentElement;
  }
  return null;
}

/** Mirrors Gemini send-key semantics, including Voyager's Ctrl+Enter mode. */
export function isSendKeyboardEvent(event: KeyboardEvent, sendKey: EffectiveSendKey): boolean {
  if (event.key !== 'Enter' || isImeKeyEvent(event)) return false;
  const hasCtrlModifier = event.ctrlKey || event.metaKey;
  if (sendKey === 'ctrlEnter') return hasCtrlModifier;
  return !event.shiftKey || hasCtrlModifier;
}
