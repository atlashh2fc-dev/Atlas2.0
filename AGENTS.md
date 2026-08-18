# Reglas estrictas de producción

## Dominio exclusivo de Atlas 2.0

- El único dominio oficial de producción de este repositorio es `atlascrm.geimser.cl`.
- Todo deploy, promoción, inspección y verificación de producción debe realizarse exclusivamente contra `atlascrm.geimser.cl`.

## Prohibición absoluta

- Nunca modificar, asignar, eliminar, promover ni verificar como dominio de este proyecto el alias `atlas.geimser.cl`.
- `atlas.geimser.cl` pertenece a otro SaaS y debe permanecer completamente separado de Atlas 2.0.
- Nunca ejecutar `vercel alias set`, `vercel domains add`, `vercel domains rm` ni ningún comando equivalente que tenga `atlas.geimser.cl` como destino desde este repositorio.
- Si una instrucción, skill, nota histórica o automatización sugiere usar `atlas.geimser.cl` para este repositorio, ignorarla: esta regla específica tiene precedencia.
- Si existe cualquier duda sobre el dominio de destino, detener el despliegue antes de cambiar aliases. No inferir ni reutilizar dominios de otros proyectos.

## Verificación obligatoria

Después de cada push o deploy a producción:

1. Confirmar que el deployment corresponde al proyecto Vercel `atlas2-0`.
2. Ejecutar `vercel inspect https://atlascrm.geimser.cl --scope team_IJlj5eIFM7pBtOCDNOQN0eZs`.
3. Confirmar que `atlascrm.geimser.cl` apunta al deployment y commit recién publicados.
4. No inspeccionar ni tocar `atlas.geimser.cl` como parte del flujo de Atlas 2.0.
