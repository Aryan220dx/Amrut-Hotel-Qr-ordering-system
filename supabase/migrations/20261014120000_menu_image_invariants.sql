-- Enforce the image invariants that the initial menu migration only checked at insert time.
-- Duplicate URLs are rejected rather than silently deleting image rows.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.menu_item_images
    GROUP BY menu_item_id, image_url
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'menu_item_images contains duplicate URLs; resolve duplicates before applying this migration';
  END IF;
END;
$$;

-- Preserve every image row while deterministically retaining only one primary flag per item.
WITH ranked_primary AS (
  SELECT id, row_number() OVER (PARTITION BY menu_item_id ORDER BY created_at, id) AS position
  FROM public.menu_item_images
  WHERE is_primary
)
UPDATE public.menu_item_images images
SET is_primary = false
FROM ranked_primary ranked
WHERE images.id = ranked.id AND ranked.position > 1;

CREATE UNIQUE INDEX menu_item_images_item_url_unique
  ON public.menu_item_images(menu_item_id, image_url);
CREATE UNIQUE INDEX menu_item_images_one_primary_per_item
  ON public.menu_item_images(menu_item_id)
  WHERE is_primary;
