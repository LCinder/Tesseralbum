# Tesseralbum

Álbum de viajes que se abre acercando el móvil a un souvenir. Cada lugar tiene
una URL que grabas en un chip NFC; al escanearlo se abre ese lugar, y desde ahí
subes las fotos, que se organizan solas en tu Google Drive por sus fechas.

En producción: **https://tesseralbum.vercel.app**

> El código, los comentarios y los identificadores están en inglés. El texto
> que ve el usuario está en español.

## La arquitectura en una frase

**No hay servidor y no hay base de datos.** La app corre entera en el
navegador, habla con la API de Drive directamente, y guarda su estado en tu
propio Drive.

```
Navegador ──token GIS──► Google Drive API
    │
    ├─ Tesseralbum/souvenirs.json          el catálogo de lugares
    └─ Tesseralbum/Irlanda/2025/Septiembre-Octubre/
                                           las fotos, en carpetas que salen
                                           de sus propias fechas, más un
                                           notas.md con el diario del viaje
```

Consecuencias que conviene tener claras:

- **Ningún secreto en ningún sitio.** La única variable de configuración es el
  client ID de Google, que es público por diseño. No hay refresh token que
  cifrar ni rotar, porque el flujo de navegador no emite ninguno.
- **El control de acceso es el de Drive.** Compartes la carpeta con quien
  quieras desde la interfaz de Drive, revocable por persona.
- **Scope `drive.file`.** La app solo ve los ficheros que ella misma crea. El
  resto de tu Drive le es invisible, y Google no exige la revisión de
  seguridad de los scopes amplios.
- **El chip NFC no es una credencial**, es un atajo. Dice *qué* álbum
  abrir; quién puede verlo lo decide Drive.

## Cómo se organizan las fotos

Nadie escribe una fecha. Al subir un lote, la app lee el EXIF, calcula el
rango y monta la ruta:

```
Tesseralbum/Irlanda/2025/Septiembre-Octubre/
```

Un viaje dentro de un mes queda como `Noviembre`; uno largo se nombra por sus
extremos, `Junio-Agosto`. Un viaje de fin de año va al año en que empezó, para
no partirlo en dos: `2025/Diciembre-Enero`.

Subir el resto de un viaje días después **no crea otra carpeta**: si el lote
nuevo cae a menos de 14 días del que ya está, se considera el mismo viaje y la
carpeta se amplía, renombrándose si hace falta. Más lejos, es una visita nueva
y le toca carpeta propia. Dos viajes distintos en el mismo mes se distinguen
con un sufijo: `Septiembre` y `Septiembre (2)`.

De ahí que **un lugar tenga un solo chip**: volver a un sitio no necesita otra
pegatina, porque lo que distingue las visitas son las fechas de las fotos. Dar
de alta una ciudad que ya tienes te devuelve la URL que ya tenía.

## De dónde sale la fecha de una foto

Por orden de fiabilidad:

1. **EXIF** — lo que escribió la cámara.
2. **El nombre del fichero** — `IMG-20251118-WA0012.jpg`, `PXL_20251118_...`. Es
   la cámara escribiendo la fecha en otro sitio, y sobrevive a que WhatsApp
   borre el EXIF.
3. **Las fotos de al lado** — si una perdió su fecha, las de antes y después en
   la misma tanda la tienen, y se hizo a minutos de ellas. Se coge la del vecino
   más cercano por nombre (en orden numérico: `IMG_2` va antes de `IMG_10`).
4. **La que escribas tú**, si no hay nada de lo anterior.

`File.lastModified` **no** está en esa lista como fuente buena: copiar, exportar,
sincronizar o reenviar un fichero la pone a *hoy*. Se usa solo cuando no hay nada
mejor, y aun así con una salvedad importante: cuando ninguna foto del viaje trae
fecha de cámara, las marcas de tiempo no son todas malas por igual — coinciden
entre sí en los ficheros intactos y se desvían justo en los que se copiaron. Así
que el grupo en el que cae la mayoría es el viaje, y los sueltos toman la fecha
de sus vecinos.

Solo si es la mayoría de verdad. Un empate entre dos grupos son **dos viajes**
subidos juntos, no uno con rezagados, y elegir ganador ahí movería media tanda al
mes equivocado.

