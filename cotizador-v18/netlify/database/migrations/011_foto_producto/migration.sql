-- Foto del producto que el vendedor elige de su carrete: panel, inversor,
-- estructura o una obra parecida ya terminada.
-- A diferencia de la foto del recibo, ésta SÍ se imprime: va en una hoja de
-- anexo al final de la propuesta, justo donde antes se desperdiciaba una hoja.
-- La imagen se comprime en el teléfono antes de subirse, así que pesa poco.
ALTER TABLE cotizaciones ADD COLUMN IF NOT EXISTS foto_producto TEXT;
