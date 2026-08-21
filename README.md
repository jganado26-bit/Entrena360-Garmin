# Territorio 360

Aplicación Android y web instalable (PWA) de exploración activa inspirada en el geocaching. Convierte recorridos a pie, corriendo, nadando o en bicicleta en territorio visible sobre el mapa.

## Versión 0.2

- Registro GPS en tiempo real con distancia, duración, ritmo/velocidad y precisión.
- Los circuitos de al menos 500 m que terminan a menos de 100 m del inicio delimitan y colorean la zona interior siguiendo el trazado real.
- Las rutas abiertas conquistan distancia lineal sobre el camino recorrido.
- Dos clasificaciones independientes: distancia total (todos los kilómetros, incluso repetidos) y conquista (solo zonas o tramos nuevos).
- Cuatro modalidades con puntuación equilibrada: correr, caminar, bicicleta y natación.
- Entornos: urbano, campo, bosque, montaña, costa y agua.
- Puntos personales por descubrir, hallazgos, misiones, niveles e insignias.
- Importación de rutas GPX grabadas con Garmin u otro reloj.
- Pantalla de fuentes preparada para integrar Health Connect como concentrador de relojes y aplicaciones Android.
- Modo de demostración sin salir de casa.
- Copia y restauración de todos los datos.
- Datos privados guardados en el dispositivo.

La experiencia social, las cuentas y las clasificaciones reales por ciudad necesitan un backend. El diseño de esa fase está definido en [PRODUCT.md](PRODUCT.md).

## Probar en local

La geolocalización necesita un contexto seguro. `localhost` se considera seguro para desarrollo:

```bash
python3 -m http.server 8080
```

Después abre `http://localhost:8080`.

## Publicación

El flujo de GitHub Actions publica la rama `main` en GitHub Pages. En la configuración del repositorio, selecciona **Settings → Pages → Source: GitHub Actions** la primera vez.

## Evolución prevista

La versión actual es individual y funciona sin cuentas. La siguiente fase conectará Health Connect con autorización explícita para cada ruta importada. Después se añadirá el backend de usuarios, seguidores, mapas compartidos y clasificaciones por ciudad. Antes de abrir esa parte al público habrá que añadir privacidad de domicilio, moderación y protección frente a falsificación de GPS.

## Mapas y privacidad

El mapa utiliza OpenStreetMap con la atribución correspondiente. La aplicación no precarga ni almacena teselas del mapa. Para una publicación con muchos usuarios deberá contratarse un proveedor de teselas con capacidad y condiciones adecuadas.
