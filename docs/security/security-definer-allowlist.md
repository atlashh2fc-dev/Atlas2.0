# Allowlist de funciones `SECURITY DEFINER`

Auditoría: 25 de agosto de 2026  
Proyecto Supabase: `lxdclavsycdidmzlbaid`

## Línea base

El Security Advisor reporta 46 `WARN`:

- 45 funciones `SECURITY DEFINER` ejecutables por `authenticated` ([lint 0029](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)).
- 1 configuración de protección de contraseñas filtradas ([Password security](https://supabase.com/docs/guides/auth/password-security)).

También hay 11 `INFO` `rls_enabled_no_policy`. Son tablas internas sin acceso de `anon` ni `authenticated`; RLS sin políticas es su denegación por defecto y no requiere abrir políticas ficticias.

No se aplica una revocación global: estas funciones son la API transaccional que valida sesión, identidad, equipo, campaña y permisos antes de operar datos protegidos.

## Corrección segura y acotada

La migración `20260825225942_restrict_atlas_lead_legacy_ingest_rpc.sql` revoca `authenticated` únicamente en:

- `sync_atlas_lead_mail_campaign`
- `apply_atlas_lead_mail_result_batch`

Ambas pertenecen al transporte heredado de Atlas Lead, no tienen consumidores autenticados en este repositorio y el flujo vigente usa Integration v2. `service_role` se conserva explícitamente para compatibilidad operacional. Al aplicar la migración, la proyección esperada es 43 warnings de funciones más 1 warning de Auth: 44 `WARN` en total.

## Riesgo aceptado: funciones expuestas intencionalmente

### Identidad, sesión y políticas RLS

Estas siete funciones deben ser invocables por `authenticated` porque son predicados de autorización o de sesión usados por RLS y por RPCs superiores:

- `can_manage_campaign`
- `current_role_name`
- `current_team_id`
- `has_active_dial_attempt`
- `is_current_app_session_valid`
- `is_current_session_target_of_command`
- `supervised_team_ids`

Todas derivan la identidad desde `auth.uid()` o la sesión JWT; ninguna acepta una identidad arbitraria como sustituto de la sesión.

### Operaciones propias del agente

Estas doce funciones limitan la acción al usuario o a la sesión corriente y son llamadas por la aplicación autenticada:

- `acknowledge_agent_control_command`
- `begin_agent_agenda_callback`
- `begin_agent_manual_call_management_api`
- `complete_my_kovacs_demo_assignment`
- `enter_agent_hybrid_manual_mode`
- `exit_agent_hybrid_manual_mode`
- `get_my_agent_control_command`
- `heartbeat_my_lead_orchestrator`
- `mark_my_agent_logged_out`
- `open_my_lead_orchestrator_assignment`
- `set_my_active_campaign`
- `set_my_agent_current_status`

### Operaciones de administración, supervisión e importación

Estas 24 funciones tienen validación explícita de rol, equipo, campaña o pertenencia y son parte de la interfaz operacional autenticada:

- `apply_mail_result_batch`
- `assign_lead`
- `convert_inbound_email_to_lead`
- `create_manual_lead_record`
- `force_agent_logout`
- `get_agent_activity_report`
- `get_agent_live_status`
- `get_call_metrics_report`
- `get_contactability_by_hour`
- `get_mail_agent_control_summary`
- `get_mail_agent_control_summary_read_model`
- `get_mail_engagement_page`
- `get_mail_engagement_queue`
- `get_mail_engagement_report`
- `get_mail_engagement_report_read_model`
- `get_mail_operational_bucket_summary`
- `get_mail_operational_queue_page`
- `get_management_integrity_report`
- `get_queue_health`
- `get_workflow_compliance`
- `import_vocalcom_events`
- `release_callbacks_to_pool`
- `reschedule_callbacks`
- `upsert_external_leads`

La permanencia en esta allowlist exige, en cada cambio de función:

1. `search_path` fijo.
2. `EXECUTE` revocado a `PUBLIC` y `anon`.
3. Identidad obtenida desde `auth.uid()`, no desde parámetros confiados.
4. Validación de rol y alcance dentro de la misma transacción.
5. Prueba negativa para usuario fuera de alcance.
6. Nueva revisión del Security Advisor.

## Pendiente de propietario

La protección contra contraseñas filtradas se habilita en Authentication > Providers > Email. Es una configuración de plataforma disponible en Pro y no debe simularse con SQL. Requiere acceso propietario, revisión del impacto y una prueba de login/reset antes de cerrarla.
