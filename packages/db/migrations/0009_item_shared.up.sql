-- Items GestIB lists under more than one child; their child is decided by name or by class (AI).
ALTER TABLE items ADD COLUMN shared boolean NOT NULL DEFAULT false;
