# Tus Activos Digitales: Biblioteca de Prompts

Pasaste mucho tiempo escribiendo un Prompt de nivel divino, fue de gran ayuda.
¿Usar y tirar?
No, guárdalo.

## Bóveda de Inspiración

Esta es tu bóveda.

### 1. Capturar

¿Escribiste algo bueno? Haz clic en la **bola flotante de Voyager** (por defecto está junto al cuadro de entrada, y puedes arrastrarla a cualquier lugar) para abrir el **Gestor de Prompts**.
Guárdalo en la bóveda, seguro en tu bolsillo.

### 2. Clasificar

Etiquétalo como `código`, `email`, `académico` (separa las etiquetas con comas).
Las herramientas deben ser prácticas y estar ordenadas.

### 3. Desplegar

La próxima vez que lo necesites, no lo vuelvas a escribir.
Abre la bóveda, busca la etiqueta, haz clic para insertar.
Llamada con un clic, duplica la eficiencia.

![Gestor de Prompts](/assets/gemini-prompt-manager.png)

## Lista compacta y notas

Cuando los prompts se acumulan y la lista de tarjetas deja de caber, el panel se adapta:

### Cambio de vista

El botón `≡ / ▦` a la derecha de la barra de búsqueda alterna entre **Lista compacta** (predeterminado) y **Vista cómoda**.

- **Lista compacta**: un prompt por fila, unas 10 visibles a la vez. A la derecha aparecen etiquetas · expandir · editar · eliminar
- **Vista cómoda**: vista previa de Markdown completa, ideal para colecciones pequeñas

### Nombre obligatorio

El campo **Nombre** al principio del formulario es obligatorio al agregar o editar un prompt. Los prompts antiguos sin nombre se conservan, pero habrá que asignarles uno la próxima vez que se editen.

### Vista previa rápida al pasar el ratón

En modo compacto, mantén el ratón sobre cualquier fila unos **250 ms** para ver el contenido completo en un tooltip flotante — sustituye al tooltip nativo `title` del navegador (que puede tardar 1–3 s en aparecer).

### Inserción rápida con barra

En el cuadro de chat, escribe `/` seguido de parte del nombre de un prompt. La lista muestra los nombres y etiquetas coincidentes, seguidos de **Gestionar prompts…** y **Panel de Voyager…**, que abren el Gestor de prompts y el [panel de Voyager](/es/guide/panel); pasa el ratón por un elemento para ver el contenido completo y selecciónalo con un clic izquierdo o con `Tab` / `Enter`. El nombre aparece como un token resaltado y al enviar se usa el cuerpo completo del prompt.

![Vista de lista compacta](/assets/gemini-prompt-manager-compact.png)

## Disponible en Cualquier Lugar

El Gestor de Prompts ahora se puede utilizar en cualquier sitio web que elijas, no solo en Gemini™ y AI Studio.

### Cómo Habilitarlo

En Claude, ChatGPT, DeepSeek y Kimi, el Gestor de Prompts es una fila de la tarjeta **Complementos** del sitio. Abre el popup de Voyager mientras estás en el sitio y activa **Gestor de Prompts**. Si es la primera función que activas allí, el navegador pide acceso al sitio una sola vez.

Para cualquier otro sitio:

1. Haz clic en el icono de Voyager en la barra de herramientas de tu navegador.
2. En la tarjeta **Acceso a sitios**, ve a **Otros sitios web**.
3. Escribe la dirección del sitio (por ejemplo: `poe.com`).
4. Haz clic en **Añadir sitio web** y concede el permiso.
5. **Recarga la página de destino** para ver el botón flotante.

### Sitios Web de IA Populares

- `copilot.microsoft.com` - Microsoft Copilot
- `poe.com` - Poe

### Aplicaciones locales

Las direcciones locales también funcionan: introduce `localhost:3080` o `127.0.0.1:3080` de la misma forma. Por ejemplo, [DeepSeek Harness](/es/guide/deepseek-harness) se ejecuta en `localhost:3080`, y el Gestor de Prompts se acopla igual que en cualquier sitio.

![Gestor de Prompts dentro de DeepSeek Harness](/assets/prompt-manager-deepseek-harness.png)

::: tip
En los sitios web que añades tú mismo, **solo** se activa la función del Gestor de Prompts. Otras funciones como la Línea de tiempo y las Carpetas no se cargarán allí. Claude, ChatGPT, DeepSeek y Kimi son distintos: tienen sus propios plugins oficiales, que puedes consultar en el [catálogo de plugins](/es/guide/plugins).
:::
