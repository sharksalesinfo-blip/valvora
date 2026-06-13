
-- 1) Helper: do two users share a conversation? (security definer, avoids recursive RLS)
CREATE OR REPLACE FUNCTION private.shares_conversation_with(_other uuid, _me uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.conversation_members a
    JOIN public.conversation_members b ON a.conversation_id = b.conversation_id
    WHERE a.user_id = _me AND b.user_id = _other
  );
$$;

-- 2) Profiles: restrict SELECT
DROP POLICY IF EXISTS "profiles readable by authenticated" ON public.profiles;
DROP POLICY IF EXISTS "Profiles are viewable by authenticated users" ON public.profiles;
DROP POLICY IF EXISTS "authenticated read profiles" ON public.profiles;
DROP POLICY IF EXISTS "profiles select" ON public.profiles;
CREATE POLICY "profiles visible to self contacts and convo peers"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() = id
    OR EXISTS (
      SELECT 1 FROM public.contacts
      WHERE owner_id = auth.uid() AND contact_user_id = profiles.id
    )
    OR private.shares_conversation_with(profiles.id, auth.uid())
  );

-- 3) Contacts: add explicit INSERT policy (owner can add own contacts)
DROP POLICY IF EXISTS "owner inserts own contacts" ON public.contacts;
CREATE POLICY "owner inserts own contacts"
  ON public.contacts
  FOR INSERT
  TO authenticated
  WITH CHECK (owner_id = auth.uid());

-- 4) conversation_members: tighten INSERT so users cannot self-join arbitrary conversations
DROP POLICY IF EXISTS "users add themselves" ON public.conversation_members;
CREATE POLICY "creator adds members"
  ON public.conversation_members
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = conversation_members.conversation_id
        AND c.created_by = auth.uid()
    )
  );

-- 5) Conversations: restrict UPDATE to safe columns (name, updated_at).
--    The existing RLS policy still scopes to members.
REVOKE UPDATE ON public.conversations FROM authenticated;
GRANT UPDATE (name, updated_at) ON public.conversations TO authenticated;
