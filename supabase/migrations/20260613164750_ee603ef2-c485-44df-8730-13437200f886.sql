
CREATE TABLE public.contact_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contact_user_id uuid NOT NULL,
  public_key text NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, contact_user_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.contact_verifications TO authenticated;
GRANT ALL ON public.contact_verifications TO service_role;

ALTER TABLE public.contact_verifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner reads own verifications" ON public.contact_verifications
  FOR SELECT TO authenticated USING (owner_id = auth.uid());

CREATE POLICY "owner inserts own verifications" ON public.contact_verifications
  FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());

CREATE POLICY "owner updates own verifications" ON public.contact_verifications
  FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

CREATE POLICY "owner deletes own verifications" ON public.contact_verifications
  FOR DELETE TO authenticated USING (owner_id = auth.uid());
