# Carpetas

Guarda tus conversaciones en carpetas de la barra lateral: arrastra una a una carpeta y queda archivada, anida carpetas hasta tres niveles y recupera las mismas en otro dispositivo. Las carpetas funcionan en el ordenador y en móviles Android.

<SiteSupport feature="folders" :labels="{ folders: 'Carpetas en la barra lateral', 'hide-filed': 'Ocultar conversaciones archivadas', activity: 'Vista Activity', 'account-isolation': 'Aislamiento de cuentas', projects: 'Carpetas como proyectos', 'ai-organize': 'Organizar con IA', 'move-menu': '**Mover a carpeta** en el menú de la conversación', 'library-drag': 'Arrastrar desde la tabla de Library', 'gem-icons': 'Iconos según el tipo de Gem' }" :only="[{ id: 'move-menu', sites: ['gemini', 'chatgpt', 'claude'] }, { id: 'library-drag', sites: ['aistudio'] }, { id: 'gem-icons', sites: ['gemini'] }]" />

<GuideHero src="/assets/gemini-folders.png" alt="La sección de carpetas en la barra lateral">

La sección de carpetas está encima de la lista de conversaciones, en la barra lateral. Con la barra lateral cerrada, las mismas carpetas siguen disponibles en un panel flotante.

</GuideHero>

## Archivar una conversación

<GuideOp>

Cualquier conversación de la barra lateral puede ir a una carpeta, y una misma conversación puede estar en varias.

- **Arrastrar**: arrastra una conversación de la barra lateral sobre una carpeta.
- **Menú de la conversación**: en los sitios que lo admiten, abre el menú de la conversación y elige **Mover a carpeta**.
- **Selección múltiple**: mantén pulsada una conversación dentro de una carpeta para seleccionar varias y moverlas a la vez.
- **AI Studio**: la barra lateral todavía no admite selección múltiple; puedes arrastrar conversaciones desde la tabla de Library a una carpeta.

</GuideOp>

## Anidar y renombrar

<GuideOp side="end">

<GuideShot src="/assets/folders-nested-en.png" alt="Carpetas anidadas en tres niveles" :width="240" />

Las carpetas llegan a tres niveles: una carpeta de primer nivel puede tener dos niveles más de subcarpetas.

- **Subcarpeta**: haz clic derecho en una carpeta y crea una subcarpeta desde el menú.
- **Renombrar**: haz doble clic en el nombre de la carpeta, o elige **Renombrar** en su menú contextual.
- **Plegar**: pulsa la flecha delante de una carpeta para plegar o desplegar su contenido.

</GuideOp>

### Menú y colores

<GuideOp side="end">

<GuideShot src="/assets/folders-menu-en.png" alt="El menú contextual de una carpeta y sus colores" :width="254" />

Haz clic derecho en una carpeta y todo lo que puedes hacer con ella está en el menú.

- **Fijar**: deja la carpeta arriba del todo.
- **Color**: elige uno de 7 colores.
- **Eliminar**: borra la carpeta con todo su contenido, tras confirmarlo.

</GuideOp>

<GuideNote>

**Ajustes de vista**: el engranaje del encabezado de carpetas cambia el orden de las conversaciones (orden manual o abiertas recientemente) y ajusta el tamaño del texto, el espaciado de carpetas y la sangría de subcarpetas; el ajuste **Espaciado de carpetas** de la ventana también lo hace. En Safari para Mac quizá tengas que recargar la página para ver el cambio.

</GuideNote>

## Ocultar conversaciones archivadas

<GuideOp>

Cuando una conversación ya está en una carpeta, puedes sacarla de la lista principal para que solo queden las conversaciones en curso.

- **Gemini y AI Studio**: abre la ventana → **Opciones de Carpetas** → **Ocultar conversaciones archivadas**. Cada sitio guarda su propio ajuste; en AI Studio se ocultan las filas de la tabla de Library.
- **Primer archivado**: en estos dos sitios, la primera vez que archivas una conversación, una tarjeta en la sección de carpetas te ofrece activarlo con un clic. Si eliges **Ahora no**, no vuelve a preguntar.
- **Otros sitios**: el interruptor está en los ajustes del plugin de carpetas, en la zona **Complementos** de la ventana, y viene desactivado.
- **No se borra nada**: las conversaciones archivadas siguen en sus carpetas y puedes desactivarlo cuando quieras.

