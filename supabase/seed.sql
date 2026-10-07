insert into restaurants (
  id,
  name,
  public_slug,
  logo_text,
  menu_url
) values (
  'sweezypop',
  'Sweezypop',
  'sweezypop',
  'Sweezypop',
  'https://sweezypop.vercel.app'
) on conflict (id) do update set
  name = excluded.name,
  public_slug = excluded.public_slug,
  logo_text = excluded.logo_text;

insert into categories (id, restaurant_id, name_en, name_de, sort_order) values
  ('signature', 'sweezypop', 'Signature Bowls', 'Signature Bowls', 1),
  ('desserts', 'sweezypop', 'Desserts', 'Desserts', 2),
  ('drinks', 'sweezypop', 'Drinks', 'Getranke', 3),
  ('brunch', 'sweezypop', 'Brunch', 'Brunch', 4),
  ('offers', 'sweezypop', 'Offers', 'Angebote', 5)
on conflict (id) do update set
  name_en = excluded.name_en,
  name_de = excluded.name_de,
  sort_order = excluded.sort_order;

insert into menu_items (
  id,
  restaurant_id,
  category_id,
  name_en,
  name_de,
  description_en,
  description_de,
  price,
  badge_en,
  badge_de,
  image_style,
  available,
  sort_order
) values
  ('berry-cloud', 'sweezypop', 'signature', 'Berry Cloud Pancakes', 'Berry Cloud Pancakes', 'Mini pancakes, strawberry cream, berries, and white chocolate.', 'Mini-Pancakes, Erdbeercreme, Beeren und weisse Schokolade.', 8.50, 'Popular', 'Beliebt', 'berry', true, 1),
  ('lavender-waffle', 'sweezypop', 'signature', 'Lavender Honey Waffle', 'Lavendel-Honig-Waffel', 'Crisp waffle with lavender honey, vanilla cream, and almonds.', 'Knusprige Waffel mit Lavendelhonig, Vanillecreme und Mandeln.', 9.25, 'New', 'Neu', 'lavender', true, 2),
  ('pink-dream', 'sweezypop', 'signature', 'Pink Dream Crepe', 'Pink Dream Crepe', 'Soft crepe, rose sauce, pistachio crunch, and seasonal fruit.', 'Crepe mit Rosensauce, Pistazien-Crunch und Saisonfrucht.', 7.75, null, null, 'pink', true, 3),
  ('lotus-jar', 'sweezypop', 'desserts', 'Lotus Cheesecake Jar', 'Lotus Cheesecake Glas', 'Layered cheesecake cream with biscuit crumble and caramel.', 'Cheesecake-Creme mit Keks-Crumble und Karamell.', 6.75, 'Best seller', 'Bestseller', 'caramel', true, 4),
  ('mochi-box', 'sweezypop', 'desserts', 'Mochi Box', 'Mochi Box', 'Six soft mochi bites: mango, matcha, vanilla, and berry.', 'Sechs Mochi: Mango, Matcha, Vanille und Beere.', 10.00, null, null, 'mochi', true, 5),
  ('rose-milk', 'sweezypop', 'drinks', 'Rose Milk Cooler', 'Rosenmilch Cooler', 'Iced milk, rose syrup, basil seeds, and cream foam.', 'Eismilch, Rosensirup, Basilikumsamen und Cremeschaum.', 4.50, null, null, 'drink-pink', true, 6),
  ('iced-matcha', 'sweezypop', 'drinks', 'Iced Strawberry Matcha', 'Iced Strawberry Matcha', 'Ceremonial matcha poured over strawberry milk.', 'Matcha auf Erdbeermilch.', 5.25, null, null, 'matcha', true, 7),
  ('avo-toast', 'sweezypop', 'brunch', 'Avocado Brioche Toast', 'Avocado Brioche Toast', 'Toasted brioche, avocado, feta, chili oil, and herbs.', 'Brioche, Avocado, Feta, Chiliol und Krauter.', 8.25, null, null, 'green', true, 8),
  ('combo', 'sweezypop', 'offers', 'Sweet Date Combo', 'Sweet Date Combo', 'Two desserts and two drinks for a shared table.', 'Zwei Desserts und zwei Getranke zum Teilen.', 22.00, 'Save 15%', '15% sparen', 'combo', true, 9)
on conflict (id) do update set
  category_id = excluded.category_id,
  name_en = excluded.name_en,
  name_de = excluded.name_de,
  description_en = excluded.description_en,
  description_de = excluded.description_de,
  price = excluded.price,
  badge_en = excluded.badge_en,
  badge_de = excluded.badge_de,
  image_style = excluded.image_style,
  available = excluded.available,
  sort_order = excluded.sort_order;

insert into opening_hours (id, restaurant_id, day, open_time, close_time, enabled, sort_order) values
  ('hour-Monday', 'sweezypop', 'Monday', '10:00', '22:00', true, 1),
  ('hour-Tuesday', 'sweezypop', 'Tuesday', '10:00', '22:00', true, 2),
  ('hour-Wednesday', 'sweezypop', 'Wednesday', '10:00', '22:00', true, 3),
  ('hour-Thursday', 'sweezypop', 'Thursday', '10:00', '23:00', true, 4),
  ('hour-Friday', 'sweezypop', 'Friday', '10:00', '00:00', true, 5),
  ('hour-Saturday', 'sweezypop', 'Saturday', '09:00', '00:00', true, 6),
  ('hour-Sunday', 'sweezypop', 'Sunday', '09:00', '21:00', true, 7)
on conflict (id) do update set
  open_time = excluded.open_time,
  close_time = excluded.close_time,
  enabled = excluded.enabled,
  sort_order = excluded.sort_order;
