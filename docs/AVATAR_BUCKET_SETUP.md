# Profile Photo (Avatar) Bucket Setup

## 1. Create the bucket in Supabase

1. Go to **Supabase Dashboard** → **Storage**
2. Click **New bucket**
3. Name: `avatars`
4. **Public bucket**: Enable (so profile photos can be viewed without auth)
5. Click **Create bucket**

## 2. Set bucket policies (optional – for direct client uploads)

If you only use the backend to upload (recommended), the service role bypasses RLS. Skip this step.

If you want clients to upload directly, run in **SQL Editor**:

```sql
-- Allow authenticated users to upload their own avatar
CREATE POLICY "Users can upload own avatar"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'avatars'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- Allow public read (profile photos are public)
CREATE POLICY "Avatar images are publicly readable"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'avatars');

-- Allow users to update their own avatar
CREATE POLICY "Users can update own avatar"
ON storage.objects FOR UPDATE
TO authenticated
USING ((storage.foldername(name))[1] = auth.uid()::text);
```

## 3. Ensure profiles table has avatar_url

Run in **SQL Editor** (if not already applied):

```sql
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS avatar_url TEXT;
```

## 4. File size limit

- Backend accepts up to **8MB** request body (for base64 images)
- Backend rejects images over **5MB** (decoded)
- App resizes to max 512px before upload to avoid "request entity too large"
- Supported formats: JPEG, PNG, WebP (from base64 data URI)
