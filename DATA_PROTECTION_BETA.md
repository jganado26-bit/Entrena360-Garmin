# Protección de datos de Territorio 360 · beta privada

Documento operativo para preparar la prueba social conforme al RGPD y la LOPDGDD. No sustituye una revisión jurídica profesional antes de una publicación abierta o comercial.

## Decisiones de diseño aplicadas

- La beta está limitada a personas adultas.
- El GPS completo se guarda localmente y no se publica por defecto.
- Las estadísticas del grupo, los rankings y el trazado protegido tienen controles separados.
- El trazado compartido elimina automáticamente entre 300 y 800 metros al inicio y al final, según la preferencia elegida.
- Los recorridos cortos no se comparten si no queda un tramo suficiente tras aplicar la zona de privacidad.
- El usuario puede exportar sus datos, eliminar actividades, retirar las opciones sociales y borrar la cuenta online.
- No se incorporan datos cardíacos, respiratorios ni diagnósticos de salud en esta fase.
- No se incluyen publicidad ni analítica de comportamiento.

## Datos que debe completar el responsable antes de distribuir la beta social

Editar `social-config.js` y sustituir:

- `controllerName`: nombre y apellidos o denominación de la entidad responsable.
- `contact`: correo electrónico o medio directo y verificable para ejercer derechos.

No debe abrirse el registro online mientras la política muestre los textos genéricos de prueba.

## Registro de Actividades de Tratamiento resumido

| Campo | Contenido |
| --- | --- |
| Tratamiento | Gestión de usuarios, grupos privados y actividades deportivas de Territorio 360 |
| Interesados | Participantes adultos invitados a la beta |
| Datos | Alias, correo, ciudad aproximada, deporte, fecha, distancia, conquista, preferencias y trazado protegido opcional |
| Finalidades | Prestar la aplicación, calcular conquistas, mostrar actividad del grupo y rankings opcionales |
| Base jurídica | Ejecución del servicio solicitado y consentimiento para funciones sociales opcionales |
| Destinatarios | Miembros del grupo privado y proveedores técnicos contratados |
| Transferencias | Deben revisarse en el contrato y la lista de subencargados del proveedor |
| Conservación | Mientras exista la cuenta o hasta que el usuario retire la opción o solicite la supresión |
| Seguridad | HTTPS, RLS por usuario y grupo, claves públicas en la app, secretos solo en servidor, copias cifradas y acceso administrativo con 2FA |

## Evaluación de impacto: puntos que deben documentarse

1. Flujo completo del dato desde el GPS o archivo del reloj hasta su eliminación.
2. Necesidad y proporcionalidad de cada campo almacenado.
3. Riesgo de revelar domicilio, hábitos, identidad, salud o ausencia del hogar.
4. Riesgo de acceso entre grupos, suplantación o código de invitación filtrado.
5. Medidas: privacidad de extremos, resolución reducida, controles separados, RLS, cifrado, eliminación, registros de consentimiento y respuesta ante incidentes.
6. Pruebas técnicas de las políticas de acceso antes de invitar participantes.
7. Aprobación y fecha de revisión del responsable.

## Protocolo de derechos

- Acceso y portabilidad: botón **Descargar mis datos**.
- Rectificación: edición del nombre y la ciudad aproximada.
- Supresión local: eliminación individual y reinicio del dispositivo.
- Supresión online: botón **Eliminar mi cuenta y datos online**.
- Retirada de opciones: controles de estadísticas, rankings y trazado.
- Solicitudes adicionales: atenderlas mediante el contacto indicado en la política.

## Protocolo de brechas

1. Contener el incidente y conservar evidencias.
2. Identificar datos, usuarios, duración y accesos afectados.
3. Valorar el riesgo para las personas.
4. Documentar todas las decisiones.
5. Si existe riesgo, notificar a la AEPD sin dilación y dentro del plazo legal aplicable.
6. Si el riesgo es alto, informar también a las personas afectadas con instrucciones claras.

## Lista previa a la prueba

- [ ] Responsable y contacto reales visibles en la aplicación.
- [ ] Proyecto de base de datos en región europea.
- [ ] Contrato de encargado y subencargados revisados.
- [ ] SQL actualizado ejecutado y políticas RLS verificadas con dos cuentas de prueba.
- [ ] Copias de seguridad, accesos administrativos y 2FA configurados.
- [ ] Registro de Actividades de Tratamiento completado.
- [ ] Análisis de riesgos y EIPD revisados y fechados.
- [ ] Participantes informados de que es una beta privada para adultos.
- [ ] Procedimiento de derechos y brechas probado.
