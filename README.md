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
src/styles.css      estilos y temas día/noche
src/data/sample.js  datos de ejemplo (se sustituirán por las inmersiones importadas)
public/             archivos estáticos
```

## Despliegue

Vercel detecta Vite automáticamente: importa el repo en vercel.com/new y deja la configuración por defecto (build `npm run build`, salida `dist`). Cada push a `main` se publica solo.

## Próximos pasos

- Importador de inmersiones desde el archivo exportado de Pro Dive, sin duplicados.
- Login y panel privado para subir las inmersiones.
- Sustituir los modelos geométricos por modelos glTF.
