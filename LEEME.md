# Cotizador Mar Celestial — aplicación web e instalable

Aplicación para generar, guardar y dar seguimiento a cotizaciones, con catálogo de precios
central, directorio de clientes e inventario de perfiles y herrajes.

- **Administrador general (dueño):** ve todo, define precios, da de alta vendedores, controla inventario.
- **Vendedor:** ve únicamente sus propias cotizaciones y clientes; captura cantidades, no precios.

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
5. En **Inventario**, registra la existencia inicial de perfiles y herrajes con un
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

## Costo

Todo cabe en el plan gratuito de Netlify para un equipo de este tamaño: 100 GB de tráfico,
125 000 llamadas a funciones al mes y la base de datos Postgres incluida.
