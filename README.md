# Aitor bajo el agua

Mi bitácora de buceo: un descenso en 3D que se controla con el scroll, con profundímetro, modo día y noche, estadísticas y perfiles de cada inmersión registrada con Pro Dive en el Apple Watch.

## Desarrollo

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # genera dist/
npm run preview   # sirve dist/ en local
```

## Estructura

```
index.html          contenido de la página y el selector día/noche
src/main.js         estadísticas, perfiles de inmersión, profundímetro y scroll
src/scene.js        escena 3D con three.js (cielo, mar, arrecife, fauna, linterna)
src/diver.js        rig y animación procedural del submarinista (esqueleto, aleteo, postura)
src/styles.css      estilos y temas día/noche
src/data/sample.js  datos de ejemplo (se sustituirán por las inmersiones importadas)
public/models/      modelo 3D del submarinista (GLB)
```

## Despliegue

Vercel detecta Vite automáticamente: importa el repo en vercel.com/new y deja la configuración por defecto (build `npm run build`, salida `dist`). Cada push a `main` se publica solo.

## Próximos pasos

- Importador de inmersiones desde el archivo exportado de Pro Dive, sin duplicados.
- Login y panel privado para subir las inmersiones.
- Sustituir la fauna geométrica por modelos glTF.

## Créditos

Modelo 3D del submarinista: [«Diver»](https://sketchfab.com/3d-models/diver-9ee9b8b722ed457da424869cd8d08b1a) de [nolanfa](https://sketchfab.com/nolanfa), licencia [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Se le ha añadido un esqueleto y animación por código.
