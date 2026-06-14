
-- 1. group_id op messages (logische groepering van per-ontvanger-kopieën)
ALTER TABLE public.messages ADD COLUMN group_id uuid;
UPDATE public.messages SET group_id = id WHERE group_id IS NULL;
ALTER TABLE public.messages ALTER COLUMN group_id SET NOT NULL;
ALTER TABLE public.messages ALTER COLUMN group_id SET DEFAULT gen_random_uuid();
CREATE INDEX idx_messages_group_id ON public.messages(group_id);

-- 2. read_receipts_enabled op profiles
ALTER TABLE public.profiles
  ADD COLUMN read_receipts_enabled boolean NOT NULL DEFAULT true;

-- 3. message_status type + tabel
CREATE TYPE public.message_status_kind AS ENUM ('delivered', 'read');

CREATE TABLE public.message_status (
  group_id uuid NOT NULL,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status public.message_status_kind NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id, status)
);

CREATE INDEX idx_message_status_conv ON public.message_status(conversation_id, group_id);

GRANT SELECT, INSERT ON public.message_status TO authenticated;
GRANT ALL ON public.message_status TO service_role;

ALTER TABLE public.message_status ENABLE ROW LEVEL SECURITY;

-- Lezen: alleen leden van het gesprek
CREATE POLICY "members read message status"
  ON public.message_status
  FOR SELECT
  TO authenticated
  USING (private.is_conversation_member(conversation_id, auth.uid()));

-- Schrijven: alleen voor jezelf, alleen als je ontvanger was van een bericht in deze group
CREATE POLICY "users write own message status"
  ON public.message_status
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.messages m
      WHERE m.group_id = message_status.group_id
        AND m.conversation_id = message_status.conversation_id
        AND m.recipient_id = auth.uid()
    )
  );

-- 4. realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.message_status;
