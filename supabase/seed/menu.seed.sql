-- Illustrative demo menu only; these names, descriptions, prices and availability
-- have not been verified by Hotel Amrut. Replace them with owner-approved data.
-- This seed is intentionally not configured in supabase/config.toml.
-- Insert only missing stable item codes; never overwrite or delete restaurant data.
INSERT INTO public.menu_items (item_code, category, name, description, base_price_paise, is_published, is_available) VALUES
-- Seafood
('AMR-PRAWN', 'Seafood', 'Coastal prawn curry', 'Coconut, kokum & house-ground spices', 38500, true, true),
('AMR-FISH', 'Seafood', 'Pan-seared catch', 'Crisp edges, lime & a little sea salt', 42000, true, true),
('AMR-CALAMARI', 'Seafood', 'Golden calamari', 'Lightly crisp, with a bright lime dip', 32500, true, true),
('AMR-LOBSTER', 'Seafood', 'Amrut lobster', 'Local lobster, garlic butter & herbs', 98000, true, true),

-- Mains
('AMR-THALI-F', 'Mains', 'Amrut fish thali', 'Today''s catch, rice, sides & curry', 49500, true, true),
('AMR-THALI-V', 'Mains', 'Seasonal veg thali', 'A comforting spread from the coast', 28500, true, true),
('AMR-RIBS', 'Mains', 'Slow-cooked ribs', '12-hour smoked, house BBQ glaze', 56000, true, true),
('AMR-STEAK', 'Mains', 'Grilled steak', 'Premium cut, rosemary butter', 78000, true, true),

-- Sides
('AMR-RICE', 'Sides', 'Steamed rice', 'Soft, fragrant & ready for curry', 9000, true, true),
('AMR-SALAD', 'Sides', 'Coastal salad', 'Mixed greens, citrus vinaigrette', 18000, true, true),
('AMR-FRIES', 'Sides', 'Truffle fries', 'Hand-cut, parmesan & truffle oil', 22000, true, true),

-- Drinks
('AMR-SOLKADHI', 'Drinks', 'Chilled solkadhi', 'Kokum, coconut & a cooling finish', 7500, true, true),
('AMR-LASSI', 'Drinks', 'Mango lassi', 'Fresh mango, yogurt & cardamom', 8500, true, true),
('AMR-JUICE', 'Drinks', 'Fresh juice', 'Seasonal fruit, no added sugar', 6500, true, true),
('AMR-WINE', 'Drinks', 'House wine', 'Red or white, local selection', 12000, true, true)
ON CONFLICT (item_code) DO NOTHING;

-- Demo image URLs are illustrative references and must be replaced or approved.
WITH image_seed(item_code, image_url) AS (
  VALUES
    ('AMR-PRAWN', 'https://images.unsplash.com/photo-1625944525533-473f1a3d54e7?auto=format&fit=crop&w=900&q=85'),
    ('AMR-FISH', 'https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?auto=format&fit=crop&w=900&q=85'),
    ('AMR-THALI-F', 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?auto=format&fit=crop&w=900&q=85'),
    ('AMR-THALI-V', 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=900&q=85')
)
INSERT INTO public.menu_item_images (menu_item_id, image_url, sort_order, is_primary)
SELECT mi.id, image_seed.image_url, 1,
       NOT EXISTS (SELECT 1 FROM public.menu_item_images image WHERE image.menu_item_id = mi.id AND image.is_primary)
FROM image_seed
JOIN public.menu_items mi ON mi.item_code = image_seed.item_code
WHERE NOT EXISTS (
  SELECT 1 FROM public.menu_item_images existing
  WHERE existing.menu_item_id = mi.id AND existing.image_url = image_seed.image_url
)
ON CONFLICT (menu_item_id, image_url) DO NOTHING;

-- These option rows are also illustrative; prices are zero deltas for the demo.
INSERT INTO public.menu_option_groups (menu_item_id, option_key, label, min_selections, max_selections, sort_order)
SELECT mi.id, 'spice', 'Spice Level', 1, 1, 1
FROM public.menu_items mi
WHERE mi.item_code IN ('AMR-PRAWN', 'AMR-FISH', 'AMR-THALI-F', 'AMR-THALI-V')
ON CONFLICT (menu_item_id, option_key) DO NOTHING;

INSERT INTO public.menu_options (group_id, option_key, label, price_delta_paise, is_available, sort_order)
SELECT groups.id, choices.option_key, choices.label, 0, true, choices.sort_order
FROM public.menu_option_groups groups
JOIN public.menu_items mi ON mi.id = groups.menu_item_id
CROSS JOIN (VALUES ('mild', 'Mild', 1), ('medium', 'Medium', 2), ('spicy', 'Spicy', 3)) AS choices(option_key, label, sort_order)
WHERE groups.option_key = 'spice'
  AND mi.item_code IN ('AMR-PRAWN', 'AMR-FISH', 'AMR-THALI-F', 'AMR-THALI-V')
ON CONFLICT (group_id, option_key) DO NOTHING;

UPDATE public.menu_items SET tag = 'A table favourite' WHERE item_code = 'AMR-PRAWN' AND tag IS NULL;
UPDATE public.menu_items SET tag = 'Coastal pick' WHERE item_code = 'AMR-FISH' AND tag IS NULL;
UPDATE public.menu_items SET tag = 'A little bit of everything' WHERE item_code = 'AMR-THALI-F' AND tag IS NULL;
UPDATE public.menu_items SET tag = 'For the table' WHERE item_code = 'AMR-CALAMARI' AND tag IS NULL;

SELECT COUNT(*) AS illustrative_demo_menu_items
FROM public.menu_items
WHERE item_code LIKE 'AMR-%' AND is_published AND is_available;
