# Preparar una prueba privada de Territorio 360

Esta beta está pensada para un grupo pequeño y de confianza. La aplicación sigue funcionando en modo local si no se configura el servidor o se pierde la conexión.

## 1. Crear el servidor gratuito

1. Crea un proyecto en [Supabase](https://supabase.com/dashboard).
2. Abre **SQL Editor**, crea una consulta nueva, pega todo el contenido de [`supabase/schema.sql`](supabase/schema.sql) y ejecútalo.
3. En **Authentication → Providers → Email**, decide cómo validar a los participantes:
   - para una prueba rápida y cerrada, se puede desactivar temporalmente la confirmación de correo;
   - si permanece activa, cada participante deberá confirmar el mensaje recibido antes de entrar.

## 2. Obtener solo la conexión pública

En **Project Settings → API** copia:

- la **Project URL**;
- la **Publishable key**; en proyectos antiguos también sirve la clave pública `anon`.

No copies nunca una **Secret key** ni `service_role`. Esas claves dan privilegios administrativos y no pertenecen dentro de una aplicación.

## 3. Crear el grupo

1. Instala o abre Territorio 360.
2. Ve a **Perfil → Grupo de prueba** e introduce la URL y la clave pública.
3. Crea una cuenta, inicia sesión y crea el grupo.
4. Comparte con los demás el código de ocho caracteres que muestra la aplicación.
5. Cada participante usa la misma URL y clave pública, crea su cuenta y pulsa **Unirme** con ese código.

## 4. Qué se comparte

- Los kilómetros, puntos de conquista, deporte, fuente y fecha se sincronizan al terminar o importar una actividad.
- Los trazados del mapa están desactivados por defecto. Cada persona debe activar **Compartir mi trazado en el mapa**.
- Al desactivar esa opción y sincronizar, los trazados que esa persona había compartido se retiran del mapa del grupo.
- La sesión y los recorridos completos también permanecen guardados localmente en el dispositivo.
- Borrar o reinstalar la aplicación elimina la copia local, pero no borra las actividades que ya se hayan sincronizado en el grupo.

Para esta prueba evita comenzar o terminar recorridos compartidos delante del domicilio. La beta no incorpora todavía una zona automática de privacidad.

## 5. Límites de esta beta

- Un usuario pertenece a un solo grupo.
- Los rankings del grupo usan las actividades de los últimos 30 días.
- No hay notificaciones, moderación ni recuperación automática de grupos.
- Suunto, COROS, Garmin y otras marcas se prueban importando GPX o TCX; la sincronización automática requiere acuerdos/API del fabricante o Health Connect.
- No está preparada todavía para una comunidad pública: primero hay que validar privacidad, juego limpio y costes con el grupo cerrado.
