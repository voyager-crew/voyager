# Modo creación

Di en una frase cómo quieres que cambie un sitio, por ejemplo «haz mis mensajes más estrechos». La IA de ese sitio hace el cambio por ti, y Voyager lo revisa antes de instalarlo. No necesitas saber programar y no sales de la página. Funciona en Gemini, AI Studio, ChatGPT, Claude, DeepSeek y Kimi.

Lo que haces se llama una creación. Es un plugin pequeño que se queda solo en este navegador. Puedes apagarla o borrarla cuando quieras.

<GuideHero src="/assets/create-mode-hero-en-light.png" dark="/assets/create-mode-hero-en-dark.png" alt="El panel de Voyager abierto en un sitio de IA, en la pestaña Crear, con una petición de una frase escrita">

El modo creación tiene dos entradas: la pestaña **Crear** del [panel de Voyager](./panel.md) en la página, y la tarjeta **Mis creaciones** del popup de Voyager (la ventana que se abre al hacer clic en el icono de Voyager en la barra de herramientas del navegador).

</GuideHero>

## Crear en la página

<GuideOp>

Lo más rápido es hacerlo en el mismo sitio de IA que quieres cambiar. Abre allí el panel de Voyager y elige **Crear**.

<GuideShot kind="panel" src="/assets/create-mode-ask-en.png" alt="La pestaña Crear: el cuadro para una frase, el interruptor de la estructura de la página y los botones para copiar a un agente local y crear en esta página" :width="632" />

</GuideOp>

<GuideSteps>
<GuideStep>

Escribe una frase en **¿Qué quieres cambiar?**, por ejemplo «Haz mis mensajes más estrechos y oculta la barra lateral». Luego elige **Crear en esta página**.

</GuideStep>
<GuideStep>

Voyager abre un chat nuevo en ese sitio y escribe tu petición en el cuadro de mensaje. Léela y pulsa enviar tú. Voyager nunca envía nada por ti. Si el cuadro ya tiene texto, Voyager no lo toca. Te pide que lo envíes o lo borres antes.

</GuideStep>
<GuideStep>

Cuando la IA responde, aparece debajo un botón de Voyager: **Revisar e instalar**.

<GuideShot src="/assets/create-mode-reply-en.png" alt="El botón Revisar e instalar de Voyager, bajo una respuesta de la IA" :width="267" />

</GuideStep>
<GuideStep>

Elígelo. El panel te muestra qué cambiará la creación, en qué sitios funciona y lo que haya en **Revisa antes**. Si te parece bien, elige **Instalar y activar**, y el cambio aparece al momento. Si ya no la quieres, apágala en la pestaña **Funciones** del panel.

<GuideShot kind="panel" src="/assets/create-mode-review-en.png" alt="La revisión en el panel: nombre de la creación, sus sitios, qué cambia, lo que conviene revisar y el botón para instalar y activar" :width="632" />

</GuideStep>
</GuideSteps>

<GuideOp>

Para cambiarla otra vez, sigue hablando con la IA en el mismo chat.

- **Una versión nueva**: aparece **Revisar actualización** debajo de la nueva respuesta de la IA. Revísala y elige **Actualizar y activar**. Las respuestas anteriores indican **Versión anterior**.
- **Ya instalada**: la respuesta que instalaste indica **Instalado**.
- **Solo en estos chats**: los botones solo aparecen en un chat que empezaste con **Crear en esta página**. Para cualquier otro chat, usa «Crear desde el popup», más abajo.

</GuideOp>

## Deja que la IA vea la página

<GuideOp>

La pestaña **Crear** tiene un solo interruptor: **Añadir cómo está construida esta página, sin nada de su texto, para que la IA escriba para lo que hay aquí**. Viene activado.

- **Qué añade**: cómo está organizada la página, es decir, qué botones, cuadros y zonas de mensajes tiene y dónde están. Así la IA no tiene que adivinar.
- **Qué nunca añade**: ningún texto de la página, tampoco tus chats, ni direcciones web ni datos de tu cuenta.
- **Míralo tú**: elige **Ver lo que se añade** para ver todo lo que se enviará a la IA.
- **Si no lo quieres**: apaga el interruptor, y la petición solo lleva tu frase.

<GuideShot kind="panel" src="/assets/create-mode-structure-en.png" alt="Lo que se adjunta, desplegado: la estructura de la página como nombres y cantidades de sus partes, sin texto" :width="612" />

</GuideOp>

## El aviso del modelo en Gemini

<GuideOp>

Gemini tiene varios modelos para elegir. Flash y Flash-Lite son más ligeros y normalmente no consiguen hacer una creación que funcione. Si el chat nuevo va a usar uno de ellos, la parte de arriba de la pestaña **Crear** te avisa.

