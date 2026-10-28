/** The "show section" tooltip a peek bar raises on hover or focus; one per page. */
import { TOOLTIP_ID, TOOLTIP_VISIBLE_CLASS } from './styles';

function getTooltipElement(): HTMLDivElement {
  let tooltip = document.getElementById(TOOLTIP_ID) as HTMLDivElement | null;
  if (tooltip) {
    return tooltip;
  }

  tooltip = document.createElement('div');
  tooltip.id = TOOLTIP_ID;
  tooltip.setAttribute('role', 'tooltip');
  document.body.appendChild(tooltip);

  return tooltip;
}

export function hideTooltip(): void {
  document.getElementById(TOOLTIP_ID)?.classList.remove(TOOLTIP_VISIBLE_CLASS);
}

export function showTooltip(bar: HTMLDivElement): void {
  const label = bar.getAttribute('data-tooltip') || bar.title;
  if (!label) {
    hideTooltip();
    return;
  }

  const tooltip = getTooltipElement();
  const rect = bar.getBoundingClientRect();

  tooltip.textContent = label;
  tooltip.style.left = `${rect.left + rect.width / 2}px`;
  tooltip.style.top = `${Math.max(rect.top, 16)}px`;
  tooltip.classList.add(TOOLTIP_VISIBLE_CLASS);
}

export function removeTooltip(): void {
  document.getElementById(TOOLTIP_ID)?.remove();
}
