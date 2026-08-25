-- ElevenLabs entrega la grabacion final en MP3. El bucket sigue privado y
-- mantiene el mismo limite de tamano usado por Calidad.
update storage.buckets
set allowed_mime_types = array['audio/ogg', 'audio/opus', 'audio/mpeg']
where id = 'call-recordings';
