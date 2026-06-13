
-- 1) Handle on profiles (case-insensitive uniqueness)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS handle text;
CREATE UNIQUE INDEX IF NOT EXISTS profiles_handle_lower_idx
  ON public.profiles (lower(handle)) WHERE handle IS NOT NULL;

-- 2) Per-user invite token (separate table so token isn't exposed via profiles SELECT)
CREATE TABLE IF NOT EXISTS public.user_invites (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.user_invites TO authenticated;
GRANT ALL ON public.user_invites TO service_role;
ALTER TABLE public.user_invites ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "owner reads own invite" ON public.user_invites;
CREATE POLICY "owner reads own invite" ON public.user_invites
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Backfill an invite row for every existing profile
INSERT INTO public.user_invites (user_id)
  SELECT id FROM public.profiles
  ON CONFLICT (user_id) DO NOTHING;

-- Extend handle_new_user trigger to also create an invite row
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)));
  INSERT INTO public.user_invites (user_id) VALUES (NEW.id)
    ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- 3) Contacts table
CREATE TABLE IF NOT EXISTS public.contacts (
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (owner_id, contact_user_id),
  CHECK (owner_id <> contact_user_id)
);
GRANT SELECT, DELETE ON public.contacts TO authenticated;
GRANT ALL ON public.contacts TO service_role;
ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "owner reads own contacts" ON public.contacts;
CREATE POLICY "owner reads own contacts" ON public.contacts
  FOR SELECT TO authenticated USING (owner_id = auth.uid());
DROP POLICY IF EXISTS "owner deletes own contacts" ON public.contacts;
CREATE POLICY "owner deletes own contacts" ON public.contacts
  FOR DELETE TO authenticated USING (owner_id = auth.uid());
-- No INSERT/UPDATE policies: contact relations are created only by server code.
