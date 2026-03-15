-- Sync profiles from auth.users on signup (like reference project c93b6341).
-- Ensures profiles.email and profiles.phone are populated so findReceiverIds works.
-- Uses full_name to match InvoiceBill schema. If your profiles table has 'name' instead
-- of 'full_name', change the INSERT to use (id, email, phone, name) and the COALESCE.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, phone, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.phone,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', '')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Create trigger if not exists (idempotent)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();

COMMENT ON FUNCTION public.handle_new_user IS 'Sync auth.users to profiles on signup; ensures email/phone for receiver lookup';
