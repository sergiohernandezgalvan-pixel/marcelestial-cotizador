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

## Datos de la empresa

**Más → Datos de la empresa** guarda razón social, giro, WhatsApp, correo, sitio, zona de
cobertura y logo. Es lo que sale impreso en las cotizaciones, en la hoja de contacto y en
los vales de almacén. Antes estaba escrito dentro del código, así que toda instalación
sacaba las propuestas con el nombre y el logo de Marcelestial.

Reglas que conviene conocer antes de entregar una instalación a otra empresa:

- Los valores de ejemplo (los de Marcelestial) **sólo aparecen mientras la instalación no
  tenga capturada la razón social**. En cuanto la empresa guarda sus datos, un campo que
  dejó vacío sale vacío: nunca se le presta el correo ni el logo de nadie más.
- Si no sube logo, las hojas salen sin logo. No hereda el de otra empresa.
- Sólo el administrador los cambia. La vendedora y el almacén los leen, porque los
  necesitan para imprimir sus cotizaciones y sus vales.
- El logo se guarda dentro de la base como imagen; no hay que subir archivos al servidor.

La portada de la propuesta también se configura ahí: **foto de portada, misión y visión**.
Vacías, esos bloques no se imprimen y la hoja usa un acomodo sencillo con el título centrado,
en lugar de dejar dos tercios en blanco. Importa porque el texto de misión y visión que traía
la aplicación es el de Marcelestial —habla de eólica y almacenamiento—, y ninguna otra empresa
debería firmarlo.

## Modo y licencia

Son dos cosas distintas y conviene no mezclarlas:

- **`MODO_DEMO = 1`** enciende los **distintivos**: marca de agua en cada hoja, cintilla,
  topes de la versión de prueba y el botón de reiniciar datos.
- **`LICENCIA_HASTA = AAAA-MM-DD`** es el **candado**, y vale para cualquier instalación, sea
  o no demostración. Pasada esa fecha, el servidor deja de trabajar.
- **`LICENCIA_SUSPENDIDA = 1`** apaga el acceso el mismo día, sin esperar a la fecha.

| Variable | Ejemplo | Para qué |
|---|---|---|
| `MODO_DEMO` | `1` | Sellos, topes y botón de reinicio |
| `LICENCIA_HASTA` | `2026-11-14` | Último día de servicio |
| `LICENCIA_SUSPENDIDA` | `1` | Apagar hoy mismo |
| `LICENCIA_GRACIA` | `7` | Días de tolerancia tras la fecha (0 en demo) |
| `TOPE_USUARIOS` | `2` | Cuentas máximas (sólo en demo) |
| `TOPE_COTIZACIONES` | `50` | Cotizaciones máximas (sólo en demo) |
| `VENTAS_WHATSAPP` | `55 7657 4769` | Aparece en los avisos de tope y de bloqueo |

Todas viven en la configuración de Netlify. Quien usa la aplicación es administrador de
**su** instalación, pero no entra al panel de Netlify, así que no puede mover ninguna.

Las tres combinaciones que se usan:

| Caso | `MODO_DEMO` | `LICENCIA_HASTA` | Cómo se ve |
|---|---|---|---|
| Prueba de 30 días | `1` | fecha a 30 días | Con sellos y con topes |
| Cliente que compra material | *(sin poner)* | fecha que se renueva | Limpia, sin sellos ni topes |
| Marcelestial | *(sin poner)* | *(sin poner)* | Limpia y sin caducidad |

El caso de en medio es el que resuelve «si algún día deja de comprar, apagarle el acceso»:
se le pone una fecha corta y se renueva mientras siga comprando. El día que deje de hacerlo
no hay que hacer nada — se apaga solo. Y si hay que apagarla antes, `LICENCIA_SUSPENDIDA`.

**Renovación cada tres meses y días de gracia.** Una fecha que hay que mover a mano depende
de que alguien se acuerde. Por eso una instalación de trabajo no se apaga de golpe: pasada la
fecha entra en **gracia** —7 días por omisión— durante la cual sigue trabajando normal pero
muestra un aviso con los días que faltan y el teléfono de contacto. Agotada la gracia, ahí sí
se congela. En demostración la gracia es cero: la fecha es la fecha.

