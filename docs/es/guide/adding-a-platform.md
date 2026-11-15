# Añadir una nueva plataforma

Añadir un nuevo sitio de chat tiene dos capas separadas:

1. El **adaptador del sitio**, `catalog/sites/<site>/site.json`, enseña a Voyager a reconocer el sitio y a encontrar sus turnos de usuario, turnos del asistente, campo de entrada, barra lateral y marcadores de tema.
2. Un **plugin** en `catalog/sites/<site>/plugins/<id>/` resuelve un problema concreto del usuario en ese sitio, como el ancho de lectura o un arreglo de renderizado.

Un `site.json` contiene `id` (igual al nombre de su directorio), `label`, `matches`, `selectors`, `theme`, `brandColor`, `capabilities` y, de forma opcional, `conversationIdPattern` y `turnKeyAttributes`. `turnKeyAttributes` indica los atributos que mantienen la identidad de un mensaje del usuario cuando la página lo vuelve a renderizar; el seguimiento de envíos (que usan la actividad de las carpetas y las marcas de tiempo de la línea de tiempo) solo se ejecuta en un sitio que define este campo, junto con `composer`, `userTurn` y `conversationIdPattern`. `validateSiteAdapterData` en `src/features/plugins/sites/siteAdapterData.ts` lo valida, y `bun run catalog:build` valida todos los sitios y plugins antes de publicarlos.

`site.json` es el propio adaptador de sitio escrito como datos. Hoy las plataformas son ChatGPT, Claude, DeepSeek, Kimi y Grok. Gemini y AI Studio son superficies nativas de Voyager con su propio `site.json` (`catalog/sites/gemini/` y `catalog/sites/aistudio/`), pero va dentro del paquete y nunca se publica en el catálogo remoto; `sites/adapters/gemini.ts`, `aistudio.ts`, `claude.ts`, `chatgpt.ts` y `deepseek.ts` son cáscaras de una línea sobre su `site.json`: edita el JSON, no el TypeScript.

El catálogo publicado por host también transporta los datos del sitio, así que un arreglo de selectores llega a los usuarios sin publicar una versión nueva. Un sitio totalmente nuevo sí necesita un cambio en el paquete, porque también necesita el permiso de host y el registro del content script, que se distribuyen dentro del paquete.

Para una nueva plataforma como DeepSeek, limita el trabajo del adaptador al contrato de la plataforma. Incluye el `site.json`, los tests de selectores necesarios y la documentación mínima que explique el soporte, todo en un único cambio completo. El registro de sitios detecta el nuevo adaptador desde el propio archivo, así que no hay ninguna lista de registro que editar. No añadas un sitio nuevo para cada plugin.

Una vez aceptado el adaptador, los plugins posteriores pueden enviarse como cambios separados y centrados. Si varios cambios dependen unos de otros, una cadena de PR apiladas resulta útil: cada rama posterior parte de la anterior y cada PR muestra solo su propia funcionalidad incremental. La cadena debe seguir igualmente la regla de alcance: un objetivo claro para el usuario por PR, con sus tests y su limpieza necesarios.

El soporte de un sitio no requiere una integración con una API de modelos. No añadas content scripts estáticos ni permisos de host obligatorios para una nueva plataforma; usa el flujo existente de permisos opcionales y registro dinámico para los sitios que solo tienen plugin.

El flujo de permisos opcionales y registro dinámico depende de la versión del navegador. Chrome y Edge soportan el flujo que usa la extensión. Firefox requiere la versión 128 o posterior para los permisos de host opcionales, y Safari requiere la versión 16.4 o posterior para el registro dinámico de content scripts. En versiones de navegador soportadas más antiguas, el popup puede negarse correctamente a activar un plugin en un sitio personalizado porque las APIs necesarias no pueden conservar un permiso de forma persistente; no lo soluciones añadiendo un permiso de host estático y amplio sin la aprobación de un mantenedor.
