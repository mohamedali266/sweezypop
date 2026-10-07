# Sweezypop Digital Menu

Restaurant QR menu app with:

- Public customer menu with category filters, search, grid/list view, cart, checkout, opening hours, and generated QR code.
- Owner dashboard for items, categories, ordering, appearance, opening hours, and received orders.
- Admin dashboard with all owner tools plus user/owner management.
- English first UI with German language support.
- Optional Supabase data sync with Vercel-ready build.

## Run locally

```bash
npm install
npm run dev
```

## Deploy on Vercel free tier

1. Push this repository to GitHub.
2. Import it in Vercel as a Vite project.
3. Add these Environment Variables in Vercel:

```bash
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your_anon_key
VITE_RESTAURANT_SLUG=sweezypop
VITE_MENU_PUBLIC_URL=https://your-vercel-domain.vercel.app/
```

4. Use the default build command:

```bash
npm run build
```

5. Output directory:

```bash
dist
```

## Supabase free tier setup

1. Create a free Supabase project.
2. In Supabase SQL Editor, run `supabase/schema.sql`.
3. Run `supabase/seed.sql` to insert the default restaurant, categories, items, and opening hours.
4. Create users in Supabase Authentication.
5. Insert matching rows in `profiles` with each user's `auth_user_id`, `restaurant_id = 'sweezypop'`, and role `admin` or `owner`.
6. Copy `.env.example` to `.env.local`.
7. Add:

```bash
VITE_SUPABASE_URL=your_project_url
VITE_SUPABASE_ANON_KEY=your_anon_key
VITE_RESTAURANT_SLUG=sweezypop
VITE_MENU_PUBLIC_URL=https://your-vercel-domain.vercel.app/
```

When Supabase variables are configured, the public menu reads restaurant, categories, items, and opening hours from Supabase. Customer orders are inserted from the public menu. Owner/admin changes sync back to Supabase after authenticated login. Without Supabase variables, the app falls back to local demo data and localStorage.

## Production security

- Never expose a Supabase service role key in Vercel or the browser.
- Use only `VITE_SUPABASE_ANON_KEY` on the frontend.
- The SQL enables Row Level Security. Public users can read the menu and create orders only. Authenticated active owners/admins can manage their restaurant data.
- Admin-only user management is enforced by RLS through the `profiles` table role.

## Notes

- The GitHub repository was empty when cloned, so this implementation is a fresh Vite app.
- Images in the menu are CSS-generated visual food cards to keep the free deployment lightweight.
- Uploaded images are currently stored as data URLs in app state. For heavier production usage, add Supabase Storage buckets and store image URLs instead.
