# Aitor bajo el agua

Mi bitácora de buceo: un descenso en 3D que se controla con el scroll, con profundímetro, modo día y noche, estadísticas y perfiles de cada inmersión registrada con Pro Dive en el Apple Watch.

## Desarrollo

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # genera dist/
npm run preview   # sirve dist/ en local
```

## Importar inmersiones

Exporta las inmersiones desde Pro Dive (formato UDDF) y ejecuta:

```bash
npm run import -- ~/Downloads/ProDive_16_2026-09-13_1010.uddf
npm run import -- ~/Downloads/exportaciones-prodive/   # o una carpeta entera
```

Se añaden a `src/data/dives.json` y las que ya estaban se saltan, así que puedes volver a importar los mismos archivos sin duplicar nada. Después haz commit y push: Vercel publica la web con los datos nuevos. Los `.uddf` originales no se suben al repo.

## Estructura

```
index.html          contenido de la página y el selector día/noche
src/main.js         estadísticas, perfiles de inmersión, profundímetro y scroll
src/scene.js        escena 3D con three.js (cielo, mar, arrecife, fauna, linterna)
src/diver.js        rig y animación procedural del submarinista (esqueleto, aleteo, postura)
src/styles.css      estilos y temas día/noche
src/data/dives.json bitácora: las inmersiones importadas
src/lib/uddf.js     lector de archivos UDDF (Pro Dive)
src/lib/logbook.js  fusión sin duplicados, estadísticas y consumo de aire
scripts/            importador de línea de comandos
public/models/      modelo 3D del submarinista (GLB)
```

## Despliegue

Vercel detecta Vite automáticamente: importa el repo en vercel.com/new y deja la configuración por defecto (build `npm run build`, salida `dist`). Cada push a `main` se publica solo.

## Próximos pasos

- Login y panel privado para subir las inmersiones desde el navegador.
- Sustituir la fauna geométrica por modelos glTF.

## Créditos

Modelo 3D del submarinista: [«Diver»](https://sketchfab.com/3d-models/diver-9ee9b8b722ed457da424869cd8d08b1a) de [nolanfa](https://sketchfab.com/nolanfa), licencia [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Se le ha añadido un esqueleto y animación por código.
