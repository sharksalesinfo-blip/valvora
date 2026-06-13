
-- Pad-conventie: attachments/{conversation_id}/{message_id}.enc
CREATE POLICY "members read attachments" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'attachments'
    AND public.is_conversation_member((split_part(name, '/', 1))::uuid, auth.uid())
  );

CREATE POLICY "members upload attachments" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'attachments'
    AND public.is_conversation_member((split_part(name, '/', 1))::uuid, auth.uid())
  );

CREATE POLICY "members delete own attachments" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'attachments'
    AND owner = auth.uid()
  );
