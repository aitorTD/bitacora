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

Las inmersiones viven en Supabase. La web las lee de ahí (si Supabase no está configurado, usa la copia de `src/data/dives.json`) y en `/admin`, con tu email y contraseña, puedes subir exportaciones de Pro Dive (.uddf), borrar inmersiones, ocultarlas de la web, sacarlas del cálculo de consumo (SAC) y elegir qué estadísticas se muestran. Las que ya están se saltan, por id o por hora de inicio.

Configuración, una sola vez:

1. Crea un proyecto en [supabase.com](https://supabase.com).
2. En **SQL Editor**, ejecuta `supabase/schema.sql`.
3. En **Authentication → Users → Add user**, crea tu usuario con email y contraseña (marca *Auto Confirm User*).
4. En **SQL Editor**, hazlo administrador: `insert into public.admins (user_id) select id from auth.users where email = 'tu@email.com';`
5. En **SQL Editor**, ejecuta también `supabase/migrations/002_ajustes.sql` (ajustes de qué se muestra en la web).
6. En **Authentication → Sign In / Providers**, desactiva *Allow new users to sign up*, para que nadie más pueda registrarse.
7. La URL y la clave publicable ya están en `.env` (son públicas por diseño), así que no hace falta configurar nada en Vercel. Para probar otro proyecto, ponlas en `.env.local`, que tiene prioridad y no se sube.

También se puede importar desde la terminal a `src/data/dives.json` (copia local):

```bash
npm run import -- ~/Downloads/ProDive_16_2026-09-13_1010.uddf
```

## Estructura

```
index.html          contenido de la página y el selector día/noche
src/main.js         estadísticas, perfiles de inmersión, profundímetro y scroll
src/scene.js        escena 3D con three.js (cielo, mar, arrecife, fauna, linterna)
src/diver.js        animación del submarinista: solo aletean las piernas, cuerpo y manos quietos
src/styles.css      estilos y temas día/noche
src/data/dives.json bitácora: las inmersiones importadas
src/lib/uddf.js     lector de archivos UDDF (Pro Dive)
src/lib/logbook.js  fusión sin duplicados, estadísticas y consumo de aire
src/lib/supabase.js cliente de Supabase: leer, añadir y borrar inmersiones
admin.html, src/admin.*  panel privado: login, importar y borrar
supabase/schema.sql tablas y reglas de acceso
scripts/            importador de inmersiones y conversor del modelo a low poly
public/models/      submarinista y máscara nomai (GLB)
```

## Despliegue

Vercel detecta Vite automáticamente: importa el repo en vercel.com/new y deja la configuración por defecto (build `npm run build`, salida `dist`). Cada push a `main` se publica solo.

## Próximos pasos

- Sustituir la fauna geométrica por modelos glTF.

## Easter egg

Al llegar al fondo, la luz del submarinista se posa sobre una máscara nomai de Outer Wilds medio enterrada en la arena. El sitio se calcula para que quede siempre a la vista (a la derecha del texto en ordenador, debajo en el móvil); es el grupo `easterEgg` de `src/scene.js`.

## Créditos

Modelo 3D del submarinista: [«Diver»](https://sketchfab.com/3d-models/diver-9a415258dec4449c9faf28f11a5b6831) de [ucdavisterc](https://sketchfab.com/ucdavisterc), licencia [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Convertido a low poly (malla simplificada y colores planos) con `scripts/lowpoly-model.mjs`.

Máscara del easter egg: [«Outer Wilds - Nomai Mask scan»](https://sketchfab.com/3d-models/outer-wilds-nomai-mask-scan-cab879e52de8497898dd9c8048a4b5c7) de [09williamsad](https://sketchfab.com/adamw1806), licencia [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Simplificada de 245.000 a 21.600 triángulos con `scripts/lowpoly-textured.mjs`. Outer Wilds es de Mobius Digital.
