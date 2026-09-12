# Cotizador Marcelestial — aplicación web e instalable

Aplicación para generar, guardar y dar seguimiento a cotizaciones, con catálogo de precios
central, directorio de clientes e inventario de perfiles y herrajes.

- **Administrador general (dueño):** ve todo, define precios, da de alta al equipo, controla inventario
  y es el único que puede cancelar un vale.
- **Vendedor:** ve únicamente sus propias cotizaciones y clientes; captura cantidades, no precios.
  Consulta existencias, pero no mueve almacén.
- **Almacén:** registra entradas, salidas y devoluciones de material, y consulta el kardex.
  No cotiza y **no ve precios**: el servidor no se los manda.

---

## 1. Qué ya está configurado en Netlify

| Elemento | Estado |
|---|---|
| Sitio `marcelestial-cotizador` | Creado |
| URL | `https://marcelestial-cotizador.netlify.app` |
| Variable `JWT_SECRET` | Configurada (llave de las sesiones) |
| Base de datos Postgres | Se crea sola en el primer despliegue |
| Tablas y catálogo base | Se crean solas con la migración incluida |

## 2. Publicarla (una sola vez)

Necesitas [Node.js](https://nodejs.org) instalado. Descomprime la carpeta, abre una terminal
dentro de ella y ejecuta:

```bash
npx netlify-cli login
npx netlify-cli link --id 6c223950-2540-4f7c-ae78-2717429a7e03
npx netlify-cli deploy --build --prod
```

El primer comando abre el navegador para autorizar tu cuenta. El tercero instala dependencias,
crea la base de datos, aplica las tablas y publica el sitio. Tarda un par de minutos.

### Alternativa: despliegue automático desde GitHub

Sube esta carpeta a un repositorio de GitHub y en Netlify entra a
**marcelestial-cotizador → Project configuration → Build & deploy → Link repository**.
A partir de ahí, cada cambio que subas se publica solo.

## 3. Primer uso

1. Abre `https://marcelestial-cotizador.netlify.app`
2. La primera pantalla es **Configuración inicial**: crea ahí tu cuenta de administrador
   (nombre, correo y contraseña de al menos 8 caracteres). Esto solo aparece una vez.
3. Entra a **Más → Catálogo y precios** y captura los precios reales. Todos los conceptos
   nacen en $0.00 a propósito.
4. Entra a **Más → Vendedores** y da de alta a tu equipo.
5. En **Almacén → Existencias**, registra la existencia inicial de perfiles y herrajes con un
   movimiento de tipo *Ajuste*.

## 4. Instalar en el celular

- **Android:** abre la liga en Chrome → menú (⋮) → *Instalar aplicación*.
- **iPhone:** abre la liga en Safari → botón compartir → *Agregar a inicio*.

Queda con ícono propio, se abre a pantalla completa y funciona como app.

---

## Líneas de negocio y cotización rápida

La app maneja tres líneas: **fotovoltaico**, **perfiles y herrajes** y **servicios eléctricos**.
Cada concepto del catálogo pertenece a una línea.

Al tocar **+** en Cotizaciones se elige entre:

- **Cotización rápida** — para dar precio en el momento. En fotovoltaico pide número de
  paneles, watts por panel, tensión, inversores y marca; calcula kWp, producción bimestral
  y total al instante, y genera el PDF. En perfiles y en servicios eléctricos muestra los
  conceptos de esa línea con una casilla de cantidad.
- **Cotización formal** — propuesta completa con detalle técnico y análisis de ahorro.

Los precios del cálculo rápido se configuran en **Más → Cotizador rápido**:
precio por panel, por inversor, estructura por panel, material eléctrico por kWp,
mano de obra por kWp, paneles por inversor y factor de producción de la zona.

### Desde el recibo de CFE

- **Tipos de panel.** Los que maneja la empresa: **710, 715 y 720 W** (migración 015; antes
  salía un 725 W que no existe). Se editan en **Más → Cotizador fotovoltaico → Configurar
  parámetros**. Son tres renglones fijos: se renombran, no se agregan ni se quitan.
- **Precio por módulo.** Sale de la tabla **Más → Configurar tarifas**, por tarifa, tensión y
  cantidad de módulos (por ejemplo GDMTH en 440 V: $11,500 hasta 99 módulos y $11,000 de ahí
  en adelante). Para dar otro precio en una cotización concreta, el dueño escribe el número en
  el campo **Precio por módulo** del formulario del recibo antes de guardar; el vendedor lo ve
  pero no lo cambia.
- El total es **módulos × precio por módulo**. Los módulos salen del consumo del recibo entre
  los días del periodo; si se quiere cotizar menos (espacio en el techo), se escribe la cantidad
  en **Módulos a cotizar**.

## Seguimiento

Cada cotización tiene bitácora: se escriben notas fechadas ("le llamé, lo ve el viernes")
y se cambia el estatus desde ahí. Queda registrado quién escribió cada nota.

## Inventario

Las salidas se ligan a **cliente o empresa** y a una **fecha de entrega**, para responder
cuántas piezas hay en stock, cuántas se entregaron, cuándo y a quién.

## Pendiente

- Lectura automática del recibo de CFE por foto (siguiente etapa).
- Migrar el diseño completo del documento de 6 páginas del cotizador original.

## Estructura del proyecto

```
netlify.toml                          configuración de Netlify
package.json                          dependencias
netlify/database/migrations/          tablas y catálogo inicial (SQL)
netlify/functions/api.mjs             toda la API (una sola función)
netlify/lib/core.mjs                  sesiones, contraseñas, utilidades
public/index.html                     estructura de la app
public/app.js                         lógica de la interfaz
public/styles.css                     diseño
public/sw.js                          modo instalable y sin conexión
public/icons/                         íconos y logotipos
```

## Modelo de datos

- **usuarios** — correo, nombre, rol (`owner` / `vendedor`), contraseña cifrada, activo
- **clientes** — datos del cliente y quién lo capturó
- **catalogo** — clave, categoría, descripción, unidad, precio, existencia y mínimo
- **movimientos** — historial de entradas, salidas y ajustes de inventario
- **cotizaciones** — folio, cliente, vendedor, estatus, detalle técnico, partidas, análisis de ahorro y total

## Seguridad

- Contraseñas cifradas con `scrypt` y sal aleatoria por usuario; nunca se guardan en claro.
- Sesiones con token firmado (HMAC-SHA256) que caduca a los 30 días.
- El servidor valida el rol en **cada** petición: un vendedor no puede leer ni editar
  cotizaciones ajenas aunque manipule la aplicación desde el navegador.
- Los precios solo se pueden modificar con rol de administrador.

## Seguridad de las sesiones

- El token de sesión lleva escrita la **versión** de la cuenta (`usuarios.token_version`).
  Cambiar la contraseña, cambiar el rol o dar de baja a alguien sube esa versión y **todos
  los tokens viejos de esa persona dejan de servir al instante**, aunque no hayan vencido.
  Es lo que hay que hacer cuando se pierde un teléfono: cambiarle la contraseña a esa cuenta.
- A quien cambia su propia contraseña se le devuelve un token nuevo, así que no se le cae la
  sesión donde está trabajando; las demás sí se cierran.
- Las peticiones tienen un tope de **14 MB**. Cada foto ya venía limitada a 4 MB por separado.
- `netlify.toml` publica `Content-Security-Policy` y `Permissions-Policy`. La política todavía
  permite `'unsafe-inline'` en los scripts porque la app usa manejadores `onclick` escritos en
  el HTML; moverlos a `addEventListener` es trabajo pendiente y deja la política estricta.

## Costo

Todo cabe en el plan gratuito de Netlify para un equipo de este tamaño: 100 GB de tráfico,
125 000 llamadas a funciones al mes y la base de datos Postgres incluida.

---

## Almacén: vales y kardex

Toda salida de material se documenta con un **vale**. Un vale es un solo documento con folio que
agrupa lo que salió en una misma entrega: 20 rieles + 40 ángulos + tornillería son **un** vale, no
tres movimientos sueltos que después nadie relaciona.

| Tipo | Folio | Qué hace |
|---|---|---|
| Salida | `VS-2026-0001` | Descuenta del almacén. A una obra, a un cliente o a una instalación propia. |
| Entrada | `VE-2026-0001` | Suma al almacén. Material que llega de Alyex o del proveedor de herraje. |
| Devolución | `VD-2026-0001` | Suma al almacén. Sobrante que regresa de una obra; se liga al vale de salida original. |

Cada vale guarda **fecha, cliente, obra o destino, cotización (si la hay), quién entregó, quién
recibió, su teléfono y su firma**. La firma se traza con el dedo en la pantalla y sale impresa en el
documento.

### Cómo se hace una salida

1. **Almacén → botón +→ A obra o cliente.**
2. Elige el cliente: aparecen sus cotizaciones. Al elegir una, un botón precarga los conceptos de
   estructura que lleva. El almacenista ajusta lo que realmente sale.
3. También se puede escribir la obra a mano, sin cotización: las instalaciones propias y las ventas
   de mostrador no tienen cotización de por medio y así sí se pueden registrar.
4. Captura quién entregó, quién recibió y —si está presente— su firma.
5. Al guardar se descuenta el material y sale el documento para imprimir o mandar por WhatsApp.

Si a un concepto no le alcanza la existencia, **el vale completo se rechaza** y no se descuenta nada:
nunca queda una entrega a medias.

### Corregir y cancelar

Las personas, el teléfono, la firma y las notas se pueden corregir después. **Las cantidades no.**
Para corregir una cantidad, el administrador cancela el vale —escribiendo el motivo— y se hace otro.
Al cancelar, el material regresa al almacén con movimientos inversos y el vale queda marcado con su
motivo. Así el kardex siempre cuadra con lo que pasó en el piso.

### Kardex

**Almacén → Kardex** responde las tres preguntas de siempre, con filtros por concepto, cliente, tipo
y fechas:

- ¿Cuánto 2442 se ha ido a la obra X?
- ¿Qué material se le entregó al cliente Y en agosto?
- ¿Quién recibió el vale VS-2026-0031?

Los totales por concepto se calculan solos. En la base de datos existe la vista `kardex` para
consultar lo mismo con SQL, sin pasar por la app.

### Movimientos rápidos

En **Existencias**, al tocar un concepto se registra una **entrada rápida** (sin vale) o un **ajuste
de conteo**. Las salidas ya no se pueden hacer así, a propósito: una salida sin vale es material que
sale del almacén sin que quede quién lo recibió.

---

## Seguridad

- `JWT_SECRET` **ya no tiene valor por defecto**. Si falta, o si conserva el texto de ejemplo, la API
  se detiene y dice exactamente qué configurar en Netlify. Verifícalo antes de desplegar: sin esa
  variable no entra nadie, incluido tú.
- Cinco intentos de contraseña fallidos bloquean la cuenta 15 minutos. Cambiar la contraseña levanta
  el bloqueo.
- Los errores del servidor ya no muestran la consulta ni los nombres de las tablas: sale una
  referencia de seis letras que se busca en el registro de Netlify.
- Borrar un concepto del catálogo que ya tiene historial lo **desactiva** en lugar de borrarlo. El
  historial de entregas no se pierde nunca.
- Los movimientos de inventario son atómicos: dos salidas simultáneas del mismo concepto ya no dejan
  piezas fantasma en el sistema.
