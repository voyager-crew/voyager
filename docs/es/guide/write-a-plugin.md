# Escribe tu propio plugin

El modo creación convierte una frase en un plugin. Dices qué quieres cambiar, una IA escribe el plugin y Voyager lo revisa antes de que lo importes. El modo creación está en la pestaña **Crear** del panel de Voyager y en la tarjeta **Mis creaciones** del popup de Voyager, y lo que crea es un plugin local.

Un plugin local es un plugin que haces para ti. Cambia el aspecto o la disposición de Gemini, AI Studio, ChatGPT, Claude, DeepSeek o Kimi, vive solo en tu navegador y no necesita ninguna pull request ni una copia del código fuente de Voyager.

La mayoría de las creaciones son declarativas: un manifest `plugin.json` más CSS, sin código propio. Voyager lo revisa al importarlo, aplica sus cambios y los retira todos cuando lo desactivas. Un plugin importado empieza desactivado, así que puedes revisarlo antes de encenderlo. Cuando una petición necesita código, la IA puede escribir en su lugar una creación que ejecuta código, descrita más abajo.

## Crear en la página

La forma más rápida funciona en el sitio de IA para el que es el plugin. Abre allí el [panel de Voyager](./panel.md) y elige **Crear**.

1. Escribe una frase en **¿Qué quieres cambiar?** y elige **Crear en esta página**.
2. Voyager abre un chat nuevo en ese sitio y pone la petición en el cuadro de mensaje. Léela y envíala tú: Voyager nunca pulsa enviar. Si el cuadro de mensaje ya tiene texto, Voyager no lo toca y te lo dice.
3. La IA lee la página de Voyager para el sitio y responde con un único bloque de código JSON. Debajo del bloque, Voyager añade **Revisar e instalar**.
4. Elígelo. El panel se abre con una revisión: los sitios donde funciona el plugin, cada cambio, su CSS completo y lo que conviene comprobar antes. Elige **Instalar y activar** y se aplica al momento.

Para cambiar el plugin, díselo a la IA en el mismo chat. Bajo su nueva respuesta Voyager ofrece **Revisar actualización**, y el bloque anterior indica **Versión anterior**. Cuando Voyager no puede instalar una respuesta, ofrece en su lugar **Devolver los problemas a la IA**: los problemas van al cuadro de mensaje, debajo de lo que hayas escrito, para que los envíes tú.

Voyager solo lee respuestas en un chat donde tu mensaje enlaza la página de creación de Voyager, y la petición de **Crear en esta página** siempre lo hace. En cualquier otro chat no aparece nada bajo las respuestas; usa las formas del popup que siguen. La pestaña **Crear** también tiene **Copiar para un agente local**.

## Otras tres formas

Las tres formas terminan en **Mis creaciones**. En Gemini y AI Studio es una tarjeta de ajustes, justo debajo de **Sincronización en Nube** salvo que la muevas, y **Ir a**, arriba del popup, enlaza con ella. En ChatGPT, Claude, DeepSeek y Kimi está debajo de la lista de plugins. **Crea el tuyo**, al final de la lista de plugins, te lleva a su primer campo.

Las dos primeras formas parten de una frase. Escríbela en **¿Qué quieres cambiar?** («Haz mis mensajes más estrechos y oculta la barra lateral»). El campo **Sitio** de debajo empieza con el sitio de tu pestaña actual; cámbialo si el plugin es para otro sitio.

### Copiar para este chat

1. Elige **Copiar para este chat** y pega el mensaje en el chat de IA de ese sitio.
2. La IA lee la página de Voyager para ese sitio, como `https://voyager.nagi.fun/create/claude.md`, y responde con un único bloque de código JSON. La IA tiene que poder abrir enlaces.
3. Pega la respuesta completa en **Pega la respuesta de la IA** y elige **Revisar respuesta**.
4. Voyager te explica con palabras sencillas qué cambia el plugin. Elige **Importar** y actívalo en la lista de plugins. En Gemini y AI Studio su interruptor aparece justo debajo de la tarjeta.

Voyager no envía nada por su cuenta. Tú pegas el mensaje y tú traes la respuesta de vuelta.

### Copiar para un agente local

Si usas un agente de código (Claude Code, Codex, Cursor y similares), elige **Copiar para un agente local** y dale el texto al agente. El texto le pide que siga la skill de plugins de Voyager:

```text
https://voyager.nagi.fun/skills/write-voyager-plugin/SKILL.md
```

