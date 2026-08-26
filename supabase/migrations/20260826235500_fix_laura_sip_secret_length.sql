-- Keep Laura's generated SIP credential aligned with the 128-bit/32-hex
-- format used by the standard administrative provisioning action.
update public.agent_sip_credentials credential
set sip_password = replace(gen_random_uuid()::text, '-', ''),
    updated_at = now()
from public.profiles profile
where profile.id = credential.profile_id
  and lower(profile.email) = 'lpincheirah.geimser@gmail.com'
  and length(credential.sip_password) <> 32;
