# Copia de Fórmulas

Voyager facilita enormemente la reutilización de fórmulas matemáticas y símbolos científicos. Haz clic en una fórmula para copiarla como LaTeX, como MathML listo para Word o como bloque compatible con Notion.

## Introducción

Cuando le pides a Gemini que derive fórmulas o escriba expresiones matemáticas, normalmente las representa usando LaTeX. Aunque es visualmente atractivo, extraer el código fuente para usarlo en tus propios artículos, documentos o editores a menudo requiere un esfuerzo manual.

Voyager proporciona un soporte fluido para esto:

1. **Detección Automática**: Voyager identifica automáticamente las fórmulas representadas en la página. Al pasar el cursor sobre una, se ve que se puede hacer clic.
2. **Clic para Copiar**: Haz clic en una fórmula en línea o en bloque y se copia de inmediato, con una breve confirmación.
3. **Elige un Formato**: En el popup, activa **Contenido de las respuestas** → **Copia de fórmulas** y elige el formato de copia debajo de la fila:
   - **LaTeX**: Código fuente LaTeX estándar con delimitadores de signo de dólar, ideal para Overleaf, editores de Markdown, etc.
   - **LaTeX (Sin signo de dólar)**: El código LaTeX sin delimitadores, para editores que añaden los suyos propios.
   - **MathML (Word)**: El mejor formato para pegar directamente en **Microsoft Word**.
   - **Notion ($$ Formato)**: Envuelve cada fórmula en `$$`, que Notion convierte en una ecuación.

![Copia de Fórmulas](/assets/gemini-math-copy.png)

## Características

- **Compatibilidad con Word**: Con el soporte de MathML, puedes pegar fórmulas complejas generadas por IA directamente en documentos de Word manteniendo un formato editable perfecto.
- **Preservación del Contexto**: No solo copia la fórmula en sí, sino que también preserva su contexto matemático.
- **Respuesta Instantánea**: Procesado completamente de forma local para obtener resultados inmediatos.

## Consejos de Uso

- **Escritura Académica**: Al escribir artículos en Word, haz que Gemini derive fórmulas y luego usa copiar y pegar en MathML para evitar la molestia de la entrada manual en el Editor de ecuaciones de Word.
- **Toma de Notas**: Al tomar notas en Obsidian o Notion, simplemente copia la fuente LaTeX directamente.

## Dónde funciona

En Gemini y AI Studio, actívala con **Contenido de las respuestas** → **Copia de fórmulas** en el popup; el formato de copia aparece debajo de esa fila cuando está activada. Ese interruptor y el formato de copia se aplican a ambos sitios. En Claude, ChatGPT, DeepSeek y Grok, la copia de fórmulas es un plugin: abre el popup en ese sitio y activa **Copia de fórmulas** en la tarjeta **Complementos**. Los plugins de cada sitio están en [Todos los plugins](/es/guide/plugins).
