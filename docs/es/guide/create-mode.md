# Modo creación

Di en una frase cómo debería cambiar un sitio. La propia IA del sitio lo escribe como plugin, y Voyager lo revisa y te lo instala. Sin código y sin salir del chat en el que estás. Funciona en Gemini, AI Studio, ChatGPT, Claude, DeepSeek y Kimi.

El modo creación tiene dos puntos de entrada: la pestaña **Crear** del [panel de Voyager](./panel.md) en la página y la tarjeta **Mis creaciones** del popup de Voyager. Lo que crea es un plugin local que vive solo en tu navegador. Para escribir un plugin tú mismo o encargárselo a un agente de programación, consulta [Escribe tu propio plugin](./write-a-plugin.md).

## Crear en la página

<GuideOp>

La forma más rápida funciona en el sitio de IA para el que es el plugin: abre allí el panel de Voyager y elige **Crear**.

</GuideOp>

<GuideSteps>
<GuideStep>

Escribe una frase en **¿Qué quieres cambiar?**, por ejemplo «Haz mis mensajes más estrechos y oculta la barra lateral», y elige **Crear en esta página**.

</GuideStep>
<GuideStep>

Voyager abre un chat nuevo en ese sitio y pone tu petición en el cuadro de mensaje. Léela y envíala tú: Voyager nunca pulsa enviar. Si el cuadro de mensaje ya tiene texto, Voyager no lo toca y te pide que lo envíes o lo borres antes.

</GuideStep>
<GuideStep>

La IA lee la página de Voyager para el sitio y responde con un único bloque de código JSON. Debajo del bloque, Voyager añade **Revisar e instalar**.

</GuideStep>
<GuideStep>

Elígelo. El panel se abre con una revisión: los sitios donde funciona el plugin, cada cambio, su CSS completo y lo que haya en **Revisa antes**. Elige **Instalar y activar** y se aplica al momento. Puedes desactivarlo cuando quieras en **Funciones**.

</GuideStep>
</GuideSteps>

<GuideOp>

Para cambiar el plugin, díselo a la IA en el mismo chat.

- **Una versión nueva**: bajo su nueva respuesta Voyager ofrece **Revisar actualización** y luego **Actualizar y activar**; el bloque anterior indica **Versión anterior**.
- **Ya instalado**: la versión que instalaste indica **Instalado**.
- **Solo chats de creación**: Voyager solo lee respuestas en un chat donde tu mensaje enlaza la página de creación de Voyager, y la petición de **Crear en esta página** siempre lo hace. En cualquier otro chat no aparece nada bajo las respuestas; usa en su lugar la forma del popup que se explica más abajo.

</GuideOp>

## Añadir la estructura de la página

<GuideOp>

La pestaña **Crear** tiene un solo interruptor: **Añadir cómo está construida esta página, sin nada de su texto, para que la IA escriba para lo que hay aquí**. Viene activado, para que la IA escriba para la página tal como es en lugar de adivinar.

- **Qué añade**: qué elementos de la página reconoce Voyager y cuántos hay, y el árbol de elementos alrededor de la última respuesta y de tu último mensaje.
- **Qué deja fuera**: cualquier texto de la página, los enlaces, tus chats y los valores de atributos que parecen datos, como ids, correos o números largos.
- **Ver lo que se añade**: ábrelo para leer exactamente el texto que se adjuntará. Vuelve a leer la página cuando esta cambia.
- **Desactivado**: si apagas el interruptor, la petición solo lleva tu frase.

</GuideOp>

## El aviso del modelo en Gemini

<GuideOp>

En Gemini, Voyager comprueba primero qué modelo usará el chat nuevo. Si es un modelo más ligero, como Flash o Flash-Lite, la parte superior de la pestaña **Crear** avisa de que ese modelo no suele poder escribir un plugin.

- **Qué sugiere**: el aviso indica un modelo más potente que puedes elegir en el menú de modelos de Gemini, u ofrece pasar la petición a un agente de programación local (**Copiar para un agente local** está en el propio aviso).
- **Volver a comprobar**: después de cambiar de modelo en Gemini, elige **Volver a comprobar**. Voyager también vuelve a comprobarlo cuando regresas al panel.
- **Modelo predeterminado**: si usas [Modelo Predeterminado](./default-model.md), Voyager se fija en el modelo predeterminado que recibirá el chat nuevo.
- **No te bloquea**: es solo un aviso. **Crear en esta página** sigue funcionando.

</GuideOp>

## Cuando una respuesta no se puede instalar

<GuideOp>

No todas las respuestas salen bien. Bajo una respuesta que Voyager no puede instalar, explica el motivo con palabras sencillas, como «No indica en qué sitio funciona» o «Uno de sus cambios no está permitido».

