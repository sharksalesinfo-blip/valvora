
-- Restrict conversation UPDATE to (name, updated_at) columns only
REVOKE UPDATE ON public.conversations FROM authenticated;
GRANT UPDATE (name, updated_at) ON public.conversations TO authenticated;

-- Tighten DELETE on messages: must still be a conversation member
DROP POLICY IF EXISTS "senders delete own messages" ON public.messages;
CREATE POLICY "senders delete own messages"
ON public.messages
FOR DELETE
TO authenticated
USING (
  sender_id = auth.uid()
  AND private.is_conversation_member(conversation_id, auth.uid())
);
