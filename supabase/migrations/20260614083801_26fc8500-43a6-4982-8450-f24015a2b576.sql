-- 1) Tighten avatar SELECT policy
DROP POLICY IF EXISTS "Authenticated users can view avatars" ON storage.objects;

CREATE POLICY "Avatar visible to self, contacts and conversation peers"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'avatars'
  AND (
    -- own avatar
    (storage.foldername(name))[1] = (auth.uid())::text
    OR
    -- owner is a contact of the requester
    EXISTS (
      SELECT 1 FROM public.contacts c
      WHERE c.owner_id = auth.uid()
        AND c.contact_user_id::text = (storage.foldername(name))[1]
    )
    OR
    -- requester shares a conversation with the avatar owner
    private.shares_conversation_with(
      ((storage.foldername(name))[1])::uuid,
      auth.uid()
    )
  )
);

-- 2) Enforce display_name length at DB level (truncate existing oversized rows first)
UPDATE public.profiles
SET display_name = left(display_name, 60)
WHERE char_length(display_name) > 60;

UPDATE public.profiles
SET display_name = 'Lid'
WHERE display_name IS NULL OR char_length(btrim(display_name)) = 0;

ALTER TABLE public.profiles
  ADD CONSTRAINT display_name_length
  CHECK (char_length(display_name) BETWEEN 1 AND 60);
