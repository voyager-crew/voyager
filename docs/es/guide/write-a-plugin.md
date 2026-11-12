# Escribe tu propio plugin

Para crear un plugin a partir de una frase, consulta [Modo creación](./create-mode.md): la IA del sitio lo escribe, y Voyager lo revisa y lo instala. Esta página cubre los otros dos caminos, encargárselo a un agente de programación en tu ordenador o escribirlo a mano, y las reglas del formato de plugin.

Un plugin local es un plugin que haces para ti. Cambia el aspecto o la disposición de Gemini, AI Studio, ChatGPT, Claude, DeepSeek o Kimi, vive solo en tu navegador y no necesita ninguna pull request ni una copia del código fuente de Voyager.

La mayoría de los plugins son declarativos: un manifest `plugin.json` más CSS, sin código propio. Voyager lo revisa al importarlo, aplica sus cambios y los retira todos cuando lo desactivas. Un plugin importado empieza desactivado, así que puedes revisarlo antes de encenderlo. Cuando una petición necesita código, escribe en su lugar una [creación que ejecuta código](./create-mode.md#creaciones-que-ejecutan-codigo).

Los dos caminos terminan en **Mis creaciones**: abre **Más formas de añadir**, elige **Importar archivos** y selecciona `plugin.json` y `style.css`.

## Copiar para un agente local

Si usas un agente de código (Claude Code, Codex, Cursor y similares), escribe una frase en la pestaña **Crear** del panel o en **Mis creaciones** del popup, elige **Copiar para un agente local** y dale el texto al agente. El texto le pide que siga la skill de plugins de Voyager:

```text
https://voyager.nagi.fun/skills/write-voyager-plugin/SKILL.md
```

La skill contiene el contrato completo: los campos del manifest, lo que declara cada sitio, las primitivas y lo que un plugin no puede hacer. El agente escribe `plugin.json` y `style.css`, ejecuta `npx create-voyager-plugin@latest check` hasta que pasen y te devuelve los dos archivos para que los añadas con **Importar archivos**.

Para tener la skill siempre instalada, guarda el archivo como `write-voyager-plugin/SKILL.md` en la carpeta de skills de tu agente (en Claude Code, `~/.claude/skills/`).

## Escríbelo a mano

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
- En ChatGPT, Claude, DeepSeek y Kimi, activar una primitiva de Voyager (copia de fórmulas, la línea de tiempo, diagramas Mermaid y otras) y cambiar los colores de la propia interfaz de Voyager. En cualquier sitio, las variables `--gv-theme-*` en `:root` cambian los colores de Voyager: consulta [Modo creación](./create-mode.md#cambiar-los-colores-de-voyager).

## Qué no puede hacer

Un plugin declarativo no puede ejecutar JavaScript, reaccionar a clics o teclas, cargar nada desde la red (fuentes, imágenes, hojas de estilo), leer ni reescribir lo que dice un mensaje, ni ejecutarse en otros sitios. Cuando solo el código sirve, escribe en su lugar una creación que ejecuta código. Ninguna creación puede ejecutarse en otros sitios ni cambiar los ajustes de Voyager; ante una petición así, el material de redacción le indica a la IA que lo diga claramente y que construya la versión más cercana que sí funcione.

## Reglas que comprueba la importación

Además de las comprobaciones comunes del manifest (consulta [Contribuir plugins](./plugin-contribution.md)), un plugin local debe:

- coincidir solo con URL dentro de un sitio compatible con Voyager;
- usar solo claves semánticas que declaren todos los sitios con los que coincide;
- añadir exactamente una clase por `addClass`, empezando por `gv-`;
- usar ajustes boolean, number o select (string y color aún no tienen control en el popup);
- no usar `theme` en Gemini ni en AI Studio, y usar solo las primitivas que cada sitio permite: `formulaCopy`, `vimInput`, `userLatex`, `codeCollapse`, `mermaid`, `wavedrom` y `echarts`, `sendShortcut`, `draftSave`, `turnNavigator` en Gemini, `formulaCopy` y `sendShortcut` en AI Studio. Ejecutan el mismo código que los ajustes propios de Voyager. `formulaCopy` y `vimInput` (copiar fórmulas y modo Vim del campo de entrada) se ejecutan una sola vez por página, el ajuste integrado o un plugin, no ambos. Al cargar la página, o mientras ninguno se esté ejecutando, el ajuste integrado va primero; después, el que ya está en marcha sigue funcionando y el otro aparece en pausa. Desactiva uno para que el otro tome el relevo. `userLatex`, `codeCollapse`, `mermaid`, `wavedrom` y `echarts` reclaman la página elemento a elemento y funcionan junto al ajuste integrado: una línea o un bloque de código que el otro ya tiene se le deja a él.

Las traducciones (`i18n`) son opcionales.

### Primitivas de línea de tiempo, envío y borradores

En Gemini para particulares, el `turnNavigator` local ya está disponible con `params.dataBackend: "shared"` y `engine: ">=1.9.0"`. Lee y modifica los mismos datos nativos de estrellas y jerarquía que la línea de tiempo oficial; no se pueden redefinir los parámetros de identidad de la conversación, la cuenta ni los turnos. El ajuste oficial **Mostrar línea de tiempo** entra en conflicto con él: desactívalo antes de activar el plugin local. Para volver a la línea de tiempo oficial, desactiva primero el plugin local y luego activa el ajuste. Business, Enterprise y la cobertura de sitios personalizada no están disponibles.

En todos los sitios solo se ejecuta un plugin de atajo de envío por página. Si uno ya ocupa el modo de envío, otro muestra un conflicto y queda en pausa. El parámetro opcional `mode` (requiere `"engine": ">=1.9.0"`) es `ctrlEnterSends` (predeterminado) o `enterSends`. Confirmar el IME no envía el mensaje. Gemini y AI Studio ya lo permiten; los modos admitidos se describen abajo.

En Gemini, `sendShortcut` puede sustituir el envío oficial Ctrl/Cmd+Enter: desactiva su ajuste y activa el plugin local. Solo admite `ctrlEnterSends`; no se ejecuta en Enterprise. `composerRoot` incluye la entrada principal y la de edición; `sendButton` excluye Detener.

En AI Studio, `sendShortcut` requiere `params.mode: "enterSends"`. Desactiva el envío oficial con Enter para que un plugin local tome el relevo. Ctrl/Cmd+Enter añade una línea; Shift/Alt+Enter lo gestiona el sitio.

En Gemini, `draftSave` comparte los registros oficiales `gvDraft_<pathname completo>`, incluidas las rutas `/u/N` y Gem. Al desactivarlo se conservan los borradores guardados; varios plugins de la página pueden compartirlos. Antes de cerrar intenta guardar la última entrada, pero el cierre del navegador no garantiza que termine el almacenamiento asíncrono. Las escrituras y la limpieza se coordinan solo en esta página; cambiar de correo en la misma posición `/u/N` sigue compartiendo los borradores guardados.
