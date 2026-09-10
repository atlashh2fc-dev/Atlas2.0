#!/bin/bash
# Despliegue a produccion con red de seguridad.
#
# El 2026-09-10 se perdieron cuatro commits de Atlas 2.0: se desplegaron a
# produccion por CLI desde un portatil y nunca se publicaron en el repositorio.
# El siguiente deploy desde Git los borro sin aviso. Este script hace imposible
# repetirlo: solo deja desplegar codigo que ya vive en el remoto.
#
# Uso:  npm run deploy:prod
set -euo pipefail

cd "$(dirname "$0")/.."

fallo() {
  echo "" >&2
  echo "  DESPLIEGUE BLOQUEADO" >&2
  echo "" >&2
  echo "  $1" >&2
  echo "" >&2
  exit 1
}

if [ -n "$(git status --porcelain)" ]; then
  fallo "Hay cambios sin commitear. Produccion quedaria con codigo que no esta
  en ningun commit. Commitea y publica antes de desplegar."
fi

git fetch --quiet origin

sha="$(git rev-parse HEAD)"
if [ -z "$(git branch -r --contains "$sha" 2>/dev/null)" ]; then
  fallo "El commit $(git rev-parse --short HEAD) no existe en ningun remoto.
  Si despliegas ahora, produccion tendra codigo que el repositorio no tiene.
  Publicalo primero:  git push origin HEAD"
fi

if [ "$sha" != "$(git rev-parse origin/main)" ]; then
  fallo "HEAD no es la punta de origin/main. Produccion se despliega desde main
  y solo desde main. Integra tu rama y deja que Vercel despliegue solo."
fi

echo "Verificaciones previas..."
npm test
npx tsc --noEmit

echo ""
echo "El commit ya esta en origin/main. Vercel despliega produccion solo al"
echo "recibir el push. No hace falta desplegar a mano."
echo ""
echo "Si aun asi necesitas forzar el deploy, ejecuta:"
echo "    npx vercel --prod"
echo ""
