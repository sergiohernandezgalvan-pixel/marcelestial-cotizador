# Revisión de seguridad · Cotizador Marcelestial

Revisión interna del código, hecha antes de poner la aplicación a la venta.
Fecha: 12 de septiembre de 2026. Versión revisada: **2026.09.12** (v16.2).

Alcance: `netlify/functions/api.mjs` (1,401 líneas), `netlify/lib/core.mjs` (210),
`public/app.js` (4,472), migraciones y `netlify.toml`.

Esta revisión la hizo quien escribió el código, y ésa es su limitación: sirve para
cerrar lo evidente, no sustituye una prueba de penetración externa.

---

## 1. Lo que ya estaba bien

| Punto | Cómo está |
|---|---|
| Contraseñas | scrypt con sal de 16 bytes por usuario, comparación en tiempo constante (`timingSafeEqual`). No hay contraseñas en claro ni MD5/SHA a secas. |
| Inyección SQL | Las 117 consultas usan plantillas parametrizadas. No hay concatenación de texto en SQL en ningún punto. |
| Llave de sesiones | Sólo desde `JWT_SECRET`. Sin llave, o con la llave de ejemplo, la API responde 500 y explica qué configurar, en vez de firmar tokens con un texto que cualquiera podía leer en el repositorio público. |
| Fuerza bruta en el login | 5 intentos fallidos bloquean la cuenta 15 minutos. El mensaje es idéntico exista o no el correo, así que no se puede averiguar qué cuentas están dadas de alta. |
| Permisos | Los roles se validan en el servidor en cada ruta. Esconder botones en el front no es el control. |
| Errores | El `catch` general devuelve una referencia de 6 letras; la consulta y el detalle quedan en el registro del servidor, no en la respuesta. |
| XSS | Todo lo que viene del usuario pasa por `esc()` antes de entrar al HTML. Se revisaron las 42 interpolaciones con datos de usuario: las de los ayudantes (`campo`, `dato`, `fila`, `renglon`) escapan adentro, y el título del modal se asigna con `textContent`. **No se encontró ningún punto sin escapar.** |
| Tamaño de fotos | Cada imagen ya venía limitada: 4 MB por foto, 80 KB la firma, y sólo se aceptan data URL de jpeg/png/webp. |

---

## 2. Lo que se corrigió en esta versión

### 2.1 Las sesiones no se podían revocar · **resuelto**

Un token duraba 30 días y nada lo mataba. Si a un vendedor le robaban el teléfono,
cambiarle la contraseña **no** cerraba la sesión que traía abierta: el ladrón seguía
entrando hasta que el token venciera solo.

Ahora cada cuenta lleva un contador (`usuarios.token_version`, migración 016) y cada
token trae escrita la versión con la que se firmó. Sube la versión —y con eso mueren
todos los tokens viejos de esa persona— cuando:

- se le cambia la contraseña (ella misma o el administrador),
- se le cambia el rol (el token viejo traía el puesto anterior),
- se da de baja la cuenta.

A quien cambia su propia contraseña se le devuelve un token nuevo para que no se le
caiga la sesión donde está trabajando; las demás sí se cierran.

**Procedimiento para teléfono perdido:** cambiarle la contraseña a esa cuenta. Con eso
la sesión del teléfono muere al instante.

### 2.2 Sin tope al tamaño de la petición · **resuelto**

Cada foto estaba limitada por separado, pero una cotización lleva tres y nada impedía
mandar un cuerpo de decenas de megabytes para inflar la base de datos o tumbar la
función. Se agregó un tope de 14 MB por petición, revisado antes de leer el cuerpo.

### 2.3 Faltaba política de contenido · **resuelto**

`netlify.toml` ya publica `Content-Security-Policy` y `Permissions-Policy`. Bloquea que
la página cargue código de otro sitio y que mande datos a un servidor ajeno, que es como
una inyección de código termina en robo de información.

Queda una reserva honesta: la política todavía permite `'unsafe-inline'` en los scripts
porque la aplicación usa 88 manejadores `onclick` escritos dentro del HTML. Moverlos a
`addEventListener` es un trabajo aparte, y hasta que se haga, la política protege menos
de lo que podría.

---

## 2b. Corregido tras una segunda revisión externa (versión 2026.09.20)

Una revisión independiente del código encontró seis puntos. Cuatro eran ciertos y se
corrigieron; dos eran decisiones de diseño que se dejan documentadas.