Calendario de renovación del cliente que compra material:

| Trimestre | `LICENCIA_HASTA` | Renovar antes del |
|---|---|---|
| 1 | `2026-12-15` | 15 de diciembre de 2026 |
| 2 | `2027-03-15` | 15 de marzo de 2027 |
| 3 | `2027-06-15` | 15 de junio de 2027 |
| 4 | `2027-09-15` | 15 de septiembre de 2027 |

Lo que trae encendida una demostración:

- **Cintilla azul en cada hoja impresa** con la leyenda de documento de demostración y la
  fecha de vigencia. Se imprime aunque salga en blanco y negro.
- **Marca de agua diagonal** «DEMOSTRACIÓN · SIN VALIDEZ COMERCIAL» en todas las hojas,
  cotizaciones y vales de almacén incluidos.
- **Topes**: 2 cuentas y 50 cotizaciones, contados en el servidor. Al toparse, el aviso dice
  qué pasó y a qué número escribir; lo ya capturado no se toca y se puede seguir imprimiendo.
- **Tarjeta en Más** con lo que incluye la prueba y un botón de WhatsApp.
- **Al vencer, el sitio queda congelado.** El cliente entra y ve una pantalla que explica
  qué pasó; cotizar, consultar clientes y mover almacén responden 403. Nada se borra:
  su información queda esperando a que se active la licencia y vuelve completa el mismo día.
- **El respaldo sigue vivo aunque la licencia haya vencido o esté suspendida.** Es a
  propósito: lo capturado es del cliente, no de quien le vendió la aplicación, y además ahí
  hay datos personales de terceros.

Sobre lo inamovible, conviene decirlo claro: el sello se dibuja en el navegador, así que
alguien con conocimientos puede borrarlo de una hoja con las herramientas del navegador. Lo
que no puede es seguir usando la aplicación después de la fecha, ni pasarse de los topes,
porque eso lo decide el servidor. El sello es la advertencia; la fecha y los topes son el
candado.

### Entregar una instalación ya configurada

Así se arma una demostración para un cliente, sin que nadie más conozca su contraseña:

1. Sitio nuevo en Netlify desde este repositorio, con su propia base de datos y su propia
   `JWT_SECRET`. Variables `MODO_DEMO = 1` y `DEMO_VENCE` con la fecha (30 días).
2. Entrar y hacer la **configuración inicial** con una cuenta de instalador propia.
3. Capturar en **Más → Datos de la empresa** la razón social, el logo, el contacto, la
   portada y, si quieren, misión y visión. Ajustar tarifas y catálogo si hace falta.
4. En **Usuarios**, dar de alta al dueño con su correo y rol Administrador, **dejando la
   contraseña vacía**. Sale un enlace de invitación: se le manda por WhatsApp.
5. Él abre el enlace, elige su contraseña y entra. La pantalla de acceso ya trae su logo y
   su nombre, porque el servidor los manda antes de iniciar sesión.
6. Cuando el cliente ya entró, **borrar la cuenta de instalador**. La app no deja quedarse
   sin administrador, así que hay que hacerlo en este orden.

El enlace vale **7 días** y sirve **una sola vez**. No se guarda en claro —en la base sólo
queda su huella—, así que si se pierde no se puede recuperar: se usa **Volver a invitar** en
la ficha de esa persona, que genera uno nuevo y anula el anterior. Ese mismo botón es lo que
se usa cuando alguien olvida su contraseña.

### Firma del desarrollador

La aplicación lleva el crédito de quien la hizo, en tres lugares:

- **Pantalla de acceso**: bajo la tarjeta, «Una aplicación de Comercializadora Marcelestial S.A.S.»
- **Más**: una tarjeta con el logo, el giro y el WhatsApp de contacto.
- **Última hoja de la propuesta**: un renglón chico al pie, con el logo a 15 px.