</GuideOp>

## Sincronizar y mover

<GuideFacts>
<GuideFact title="Importar y exportar">

El icono de carpeta del encabezado tiene **Importar carpetas** y **Exportar carpetas**. Exportar guarda un archivo JSON; importar lo fusiona con tus carpetas actuales, así que lo que ya ordenaste se queda como está.

<GuideShot src="/assets/folders-transfer-en.png" alt="Importar y exportar carpetas" :width="160" />

</GuideFact>
<GuideFact title="Aislamiento de cuentas">

El botón con forma de persona de la barra lateral de Gemini muestra temporalmente solo las conversaciones de la cuenta de Google actual; viene desactivado. **Enable Hard Isolation**, en **Opciones de Carpetas** de la ventana, separa las carpetas y los datos de sincronización por cuenta, y el botón se oculta solo.

</GuideFact>
<GuideFact title="Sincronización en la nube">

Todos los sitios con carpetas pueden usar la sincronización en la nube para tener las mismas carpetas en otro ordenador. Las carpetas de cada sitio se guardan y sincronizan por separado.

[Configurar la sincronización](/es/guide/cloud-sync)

</GuideFact>
<GuideFact title="Vista Activity">

La campana del encabezado cambia el árbol por una vista Activity de solo lectura, con las conversaciones de los últimos días ordenadas por su última actividad real; púlsala otra vez para volver al árbol. Nunca mueve, copia ni reclasifica conversaciones.

[Lee la guía completa de la vista Activity](/es/guide/activity-view)

</GuideFact>
</GuideFacts>

## Organizar con IA

¿Demasiadas conversaciones para ordenarlas a mano? Deja que Gemini proponga un plan de carpetas.

<GuideSteps>
<GuideStep>

Abre la ventana en Gemini y haz clic en **Organizar con IA** al final de **Opciones de Carpetas**. Tus conversaciones sin archivar y la estructura actual de carpetas se copian como un prompt; el prompt y los nombres de las carpetas usan tu idioma.

<GuideShot kind="panel" src="/assets/ai-auto-folder.png" alt="El botón Organizar con IA en la ventana" :width="326" />

</GuideStep>
<GuideStep>

Pega el prompt en Gemini. Responde con un plan de carpetas en JSON.

</GuideStep>
<GuideStep>

Haz clic en **Importar carpetas** en el encabezado, elige **O pegar JSON directamente**, pégalo y haz clic en **Importar**. **Fusionar con carpetas existentes** es la opción por defecto: solo añade carpetas nuevas y nuevas asignaciones, sin tocar las que ya tienes.

</GuideStep>
</GuideSteps>

## Carpetas como proyectos

Dale a una carpeta instrucciones para el primer turno y una conversación nueva se archiva sola en ella tras su primer mensaje. La idea viene de Claude Projects, pero Voyager solo añade instrucciones del primer turno y archivado automático; no es un espacio de trabajo con contexto compartido.

<GuideSteps>
<GuideStep>

Activa **Habilitar Carpeta como Proyecto** en la ventana.

</GuideStep>
<GuideStep>

Haz clic derecho en una carpeta y elige **Establecer instrucciones** o **Editar instrucciones**.

</GuideStep>
<GuideStep>

Abre una conversación nueva de Gemini y elige la carpeta en el selector junto al cuadro de texto.

</GuideStep>
<GuideStep>

Envía tu primer mensaje.

</GuideStep>
</GuideSteps>

<GuideNote>

**Después**

- Tras el primer envío, la conversación se archiva en esa carpeta.
- Si la carpeta tiene instrucciones, Voyager las añade solo a ese primer envío. Sin instrucciones, la carpeta sirve como atajo para archivar conversaciones nuevas.
- Las conversaciones de una misma carpeta **no** comparten memoria ni leen el contenido de las demás.
- El guardado automático del borrador solo conserva lo que escribiste, nunca las instrucciones ocultas.

</GuideNote>

Para el ancho de la barra lateral, consulta [Ancho de la barra lateral](/es/guide/sidebar).
