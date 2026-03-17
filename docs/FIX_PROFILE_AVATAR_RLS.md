# Fix: Profile Image Upload RLS Error

If you see **"new row violates row-level security policy"** when uploading a profile image:

## 1. Run the migration in Supabase

1. Open [Supabase Dashboard](https://app.supabase.com) → your project
2. Go to **SQL Editor**
3. Copy and run the contents of:
   ```
   supabase/migrations/20260317000001_profiles_avatar_rls.sql
   ```
4. Click **Run**

## 2. Verify backend .env

Ensure your backend `.env` has the **service_role** key (not anon):

```
SUPABASE_SERVICE_KEY=eyJ...  # From Supabase Dashboard > API > service_role
```

- **Wrong:** Using `SUPABASE_ANON_KEY` value for `SUPABASE_SERVICE_KEY`
- **Right:** Use the key labeled "service_role" from Project Settings > API

## 3. Restart backend

After running the migration and verifying .env, restart your backend server.