- **Pedir que lo corrija**: elige **Pedir que lo corrija** bajo la respuesta. Voyager pone la lista de problemas en el cuadro de mensaje, después de lo que ya hayas escrito, para que la envíes tú.
- **Cuando esté corregido**: cuando la IA responde con una versión corregida, aparece **Revisar e instalar** debajo.
- **Durante la revisión**: si los problemas solo aparecen en la revisión del panel, Voyager no instala nada y los enumera.

</GuideOp>

## Después de instalar

<GuideOp>

Todo lo que has instalado está en **Mis creaciones**. En el panel es un grupo de la pestaña **Funciones**. En el popup, en Gemini y AI Studio es una tarjeta de ajustes, justo debajo de **Sincronización en Nube** salvo que la muevas, y **Ir a**, arriba del popup, enlaza con ella; en ChatGPT, Claude, DeepSeek y Kimi está debajo de la lista de plugins.

- **Interruptor**: cada creación tiene su fila y se activa y desactiva como cualquier otra función.
- **Eliminar**: elige el icono de la papelera y confirma para quitarla de este navegador. No se puede deshacer.
- **Exportar**: elige **Exportar** en ella dentro de la lista de **Mis creaciones** del popup e importa el archivo JSON en otro navegador.
- **Compartirla**: si puede ser útil para todos, proponla para el catálogo oficial: [Contribuir plugins](./plugin-contribution.md) describe ese camino.

</GuideOp>

### La comprobación automática

<GuideOp>

Al abrirse el panel, Voyager mira si cada creación de **Mis creaciones** hace algo en la página actual.

- **Nada coincide**: una creación que cambia el estilo está activada, pero ningún elemento que modifica está en esta página. Su fila indica **Activado, pero nada en esta página coincide con él**. No cuentan los estados de hover y foco, ni las creaciones que solo activan funciones integradas.
- **Una página bloqueada**: cuando una creación que ejecuta código hizo que la página dejara de responder, Voyager ya la ha desactivado, y su fila explica el motivo.
- **Pedir que lo arregle**: ambos casos ofrecen **Pedir que lo arregle**. Voyager abre un chat nuevo en este sitio y lo rellena con lo que vio en la página y el plugin tal como está instalado (más la estructura de la página mientras ese interruptor esté activado). El panel se cierra para que puedas leerlo y enviarlo.

</GuideOp>

## Cambiar los colores de Voyager

<GuideOp>

Una creación también puede cambiar los colores de la propia interfaz de Voyager en la página, de nuevo con una frase, como «Dale a los paneles y a la línea de tiempo de Voyager una paleta Nord». La IA establece las variables de color públicas de Voyager en una sola regla `:root`, y se aplican igual en modo claro y oscuro.

- **Qué sigue la paleta**: el fondo, el texto, los bordes y el color de hover de paneles, menús, diálogos, tooltips y avisos; el color de acento de botones, selección y foco; el color de peligro para eliminar.
- **La línea de tiempo**: su riel, sus puntos y marcas en reposo y la pista del deslizador izquierdo tienen un color propio.
- **Qué sigue al sitio**: el texto, los bordes y el color de hover que Voyager dibuja directamente sobre la página del sitio, para que nunca quede texto claro sobre el fondo claro del sitio. El popup de Voyager no se ve afectado.

</GuideOp>

<GuideNote>

**Un ejemplo Nord**: la frase anterior suele dar un CSS como este. Una variable que no se define conserva el color propio de Voyager.

```css
:root {
  --gv-theme-surface: #2e3440;
  --gv-theme-hover: #3b4252;
  --gv-theme-text: #eceff4;
  --gv-theme-text-muted: #d8dee9;
  --gv-theme-border: #4c566a;
  --gv-theme-accent: #88c0d0;
  --gv-theme-accent-fg: #2e3440;
  --gv-theme-danger: #bf616a;
  --gv-theme-timeline: #81a1c1;
}
```

Todas las variables: `--gv-theme-surface` (fondo), `-hover` (filas con el puntero encima), `-text` (texto), `-text-muted` (texto secundario, iconos), `-border` (bordes), `-accent` (botones, selección, foco), `-accent-fg` (texto sobre el acento), `-accent-hue` (el tono OKLCH del acento, un número), `-danger` (eliminar), `-timeline` (riel y puntos sobre el fondo del sitio).

</GuideNote>

## Sin el panel: crear desde el popup

<GuideOp>

Para saltarte el chat nuevo, o para que lo escriba otro chat u otra IA, empieza en **Mis creaciones** del popup. **Crea el tuyo**, al final de la lista de plugins, te lleva a su primer campo.