Todo esto se aplica en tres sitios con la misma función, así que no pueden
discrepar: al subir (y se guarda en la foto), al leer el álbum (sin escribir nada,
lo que repara álbumes de antes) y al renombrar carpetas desde `/admin`.

### Guardada o recalculada

Las dos, a propósito:

- **Al subir** se escribe en las `appProperties` de la foto (`takenAt` y
  `dateSource`, que dice de dónde salió).
- **Al leer un álbum** se recalcula en el navegador sobre lo que el listado ya
  trajo, sin ninguna llamada extra.
- **El nombre del fichero no se toca nunca.** Solo el de la carpeta, y solo
  desde el botón de `/admin`.

Recalcular al leer es lo que repara hacia atrás: un álbum subido antes de que
existiera nada de esto se ve bien sin tocar Drive ni gastar cuota. El precio es
que la foto sigue guardando la fecha mala, así que **cualquier pantalla nueva
tiene que leer por `listTrips`**, que aplica el recálculo, y no las
`appProperties` en crudo. Hoy pasan por ahí la galería, el visor y el propio
recálculo de carpetas; el pasaporte y el "hace un año" leen el rango de la
carpeta, no la foto.

## Recalcular fechas

Cada carpeta de viaje lleva en sus propias `appProperties` el rango que cubre, y
de ahí sale su nombre. Las que se subieron antes de que la app distinguiera la
fecha de la cámara de la del sistema pueden llevar un rango imposible:
`File.lastModified` se pone a *hoy* al copiar un fichero, así que un viaje de
noviembre acabó llamándose `Noviembre-Agosto`.

`/admin` → **Revisar fechas** lo recalcula a partir de las fotos que cada carpeta
tiene dentro, con el mismo agrupamiento que usa la subida. Primero enseña lo que
cambiaría y solo escribe si lo confirmas. Cuesta la lista que el pasaporte ya
cachea, más un `PATCH` por carpeta que esté mal; una carpeta correcta no se toca.

Lo que no hace, y lo dice en el propio plan:

- **Partir una carpeta con dos viajes dentro.** Renombrarla no los separa, y
  separarlos es mover ficheros.
- **Mover una carpeta de año.** Si las fechas buenas caen en otro año le arregla
  el nombre, pero moverla hay que hacerlo desde Drive.

## Qué hay

| Ruta | Qué hace |
|---|---|
| `/` | Tus lugares, y el alta de lugares nuevos |
| `/t/[slug]` | Aterrizaje del NFC: el lugar, y subir fotos |
| `/place/[id]` | El álbum: viajes, fotos, diario y subida |
| `/map` | Mapa de lugares, con vista previa al pulsar |
| `/passport` | Países, ciudades, viajes, días fuera y gráfico por año |
| `/admin` | URLs de los lugares, borrado, recálculo de fechas, cuota y caché |

## Puesta en marcha

### 1. Google Cloud

