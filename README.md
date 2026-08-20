# Tesseralbum

Álbum de viajes que se abre acercando el móvil a un souvenir. Cada pegatina
NFC lleva una URL con un código; escanearla abre el álbum de ese lugar y,
más adelante, permitirá subir fotos directamente a Google Drive.

**Fase 1 — escaneo y lugares.** Conexión con Drive, catálogo de pegatinas y la
ruta `/t/[slug]` resolviendo a un lugar. Las subidas, la galería, el mapa y el
vídeo llegan en fases posteriores.

> El código, los comentarios y los identificadores están en inglés. El texto
> que ve el usuario está en español.

## La arquitectura en una frase

**No hay servidor y no hay base de datos.** La app corre entera en el
navegador, habla con la API de Drive directamente, y guarda su estado en tu
propio Drive.

```
Navegador ──token GIS──► Google Drive API
    │
    ├─ Tesseralbum/souvenirs.json          el catálogo: pegatina → lugar
    └─ Tesseralbum/Irlanda/2025/Septiembre-Octubre/
                                           las fotos, en carpetas que
                                           salen de sus propias fechas
```

Consecuencias que conviene tener claras:

- **Ningún secreto en ningún sitio.** El token de Google vive una hora en
  memoria y se renueva en silencio. No hay refresh token que cifrar ni rotar.
  La única variable de configuración es el client ID, que es público por
  diseño.
- **El control de acceso es el de Drive.** Compartes la carpeta con quien
  quieras desde la interfaz de Drive, revocable por persona. La app solo
  muestra lo que Drive le deje ver a quien esté dentro.
- **Scope `drive.file`.** La app solo ve los ficheros que ella misma crea. El
  resto de tu Drive le es invisible, y Google no exige la revisión de
  seguridad de los scopes amplios.
- **La pegatina NFC no es una credencial**, es un atajo. Dice *qué* álbum
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
carpeta se amplía. Más lejos, es una visita nueva y le toca carpeta propia.

De ahí que una pegatina no necesite nombre: **volver al mismo sitio lo
distinguen las fechas, no una etiqueta.**

## Puesta en marcha

### 1. Google Cloud

1. Crea un proyecto en [console.cloud.google.com](https://console.cloud.google.com).
   El nombre que le pongas es el que verás en la pantalla de permisos.
2. **APIs y servicios › Biblioteca › Google Drive API › Habilitar.**
3. **Credenciales › Crear credenciales › ID de cliente de OAuth › Aplicación web.**
   Como *origen autorizado de JavaScript* pon `http://localhost:3000`, y añade
   la URL de Vercel cuando despliegues. **No necesitas el client secret.**
4. **Pantalla de consentimiento › Público › Publicar app.**

El paso 4 importa: en modo «Prueba» solo entran las cuentas que apuntes una a
una, y Google devuelve un `403 access_denied` a las demás. Como el único scope
que pide la app es `drive.file`, que Google clasifica como **no sensible**,
publicar no exige verificación — y de paso quita el aviso de «app no
verificada».

### 2. Variables

```bash
cp .env.example .env.local
```

Pega el client ID en `NEXT_PUBLIC_GOOGLE_CLIENT_ID`. Es la única que hay.

### 3. Arranca

```bash
npm run dev
```

Pulsa **Conectar con Google** y acepta el permiso. La app crea la carpeta
`Tesseralbum` en tu Drive.

### 4. Crea la primera pegatina

Ve a **Pegatinas** (`/admin`) y escribe la ciudad en el buscador. Ciudad, país,
código ISO y coordenadas los rellena Nominatim. Al guardar te da la URL para
grabar en el chip.

No hay nada más que rellenar: una pegatina es un lugar y nada más.

Si el lugar no aparece en el buscador, hay un enlace para introducirlo a mano.

### 5. Prueba el escaneo

Abre esa URL. Debe mostrar el souvenir y la ciudad. **Ese es el criterio de
aceptación de la fase 1.**

Para probarlo desde el móvil, graba la pegatina con un registro NDEF de tipo
URI sustituyendo `localhost` por la IP que imprime `npm run dev` en «Network».

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Build de producción |
| `npm test` | Tests del catálogo, las carpetas de viaje y la geocodificación |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |

## Mapa del código

```
src/
  app/
    page.tsx                 índice de lugares
    t/[slug]/page.tsx        aterrizaje del NFC
    place/[id]/page.tsx      álbum de un lugar
    admin/page.tsx           alta de pegatinas
  components/
    SessionProvider.tsx      token de Drive y catálogo en contexto
    Shell.tsx                cabecera, y la puerta de «conecta tu Drive»
    SetupNeeded.tsx          pantalla de primer arranque
    PlaceSearch.tsx          buscador de ciudades con debounce
  lib/
    google/gis.ts            token de Google, sin nada persistido  ← tests
    google/drive.ts          cliente REST de Drive                 ← tests
    catalog.ts               souvenirs.json: lugares y pegatinas    ← tests
    trips.ts                 fechas → carpeta del viaje             ← tests
    geocode.ts               búsqueda en Nominatim                  ← tests
    env.ts                   el único client ID
docs/
  postgres-index-phase5.sql  esquema guardado para cuando el mapa pese
```

## Estado de verificación

Comprobado automáticamente: 31 tests, typecheck, lint, build, y las cuatro
rutas respondiendo tanto sin configurar como con client ID puesto.

Comprobado a mano contra Google: **el consentimiento, la creación de la carpeta
y la escritura de `souvenirs.json` funcionan.** La búsqueda de lugares se
verificó contra la API real de Nominatim con cuatro casos, incluido uno sin
campo de ciudad (Machu Picchu).

Sin comprobar: la subida de ficheros, que todavía no existe (fase 2).

## Notas

- Next.js 16: `params` es asíncrono y se lee con `use()` en componentes de
  cliente. El antiguo `middleware.ts` ya no existe aquí — no hay nada que
  refrescar en el servidor.
- Si renombras rutas, borra `.next/` antes de `tsc`: los tipos generados
  siguen apuntando a las carpetas viejas.
- `ensurePath` no es atómico. Dos pestañas creando la misma carpeta a la vez
  pueden producir un duplicado, porque Drive permite nombres repetidos.
- Las pegatinas sobre souvenirs metálicos necesitan chips *on-metal* con capa
  de ferrita. Las normales no funcionan pegadas a metal.
- En el iPhone, *Ajustes › Cámara › Formatos › Más compatible*: cambia HEIC por
  JPEG y HEVC por H.264. Sin eso, la fase 2 necesitaría un transcodificador.
