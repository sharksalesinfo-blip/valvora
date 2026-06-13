
-- 1) Storage UPDATE policy
DROP POLICY IF EXISTS "owners update own attachments" ON storage.objects;
CREATE POLICY "owners update own attachments" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'attachments' AND owner = auth.uid())
  WITH CHECK (bucket_id = 'attachments' AND owner = auth.uid());

-- 2) Realtime broadcast/presence deny-all
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

-- 3) Private schema + relocated helper
CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

CREATE OR REPLACE FUNCTION private.is_conversation_member(_conversation_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.conversation_members
    WHERE conversation_id = _conversation_id AND user_id = _user_id
  );
$$;
REVOKE ALL ON FUNCTION private.is_conversation_member(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private.is_conversation_member(uuid, uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "members read attachments" ON storage.objects;
DROP POLICY IF EXISTS "members upload attachments" ON storage.objects;
DROP FUNCTION IF EXISTS public.is_conversation_member(uuid, uuid) CASCADE;

-- Drop any remaining policies that we'll recreate (idempotent)
DROP POLICY IF EXISTS "members read own membership rows" ON public.conversation_members;
DROP POLICY IF EXISTS "users add themselves" ON public.conversation_members;
DROP POLICY IF EXISTS "members read messages" ON public.messages;
DROP POLICY IF EXISTS "members send messages" ON public.messages;
DROP POLICY IF EXISTS "senders delete own messages" ON public.messages;
DROP POLICY IF EXISTS "members read conversations" ON public.conversations;
DROP POLICY IF EXISTS "members update conversation" ON public.conversations;
DROP POLICY IF EXISTS "authenticated create conversations" ON public.conversations;

CREATE POLICY "members read own membership rows" ON public.conversation_members
  FOR SELECT TO authenticated
  USING (private.is_conversation_member(conversation_id, auth.uid()));

CREATE POLICY "users add themselves" ON public.conversation_members
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "members read messages" ON public.messages
  FOR SELECT TO authenticated
  USING (
    private.is_conversation_member(conversation_id, auth.uid())
    AND (recipient_id IS NULL OR recipient_id = auth.uid() OR sender_id = auth.uid())
  );

CREATE POLICY "members send messages" ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND private.is_conversation_member(conversation_id, auth.uid())
  );

CREATE POLICY "senders delete own messages" ON public.messages
  FOR DELETE TO authenticated
  USING (sender_id = auth.uid());

CREATE POLICY "members read conversations" ON public.conversations
  FOR SELECT TO authenticated
  USING (private.is_conversation_member(id, auth.uid()));

CREATE POLICY "members update conversation" ON public.conversations
  FOR UPDATE TO authenticated
  USING (private.is_conversation_member(id, auth.uid()))
  WITH CHECK (private.is_conversation_member(id, auth.uid()));

CREATE POLICY "authenticated create conversations" ON public.conversations
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "members read attachments" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'attachments'
    AND private.is_conversation_member((split_part(name, '/', 1))::uuid, auth.uid())
  );

CREATE POLICY "members upload attachments" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'attachments'
    AND private.is_conversation_member((split_part(name, '/', 1))::uuid, auth.uid())
  );

-- 4) Trigger helpers: not callable via API
REVOKE EXECUTE ON FUNCTION public.touch_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
