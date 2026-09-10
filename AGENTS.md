# Reglas estrictas de producción

## Publicar antes de desplegar

- Producción se despliega **solo** desde `origin/main`. Un push a `main` dispara el deploy automáticamente; no hace falta desplegar a mano.
- **Nunca ejecutar `vercel --prod` (ni `vercel deploy --target production`) con un commit que no esté ya en `origin`.** El CLI sube el disco local, no el repositorio: si el commit no está publicado, producción queda con código que nadie más tiene y el siguiente deploy desde Git lo borra sin aviso.
- Esto no es hipotético. El 2026-09-10 se perdieron así cuatro commits (`76e0fb3`, `f464129`, `1137230`, `3fd2ba0`): se desplegaron por CLI desde un portátil y jamás se publicaron.
- Antes de cualquier deploy manual: `git status` limpio y `git push origin HEAD`. Si `git branch -r --contains HEAD` sale vacío, el commit no está publicado; publícalo o no despliegues.
- Si `.git` está roto o el push falla, **detente y avísalo**. Desplegar no es una alternativa a publicar: es la forma de perder el trabajo.
- Para desplegar con las verificaciones puestas: `npm run deploy:prod`.
- Para detectar deriva entre producción y el repositorio: `npm run auditar:prod`.

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
