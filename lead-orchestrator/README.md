# Atlas Lead Orchestrator

Servicio independiente del CRM y del motor telefonico. Selecciona leads de
campanas activas, los reserva transaccionalmente y los asigna a ejecutivos de
Atlas que se encuentren disponibles.

No se conecta a Asterisk, no origina llamadas y no comparte proceso con
`dialer-engine/`.

## Ejecucion

```bash
cp .env.example .env
npm ci
npm run build
npm start
```

El endpoint `GET /health` informa el ultimo ciclo procesado. Una campana solo
participa cuando `lead_orchestrator_configs.is_active = true`.