- **Qué hacer**: el aviso te dice un modelo mejor. Cámbialo en el menú de modelos de Gemini y elige **Volver a comprobar**.
- **Otra opción**: elige **Copiar para un agente local** en el aviso para pasarle el trabajo a un asistente de programación de tu ordenador. Consulta [Escribe tu propio plugin](./write-a-plugin.md).
- **No te frena**: es solo un aviso. **Crear en esta página** sigue funcionando.

<GuideShot kind="panel" src="/assets/create-mode-model-en.png" alt="El aviso arriba de la pestaña Crear de que Flash de Gemini no suele escribir un plugin, con los botones para comprobar de nuevo y copiar a un agente local" :width="616" />

</GuideOp>

## Cuando no se puede instalar

<GuideOp>

La IA no siempre acierta a la primera. Cuando falla, una línea debajo de la respuesta explica por qué, por ejemplo «No indica en qué sitio funciona».

- **Pedir que lo corrija**: elige **Pedir que lo corrija** debajo de la respuesta. Voyager escribe los problemas en el cuadro de mensaje, y tú pulsas enviar.
- **Cuando esté corregida**: cuando la IA mande una versión corregida, vuelve a aparecer **Revisar e instalar** debajo.
- **Mientras tanto no cambia nada**: una creación que no se instaló no toca tu página.

<GuideShot src="/assets/create-mode-rejected-en.png" alt="La línea bajo una respuesta de la IA que dice que el plugin no se puede instalar porque no indica el sitio, con el botón Pedir que lo corrija" :width="624" />

</GuideOp>

## Después de instalar

<GuideOp>

Todo lo que instalaste está en **Mis creaciones**.

- **En el panel**: el grupo **Mis creaciones** de la pestaña **Funciones**. Cada creación tiene su fila con su propio interruptor.
- **En el popup**: en Gemini y AI Studio es una tarjeta, debajo de **Sincronización en Nube** salvo que la muevas. **Ir a**, arriba del popup, te lleva hasta ella. En los demás sitios está debajo de la lista de plugins.
- **Borrar**: elige el icono de la papelera en su fila y confirma. No se puede deshacer.
- **Llevarla a otro navegador**: en **Mis creaciones** del popup, elige **Exportar** en ella y obtendrás un archivo. Importa ese archivo en el otro navegador.
- **Compartirla con todos**: si puede ayudar a otros, puedes proponerla para Voyager. [Contribuir plugins](./plugin-contribution.md) explica cómo.

</GuideOp>

### La comprobación automática

<GuideOp>

Cada vez que abres el panel, Voyager mira si tus creaciones hacen algo en la página actual.

- **No funciona aquí**: si una creación está activada pero no encuentra nada que cambiar en esta página, su fila indica **Activado, pero nada en esta página coincide con él**. Suele pasar cuando el sitio cambia de diseño.
- **Bloqueó la página**: si una creación que ejecuta código dejó la página congelada, Voyager ya la apagó, y su fila explica por qué.
- **Pedir que lo arregle**: en los dos casos aparece **Pedir que lo arregle**. Elígelo, y Voyager abre un chat nuevo con el problema ya escrito. El panel se cierra para que lo leas y pulses enviar.

<GuideShot kind="panel" src="/assets/create-mode-creations-en.png" alt="Mis creaciones en la pestaña Funciones: una creación está activa pero nada en esta página coincide, con el botón Pedir que lo arregle" :width="414" />

</GuideOp>

## Cambiar los colores de Voyager

<GuideOp>

Una creación también puede cambiar los colores del propio Voyager. Solo tienes que pedirlo, por ejemplo «pon Voyager con los colores de Nord».

- **Qué cambia**: los paneles, menús, ventanas, mensajes emergentes y la línea de tiempo de Voyager, en modo claro y en modo oscuro.
- **Qué se queda igual**: los colores del propio sitio, y el texto que Voyager pone directamente en la página del sitio, para que nunca se confunda con el fondo. El popup de Voyager no cambia.
- **Para volver atrás**: apaga la creación y vuelven los colores de antes.

</GuideOp>

## Crear desde el popup

<GuideOp>

Para no abrir un chat nuevo, o para que lo haga otro chat u otra IA, empieza en **Mis creaciones** del popup. **Crea el tuyo**, al final de la lista de plugins, te lleva ahí.

</GuideOp>

<GuideSteps>
<GuideStep>

Escribe una frase en **¿Qué quieres cambiar?**. Debajo, **Sitio** empieza con el sitio en el que estás. Cámbialo si la creación es para otro sitio.

</GuideStep>
<GuideStep>

Elige **Copiar para este chat**. Luego pega el texto copiado en el chat de IA de ese sitio y envíalo.

</GuideStep>
<GuideStep>

Cuando la IA responda, copia la respuesta entera, pégala en **Pega la respuesta de la IA** y elige **Revisar respuesta**.

</GuideStep>
<GuideStep>

Voyager te explica con palabras sencillas qué va a cambiar. Elige **Importar** y luego actívala en la lista de plugins. Una creación añadida así empieza apagada.

