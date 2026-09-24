#!/usr/bin/env bash
# Despliega el motor de discado en la EC2 dialer-engine-atlas por SSM.
#
#   dialer-engine/scripts/desplegar-motor.sh            # el commit de origin/main
#   dialer-engine/scripts/desplegar-motor.sh d6be9d6    # un commit concreto, ya publicado
#
# Se corre desde el Mac con el AWS CLI configurado. Sólo despliega commits
# que ya están en origin/main (misma regla que producción web: nada sale
# del disco local). Empaqueta dialer-engine/ con git archive, lo sube al
# bucket de releases, y en la EC2: descarga, verifica el SHA-256, instala,
# compila, corre los tests, cambia el symlink /opt/atlas-dialer-engine,
# escribe /etc/atlas-dialer-engine/release.env y reinicia el servicio.
set -euo pipefail

BUCKET=atlas-dialer-deploy-849073005851-sae1
INSTANCIA=i-0973184c0eb23a6b8
REGION=sa-east-1

REPO=$(git rev-parse --show-toplevel)
cd "$REPO"
git fetch -q origin
SHA=$(git rev-parse "${1:-origin/main}")
if ! git branch -r --contains "$SHA" | grep -q 'origin/main'; then
  echo "El commit $SHA no está en origin/main. Publícalo primero (git push origin HEAD:main)." >&2
  exit 1
fi
echo "Commit a desplegar: $(git log -1 --format='%h %s' "$SHA")"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
PAQUETE="$TMP/dialer-engine-$SHA.tar.gz"
git archive --format=tar.gz -o "$PAQUETE" "$SHA" dialer-engine
SUMA=$(shasum -a 256 "$PAQUETE" | cut -d' ' -f1)
aws s3 cp "$PAQUETE" "s3://$BUCKET/releases/dialer-engine-$SHA.tar.gz" --region "$REGION" --only-show-errors
echo "Paquete subido ($SUMA)"

read -r -d '' REMOTO <<EOF || true
set -eu
export PATH=/opt/atlas-node/bin:\$PATH
SHA=$SHA
REL=/opt/atlas-dialer-releases/\$SHA
ANTERIOR=\$(readlink -f /opt/atlas-dialer-engine)
rm -rf \$REL && mkdir -p \$REL
aws s3 cp s3://$BUCKET/releases/dialer-engine-\$SHA.tar.gz /tmp/motor-\$SHA.tgz --region $REGION --only-show-errors
echo "$SUMA  /tmp/motor-\$SHA.tgz" | sha256sum -c
tar xzf /tmp/motor-\$SHA.tgz -C \$REL
cd \$REL/dialer-engine
cp -p \$ANTERIOR/.env .env
npm ci --no-audit --no-fund
npm run build
node --test dist/*.test.js dist/**/*.test.js >/tmp/motor-tests-\$SHA.log 2>&1 || { tail -40 /tmp/motor-tests-\$SHA.log; echo "Tests del motor fallaron; no se despliega." >&2; exit 1; }
grep -E '^(ℹ|# )(tests|pass|fail)' /tmp/motor-tests-\$SHA.log || true
npm prune --omit=dev --no-audit --no-fund
echo "ANTERIOR=\$ANTERIOR" > \$REL/rollback.txt
ln -sfn \$REL/dialer-engine /opt/atlas-dialer-engine
echo ATLAS_RELEASE=\$SHA > /etc/atlas-dialer-engine/release.env
systemctl restart atlas-dialer-engine
sleep 12
echo "servicio: \$(systemctl is-active atlas-dialer-engine)"
curl -fsS http://127.0.0.1:8080/health
echo
journalctl -u atlas-dialer-engine --since "1 minute ago" --no-pager | grep -iE 'error|warn|Suscrito|Realtime' | tail -10 || true
echo "Para volver atrás: ln -sfn \$ANTERIOR /opt/atlas-dialer-engine && systemctl restart atlas-dialer-engine"
EOF

PARAMS=$(python3 -c 'import json,sys; print(json.dumps({"commands":[sys.stdin.read()],"executionTimeout":["900"]}))' <<<"$REMOTO")
ID=$(aws ssm send-command --region "$REGION" --instance-ids "$INSTANCIA" \
  --document-name AWS-RunShellScript --comment "Motor de discado $SHA" \
  --parameters "$PARAMS" --query Command.CommandId --output text)
echo "Comando SSM: $ID (instalando y compilando en la EC2, ~2 min)"

while :; do
  sleep 5
  ESTADO=$(aws ssm get-command-invocation --region "$REGION" --command-id "$ID" --instance-id "$INSTANCIA" --query Status --output text 2>/dev/null || echo Pending)
  case "$ESTADO" in Pending|InProgress|Delayed) printf '.';; *) echo; break;; esac
done
aws ssm get-command-invocation --region "$REGION" --command-id "$ID" --instance-id "$INSTANCIA" \
  --query '[Status,StandardOutputContent,StandardErrorContent]' --output text | tail -40

[ "$ESTADO" = "Success" ] || { echo "El despliegue terminó en estado $ESTADO; revisa la salida de arriba." >&2; exit 1; }