| Punto | Veredicto | Qué se hizo |
|---|---|---|
| El servidor aceptaba cualquier precio en las partidas | **Cierto y grave** | `revisarPrecios` en `core.mjs`: para quien no es administrador, cada partida se contrasta con la tarifa (SISTEMA-FV), la guía de inversores, el cotizador rápido o el catálogo. Precio distinto o concepto fuera de catálogo → 403. El administrador pasa directo. |
| Cualquier vendedor podía cancelar la orden de otro; el almacén podía cotizar por la API | **Cierto** | Cancelar y marcar enviada: sólo administrador o quien la generó. El almacén queda bloqueado en crear y editar cotizaciones. |
| El vale no se guardaba en una sola transacción | **Cierto** | Migración 021: `registrar_vale` y `cancelar_vale` son funciones de Postgres. Todo el vale ocurre en una transacción; la cancelación bloquea la fila (`FOR UPDATE`) contra dobles cancelaciones simultáneas. |
| La tabla de recuperación decía "recuperada" a los 120 meses aunque quedara saldo | **Cierto** | Si queda saldo dice "más de 120 meses" y el párrafo avisa que conviene revisar dimensionamiento o precio. |
| La orden se marcaba "enviada" al abrirla | **Cierto** | Ya no. Botón explícito "Ya la envié al proveedor". |
| El respaldo no incluía órdenes ni permite restaurar | **Cierto a medias** | Las órdenes ya van. Fotos y firmas siguen fuera a propósito (límite de respuesta de la función). Restaurar desde el archivo sigue pendiente. |
| El ahorro divide el pago total entre el consumo | **Decisión de modelo** | La propuesta lo aclara. En GDMTH el cargo por capacidad no lo elimina el sistema; afinar eso es ajuste comercial, no error de código. |

## 3. Lo que sigue abierto

### 3.1 No hay separación por empresa · **decisión pendiente, es la grande**

No existe `empresa_id` en ninguna tabla ni en ninguna consulta. Hoy no importa porque el
único cliente es Marcelestial. El día que entren dos empresas al mismo sitio, cualquiera
ve los clientes, precios y almacén de la otra.

Dos caminos:

- **Una instalación por cliente.** Cada quien su sitio de Netlify y su base de datos. Se
  puede hacer hoy sin tocar código y el riesgo de fuga entre clientes desaparece. Duele
  cuando haya treinta instalaciones que actualizar.
- **Multiempresa de verdad.** `empresa_id` en todas las tablas y en todas las consultas,
  más Row Level Security en Postgres para que la base misma niegue lo que no toca. Es
  reescribir la capa de datos y es donde se cometen los errores caros.

Recomendación: arrancar a vender con la primera; la segunda cuando ya haya clientes
pagando que justifiquen el trabajo.

### 3.2 Límite de peticiones sólo en el login

El freno por intentos cubre el login. El resto de la API no tiene límite por dirección o
por cuenta: alguien con una sesión válida puede golpear las rutas sin tope. Con pocos
usuarios no se nota; con clientes de verdad conviene un límite por cuenta.

### 3.3 Sin bitácora de cambios de precios y configuración

Los vales sí registran quién hizo qué. Las tarifas, los parámetros del dimensionamiento y
el catálogo no. Si mañana una cotización sale con un precio raro, no hay forma de saber
quién lo cambió ni cuándo.

### 3.4 Respaldos sin procedimiento probado

La base vive en Netlify DB. Falta definir cada cuándo se respalda, dónde queda la copia,
quién la restaura y —lo que casi nunca se hace— probar una restauración completa antes de
necesitarla.

### 3.5 Restaurar desde el respaldo

El respaldo se descarga pero no hay función para volver a cargarlo en una instalación vacía.
Es útil para migrar entre instalaciones y para recuperarse de un borrado. Tiene riesgo propio:
una restauración a medias es peor que ninguna, así que debe hacerse en una transacción y con
conteos por tabla antes y después.

### 3.6 Rotación de la llave de sesiones

No hay procedimiento escrito para cambiar `JWT_SECRET`. Cambiarla cierra todas las
sesiones de todos, que es justo lo que se quiere en una emergencia, pero conviene tenerlo
escrito antes de la emergencia.

---

## 4. Lo que no es técnico y puede costar más

La aplicación guarda recibos de CFE con nombre y domicilio de terceros. Eso es dato
personal bajo la LFPDPPP: hace falta aviso de privacidad, y en el contrato de venta debe
quedar claro quién responde si hay una fuga. Eso lo revisa un abogado, no un programador.

---

## 5. Cómo seguir

1. **Gratis y hoy:** activar Dependabot y `npm audit` en el repositorio, y el escaneo de
   secretos de GitHub. Avisan de librerías con fallas conocidas y de llaves subidas por
   accidente.
2. **Antes de cobrarle al primer cliente externo:** decidir el punto 3.1 y cerrar 3.2 a 3.5.
3. **Antes de venderle a una empresa mediana:** prueba de penetración externa. En México
   la cobran entre 40 y 120 mil pesos según alcance. El entregable es el reporte que los
   clientes empresariales van a pedir.

---

## 6. Pruebas que respaldan esta revisión

- 46 verificaciones funcionales del rol de almacén, vales y kardex: **46 en verde**.
- 14 verificaciones de seguridad de sesiones y tamaño de petición: **14 en verde**.
  Cubren que el token viejo se rechace tras cambio de contraseña, cambio de rol y baja de
  cuenta; que quien cambia su propia contraseña no pierda su sesión; que un cuerpo de
  15 MB se rechace con 413; y que sin token o con token inventado no se entre.
