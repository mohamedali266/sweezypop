begin;

update public.menu_items
set image_url = case id
  when 'item-1793813112087' then 'https://sweezypop-1.vercel.app/menu-images/item-1793813112087-e4f0eae208253e4f0b68048ad4e74ca4.webp'
  when 'item-1793813370860' then 'https://sweezypop-1.vercel.app/menu-images/item-1793813370860-2f1abea910935e032675a1cd9edf885f.webp'
  when 'item-1793815051593' then 'https://sweezypop-1.vercel.app/menu-images/item-1793815051593-825f502e247556918f6dba9f58020c27.webp'
  when 'item-1793817091596' then 'https://sweezypop-1.vercel.app/menu-images/item-1793817091596-42763e439539cdeff7ae0adaf08b909b.webp'
  when 'item-1793817180631' then 'https://sweezypop-1.vercel.app/menu-images/item-1793817180631-ea3134595867218635d83fd8f12d703f.webp'
  when 'item-1793817569045' then 'https://sweezypop-1.vercel.app/menu-images/item-1793817569045-c776f09bec953e5d41ae1d77fd317765.webp'
end
where (id, image_url) in (
  ('item-1793813112087', 'https://kedrciyshstlsrkepnav.supabase.co/functions/v1/menu-image?slug=sweezypop&item=item-1793813112087&v=e4f0eae208253e4f0b68048ad4e74ca4'),
  ('item-1793813370860', 'https://kedrciyshstlsrkepnav.supabase.co/functions/v1/menu-image?slug=sweezypop&item=item-1793813370860&v=2f1abea910935e032675a1cd9edf885f'),
  ('item-1793815051593', 'https://kedrciyshstlsrkepnav.supabase.co/functions/v1/menu-image?slug=sweezypop&item=item-1793815051593&v=825f502e247556918f6dba9f58020c27'),
  ('item-1793817091596', 'https://kedrciyshstlsrkepnav.supabase.co/functions/v1/menu-image?slug=sweezypop&item=item-1793817091596&v=42763e439539cdeff7ae0adaf08b909b'),
  ('item-1793817180631', 'https://kedrciyshstlsrkepnav.supabase.co/functions/v1/menu-image?slug=sweezypop&item=item-1793817180631&v=ea3134595867218635d83fd8f12d703f'),
  ('item-1793817569045', 'https://kedrciyshstlsrkepnav.supabase.co/functions/v1/menu-image?slug=sweezypop&item=item-1793817569045&v=c776f09bec953e5d41ae1d77fd317765')
);

commit;
