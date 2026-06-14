
-- 1. key_recovery: client-encrypted backup of the private key
CREATE TABLE public.key_recovery (
  owner_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  recovery_id text NOT NULL UNIQUE,
  ciphertext text NOT NULL,
  nonce text NOT NULL,
  kdf_salt text NOT NULL,
  kdf_opslimit integer NOT NULL,
  kdf_memlimit bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.key_recovery TO authenticated;
GRANT ALL ON public.key_recovery TO service_role;

ALTER TABLE public.key_recovery ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner reads own recovery"
  ON public.key_recovery FOR SELECT
  TO authenticated
  USING (owner_id = auth.uid());

CREATE POLICY "owner inserts own recovery"
  ON public.key_recovery FOR INSERT
  TO authenticated
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "owner updates own recovery"
  ON public.key_recovery FOR UPDATE
  TO authenticated
  USING (owner_id = auth.uid())
  WITH CHECK (owner_id = auth.uid());

CREATE POLICY "owner deletes own recovery"
  ON public.key_recovery FOR DELETE
  TO authenticated
  USING (owner_id = auth.uid());

CREATE TRIGGER touch_key_recovery
  BEFORE UPDATE ON public.key_recovery
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- 2. Make handle_new_user safe for anonymous signups (no email, name may come later)
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (
    NEW.id,
    COALESCE(
      NEW.raw_user_meta_data->>'display_name',
      CASE
        WHEN NEW.email IS NOT NULL AND NEW.email <> '' THEN split_part(NEW.email, '@', 1)
        ELSE 'Nieuw lid'
      END
    )
  );
  INSERT INTO public.user_invites (user_id) VALUES (NEW.id)
    ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;
