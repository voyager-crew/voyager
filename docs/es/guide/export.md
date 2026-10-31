# Libertad Total

Voyager Export te permite descargar cualquier conversación de Gemini, ChatGPT, Claude, DeepSeek o Kimi como archivo Markdown, PDF, JSON o imagen. Extrae el contenido completo del chat, incluidos los bloques de código, las imágenes y el formato, y te da una copia permanente y portátil de cada conversación con IA que tengas.

Los datos bloqueados son la peor experiencia.
Nuestro credo es simple: lo que creas, es tuyo.

## Comparativa de formatos

| Característica    | Markdown                             | PDF                        | JSON                               | Imagen                   |
| ----------------- | ------------------------------------ | -------------------------- | ---------------------------------- | ------------------------ |
| Ideal para        | Apps de notas (Obsidian, Notion)     | Compartir e imprimir       | Desarrolladores, análisis de datos | Compartir en el móvil    |
| Imágenes          | Incrustadas                          | Incluidas por completo     | Codificadas en Base64              | Renderizadas en su lugar |
| Bloques de código | Se conserva el resaltado de sintaxis | Renderizados visualmente   | Se conserva el texto sin formato   | Renderizados visualmente |
| Tamaño            | El más pequeño                       | El más grande              | Medio                              | Grande                   |
| Búsqueda          | Texto plano                          | Búsqueda del lector de PDF | Acceso programático                | No                       |

## Llévatelo Todo

Voyager te ayuda a bajar tus datos de la nube a tu palma.

### Elige tu Formato

- **Markdown**: Para usar en Obsidian o Notion. Limpio, con formato e imágenes integradas.
- **PDF**: Para enviar a otros o imprimir. Maquetación hermosa, texto e imágenes.
- **JSON**: Para desarrolladores. Datos brutos, juega con ellos como quieras.
- **Imagen**: Un PNG largo, ideal para compartir en el móvil. Elige un diseño estrecho, medio o ancho.

### Cómo Exportar

1. Haz clic en el botón **Exportar** (ChatGPT, Claude, DeepSeek, Kimi y los diseños actuales de Gemini). Empieza en la esquina superior derecha de la página; puedes arrastrarlo a cualquier sitio, cada sitio recuerda su posición y, si lo sueltas cerca de la posición original, vuelve a ella. En Gemini también puedes elegir **Exportar historial de conversación** en el menú ⋮ de una conversación o de una respuesta; en los diseños antiguos de Gemini, pasa el ratón sobre el logo de Gemini para ver el **icono de exportación**.
2. Elige el formato.
3. Llévatelo.

En Claude, DeepSeek y Kimi, la exportación es un complemento desactivado por defecto: actívalo primero en **Complementos** en el popup. Voyager recorre las conversaciones largas desplazándose para leerlas enteras y después empieza con todos los mensajes seleccionados; desmarca los que no quieras. Si no puede confirmar el principio y el final, avisa de que la exportación puede estar incompleta. En ChatGPT, si no puede leer el historial completo, lo indica y te pide que te desplaces hacia arriba para cargar los mensajes anteriores y vuelvas a intentarlo. Cambiar a otro chat detiene la exportación, igual que empezar una nueva respuesta en Claude.

Los archivos subidos en una conversación de ChatGPT aparecen en la exportación como una línea `📎 nombre del archivo`.

Tus datos, tus reglas.

<div style="display: flex; gap: 20px; margin-top: 20px;">
  <div style="flex: 1; text-align: center;">
    <p><b>1. Busca Exportar</b></p>
    <img src="/assets/gemini-export-guide-1.png" alt="Guía de exportación paso 1" style="border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);"/>
  </div>
  <div style="flex: 1; text-align: center;">
    <p><b>2. Elige el formato</b></p>
    <img src="/assets/gemini-export-guide-2.png" alt="Guía de exportación paso 2" style="border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);"/>
  </div>
</div>

### Nota sobre la exportación a PDF en Safari

La exportación a PDF en Safari requiere un proceso ligeramente diferente (impresión manual):

1. Haz clic en el botón **Exportar** y selecciona el formato PDF.
2. **Espera aproximadamente un segundo** (para que la página prepare los estilos de impresión).
3. Presiona `Command + P` para abrir el cuadro de diálogo de impresión.
4. Selecciona **"Guardar como PDF"** (Save to PDF) en el cuadro de diálogo de impresión.

<img src="/assets/safari-export-pdf.png" alt="Safari Export PDF" style="max-width: 100%; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1); margin-top: 20px;"/>

## Exportación de Deep Research

El modo Deep Research de Gemini genera informes estructurados con fuentes, pasos de razonamiento y citas. Voyager puede exportar estas sesiones con todos sus metadatos intactos:

1. Abre una conversación de Deep Research que ya esté terminada.
2. Abre el menú **Compartir y exportar** del informe y elige **Save Report**.
3. Elige el formato.
4. La exportación incluye el informe final con sus enlaces a las fuentes. Para guardar también el proceso de pensamiento, consulta [Exportación de Deep Research](/es/guide/deep-research).

Esto resulta útil en investigación académica, análisis de la competencia y documentación técnica, cuando necesitas conservar la cadena de razonamiento y la atribución de las fuentes.

## Cuándo exportar

- **Archivo de conocimiento**: Guarda las conversaciones importantes antes de que queden enterradas en tu historial de chat.
- **Compartir con el equipo**: Exporta una sesión de depuración a PDF para enviarla a compañeros que no usan Gemini.
- **Crear una base de conocimiento**: Exporta las conversaciones en Markdown y organízalas en Obsidian o Notion.
- **Análisis de datos**: Usa las exportaciones JSON para analizar patrones de conversación de forma programática o extraer datos estructurados.
- **Cumplimiento y auditoría**: Conserva registros de las decisiones tomadas con ayuda de la IA para tener pistas de auditoría.

## Plataformas compatibles

La exportación funciona en Gemini y ChatGPT en Chrome, Edge, Firefox, Safari, Opera y Brave. En Claude, DeepSeek y Kimi, la exportación es un complemento desactivado por defecto que se activa en **Complementos**. En Safari, la exportación a PDF usa un paso de impresión manual (Command+P después de hacer clic en exportar); las exportaciones a Markdown y JSON siguen incluyendo imágenes.
