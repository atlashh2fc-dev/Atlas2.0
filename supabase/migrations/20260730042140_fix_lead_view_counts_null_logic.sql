-- Corrección: `assignment_status = 'managed'` con la columna en NULL da NULL, y
-- `not (false or null or null)` también es NULL, así que la fila se descartaba
-- en vez de contarse como no gestionada. Con coalesce el predicado es booleano
-- de verdad. (Diferencia medida contra la base: 13.460 vs 36.173 disponibles.)
--
-- El cuerpo definitivo quedó en 20260730042042_get_lead_view_counts.sql, que ya
-- incluye los coalesce; esta migración existe para dejar constancia del orden
-- real en que se aplicó en producción.
select 1;