</GuideStep>
</GuideSteps>

<GuideOp>

Por este camino Voyager no envía nada por su cuenta. Tú pegas el texto y tú traes la respuesta de vuelta.

</GuideOp>

## Creaciones que ejecutan código

<GuideOp>

La mayoría de las creaciones solo cambian el aspecto. Algunas peticiones necesitan más, como contar tus mensajes o hacer algo cuando haces clic. Para esas, la IA hace una creación que ejecuta código. La revisión la marca con **Ejecuta código**.

</GuideOp>

### Activarla

<GuideOp>

- **Mírala antes**: la revisión muestra los sitios donde funciona y todo su código. Puede ver todo lo que hay en esas páginas, tus chats incluidos. Voyager no puede impedir que envíe a otra parte lo que ve. Así que activa solo una en la que confíes.
- **Instalar y activar**: activa justo la versión que acabas de mirar. Si la IA te da una versión más nueva, se queda apagada hasta que la mires otra vez. El interruptor vale solo para este dispositivo.
- **Un ajuste del navegador, una sola vez**: el navegador tiene que dejar que Voyager ejecute estas creaciones. Elige **Abrir la página de detalles de Voyager** y activa **Permitir scripts de usuario** (Allow User Scripts). Luego vuelve y elige **Ya lo activé**.
- **Navegadores**: Chrome o Edge 133 o posterior, en un ordenador. En Safari, Firefox y móviles se queda instalada pero en pausa. Puedes pedirle a la IA una versión que solo cambie el aspecto de la página.

<GuideShot kind="panel" src="/assets/create-mode-scripted-en.png" alt="La revisión de una creación que ejecuta código: la marca Ejecuta código, el aviso, el código completo y los pasos de Allow User Scripts" :width="632" />

</GuideOp>

### Mantener el control

<GuideOp>

En **Mis creaciones**, cada creación que ejecuta código indica **Activada, solo en este dispositivo**, **Desactivada** o **En pausa**. Si está en pausa, también dice por qué.

- **Detenerlas todas**: elige **Detener todas las creaciones que ejecutan código**, al final de **Mis creaciones**. Elige **Reanudar** para volver a ponerlas en marcha.
- **Páginas ya abiertas**: siguen funcionando hasta que recargas. **Recargar esta página** recarga la página actual.
- **Una página congelada**: si una página se congela por su culpa, Voyager las apaga. La próxima vez que abras la página, un aviso te dice cuáles eran.

</GuideOp>

## Qué puede y qué no puede hacer

<GuideOp>

- **Puede**: cambiar el aspecto de una página, como el ancho, el tamaño del texto y los colores; ocultar partes que no quieres ver; añadir interruptores y deslizadores a los ajustes; cambiar los colores de Voyager. En algunos sitios también puede activar funciones propias de Voyager, como copiar fórmulas y la línea de tiempo.
- **Necesita código**: hacer algo al hacer clic, contar cosas, leer lo que hay en la página. Consulta «Creaciones que ejecutan código», más arriba.
- **Nada puede**: funcionar en otros sitios ni cambiar los ajustes de Voyager. Si pides algo así, la IA te lo dice y hace la versión más parecida que pueda.

</GuideOp>

## Los detalles

<GuideOp>

Esta sección es para quien quiere saber cómo funciona por dentro. Sáltala si solo quieres usarlo.

- **Qué es una creación**: un plugin local, hecho de un manifest de plugin y estilos. Cómo escribir uno a mano, las reglas y las variables de color para cambiar los colores de Voyager están en [Escribe tu propio plugin](./write-a-plugin.md).
- **Qué lee la IA**: la petición enlaza las instrucciones de Voyager para el sitio, como `https://voyager.nagi.fun/create/claude.md`, y la IA responde con un único bloque de código JSON. Voyager solo muestra sus botones en un chat cuyo mensaje lleva ese enlace. Por eso, en el camino del popup, la IA tiene que poder abrir enlaces.
- **La estructura de la página**: qué elementos de la página reconoce Voyager y cuántos hay, y el árbol de elementos alrededor de la última respuesta y de tu último mensaje. Sin texto y sin direcciones web; también se quitan los valores de atributos que parecen ids, correos o números largos.
- **El aviso del modelo**: Voyager lee el modelo que recibirá el chat nuevo. Con [Modelo Predeterminado](./default-model.md) activado, se fija en ese modelo predeterminado. Vuelve a comprobarlo cuando regresas al panel.
- **La comprobación automática**: Voyager solo mira si los estilos y los cambios de página de la creación encuentran algo en la página actual. No cuentan los estados de hover y foco, ni las creaciones que solo activan funciones integradas.
- **Ejecutar código**: mediante los scripts de usuario de Chrome, y solo en los sitios que indica la creación. Antes de Chrome 138, el interruptor es **Modo de desarrollador**, arriba en `chrome://extensions`.

</GuideOp>
