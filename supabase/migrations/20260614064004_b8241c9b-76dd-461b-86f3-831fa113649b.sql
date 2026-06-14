ALTER TYPE public.message_type ADD VALUE IF NOT EXISTS 'file';
ALTER TYPE public.message_type ADD VALUE IF NOT EXISTS 'location';

ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS reply_to_message_id uuid
  REFERENCES public.messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_messages_reply_to ON public.messages(reply_to_message_id);