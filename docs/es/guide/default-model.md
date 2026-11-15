# Modelo Predeterminado

::: info
**Nota**: Esta función es compatible con la versión 1.1.9 y posteriores.
:::

Establece un modelo de Gemini™ preferido como predeterminado para evitar el cambio manual en cada nueva conversación.

<div style="text-align: center; margin-top: 20px;">
  <video src="/assets/default-model.mp4" autoplay loop muted playsinline style="max-width: 100%; border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.1);"></video>
</div>

## Características

- **Configuración Interactiva**: Añade un botón de "Estrella" directamente en el menú nativo de selección de modelos de Gemini.
- **Cambio Automático**: Cambia automáticamente a tu modelo preferido cada vez que inicias una nueva conversación.
- **También el Nivel de Razonamiento**: Cada fila de razonamiento, **Low**, **Medium** y **High**, tiene su propia estrella; si marcas una, los chats nuevos empiezan en ese nivel. Una estrella guardada en la antigua opción **Extended thinking** ahora corresponde a **High**.
- **Preferencia Persistente**: Tu elección se guarda y se sincroniza entre tus dispositivos.
- **Optimizado para SPA**: Se activa con precisión al hacer clic en el botón "Nuevo chat", usar atajos o navegar de regreso a la página de inicio.

## Cómo usar

1. Haz clic en el **Selector de modelos** arriba del área de entrada de Gemini.
2. Pasa el cursor sobre tu modelo preferido y haz clic en el **icono de Estrella**.
3. Una vez que la estrella esté **llena**, ese modelo quedará configurado como predeterminado.
4. La extensión seleccionará automáticamente este modelo para todos los chats nuevos.
5. Para que los chats nuevos empiecen también en un nivel de razonamiento, haz clic en la estrella junto a **Low**, **Medium** o **High** en el mismo menú (en el menú anterior, que solo tiene **Extended thinking**, haz clic en la estrella junto a esa opción).
6. Para deshabilitarlo, simplemente haz clic en el icono de estrella llena nuevamente.

Para pausarlo sin perder tu elección, desactiva **Conversaciones** → **Modelo predeterminado** en el popup de Voyager.
