-- Add image and customization support to menu_items
-- This allows mapping frontend MenuItem fields to database schema

-- Add image support without replacing an existing table or its dependencies.
CREATE TABLE IF NOT EXISTS public.menu_item_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_item_id UUID NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  image_url TEXT NOT NULL CHECK (length(image_url) > 0 AND length(image_url) < 2048),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add tag column to menu_items for promotional tags.
ALTER TABLE public.menu_items ADD COLUMN IF NOT EXISTS tag TEXT CHECK (length(btrim(tag)) <= 40 OR tag IS NULL);

-- Reuse the normalized menu_option_groups/menu_options model from the core schema.
-- Images are visible only for published, available menu items.
ALTER TABLE public.menu_item_images ENABLE ROW LEVEL SECURITY;
CREATE POLICY menu_item_images_available_read
  ON public.menu_item_images FOR SELECT TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM public.menu_items mi
    WHERE mi.id = menu_item_id AND mi.is_published AND mi.is_available
  ));

-- Insert illustrative image references only when the item exists and the image is absent.
WITH image_seed(item_code, image_url) AS (
  VALUES
    ('AMR-PRAWN', 'https://images.unsplash.com/photo-1625944525533-473f1a3d54e7?auto=format&fit=crop&w=900&q=85'),
    ('AMR-FISH', 'https://images.unsplash.com/photo-1519708227418-c8fd9a32b7a2?auto=format&fit=crop&w=900&q=85'),
    ('AMR-THALI-F', 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?auto=format&fit=crop&w=900&q=85'),
    ('AMR-THALI-V', 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=900&q=85'),
    ('AMR-CALAMARI', 'https://images.unsplash.com/photo-1599487488170-d11ec9c172f0?auto=format&fit=crop&w=900&q=85'),
    ('AMR-RICE', 'https://images.unsplash.com/photo-1516684732162-798a0062be99?auto=format&fit=crop&w=900&q=85'),
    ('AMR-SOLKADHI', 'https://images.unsplash.com/photo-1544145945-f90425340c7e?auto=format&fit=crop&w=900&q=85'),
    ('AMR-LOBSTER', 'https://images.unsplash.com/photo-1551024709-8f23befc6f87?auto=format&fit=crop&w=900&q=85'),
    ('AMR-RIBS', 'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=900&q=85'),
    ('AMR-STEAK', 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?auto=format&fit=crop&w=900&q=85'),
    ('AMR-SALAD', 'https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=900&q=85'),
    ('AMR-FRIES', 'https://images.unsplash.com/photo-1599487488170-d11ec9c172f0?auto=format&fit=crop&w=900&q=85'),
    ('AMR-LASSI', 'https://images.unsplash.com/photo-1544145945-f90425340c7e?auto=format&fit=crop&w=900&q=85'),
    ('AMR-JUICE', 'https://images.unsplash.com/photo-1544145945-f90425340c7e?auto=format&fit=crop&w=900&q=85'),
    ('AMR-WINE', 'https://images.unsplash.com/photo-1510812431401-41d2bd2722f3?auto=format&fit=crop&w=900&q=85')
)
INSERT INTO public.menu_item_images (menu_item_id, image_url, sort_order, is_primary)
SELECT mi.id, image_seed.image_url, 1,
       NOT EXISTS (
         SELECT 1 FROM public.menu_item_images existing
         WHERE existing.menu_item_id = mi.id AND existing.is_primary
       )
FROM image_seed
JOIN public.menu_items mi ON mi.item_code = image_seed.item_code
WHERE NOT EXISTS (
  SELECT 1 FROM public.menu_item_images existing
  WHERE existing.menu_item_id = mi.id AND existing.image_url = image_seed.image_url
);

-- Each item has one required spice group with three distinct option keys.
INSERT INTO public.menu_option_groups (
  menu_item_id, option_key, label, min_selections, max_selections, sort_order
)
SELECT mi.id, 'spice', 'Spice Level', 1, 1, 1
FROM public.menu_items mi
WHERE mi.item_code IN ('AMR-PRAWN', 'AMR-FISH', 'AMR-THALI-F', 'AMR-THALI-V')
ON CONFLICT (menu_item_id, option_key) DO NOTHING;

INSERT INTO public.menu_options (
  group_id, option_key, label, price_delta_paise, is_available, sort_order
)
SELECT option_group.id, option_seed.option_key, option_seed.label, 0, true, option_seed.sort_order
FROM public.menu_option_groups option_group
JOIN public.menu_items mi ON mi.id = option_group.menu_item_id
CROSS JOIN (VALUES
  ('mild', 'Mild', 1),
  ('medium', 'Medium', 2),
  ('spicy', 'Spicy', 3)
) AS option_seed(option_key, label, sort_order)
WHERE option_group.option_key = 'spice'
  AND mi.item_code IN ('AMR-PRAWN', 'AMR-FISH', 'AMR-THALI-F', 'AMR-THALI-V')
ON CONFLICT (group_id, option_key) DO NOTHING;

-- Add tags to menu items
UPDATE public.menu_items SET tag = 'A table favourite' WHERE item_code = 'AMR-PRAWN' AND tag IS NULL;
UPDATE public.menu_items SET tag = 'Coastal pick' WHERE item_code = 'AMR-FISH' AND tag IS NULL;
UPDATE public.menu_items SET tag = 'A little bit of everything' WHERE item_code = 'AMR-THALI-F' AND tag IS NULL;
UPDATE public.menu_items SET tag = 'For the table' WHERE item_code = 'AMR-CALAMARI' AND tag IS NULL;

-- Create view for easy frontend consumption
CREATE OR REPLACE VIEW public.v_menu_items WITH (security_invoker = true) AS
SELECT
  mi.id,
  mi.item_code,
  mi.name,
  mi.description,
  mi.base_price_paise,
  mi.category,
  mi.tag,
  mi.is_published,
  mi.is_available,
  COALESCE(img.image_url, '') AS image_url,
  COALESCE(img.is_primary, false) AS is_primary_image
FROM public.menu_items mi
LEFT JOIN LATERAL (
  SELECT image_url, is_primary
  FROM public.menu_item_images
  WHERE menu_item_id = mi.id AND is_primary = true
  ORDER BY sort_order, created_at, id
  LIMIT 1
) img ON true
WHERE mi.is_published = true AND mi.is_available = true;

-- Grant necessary permissions
GRANT SELECT ON public.v_menu_items TO anon, authenticated;
GRANT SELECT ON public.menu_item_images TO anon, authenticated;
