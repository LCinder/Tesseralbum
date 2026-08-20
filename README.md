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

## Qué hay

| Ruta | Qué hace |
|---|---|
| `/` | Tus lugares, y el alta de lugares nuevos |
| `/t/[slug]` | Aterrizaje del NFC: el lugar, y subir fotos |
| `/place/[id]` | El álbum: viajes, fotos, diario y subida |
| `/map` | Mapa de lugares, con vista previa al pulsar |
| `/passport` | Países, ciudades, viajes, días fuera y gráfico por año |
| `/admin` | URLs de los lugares, borrado, cuota y caché |

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
| `npm test` | 140 tests de la lógica pura |
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
    admin/page.tsx           lugares, cuota y caché
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
    notes.ts                 notas.md por viaje
docs/
  postgres-index-phase5.sql  esquema guardado por si el mapa pesa
```

## Estado de verificación

Comprobado automáticamente en cada cambio: **140 tests**, typecheck, lint y
build.

Comprobado a mano contra Google: consentimiento, creación de carpetas,
escritura del catálogo, subida de fotos y lectura de fechas EXIF.

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
