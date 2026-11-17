# Comportamiento de Envío

::: info
**Nota**: Esta función está disponible en la versión 1.3.7 y posteriores.
:::

Cambia el atajo de envío a `Ctrl+Enter` (`⌘+Enter` en macOS), convirtiendo `Enter` en una tecla de nueva línea para que puedas componer prompts de varias líneas con tranquilidad.

## Por qué esta función

Por defecto, presionar `Enter` envía el mensaje inmediatamente. Al escribir prompts más largos, pegar código de varias líneas o formatear cuidadosamente tu entrada, esto a menudo provoca envíos accidentales — solo querías una nueva línea, pero el mensaje ya se envió.

Al activar:

- **Enter** → Insertar nueva línea
- **Ctrl+Enter** (macOS: **⌘+Enter**) → Enviar mensaje

Shift+Enter y la composición de IME mantienen el comportamiento propio del sitio, y Ctrl/⌘+Enter espera mientras un adjunto todavía se está subiendo.

## Cómo activar

1. Abre el popup de Voyager.
2. Activa **Entrada** → **Ctrl/Cmd+Enter para enviar**.

## Otros sitios

- **AI Studio** funciona al revés: activa **Enter para enviar en AI Studio** para enviar con `Enter` y añadir una nueva línea con `Ctrl/⌘+Enter`.
- **Claude, ChatGPT, DeepSeek, Kimi y Grok**: abre el popup de Voyager en ese sitio y activa **Enviar con Ctrl/⌘+Enter** en la tarjeta **Complementos**. Los plugins de cada sitio están en [Todos los plugins](/es/guide/plugins).
- **Safari**: si Gemini necesita pulsar Enter dos veces para enviar, activa **Corregir tecla Enter en Safari**.

## Características

- **Cero sobrecarga de rendimiento**: Cuando está desactivado, no hay listeners de eventos de teclado activos — sin impacto en el rendimiento de la página.
- **Cambio instantáneo**: Los cambios surten efecto inmediatamente después de activar en la configuración, sin necesidad de actualizar la página.
