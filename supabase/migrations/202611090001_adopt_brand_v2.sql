begin;

update public.restaurants
set
  logo_url = 'https://sweezypop-1.vercel.app/brand/sweezypop-logo-3d-v2.png?v=fa38cf6',
  app_icon_url = 'https://sweezypop-1.vercel.app/brand/sweezypop-app-icon-v2-512.png?v=fa38cf6',
  favicon_url = 'https://sweezypop-1.vercel.app/brand/sweezypop-app-icon-v2-64.png?v=fa38cf6'
where public_slug = 'sweezypop';

commit;