La skill contiene el contrato completo: los campos del manifest, lo que declara cada sitio, las primitivas y lo que un plugin no puede hacer. El agente escribe `plugin.json` y `style.css`, ejecuta `npx create-voyager-plugin@latest check` hasta que pasen y te devuelve los dos archivos. En **Mis creaciones**, abre **Más formas de añadir**, elige **Importar archivos** y selecciona los dos archivos.

Para tener la skill siempre instalada, guarda el archivo como `write-voyager-plugin/SKILL.md` en la carpeta de skills de tu agente (en Claude Code, `~/.claude/skills/`).

### Escríbelo a mano

Con Node.js 18 o posterior:

```sh
npx create-voyager-plugin@latest init my-plugin --site claude
# edita my-plugin/plugin.json y my-plugin/style.css
npx create-voyager-plugin@latest check my-plugin
```

`init` genera un `plugin.json` y un `style.css` que ya pasan las comprobaciones, además de un `AGENTS.md` con las reglas de ese sitio. `--site` acepta `gemini`, `aistudio`, `chatgpt`, `claude`, `deepseek` o `kimi`.

`check` ejecuta sin conexión las mismas comprobaciones que la importación del popup. Termina con código 0 cuando el plugin se podría importar y, si no, imprime una línea `path: message` por cada problema. Añade `--json` para obtener una salida legible por máquinas.

Cuando pase, importa los dos archivos del mismo modo, con **Importar archivos** dentro de **Más formas de añadir**.

## Qué puede hacer un plugin

- Añadir CSS, acotado bajo una clase `gv-` que el plugin añade a la página.
- Añadir una clase, establecer un atributo seguro o un estilo en línea, u ocultar elementos. Los objetivos son claves semánticas que declara el sitio (`userTurn`, `assistantTurn`, `composer`…) o selectores CSS.
- Ofrecer ajustes en el popup: interruptores, controles deslizantes y desplegables, cuyos valores llegan al CSS mediante tokens `{{key}}`.
- En ChatGPT, Claude, DeepSeek y Kimi, activar una primitiva de Voyager (copia de fórmulas, la línea de tiempo, diagramas Mermaid y otras) y cambiar los colores de la propia interfaz de Voyager.

## Qué no puede hacer

Un plugin declarativo no puede ejecutar JavaScript, reaccionar a clics o teclas, cargar nada desde la red (fuentes, imágenes, hojas de estilo), leer ni reescribir lo que dice un mensaje, ni ejecutarse en otros sitios. Cuando solo el código sirve, la IA escribe una creación que ejecuta código, descrita más abajo. Ninguna creación puede ejecutarse en otros sitios ni cambiar los ajustes de Voyager; ante una petición así, el material de redacción le indica a la IA que lo diga claramente y que construya la versión más cercana que sí funcione.

## Creaciones que ejecutan código

Cuando el CSS y los cambios de página no bastan, por ejemplo para contar tus mensajes o reaccionar a un clic, la IA puede escribir una creación que ejecuta JavaScript. Voyager la ejecuta como script de usuario de Chrome, solo en los sitios que indica y solo después de que hayas leído su código.

### Activarla

La revisión marca una creación así con la insignia **Ejecuta código**.

- **Léela**: la revisión muestra los sitios donde se ejecuta y su código fuente completo. Puede leer todo lo que hay en esas páginas, y Voyager no puede impedir que envíe a otro lugar lo que lee, así que instala solo código en el que confíes.
- **Instalar y activar**: activa exactamente el código que leíste. Una versión posterior de la IA queda desactivada hasta que la revises de nuevo, y el interruptor nunca se sincroniza con tus otros dispositivos.
- **Interruptor único**: Chrome solo deja que una extensión ejecute este código después de que lo permitas. Elige **Abrir la página de detalles de Voyager**, activa allí **Permitir scripts de usuario** (Allow User Scripts; antes de Chrome 138, el **Modo de desarrollador** arriba en `chrome://extensions`), vuelve y elige **Ya lo activé**.
- **Navegadores**: Chrome o Edge de escritorio 133 o posterior. En Safari, Firefox y móviles queda instalada pero en pausa; pide a la IA una versión que solo cambie el aspecto de la página.

### Mantener el control

En **Mis creaciones**, cada una muestra **Activada, solo en este dispositivo**, **Desactivada** o **En pausa** con el motivo.