1. Crea un proyecto en [console.cloud.google.com](https://console.cloud.google.com).
   El nombre que le pongas es el que verás en la pantalla de permisos.
2. **APIs y servicios › Biblioteca › Google Drive API › Habilitar.**
3. **Credenciales › Crear credenciales › ID de cliente de OAuth › Aplicación web.**
   En *orígenes autorizados de JavaScript* pon **los dos**:
   `http://localhost:3000` y la URL de tu despliegue.
   **No necesitas el client secret.**
4. **Pantalla de consentimiento › Público › Publicar app.**

El paso 4 importa: en modo «Prueba» solo entran las cuentas que apuntes una a
una, y Google devuelve un `403 access_denied` a las demás. Como el único scope
que pide la app es `drive.file`, que Google clasifica como **no sensible**,
publicar no exige verificación — y de paso quita el aviso de «app no
verificada».

Si ves `400 origin_mismatch`, es que falta ese origen exacto en el paso 3.
Ojo: `127.0.0.1` y `localhost` son orígenes distintos para Google.

### 2. Variables

```bash
cp .env.example .env.local
```

Pega el client ID en `NEXT_PUBLIC_GOOGLE_CLIENT_ID`. Es la única que hay.

Si la cambias, **reinicia `npm run dev`**: las `NEXT_PUBLIC_*` se inyectan al
compilar, y un servidor que arrancó sin ella no la recoge.

### 3. Arranca

```bash
npm run dev
```

Pulsa **Conectar con Google** y acepta el permiso. La app crea la carpeta
`Tesseralbum` en tu Drive.

### 4. Crea el primer lugar

En la portada, escribe la ciudad en el buscador y elígela de la lista: ciudad,
país, código ISO y coordenadas los rellena Nominatim. Al guardar te da la URL
para grabar en el chip.

No hay nada más que rellenar: un lugar es una ciudad y nada más.

### 5. Graba el chip

Un registro NDEF de tipo URI con esa URL. Cabe de sobra en un NTAG213.

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Build de producción |
| `npm test` | 150 tests de la lógica pura |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |

## Mapa del código

```
src/
  app/
    page.tsx                 lugares + alta de lugares nuevos
    t/[slug]/page.tsx        aterrizaje del NFC y subida
    place/[id]/page.tsx      el álbum de un lugar
    map/page.tsx             mapa de lugares
    passport/page.tsx        estadísticas de viaje
    admin/page.tsx           lugares, fechas, cuota y caché
  components/
    SessionProvider.tsx      token, catálogo y persistencia de sesión
    UploadPreview.tsx        elegir, revisar y subir
    Gallery.tsx              viajes y fotos de un lugar
    DriveImage.tsx           caché → thumbnailLink → descarga
    MapView.tsx              Leaflet, cargado bajo demanda
    TripNotes.tsx            el diario, con guardado automático
  lib/
    catalog.ts               souvenirs.json                    ← tests
    anniversary.ts           «hace un año estabas en…»         ← tests
    thumbnail.ts             miniaturas propias al subir       ← tests
    flags.ts                 banderas desde el código ISO      ← tests
    trips.ts                 fechas → carpeta del viaje        ← tests
    media.ts                 EXIF, hash y clasificación        ← tests
    limits.ts                topes de tamaño y cuota           ← tests
    passport.ts              estadísticas de viaje             ← tests
    map.ts                   pines y solapamientos             ← tests
    geocode.ts               búsqueda en Nominatim             ← tests
    session-store.ts         token y catálogo persistidos      ← tests
    google/drive.ts          cliente REST de Drive             ← tests
    google/gis.ts            token de Google
    upload.ts                orquestación de la subida
    gallery.ts               lectura del álbum
    cache.ts                 miniaturas en IndexedDB
    memo.ts                  listados en memoria por sesión      ← tests
    notes.ts                 notas.md por viaje
docs/
  postgres-index-phase5.sql  esquema guardado por si el mapa pesa
```

## Estado de verificación

Comprobado automáticamente en cada cambio: **222 tests**, typecheck, lint y
build.

Comprobado a mano contra Google: consentimiento, creación de carpetas, escritura
del catálogo, subida de fotos, lectura de fechas EXIF, la inferencia de fechas
por vecindad y el renombrado de carpetas desde `/admin`.

Comprobado con un chip de verdad: grabar la URL de un lugar en una pegatina NFC
y abrir el álbum acercando el móvil. Era la premisa del proyecto y la última
pieza que quedaba sin probar de punta a punta.

## Notas

- Next.js 16: `params` es asíncrono y se lee con `use()` en componentes de
  cliente. No hay `middleware.ts` — no hay nada que refrescar en el servidor.
- Si renombras rutas, borra `.next/` antes de `tsc`: los tipos generados
  siguen apuntando a las carpetas viejas.
- `ensurePath` no es atómico. Dos pestañas creando la misma carpeta a la vez
  pueden producir un duplicado, porque Drive permite nombres repetidos.
- El token de Google dura una hora. La app lo guarda y lo renueva en silencio
  mientras haya sesión de Google en el navegador; un mes sin interacción
  requeriría un refresh token, que este flujo no emite.
- Los chips sobre souvenirs metálicos tienen que ser *on-metal*, con capa
  de ferrita. Las normales no funcionan pegadas a metal.
- En el iPhone, *Ajustes › Cámara › Formatos › Más compatible*: cambia HEIC por
  JPEG y HEVC por H.264. Sin eso las fotos suben bien pero el navegador no
  puede mostrarlas.
