# Territorio 360

Aplicación web instalable (PWA) de exploración activa inspirada en el geocaching. Convierte recorridos a pie, corriendo, nadando o en bicicleta en parcelas conquistadas sobre el mapa.

## Primera versión

- Registro GPS en tiempo real con distancia, duración, ritmo/velocidad y precisión.
- Cuadrícula de parcelas de aproximadamente 100 metros.
- Cuatro modalidades con puntuación equilibrada: correr, caminar, bicicleta y natación.
- Entornos: urbano, campo, bosque, montaña, costa y agua.
- Puntos personales por descubrir, hallazgos, misiones, niveles e insignias.
- Importación de rutas GPX grabadas con Garmin u otro reloj.
- Modo de demostración sin salir de casa.
- Copia y restauración de todos los datos.
- Datos privados guardados en el dispositivo.

## Probar en local

La geolocalización necesita un contexto seguro. `localhost` se considera seguro para desarrollo:

```bash
python3 -m http.server 8080
```

Después abre `http://localhost:8080`.

## Publicación

El flujo de GitHub Actions publica la rama `main` en GitHub Pages. En la configuración del repositorio, selecciona **Settings → Pages → Source: GitHub Actions** la primera vez.

## Evolución prevista

La versión actual es individual y funciona sin cuentas. La siguiente fase necesita un backend para sincronizar usuarios, equipos, retos compartidos y propiedad competitiva de territorios. Antes de abrir esa parte al público habrá que añadir reglas de privacidad, moderación y protección frente a falsificación de GPS.

## Mapas y privacidad

El mapa utiliza OpenStreetMap con la atribución correspondiente. La aplicación no precarga ni almacena teselas del mapa. Para una publicación con muchos usuarios deberá contratarse un proveedor de teselas con capacidad y condiciones adecuadas.
