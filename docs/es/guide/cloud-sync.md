# Sincronización en la Nube

La sincronización en la nube de Voyager guarda una copia de seguridad de tus carpetas, tu biblioteca de prompts, los mensajes destacados y los ajustes compatibles. Elige Google Drive en cualquier navegador compatible, o iCloud en Safari. Los datos viajan directamente entre Voyager y la cuenta en la nube personal que selecciones; Voyager no gestiona ningún servidor de sincronización.

## Qué se sincroniza

| Tipo de dato                    | Sincronizado | Detalles                                                                                                         |
| ------------------------------- | ------------ | ---------------------------------------------------------------------------------------------------------------- |
| Estructura de carpetas          | Sí           | Carpetas de Gemini, AI Studio, ChatGPT, Claude, DeepSeek y Kimi: anidamiento, colores y conversaciones asignadas |
| Biblioteca de prompts           | Sí           | Todos los prompts guardados, con etiquetas y organización por carpetas                                           |
| Mensajes destacados             | Sí           | Marcadores de la línea de tiempo de cualquier conversación                                                       |
| Línea de tiempo en otros sitios | Sí           | Destacados y niveles de la línea de tiempo en ChatGPT, Claude y DeepSeek                                         |
| Ajustes de la extensión         | Sí           | Preferencias compartidas entre dispositivos, como el orden, los colores y el comportamiento de la entrada        |
| Configuración de plugins        | Sí           | Estado de instalación y activación, y ajustes del plugin; los permisos del sitio siguen siendo por dispositivo   |
| Respuestas del modelo           | No           | Las copias de destacados contienen los prompts del usuario, no las respuestas del modelo                         |

<!-- D4: draft wording, waiting for Jesse to confirm -->

**Enable Hard Isolation** ya no viaja en el archivo de ajustes de la nube. La sincronización propia de tu navegador (por ejemplo, la de Chrome) sigue llevándolo entre ordenadores con el mismo perfil del navegador.

## Datos destacados y límites de sincronización

Las copias en la nube incluyen el **texto completo de los prompts de usuario que marcas con estrella** (hasta 16 KiB UTF-8 por prompt) en tu propio Google Drive o iCloud. Las copias de estrellas no almacenan respuestas del modelo. La copia v1 conserva solo vistas previas; la nueva v2 incluye el texto y los registros de eliminación.

Los registros de eliminación se conservan 180 días. Las versiones antiguas de Voyager los ignoran y pueden mostrar o subir estrellas eliminadas; las nuevas bloquean copias antiguas con la misma marca de tiempo. Marcar de nuevo con una fecha posterior, o la caducidad del registro, puede restaurar una estrella. Los periodos largos sin conexión y las diferencias entre relojes también afectan a las eliminaciones.

La sincronización combina y verifica los datos escritos, con un máximo de tres intentos, pero no es una transacción atómica entre dispositivos: las cargas simultáneas pueden sobrescribirse. Una sincronización posterior desde un dispositivo que conserva los datos faltantes puede repararlos; sin ella, la recuperación no está garantizada. Los fallos parciales conservan las escrituras aceptadas; vuelve a sincronizar para completar la reparación.

## Características

- **Sincronización multidispositivo**: Mantén tus configuraciones sincronizadas en varias computadoras.
- **Privacidad de datos**: Los datos se guardan en tu propio Google Drive o en tu base de datos privada de iCloud, sin pasar por un servidor de Voyager.
- **Sincronización flexible**: Soporte para carga manual y descarga/fusión de datos.

::: info
Los identificadores de dispositivo, los tokens de acceso, las cachés, las coordenadas de la ventana y el estado temporal de ejecución no se sincronizan a propósito como ajustes personales.
:::

## Cómo usar

1. Abre una pestaña de Gemini, AI Studio, ChatGPT, Claude, DeepSeek o Kimi y haz clic en el icono de Voyager en la barra de herramientas del navegador para abrir el popup. La sección **Sincronización en Nube** solo aparece en estos sitios, y las carpetas de cada sitio se sincronizan por separado.
2. Localiza la sección **Sincronización en Nube**.
3. En Safari, elige **Google Drive** o **iCloud**. Los demás navegadores usan Google Drive.
4. Cambia **Modo sinc.** a **Manual**. Empieza en **Desactivado**, y los botones de sincronización solo aparecen en modo Manual.
5. Con Google Drive en Safari, haz clic en **Conectar Google Drive** para iniciar sesión desde la app de Voyager. Los demás navegadores no tienen un botón de inicio de sesión aparte: la ventana de autorización de Google se abre la primera vez que haces clic en **Subir** o **Fusionar**. En iCloud, asegúrate de que el Mac tenga la sesión de iCloud iniciada.
6. Haz clic en **Subir** para sincronizar tus datos locales con la nube, o en **Fusionar** para traer los datos de la nube a este navegador. **Sobrescribir** pide confirmación y luego sustituye solo los datos que la nube tiene y Voyager puede leer; lo que falte o no se pueda leer en la nube se queda como está, y el resultado lo indica. Puedes deshacerlo justo después.

Con iCloud, **Eliminar copia de iCloud** elimina de iCloud todas las copias de seguridad de Voyager; los datos locales del Mac no cambian.

### 💡 Sincronización rápida

La forma más sencilla es hacer clic en el icono de nube del encabezado del área de carpetas, en la barra lateral izquierda, y elegir **"Subir a la nube"** o **"Sincronizar desde la nube"** en el menú.

