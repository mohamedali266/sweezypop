begin;

update public.restaurants
set
  logo_url = 'https://sweezypop-1.vercel.app/brand/sweezypop-logo-3d-v2.png',
  app_icon_url = 'https://sweezypop-1.vercel.app/brand/sweezypop-app-icon-v2-512.png',
  favicon_url = 'https://sweezypop-1.vercel.app/brand/sweezypop-app-icon-v2-64.png'
where public_slug = 'sweezypop';

commit;