En la aplicación el crédito se queda siempre. El del PDF se puede apagar por instalación con
`CREDITO_PDF = 0` en Netlify, para el cliente que paga y prefiere que su propuesta no lleve la
firma de nadie más. Vale la pena tenerlo presente: la propuesta se la entrega él a su propio
cliente, y ahí la firma ajena puede incomodar. En una demostración conviene dejarla.

### Respaldo

**Más → Respaldo de tu información** descarga un archivo con clientes, cotizaciones,
catálogo, movimientos, vales, seguimiento y configuración. Sólo el administrador.

No lleva las contraseñas —no deben salir ni en un respaldo— ni las fotografías, porque son
data URL de megabytes y reventarían el tamaño de respuesta de la función. En su lugar va,
por renglón, si había foto o no. Las imágenes se conservan desde el botón de imprimir de
cada cotización o vale.

Sobre lo inamovible, conviene decirlo claro: el sello se dibuja en el navegador, así que
alguien con conocimientos puede borrarlo de una hoja con las herramientas del navegador.
Lo que no puede es seguir usando la aplicación después de la fecha, porque eso lo decide el
servidor. El sello es la advertencia; la fecha es el candado.

## Ayuda dentro de la aplicación

Cada campo que se presta a duda lleva un **?** azul junto a su etiqueta: tarifa, número de
servicio, tensión, consumo por horario, periodo, módulos a cotizar, precio por panel, estatus,
hileras del arreglo, logo, usuarios y respaldo. Al tocarlo se abre una explicación corta con el
WhatsApp de contacto al final.

El texto vive en el objeto `AYUDA` dentro de `public/app.js`, no en un servidor: **en un techo
sin señal la ayuda sigue estando**, porque el navegador ya guardó la aplicación completa.

En **Más → Cómo se usa** está el índice de los 14 temas, para quien prefiere leer de corrido.
Agregar un tema es un renglón más en `AYUDA` y un `${pista("clave")}` junto a la etiqueta.

No hay recorrido guiado con flechas encima de la pantalla: estorba siempre y casi nadie lo
termina.

## Órdenes de compra de material

Cuando el instalador marca una cotización como **Ganada**, en el editor aparece la tarjeta
**Material de montaje**: calcula el riel y los clamps que lleva ese proyecto y genera una
orden de compra al proveedor, con folio `OC-2026-0001` por año.

### La regla de consumo

Los puntos de sujeción interiores **los comparten dos paneles vecinos**: un riel con su clamp
detiene el borde de un panel y el del siguiente. Por eso no son 4 piezas por panel.

Por hilera de n paneles hay dos líneas de riel y cada una lleva n+1 posiciones:

    piezas = 2 × paneles + 2 × hileras

Un panel solo lleva 4 piezas; dos en línea llevan 6, no 8. Un proyecto de 51 paneles en 3
hileras lleva 108 rieles y 108 clamps. Por eso la tarjeta pregunta **en cuántas hileras** van
los paneles: sin ese dato el cálculo no puede salir bien.

### El catálogo del proveedor

Vive en `config` bajo la llave `material_proveedor`, no en el código. Cada producto lleva
clave, nombre, detalle, unidad, `por_modulo`, `por_hilera` y sus escalones de precio por
volumen. Hoy trae el riel mini (001) y el clamp (003) con los escalones de 200, 600 y más.

Un producto con `por_modulo` y `por_hilera` en cero no se calcula solo: se captura a mano en
la orden. Ahí entran la estructura, el cable FV y los interruptores de DC cuando estén en
catálogo, **sin tocar código**.

El escalón se cobra por la cantidad total del renglón. 108 piezas caen en el primero ($58 el
riel); hay que pasar de 200 piezas para el segundo, o sea más de 99 paneles.

### Candados

- Una sola orden viva por cotización. Para rehacerla hay que cancelar la anterior, con motivo.
- Las cantidades y los precios se calculan **en el servidor**: el precio del proveedor no se
  negocia desde el navegador. Sólo se respetan los renglones agregados a mano.
- El almacén no entra: una orden de compra no es un movimiento de existencias.
- La orden se marca como enviada cuando se abre para imprimir o compartir.

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