<GuideShot src="/assets/cloud-sync.png" alt="Botones de sincronización rápida en la nube" :width="440" />

::: warning
**Recomendación de seguridad: Protección doble**\
Si bien la sincronización en la nube ofrece una gran comodidad, le recomendamos encarecidamente que también realice periódicamente copias de seguridad de sus datos principales mediante **archivos locales**.

1. **Carpetas**: Abre el menú del área de carpetas, elige **Importar/Exportar carpetas** y, después, **Exportar carpetas** para guardar todas tus carpetas y las asignaciones de conversaciones.
2. **Prompts**: En el **Gestor de prompts**, haz clic en **Exportar** para guardar tu biblioteca de prompts.
   :::

## Protección de la sincronización

<GuideFacts>
<GuideFact title="Confirmación al subir">

Si una subida dejaría un archivo de la nube mucho más pequeño (este dispositivo no tiene nada de algo que la nube sí tiene, o tiene menos de la mitad cuando la nube tiene al menos 4) o Voyager no puede leer el archivo de la nube, primero pregunta: **Fusionar desde la nube**, **Subir de todos modos** o **Cancelar**. Fusionar solo se ofrece cuando el archivo de la nube se puede leer.

</GuideFact>
<GuideFact title="Sobrescribir solo sustituye lo que existe">

**Sobrescribir** conserva cualquier tipo de datos que falte en la nube o que Voyager no pueda leer, y lo indica en el resultado. Una lista de plugins vacía en la nube nunca borra tus plugins.

</GuideFact>
<GuideFact title="Deshacer justo después de descargar">

Después de **Fusionar** o **Sobrescribir**, la línea de resultado del popup ofrece **Deshacer** mientras el popup siga abierto. El aviso de la nube en el área de carpetas lo ofrece durante unos 10 segundos y espera mientras tengas el puntero encima. Deshacer restaura lo que cambió esa descarga y conserva lo que hayas cambiado después. Solo se puede deshacer la última descarga.

</GuideFact>
<GuideFact title="Copias de historial en Google Drive">

Antes de que una subida sustituya un archivo, Voyager guarda la versión sustituida a su lado en su carpeta de Drive como `<archivo>.backup-<hora UTC>.json`, por ejemplo `gemini-voyager-folders.backup-2026-10-29-031100.json`. Conserva las 3 más recientes de cada archivo y mueve las anteriores a la papelera de Drive. iCloud no guarda copias de historial.

</GuideFact>
<GuideFact title="Actualiza todos los dispositivos">

Con **Enable Hard Isolation** activado, Voyager nombra ahora los archivos de Drive de cada cuenta con el correo de la cuenta. Un dispositivo que siga en Voyager 2.2.1 y que conoció la cuenta en una dirección numerada (gemini.google.com/u/1) no verá lo que suban las versiones nuevas hasta que se actualice. Las actualizaciones de Chrome Web Store llegan en pocos días; Safari tarda más.

</GuideFact>
</GuideFacts>

## Sincronización en la nube frente a copia de seguridad manual

| Aspecto                    | Copia manual (exportar/importar)   | Sincronización en la nube                                          |
| -------------------------- | ---------------------------------- | ------------------------------------------------------------------ |
| Frecuencia                 | Cuando te acuerdes                 | Bajo demanda, con un solo clic                                     |
| Ubicación de datos         | Archivo local en tu ordenador      | Tu Google Drive o tu base de datos privada de iCloud               |
| Entre dispositivos         | Requiere transferir archivos       | Dispositivos con sesión iniciada en la cuenta de nube seleccionada |
| Comportamiento al fusionar | Sustituye o requiere fusión manual | Fusión inteligente sin duplicar                                    |
| Privacidad                 | El archivo permanece en tu máquina | Almacenado en tu cuenta de nube personal                           |

## Cómo funciona

1. **Proveedor**: Google Drive usa el permiso limitado `drive.file`, así que Voyager solo puede acceder a los archivos que ha creado. En Safari, iCloud usa la base de datos privada CloudKit de la aplicación y no expone a Voyager ningún token de Apple ID.
2. **Subida**: Al hacer clic en **Subir**, Voyager escribe en el proveedor seleccionado archivos de copia separados para las carpetas, los prompts, los destacados, los forks, la jerarquía de la línea de tiempo, los ajustes de personalización y la configuración de plugins. Los datos de resaltado se incluyen cuando la sincronización de resaltados está activada.
3. **Descarga y fusión**: Al hacer clic en **Fusionar** en otro dispositivo, Voyager lee esos archivos y los fusiona por tipo de dato. Las carpetas y los prompts nuevos se añaden sin duplicarse, se restauran las preferencias de la nube y las entradas de plugins se fusionan por ID de plugin.
4. **Sin sincronización en segundo plano**: La sincronización es manual y bajo demanda. Voyager nunca sincroniza sin tu acción explícita.

Cambiar de proveedor no copia datos entre ellos ni escribe en los dos a la vez. Si quieres que los datos locales actuales estén en el nuevo proveedor, sube los datos una vez después de cambiar.

## Plataformas compatibles

La sincronización con Google Drive funciona en Chrome, Edge, Firefox y Safari en el ordenador. No está disponible en el móvil (Firefox para Android), que no puede abrir la ventana de inicio de sesión de Google. La sincronización con iCloud solo está disponible en la aplicación de Safari distribuida directamente y usa la cuenta de iCloud iniciada en el Mac.
