import { createChartFullscreen } from '../chartFullscreen';

/** A Mermaid fullscreen viewer; an owner that unmounts closes it. */
export const createMermaidFullscreen = () => {
  const fullscreen = createChartFullscreen();
  return {
    open(svgHtml: string) {
      fullscreen.open(() => {
        const content = document.createElement('div');
        content.className = 'gv-mermaid-modal-content';
        content.innerHTML = svgHtml;
        return {
          prefix: 'gv-mermaid',
          body: content,
          closeLabel: 'Close (ESC)',
          hint: 'Scroll to zoom • Drag to pan • ESC to close',
          panZoom: {
            content,
            labels: ['Zoom In', 'Zoom Out', 'Reset'],
            fit: () => {
              const svg = content.querySelector('svg');
              if (!svg) return null;
              const width = svg.scrollWidth || svg.clientWidth;
              const height = svg.scrollHeight || svg.clientHeight;
              if (width <= 0 || height <= 0) return null;
              return Math.min(
                Math.max(
                  Math.min((window.innerWidth - 160) / width, (window.innerHeight - 160) / height),
                  0.1,
                ),
                10,
              );
            },
          },
        };
      });
    },
    close: fullscreen.close,
  };
};

const geminiFullscreen = createMermaidFullscreen();

export const openFullscreen = (svgHtml: string) => geminiFullscreen.open(svgHtml);
