# Territorio 360

Aplicación Android y web instalable (PWA) de exploración activa inspirada en el geocaching. Convierte recorridos a pie, corriendo, nadando o en bicicleta en territorio visible sobre el mapa.

## Versión 0.5.1 beta privada

- Registro GPS en tiempo real con distancia, duración, ritmo/velocidad y precisión.
- Los circuitos de al menos 500 m que terminan a menos de 100 m del inicio delimitan y colorean la zona interior siguiendo el trazado real.
- Las rutas abiertas conquistan distancia lineal sobre el camino recorrido.
- Dos clasificaciones independientes: distancia total (todos los kilómetros, incluso repetidos) y conquista (solo zonas o tramos nuevos).
- Cuatro modalidades con puntuación equilibrada: correr, caminar, bicicleta y natación.
- Entornos: urbano, campo, bosque, montaña, costa y agua.
- Puntos personales por descubrir, hallazgos, misiones, niveles e insignias.
- Importación de rutas GPX y TCX grabadas con Suunto, COROS, Garmin, Polar, Wahoo y otras marcas.
- Detección del fabricante cuando aparece en el archivo y prevención de importaciones duplicadas.
- Pantalla de fuentes preparada para integrar Health Connect como concentrador de relojes y aplicaciones Android.
- Modo de demostración sin salir de casa.
- Copia y restauración de todos los datos.
- Datos privados guardados en el dispositivo.
- Cuentas y grupos privados mediante código de invitación.
- Ranking del grupo separado entre kilómetros totales y conquista nueva.
- Actividad reciente y capa de mapa compartida con consentimiento explícito.
- Pantalla inicial de información y aceptación para participantes adultos.
- Centro de privacidad con controles separados para estadísticas, rankings y trazado.
- Protección automática de 300, 500 u 800 metros en los extremos de las rutas compartidas y reducción de precisión.
- Descarga de datos, borrado individual de actividades y eliminación de la cuenta online.
- Registro de preferencias en el backend, condiciones de uso y política de privacidad integradas.
- Librería de mapas incluida en la APK para evitar cargar código desde un CDN externo.
- Correo de contacto del proyecto: `territorio360.app@gmail.com`.

Para activar la prueba social, sigue [BETA_SETUP.md](BETA_SETUP.md). Sin configurar el servidor, la aplicación conserva todo el funcionamiento individual.

## Probar en local

La geolocalización necesita un contexto seguro. `localhost` se considera seguro para desarrollo:

```bash
python3 -m http.server 8080
```

Después abre `http://localhost:8080`.

## Publicación

El flujo de GitHub Actions publica la rama `main` en GitHub Pages. En la configuración del repositorio, selecciona **Settings → Pages → Source: GitHub Actions** la primera vez.

## Evolución prevista

La versión actual permite probar cuentas, un grupo privado y clasificaciones compartidas con un backend Supabase propio. La siguiente fase conectará Health Connect con autorización explícita para cada ruta importada. Las conexiones automáticas directas con COROS, Suunto u otros fabricantes requieren registrar Territorio 360 como plataforma, completar sus procesos de acceso y guardar las credenciales en un backend seguro. Antes de abrir la parte social al público habrá que completar la identidad legal del responsable, revisar la EIPD, añadir moderación y reforzar la protección frente a falsificación de GPS.

## Mapas y privacidad

El mapa utiliza OpenStreetMap con la atribución correspondiente. La aplicación no precarga ni almacena teselas del mapa. Para una publicación con muchos usuarios deberá contratarse un proveedor de teselas con capacidad y condiciones adecuadas.
