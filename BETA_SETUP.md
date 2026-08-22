# Preparar una prueba privada de Territorio 360

Esta beta está pensada para un grupo pequeño y de confianza. La aplicación sigue funcionando en modo local si no se configura el servidor o se pierde la conexión.

## 1. Identificar al responsable de la prueba

Antes de permitir cuentas online, edita `social-config.js` y completa `TERRITORIO_LEGAL_CONFIG` con:

- el nombre real de la persona o entidad responsable;
- un correo o medio directo para ejercer los derechos de protección de datos.

El correo de contacto ya está configurado como `territorio360.app@gmail.com`. Mientras el nombre del responsable mantenga el texto genérico, la aplicación bloquea la creación de cuentas nuevas.

## 2. Crear el servidor de prueba

1. Crea un proyecto en [Supabase](https://supabase.com/dashboard).
2. Abre **SQL Editor**, crea una consulta nueva, pega todo el contenido de [`supabase/schema.sql`](supabase/schema.sql) y ejecútalo.
3. En **Authentication → Providers → Email**, decide cómo validar a los participantes:
   - para una prueba rápida y cerrada, se puede desactivar temporalmente la confirmación de correo;
   - si permanece activa, cada participante deberá confirmar el mensaje recibido antes de entrar.

Si el esquema ya se había instalado para una beta anterior, vuelve a ejecutar el archivo completo: incluye las nuevas preferencias, registros de consentimiento y eliminación de cuenta.

## 3. Obtener solo la conexión pública

En **Project Settings → API** copia:

- la **Project URL**;
- la **Publishable key**; en proyectos antiguos también sirve la clave pública `anon`.

No copies nunca una **Secret key** ni `service_role`. Esas claves dan privilegios administrativos y no pertenecen dentro de una aplicación.

## 4. Crear el grupo

1. Instala o abre Territorio 360.
2. Ve a **Perfil → Grupo de prueba** e introduce la URL y la clave pública.
3. Crea una cuenta, inicia sesión y crea el grupo.
4. Comparte con los demás el código de ocho caracteres que muestra la aplicación.
5. Cada participante usa la misma URL y clave pública, crea su cuenta y pulsa **Unirme** con ese código.

## 5. Qué se comparte

- Los kilómetros, puntos de conquista, deporte, fuente y fecha solo se sincronizan si cada persona activa **Compartir estadísticas con mi grupo**.
- La participación en los rankings tiene un control separado.
- Los trazados del mapa están desactivados por defecto. Si se activan, la aplicación elimina entre 300 y 800 metros del inicio y el final y reduce su precisión.
- Las rutas demasiado cortas no muestran trazado después de aplicar la zona de privacidad.
- Al retirar una opción, la aplicación actualiza o elimina la información sincronizada.
- La sesión y los recorridos completos también permanecen guardados localmente en el dispositivo.
- **Eliminar mi cuenta y datos online** borra la cuenta y el contenido sincronizado. **Borrar datos del dispositivo** solo elimina la copia local.

Consulta también [`DATA_PROTECTION_BETA.md`](DATA_PROTECTION_BETA.md) y completa su lista de comprobación antes de invitar participantes.

## 6. Límites de esta beta

- Un usuario pertenece a un solo grupo.
- Los rankings del grupo usan las actividades de los últimos 30 días.
- No hay notificaciones, moderación ni recuperación automática de grupos.
- Suunto, COROS, Garmin y otras marcas se prueban importando GPX o TCX; la sincronización automática requiere acuerdos/API del fabricante o Health Connect.
- No está preparada para una comunidad pública ni para menores. La documentación y configuración deben revisarse profesionalmente antes de un uso abierto o comercial.
