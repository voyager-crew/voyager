# Respuesta con Cita

Voyager ofrece una conveniente función de "Respuesta con Cita", haciendo que responder a contenido específico sea más preciso y eficiente.

## Introducción

En las conversaciones diarias, a menudo necesitamos hacer preguntas de seguimiento o refutar una parte específica de la salida de la IA. El método tradicional es copiar ese texto y luego escribir manualmente el símbolo `> ` en el cuadro de entrada, lo cual es muy tedioso.

Voyager simplifica este proceso:

1. **Selecciona y Cita**: En la página de conversación (ya sea tu pregunta o la respuesta de Gemini), selecciona cualquier texto con el ratón.
2. **Botón Flotante**: Aparecerá automáticamente un botón de "Responder cita" cerca del texto seleccionado.
3. **Inserción en un Clic**: Haz clic en el botón, y el texto seleccionado se insertará automáticamente en tu cuadro de entrada con el formato de cita estándar de Markdown (`> contenido`).

![Respuesta con Cita](/assets/quote-reply.png)

## Cómo Activarla

Gemini ya incluye su propia función de respuesta con cita, por lo que la de Voyager está desactivada por defecto en Gemini. Puedes activarla en **Entrada** → **Responder cita** en el popup de Voyager.

En Claude, ChatGPT, DeepSeek y Kimi, abre el popup de Voyager en ese sitio y activa **Citar respuestas** en la tarjeta **Complementos** (en [Todos los plugins](/es/guide/plugins) verás los plugins de cada sitio). Después, el botón "Citar" aparece cuando seleccionas texto dentro de una única respuesta del asistente, y la cita se añade a tu borrador sin enviar nada.

## Características

- **Conciencia de Contexto**: Identifica inteligentemente el contenido de la conversación, evitando disparadores falsos en áreas irrelevantes (como el propio cuadro de entrada).
- **Formato Estándar**: Utiliza la sintaxis universal de Markdown, que Gemini entiende perfectamente, permitiendo respuestas más precisas.
- **Soporte Multilínea**: Si seleccionas varias líneas de texto, Voyager agregará automáticamente símbolos de cita a cada línea, manteniendo el formato limpio.

## Consejos de Uso

- **Preguntar Detalles**: Selecciona un concepto poco claro en la respuesta de Gemini, haz clic en citar y luego escribe "Por favor, explica este concepto en detalle".
- **Corregir Errores**: Selecciona código o hechos incorrectos en la respuesta, cita y señala "Esto es incorrecto, debería ser...".
