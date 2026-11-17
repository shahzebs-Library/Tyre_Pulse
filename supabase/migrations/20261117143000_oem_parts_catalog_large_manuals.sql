-- Allow the supplied full OEM catalogs (up to 71 MB) to be stored as source PDFs.
UPDATE storage.buckets
SET file_size_limit = 104857600
WHERE id = 'oem-parts-catalogs';
