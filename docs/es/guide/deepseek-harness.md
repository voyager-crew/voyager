# DeepSeek Harness

El agent de programación de código abierto oficial de DeepSeek. Se ejecuta en tu máquina.

Tiene una interfaz web, en `localhost:3080`.

Una interfaz web significa que Voyager puede entrar.

## Por qué funciona

El Gestor de Prompts de Voyager no mira los dominios. Mira los sitios que has añadido.

Una dirección local también es un sitio.

Así que DeepSeek Harness no se diferencia de Gemini, Claude o ChatGPT: un lugar más al que tus prompts te siguen.

## Tres pasos

### 1. Arranca DSH

```bash
npm i -g @deepseek-ai/dsh
dsh web
```

Abre `http://localhost:3080` en tu navegador.

### 2. Añádelo en el popup

![Haz clic en el icono de puzle de la barra de herramientas, haz clic en Voyager y activa el Gestor de Prompts en localhost:3080](/assets/dsh-enable-steps-en.png)

En la tarjeta **Acceso a sitios** del popup, en **Otros sitios web**, escribe `localhost:3080`. Haz clic en **Añadir sitio web** y concede el acceso.

### 3. Recarga la página

El botón flotante aparece en la esquina inferior derecha.

![Gestor de Prompts dentro de DeepSeek Harness](/assets/prompt-manager-deepseek-harness.png)

## Una sola biblioteca, en todas partes

No tienes una biblioteca por cada sitio. Tienes una sola, y te sigue.

Cada prompt que guardaste en Gemini, Claude o ChatGPT ya está ahí cuando abres DSH. Todos, sin faltar uno. Y funciona al revés: escribe un prompt dentro de DSH y te espera de vuelta en Gemini.

Las mismas etiquetas, los mismos favoritos, la misma búsqueda.

![Una sola biblioteca que llega a cada interfaz](/assets/one-prompt-library.png)

## Un par de notas

**El puerto no es fijo.** DSH sigue siendo una versión preliminar para desarrolladores y su puerto por defecto puede cambiar. Si cambia, añade el nuevo y listo.

**Solo se carga el Gestor de Prompts.** La Línea de tiempo, las Carpetas y lo demás no arrancan en un sitio personalizado. (En la web de DeepSeek, muchas de estas funciones están disponibles como plugins oficiales.)

**Tus prompts nunca salen de la máquina.** DSH es local, la biblioteca de Voyager es local. Nada de la cadena sale fuera.

::: tip
El mismo método sirve para cualquier interfaz web local: Open WebUI, LibreChat, la que escribiste tú. Añade la dirección, recarga, listo.
:::
