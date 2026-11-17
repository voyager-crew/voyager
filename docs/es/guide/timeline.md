# Viaje en el Tiempo

La línea de tiempo de Voyager es un sistema visual de navegación por conversaciones para Gemini, Claude y ChatGPT. Asigna cada mensaje de un chat a un nodo interactivo en el lado derecho de la pantalla y convierte las conversaciones largas con IA en un mapa navegable por el que puedes saltar al instante.

Las conversaciones largas son un desastre. Arriba y abajo, perdido.
Voyager convierte la conversación en una línea.

En Gemini, **Línea de tiempo** → **Mostrar línea de tiempo** controla la barra de la línea de tiempo y sus atajos de navegación. Al desactivarla se conservan las estrellas y la jerarquía guardadas. Las horas de los mensajes dependen por separado de **Línea de tiempo** → **Marcas de tiempo de mensajes**, por lo que pueden seguir visibles con la línea de tiempo desactivada.

En Claude, ChatGPT, DeepSeek y Grok, la barra es el complemento de línea de tiempo de ese sitio: actívalo en **Complementos** y sus **Opciones** incluyen el estilo, los niveles de nodo (donde se ofrecen), **Restablecer posición de la línea de tiempo** y **Ver biblioteca guardada**, además de las marcas de tiempo de mensajes en ChatGPT.

## Ver el Ritmo

Mira el lado derecho de la pantalla.
Cada punto es una frase. Ese es el pulso de tu conversación.

## Navegación, Paso a Paso

- **Teletransporte**: Haz clic y ve, sin demoras.
- **Vistazo**: Pasa el ratón por encima, ve el contenido sin saltar.
- **Marcador**: Mantén presionado un nodo para **destacar**. Pon un marcador para tu cerebro.
- **Niveles (Experimental)**: Desactivados por defecto. Primero activa **Habilitar niveles de nodo** debajo de **Línea de tiempo** → **Mostrar línea de tiempo**, con la fila activada; luego haz clic derecho en un nodo para establecer su nivel (1-3) o contraer sus hijos. Haz que las conversaciones ramificadas sean claras. Los niveles solo se muestran en el estilo `Nodos`: al activarlos, la línea de tiempo cambia a `Nodos`, y `Escala` y `Compacto` no se pueden elegir mientras estén activos.
- **Redimensionar**: Arrastra el borde interior de la línea de tiempo para ajustar su ancho.
- **Atajos**: Vuela con el teclado. Por defecto `j`/`k` para saltar arriba/abajo, `gg`/`GG` para ir al primero/último turno.

![Navegación de Línea de Tiempo](/assets/teaser.png)

## Destacar: Marca tus momentos clave

Las conversaciones largas entierran oro. Destaca los momentos que importan.

**Cómo funciona**: Mantén presionado (~0.5s) cualquier nodo en la línea de tiempo. Verás que se ilumina — ese mensaje ahora está destacado.

- Mantén presionado de nuevo para quitar la estrella.
- Los nodos destacados permanecen resaltados para que puedas encontrarlos de un vistazo.
- Consulta todos tus mensajes destacados en la **Biblioteca guardada**: haz clic en **Ver biblioteca guardada** en el popup de Voyager, debajo de **Línea de tiempo** → **Mostrar línea de tiempo**, con la fila activada, o ábrela desde el panel del Gestor de prompts.

Es como plantar una bandera en la conversación — el momento de una revelación, la respuesta perfecta, o donde quieres retomar después.

::: tip Consejo
Las estrellas se sincronizan entre dispositivos si tienes la [Sincronización en la Nube](/es/guide/cloud-sync) activada.
:::

## Hazlo tuyo

En el popup de Voyager, activa **Línea de tiempo** → **Mostrar línea de tiempo** para ver sus opciones debajo de la fila:

- **Estilo de cronología**: `Nodos`, `Escala` o `Compacto`.
- **Fijar panel de vista previa**: Mantiene abierto el panel de vista previa junto a la línea de tiempo. Su cuadro de búsqueda filtra los mensajes mientras escribes.
- **Línea de tiempo arrastrable**: Mueve la línea de tiempo a cualquier punto de la página. **Restablecer posición de la línea de tiempo** la devuelve a su lugar.

## Teclado, Más Rápido

¿No quieres usar el ratón? Usa el teclado.

**Es como activar el Modo Vim en Gemini.**

### Atajos Predeterminados

- `k` - Saltar al nodo anterior
- `j` - Saltar al nodo siguiente
- `gg` - Saltar al primer turno
- `GG` - Saltar al último turno

### Personalizar

Abre la configuración de la extensión, haz clic en el cuadro de atajos y presiona la tecla que quieras usar.
Cualquier tecla, cualquier combinación. ¿`n`/`p`? ¿`,`/`.`? Tú decides.

En **Modo Flujo**, presionar repetidamente pondrá en cola la animación.
En **Modo Salto**, respuesta inmediata, velocidad máxima.

## Cuándo usar la línea de tiempo

La línea de tiempo es más útil en conversaciones de más de 10 mensajes, cuando desplazarse se vuelve ineficiente:

- **Sesiones de investigación**: pediste a Gemini que explorara un tema a lo largo de más de 30 turnos. La línea de tiempo te permite volver a la idea clave sin releerlo todo.
- **Depuración de código**: una conversación larga de depuración en la que la solución apareció en el turno 47. Destácala y encuéntrala después con un solo clic.
- **Aprendizaje y tutorías**: avanzar paso a paso por un tema complejo. Usa los niveles para contraer las secciones que ya dominas.
- **Repaso de lluvias de ideas**: revisar una sesión creativa para extraer las mejores ideas. Los destacados marcan los momentos que vale la pena conservar.

## Línea de tiempo frente a desplazamiento manual

| Capacidad                            | Sin línea de tiempo              | Con la línea de tiempo de Voyager                                             |
| ------------------------------------ | -------------------------------- | ----------------------------------------------------------------------------- |
| Encontrar un mensaje concreto        | Subir y bajar repetidamente      | Hacer clic en un nodo o pulsar j/k                                            |
| Marcar momentos clave                | Copiar y pegar en notas externas | Mantener pulsado para destacar; se sincroniza con la nube                     |
| Ver la estructura de la conversación | Leer en orden                    | Un mapa visual muestra toda la forma de un vistazo                            |
| Navegación por teclado               | No disponible en Gemini          | Estilo Vim con j/k y gg/GG, totalmente personalizable                         |
| Navegar por más de 100 mensajes      | Minutos de desplazamiento        | Salto instantáneo a cualquier punto                                           |
| Organizar hilos largos               | No hay herramientas integradas   | Niveles (1-3) y los hijos pueden contraerse (experimental, hay que activarlo) |

## Navegadores compatibles

La línea de tiempo funciona en Google Gemini, y en Claude y ChatGPT como plugins integrados, en Chrome, Edge, Firefox, Safari, Opera y Brave. Los atajos de teclado y los destacados funcionan igual en las tres. Los niveles son en todas partes una opción experimental que hay que activar: en Gemini, activa **Habilitar niveles de nodo** debajo de **Línea de tiempo** → **Mostrar línea de tiempo**, con la fila activada; en Claude y ChatGPT, activa el mismo interruptor en los ajustes de **Línea de tiempo**, dentro de **Complementos**. Los mensajes destacados se sincronizan entre dispositivos cuando la [Sincronización en la nube](/es/guide/cloud-sync) está activada.

La línea de tiempo no está disponible en AI Studio. DeepSeek y Grok tienen cada uno un plugin de línea de tiempo opcional en el catálogo de plugins (vienen desactivados).