</GuideOp>

<GuideSteps>
<GuideStep>

Escribe una frase en **¿Qué quieres cambiar?**. El campo **Sitio** de debajo empieza con el sitio de tu pestaña actual; cámbialo si el plugin es para otro sitio.

</GuideStep>
<GuideStep>

Elige **Copiar para este chat** y pega el mensaje en el chat de IA de ese sitio. La IA lee la página de Voyager para ese sitio, como `https://voyager.nagi.fun/create/claude.md`, y responde con un único bloque de código JSON. La IA tiene que poder abrir enlaces.

</GuideStep>
<GuideStep>

Pega la respuesta completa en **Pega la respuesta de la IA** y elige **Revisar respuesta**.

</GuideStep>
<GuideStep>

Voyager te explica con palabras sencillas qué cambia el plugin. Elige **Importar** y actívalo en la lista de plugins; en Gemini y AI Studio su interruptor aparece justo debajo de la tarjeta. Un plugin importado así empieza desactivado.

</GuideStep>
</GuideSteps>

<GuideOp>

Por este camino Voyager no envía nada por su cuenta. Tú pegas el mensaje y tú traes la respuesta de vuelta.

</GuideOp>

## Creaciones que ejecutan código

<GuideOp>

Cuando el CSS y los cambios de página no bastan para lo que pediste, por ejemplo contar tus mensajes o reaccionar a un clic, la IA puede escribir una creación que ejecuta JavaScript. Voyager la ejecuta mediante los scripts de usuario de Chrome, solo en los sitios que indica y solo después de que la hayas leído. La revisión marca una creación así con la insignia **Ejecuta código**.

</GuideOp>

### Activarla

<GuideOp>

- **Léela**: la revisión muestra los sitios donde se ejecuta y su código fuente completo. Puede leer todo lo que hay en esas páginas, tus chats incluidos, y Voyager no puede impedir que envíe a otro lugar lo que lee, así que instala solo código en el que confíes.
- **Instalar y activar**: activa exactamente el código que leíste. Si más adelante cambian su código o sus sitios, queda en pausa hasta que la revises de nuevo, y el interruptor nunca se sincroniza con tus otros dispositivos.
- **Interruptor único**: Chrome solo deja que una extensión ejecute este código después de que lo permitas. Elige **Abrir la página de detalles de Voyager**, activa allí **Permitir scripts de usuario** (Allow User Scripts; antes de Chrome 138, el **Modo de desarrollador** arriba en `chrome://extensions`), vuelve y elige **Ya lo activé**.
- **Navegadores**: Chrome o Edge de escritorio 133 o posterior. En Safari, Firefox y móviles queda instalada pero en pausa; pide a la IA una versión que solo cambie el aspecto de la página.

</GuideOp>

### Mantener el control

<GuideOp>

En **Mis creaciones**, cada creación que ejecuta código muestra **Activada, solo en este dispositivo**, **Desactivada** o **En pausa** con el motivo.

- **Detener todo**: **Detener todas las creaciones que ejecutan código**, al final de **Mis creaciones** (la tarjeta del popup o la pestaña **Funciones** del panel), las detiene todas a la vez; **Reanudar** las vuelve a iniciar.
- **Páginas abiertas**: una página que ya está abierta las sigue ejecutando hasta que se recarga. **Recargar esta página** lo hace con la pestaña actual.
- **Bloqueos**: si una página deja de responder después de que estas creaciones se ejecutaran en ella, Voyager las desactiva y las nombra en un aviso la próxima vez que se cargue la página. Cuando la creación esté corregida, revísala en **Mis creaciones** y vuelve a activarla.

</GuideOp>

## Qué puede y qué no puede hacer

<GuideOp>

La mayoría de las creaciones solo cambian el aspecto y la disposición de la página, no ejecutan código propio y deshacen todos sus cambios cuando las desactivas.

- **Puede**: cambiar el estilo de la página, ocultar partes de ella, añadir interruptores y deslizadores a los ajustes, cambiar los colores de Voyager y, en los sitios de plugins, activar las funciones integradas de Voyager (copia de fórmulas, la línea de tiempo, diagramas Mermaid y otras).
- **Necesita código**: reaccionar a clics, contar cosas o leer la página requiere una creación que ejecuta código, descrita más arriba.
- **Ninguna creación puede**: ejecutarse en otros sitios ni cambiar los ajustes de Voyager. Ante una petición así, la IA lo dice y construye la versión más cercana que sí funcione.
- **Las reglas completas**: qué campos puede usar un plugin y qué comprueba la importación se explican en [Escribe tu propio plugin](./write-a-plugin.md#que-puede-hacer-un-plugin).

</GuideOp>
