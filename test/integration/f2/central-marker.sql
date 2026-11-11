CREATE TABLE public.c4g_database_identity (
  product_code TEXT NOT NULL,
  database_role TEXT NOT NULL,
  PRIMARY KEY (product_code, database_role)
);
INSERT INTO public.c4g_database_identity(product_code, database_role) VALUES ('C4G', 'CENTRAL');