- **Detener todo**: **Detener todas las creaciones que ejecutan código**, al final de **Mis creaciones** (la tarjeta del popup o la pestaña **Funciones** del panel), las detiene todas a la vez; **Reanudar** las vuelve a iniciar.
- **Páginas abiertas**: una página que ya está abierta las sigue ejecutando hasta que se recarga. **Recargar esta página** lo hace con la pestaña actual.
- **Bloqueos**: si una página deja de responder después de que estas creaciones se ejecutaran en ella, Voyager las desactiva y las nombra en un aviso la próxima vez que se cargue la página. Cuando esté corregida, revísala en **Mis creaciones** y vuelve a activarla.

## Reglas que comprueba la importación

Además de las comprobaciones comunes del manifest (consulta [Contribuir plugins](./plugin-contribution.md)), un plugin local debe:

- coincidir solo con URL dentro de un sitio compatible con Voyager;
- usar solo claves semánticas que declaren todos los sitios con los que coincide;
- añadir exactamente una clase por `addClass`, empezando por `gv-`;
- usar ajustes boolean, number o select (string y color aún no tienen control en el popup);
- no usar `theme` en Gemini ni en AI Studio, y usar solo las primitivas que cada sitio permite: `formulaCopy`, `vimInput`, `userLatex`, `codeCollapse`, `mermaid`, `wavedrom` y `echarts`, `sendShortcut`, `draftSave`, `turnNavigator` en Gemini, `formulaCopy` y `sendShortcut` en AI Studio. Ejecutan el mismo código que los ajustes propios de Voyager. `formulaCopy` y `vimInput` (copiar fórmulas y modo Vim del campo de entrada) se ejecutan una sola vez por página, el ajuste integrado o un plugin, no ambos. Al cargar la página, o mientras ninguno se esté ejecutando, el ajuste integrado va primero; después, el que ya está en marcha sigue funcionando y el otro aparece en pausa. Desactiva uno para que el otro tome el relevo. `userLatex`, `codeCollapse`, `mermaid`, `wavedrom` y `echarts` reclaman la página elemento a elemento y funcionan junto al ajuste integrado: una línea o un bloque de código que el otro ya tiene se le deja a él.

En Gemini para particulares, el `turnNavigator` local ya está disponible con `params.dataBackend: "shared"` y `engine: ">=1.9.0"`. Lee y modifica los mismos datos nativos de estrellas y jerarquía que la línea de tiempo oficial; no se pueden redefinir los parámetros de identidad de la conversación, la cuenta ni los turnos. El ajuste oficial **Mostrar línea de tiempo** entra en conflicto con él: desactívalo antes de activar el plugin local. Para volver a la línea de tiempo oficial, desactiva primero el plugin local y luego activa el ajuste. Business, Enterprise y la cobertura de sitios personalizada no están disponibles.

Las traducciones (`i18n`) son opcionales.

## Compartirlo

Un plugin local se queda en tu navegador. Para llevarlo a otro lugar, elige **Exportar** en él dentro de la lista de **Mis creaciones** y luego importa allí el archivo JSON. Si puede ser útil para todos, proponlo para el catálogo oficial: [Contribuir plugins](./plugin-contribution.md) describe ese camino.

En todos los sitios solo se ejecuta un plugin de atajo de envío por página. Si uno ya ocupa el modo de envío, otro muestra un conflicto y queda en pausa. El parámetro opcional `mode` (requiere `"engine": ">=1.9.0"`) es `ctrlEnterSends` (predeterminado) o `enterSends`. Confirmar el IME no envía el mensaje. Gemini y AI Studio ya lo permiten; los modos admitidos se describen abajo.

En Gemini, `sendShortcut` puede sustituir el envío oficial Ctrl/Cmd+Enter: desactiva su ajuste y activa el plugin local. Solo admite `ctrlEnterSends`; no se ejecuta en Enterprise. `composerRoot` incluye la entrada principal y la de edición; `sendButton` excluye Detener.

En AI Studio, `sendShortcut` requiere `params.mode: "enterSends"`. Desactiva el envío oficial con Enter para que un plugin local tome el relevo. Ctrl/Cmd+Enter añade una línea; Shift/Alt+Enter lo gestiona el sitio.

En Gemini, `draftSave` comparte los registros oficiales `gvDraft_<pathname completo>`, incluidas las rutas `/u/N` y Gem. Al desactivarlo se conservan los borradores guardados; varios plugins de la página pueden compartirlos. Antes de cerrar intenta guardar la última entrada, pero el cierre del navegador no garantiza que termine el almacenamiento asíncrono. Las escrituras y la limpieza se coordinan solo en esta página; cambiar de correo en la misma posición `/u/N` sigue compartiendo los borradores guardados.
