# Aitor bajo el agua

Mi bitácora de buceo: un descenso en 3D que se controla con el scroll, con profundímetro, modo día y noche, estadísticas y perfiles de cada inmersión registrada con Pro Dive en el Apple Watch.

## Desarrollo

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # genera dist/
npm run preview   # sirve dist/ en local
```

## Panel privado (/admin)

Las inmersiones viven en Supabase. La web las lee de ahí (si Supabase no está configurado, usa la copia de `src/data/dives.json`) y en `/admin`, con tu email y contraseña, puedes subir exportaciones de Pro Dive (.uddf), borrar inmersiones, ocultarlas de la web y elegir en qué estadísticas cuenta cada una (por ejemplo, sacar del SAC una inmersión de prácticas). Lo que se apaga en una inmersión tampoco aparece en su ficha. Las que ya están se saltan, por id o por hora de inicio. En el mismo panel se gestionan las titulaciones (conseguidas y pendientes), que salen en la sección «Formación». El mapa de «Dónde he buceado» se dibuja solo con las coordenadas de cada inmersión.

Configuración, una sola vez:

1. Crea un proyecto en [supabase.com](https://supabase.com).
2. En **SQL Editor**, ejecuta `supabase/schema.sql`.
3. En **Authentication → Users → Add user**, crea tu usuario con email y contraseña (marca *Auto Confirm User*).
4. En **SQL Editor**, hazlo administrador: `insert into public.admins (user_id) select id from auth.users where email = 'tu@email.com';`
5. En **SQL Editor**, ejecuta también `supabase/migrations/002_ajustes.sql` (ajustes de qué se muestra en la web), `supabase/migrations/003_formacion.sql` (titulaciones) y `supabase/migrations/004_album.sql` (álbum de especies).
6. En **Authentication → Sign In / Providers**, desactiva *Allow new users to sign up*, para que nadie más pueda registrarse.
7. La URL y la clave publicable ya están en `.env` (son públicas por diseño), así que no hace falta configurar nada en Vercel. Para probar otro proyecto, ponlas en `.env.local`, que tiene prioridad y no se sube.

También se puede importar desde la terminal a `src/data/dives.json` (copia local):

```bash
npm run import -- ~/Downloads/ProDive_16_2026-09-13_1010.uddf
```

## Estructura

```
index.html          contenido de la página y el selector día/noche
src/main.js         estadísticas, titulaciones, perfiles de inmersión, profundímetro y scroll
src/map.js          mapa de sitios de buceo: costa dibujada en SVG, sin servicios de mapas
src/data/land.json  costa ya proyectada (se regenera con `node scripts/build-land.mjs`, por ejemplo para ampliar la región)
src/scene.js        escena 3D con three.js (cielo, mar, arrecife, pulpo, medusas, luz del submarinista)
src/fauna.js        peces: bancos, peces que deambulan por la pantalla, salmonetes y raya en la arena
src/diver.js        animación del submarinista: solo aletean las piernas, cuerpo y manos quietos
src/styles.css      estilos y temas día/noche
src/data/dives.json bitácora: las inmersiones importadas
src/lib/uddf.js     lector de archivos UDDF (Pro Dive)
src/lib/logbook.js  fusión sin duplicados, estadísticas y consumo de aire
src/lib/supabase.js cliente de Supabase: inmersiones y titulaciones
admin.html, src/admin.*  panel privado: login, inmersiones y titulaciones
album.html, src/album/  álbum de especies
supabase/schema.sql tablas y reglas de acceso (y migrations/ con los cambios posteriores)
scripts/            importador de inmersiones, conversor del modelo a low poly y generador de la costa del mapa
public/models/      submarinista y máscara nomai (GLB)
```

## Despliegue

Vercel detecta Vite automáticamente: importa el repo en vercel.com/new y deja la configuración por defecto (build `npm run build`, salida `dist`). Cada push a `main` se publica solo.

- `api/keepalive.js` + `crons` en `vercel.json`: una vez al día lee una fila de Supabase para que el proyecto gratuito no se pause por inactividad.
- La tarjeta para compartir (`public/og.jpg`, etiquetas `og:` en `index.html`) apunta a la dirección oficial, https://bitacora-aitor.vercel.app (constante `SITE` en `vite.config.js`).
- `404.html`: página de error con el estilo de la web.
- Estadísticas de visitas: Vercel Web Analytics (`@vercel/analytics`); hay que activarlo una vez en la pestaña Analytics del proyecto.

## Próximos pasos

- Sustituir la fauna geométrica por modelos glTF.

## Álbum de especies (/album)

Un álbum de cromos con 59 especies que se pueden ver buceando en España (Mediterráneo, Atlántico y Canarias). Cada cromo es una figura 3D low poly generada en código; las que no he visto salen en silueta con su nombre, y el marco indica la rareza (común, poco común, rara, muy rara). Al abrir un cromo se ve la figura en 3D, sus datos y un mapa con las zonas donde es más fácil verla.

El álbum público es de solo lectura. Se edita desde el panel (`/admin`, tarjeta «Especies vistas»), que muestra el mismo álbum: al tocar un cromo se marca como visto o se quita, con un solo botón, y el cambio sale al momento en la web. Lo visto se guarda en Supabase, tabla `species_seen` (migración 004); el catálogo vive en el código.

- `src/album/species.js`: catálogo (nombre, nombre científico, grupo, zonas, dato curioso, rareza, zonas calientes y cómo se dibuja).
- `src/album/models.js`: generadores de figuras (peces, morenas, caballito, rayas, cefalópodos, crustáceos...).
- `src/album/ui.js` + `ui.css`: el componente del álbum (rejilla, filtros, visor y mapa), usado por la página pública y por el panel.
- `src/album/sheet.html`: hoja de pruebas solo para desarrollo (`/src/album/sheet.html` con `npm run dev`).

## Easter eggs

En la superficie, a lo lejos, flota el barco tienda de Beedle de The Wind Waker (`public/models/beedle-boat.glb`, convertido con `scripts/convert-boat.mjs`).

Al llegar al fondo, la luz del submarinista se posa sobre una máscara nomai de Outer Wilds medio enterrada en la arena. El sitio se calcula para que quede siempre a la vista (a la derecha del texto en ordenador, debajo en el móvil); es el grupo `easterEgg` de `src/scene.js`.

## Créditos

Modelo 3D del submarinista: [«Diver»](https://sketchfab.com/3d-models/diver-9a415258dec4449c9faf28f11a5b6831) de [ucdavisterc](https://sketchfab.com/ucdavisterc), licencia [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Convertido a low poly (malla simplificada y colores planos) con `scripts/lowpoly-model.mjs`.

Máscara del easter egg: [«Outer Wilds - Nomai Mask scan»](https://sketchfab.com/3d-models/outer-wilds-nomai-mask-scan-cab879e52de8497898dd9c8048a4b5c7) de [09williamsad](https://sketchfab.com/adamw1806), licencia [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Simplificada de 245.000 a 21.600 triángulos con `scripts/lowpoly-textured.mjs`. Outer Wilds es de Mobius Digital.
