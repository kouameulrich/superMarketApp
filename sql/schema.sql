/* ============================================================================
   SuperGestion — Schéma SQL Server (PRD §5, calqué sur src/lib/types.ts)
   Cible : LI-ERP-004\DEVPERSO — base supergestion
   Exécution :  sqlcmd -S "localhost\DEVPERSO" -E -i sql/schema.sql -d supergestion
   (idempotent : chaque objet n'est créé que s'il n'existe pas)
   ----------------------------------------------------------------------------
   Modèle multi-tenant du PRD (PostgreSQL schéma-par-tenant) transposé ici :
   une seule base, colonne discriminante `tenant` + index (l'étanchéité reste
   garantie par la résolution de la session côté serveur — jamais du client).
   Section 0 (sg_tenants) = table réellement écrite par la couche applicative
   actuelle (db.ts/sqlStore.ts). Les sections 1 à 11 constituent le schéma
   relationnel cible (migration applicative à venir).
   ========================================================================== */

USE supergestion;
GO

/* ── 0. Document par tenant (persisté par l'app aujourd'hui) ─────────────── */
IF OBJECT_ID(N'dbo.sg_tenants', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.sg_tenants (
    slug        NVARCHAR(64)  NOT NULL CONSTRAINT PK_sg_tenants PRIMARY KEY,
    name        NVARCHAR(200) NOT NULL,
    plan        NVARCHAR(20)  NOT NULL,
    data        NVARCHAR(MAX) NOT NULL,
    updated_at  DATETIME2     NOT NULL CONSTRAINT DF_sg_tenants_updated DEFAULT (SYSUTCDATETIME())
  );
END
GO

/* ── 1. Tenants ──────────────────────────────────────────────────────────── */
IF OBJECT_ID(N'dbo.sg_tenant', N'U') IS NULL
CREATE TABLE dbo.sg_tenant (
  id          UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_sg_tenant PRIMARY KEY,
  slug        NVARCHAR(64)     NOT NULL,
  name        NVARCHAR(200)    NOT NULL,
  plan        NVARCHAR(20)     NOT NULL CONSTRAINT CK_sg_tenant_plan CHECK (plan IN ('STARTER','BUSINESS','ENTERPRISE')),
  created_at  DATETIME2        NOT NULL CONSTRAINT DF_sg_tenant_created DEFAULT (SYSUTCDATETIME())
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_sg_tenant_slug' AND object_id = OBJECT_ID(N'dbo.sg_tenant'))
  CREATE UNIQUE INDEX UX_sg_tenant_slug ON dbo.sg_tenant (slug);
GO

/* ── 1 bis. Comptes utilisateurs (rôles de l'app) ────────────────────────── */
IF OBJECT_ID(N'dbo.sg_user', N'U') IS NULL
CREATE TABLE dbo.sg_user (
  id            UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_sg_user PRIMARY KEY,
  tenant        NVARCHAR(64)     NOT NULL,
  username      NVARCHAR(50)     NOT NULL,
  password_hash NVARCHAR(64)     NOT NULL,               -- sha256(salt:password)
  salt          NVARCHAR(64)     NOT NULL,
  display_name  NVARCHAR(100)    NOT NULL,
  role          NVARCHAR(20)     NOT NULL CONSTRAINT CK_sg_user_role CHECK (role IN ('CASHIER','STOCK','LOGISTICS','ADMIN','SUPER_ADMIN')),
  active        BIT              NOT NULL CONSTRAINT DF_sg_user_active DEFAULT (1),
  created_at    DATETIME2        NOT NULL CONSTRAINT DF_sg_user_created DEFAULT (SYSUTCDATETIME())
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_sg_user_login' AND object_id = OBJECT_ID(N'dbo.sg_user'))
  CREATE UNIQUE INDEX UX_sg_user_login ON dbo.sg_user (tenant, username);
GO

/* ── 2. Magasins / hub ───────────────────────────────────────────────────── */
IF OBJECT_ID(N'dbo.sg_store', N'U') IS NULL
CREATE TABLE dbo.sg_store (
  id          UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_sg_store PRIMARY KEY,
  tenant      NVARCHAR(64)     NOT NULL,
  code        NVARCHAR(16)     NOT NULL,
  name        NVARCHAR(200)    NOT NULL,
  is_hub      BIT              NOT NULL CONSTRAINT DF_sg_store_hub DEFAULT (0),
  address     NVARCHAR(300)    NOT NULL,
  city        NVARCHAR(100)    NOT NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_sg_store_code' AND object_id = OBJECT_ID(N'dbo.sg_store'))
  CREATE UNIQUE INDEX UX_sg_store_code ON dbo.sg_store (tenant, code);
GO

/* ── 3. Produits ─────────────────────────────────────────────────────────── */
IF OBJECT_ID(N'dbo.sg_product', N'U') IS NULL
CREATE TABLE dbo.sg_product (
  id               UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_sg_product PRIMARY KEY,
  tenant           NVARCHAR(64)     NOT NULL,
  sku              NVARCHAR(40)     NOT NULL,
  barcode          NVARCHAR(20)     NOT NULL,
  name             NVARCHAR(200)    NOT NULL,
  category         NVARCHAR(80)     NOT NULL,
  brand            NVARCHAR(80)     NOT NULL,
  cost_price       DECIMAL(19,2)    NOT NULL,           -- HT, FCFA sans décimales
  vat_rate         DECIMAL(5,4)     NOT NULL CONSTRAINT DF_sg_product_vat DEFAULT (0.18), -- 0.18 | 0.05 | 0 (zone FCFA)
  selling_price    DECIMAL(19,2)    NOT NULL,           -- TTC
  unit             NVARCHAR(4)      NOT NULL CONSTRAINT CK_sg_product_unit CHECK (unit IN ('UNIT','KG')) CONSTRAINT DF_sg_product_unit DEFAULT ('UNIT'),
  min_stock_level  INT              NOT NULL CONSTRAINT DF_sg_product_min DEFAULT (0),
  supplier_id      UNIQUEIDENTIFIER NULL,
  active           BIT              NOT NULL CONSTRAINT DF_sg_product_active DEFAULT (1),
  created_at       DATETIME2        NOT NULL CONSTRAINT DF_sg_product_created DEFAULT (SYSUTCDATETIME())
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_sg_product_sku' AND object_id = OBJECT_ID(N'dbo.sg_product'))
  CREATE UNIQUE INDEX UX_sg_product_sku ON dbo.sg_product (tenant, sku);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_sg_product_barcode' AND object_id = OBJECT_ID(N'dbo.sg_product'))
  CREATE UNIQUE INDEX UX_sg_product_barcode ON dbo.sg_product (tenant, barcode);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_sg_product_active' AND object_id = OBJECT_ID(N'dbo.sg_product'))
  CREATE INDEX IX_sg_product_active ON dbo.sg_product (tenant, active);
GO

/* ── 4. Fournisseurs ─────────────────────────────────────────────────────── */
IF OBJECT_ID(N'dbo.sg_supplier', N'U') IS NULL
CREATE TABLE dbo.sg_supplier (
  id              UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_sg_supplier PRIMARY KEY,
  tenant          NVARCHAR(64)     NOT NULL,
  code            NVARCHAR(16)     NOT NULL,
  name            NVARCHAR(200)    NOT NULL,
  email           NVARCHAR(200)    NOT NULL,
  phone           NVARCHAR(40)     NOT NULL,
  lead_time_days  INT              NOT NULL,
  payment_terms   NVARCHAR(50)     NOT NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_sg_supplier_code' AND object_id = OBJECT_ID(N'dbo.sg_supplier'))
  CREATE UNIQUE INDEX UX_sg_supplier_code ON dbo.sg_supplier (tenant, code);
GO

/* FK produits → fournisseurs (post-déclaration) */
IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_sg_product_supplier')
  ALTER TABLE dbo.sg_product ADD CONSTRAINT FK_sg_product_supplier
    FOREIGN KEY (supplier_id) REFERENCES dbo.sg_supplier (id);
GO

/* ── 5. Lots / DLC ───────────────────────────────────────────────────────── */
IF OBJECT_ID(N'dbo.sg_batch', N'U') IS NULL
CREATE TABLE dbo.sg_batch (
  id           UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_sg_batch PRIMARY KEY,
  tenant       NVARCHAR(64)     NOT NULL,
  product_id   UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_sg_batch_product REFERENCES dbo.sg_product (id),
  store_id     UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_sg_batch_store REFERENCES dbo.sg_store (id),
  batch_number NVARCHAR(64)     NOT NULL,
  dlc          DATE             NOT NULL,
  quantity     DECIMAL(19,3)    NOT NULL CONSTRAINT CK_sg_batch_qty CHECK (quantity > 0)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_sg_batch_dlc' AND object_id = OBJECT_ID(N'dbo.sg_batch'))
  CREATE INDEX IX_sg_batch_dlc ON dbo.sg_batch (tenant, store_id, dlc);
GO

/* ── 6. Journal de stock (stock dérivé = somme signée) ───────────────────── */
IF OBJECT_ID(N'dbo.sg_stock_movement', N'U') IS NULL
CREATE TABLE dbo.sg_stock_movement (
  id          UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_sg_stock_movement PRIMARY KEY,
  tenant      NVARCHAR(64)     NOT NULL,
  store_id    UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_sg_sm_store REFERENCES dbo.sg_store (id),
  product_id  UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_sg_sm_product REFERENCES dbo.sg_product (id),
  type        NVARCHAR(20)     NOT NULL CONSTRAINT CK_sg_sm_type CHECK (type IN
               ('SUPPLIER_IN','SALE_POS','RETURN_IN','TRANSFER_OUT','TRANSFER_IN','TRANSIT_ENTRY','LOSS_TRANSIT','DAMAGE_TRANSIT','INVENTORY_ADJUST','LOSS_DAMAGE')),
  quantity    DECIMAL(19,3)    NOT NULL CONSTRAINT CK_sg_sm_qty CHECK (quantity > 0),  -- direction dérivée du type
  reference   NVARCHAR(64)     NOT NULL,
  note        NVARCHAR(500)    NULL,
  created_by  NVARCHAR(100)    NOT NULL,
  created_at  DATETIME2        NOT NULL CONSTRAINT DF_sg_sm_created DEFAULT (SYSUTCDATETIME())
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_sg_sm_stock' AND object_id = OBJECT_ID(N'dbo.sg_stock_movement'))
  CREATE INDEX IX_sg_sm_stock ON dbo.sg_stock_movement (tenant, store_id, product_id, created_at DESC);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_sg_sm_ref' AND object_id = OBJECT_ID(N'dbo.sg_stock_movement'))
  CREATE INDEX IX_sg_sm_ref ON dbo.sg_stock_movement (tenant, reference);
GO

/* ── 7. Ordres de transfert (machine à états DRAFT→…→RECEIVED/…) ──────────── */
IF OBJECT_ID(N'dbo.sg_transfer_order', N'U') IS NULL
CREATE TABLE dbo.sg_transfer_order (
  id                    UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_sg_transfer_order PRIMARY KEY,
  tenant                NVARCHAR(64)     NOT NULL,
  code_reference        NVARCHAR(32)     NOT NULL,
  source_store_id       UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_sg_to_source REFERENCES dbo.sg_store (id),
  destination_store_id  UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_sg_to_dest REFERENCES dbo.sg_store (id),
  status                NVARCHAR(20)     NOT NULL CONSTRAINT CK_sg_to_status CHECK (status IN
                         ('DRAFT','REQUESTED','APPROVED','IN_PREPARATION','SHIPPED','RECEIVED','DISCREPANCY','CANCELLED')),
  strategy              NVARCHAR(4)      NOT NULL CONSTRAINT CK_sg_to_strategy CHECK (strategy IN ('PULL','PUSH')),
  requested_by          NVARCHAR(100)    NOT NULL,
  shipped_at            DATETIME2        NULL,
  received_at           DATETIME2        NULL,
  created_at            DATETIME2        NOT NULL CONSTRAINT DF_sg_to_created DEFAULT (SYSUTCDATETIME()),
  CONSTRAINT CK_sg_to_stores CHECK (destination_store_id <> source_store_id)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_sg_to_code' AND object_id = OBJECT_ID(N'dbo.sg_transfer_order'))
  CREATE UNIQUE INDEX UX_sg_to_code ON dbo.sg_transfer_order (tenant, code_reference);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_sg_to_status' AND object_id = OBJECT_ID(N'dbo.sg_transfer_order'))
  CREATE INDEX IX_sg_to_status ON dbo.sg_transfer_order (tenant, status);
GO

IF OBJECT_ID(N'dbo.sg_transfer_item', N'U') IS NULL
CREATE TABLE dbo.sg_transfer_item (
  id                  UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_sg_transfer_item PRIMARY KEY,
  transfer_order_id   UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_sg_ti_order REFERENCES dbo.sg_transfer_order (id) ON DELETE CASCADE,
  product_id          UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_sg_ti_product REFERENCES dbo.sg_product (id),
  batch_number        NVARCHAR(64)     NULL,
  quantity_requested  DECIMAL(19,3)    NOT NULL CONSTRAINT CK_sg_ti_req CHECK (quantity_requested > 0),
  quantity_shipped    DECIMAL(19,3)    NOT NULL CONSTRAINT DF_sg_ti_shipped DEFAULT (0),
  quantity_received   DECIMAL(19,3)    NOT NULL CONSTRAINT DF_sg_ti_received DEFAULT (0),   -- conformes
  quantity_damaged    DECIMAL(19,3)    NOT NULL CONSTRAINT DF_sg_ti_damaged DEFAULT (0),    -- casse transit
  discrepancy_reason  NVARCHAR(500)    NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_sg_ti_order' AND object_id = OBJECT_ID(N'dbo.sg_transfer_item'))
  CREATE INDEX IX_sg_ti_order ON dbo.sg_transfer_item (transfer_order_id);
GO

/* ── 8. Achats fournisseurs ──────────────────────────────────────────────── */
IF OBJECT_ID(N'dbo.sg_purchase_order', N'U') IS NULL
CREATE TABLE dbo.sg_purchase_order (
  id              UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_sg_purchase_order PRIMARY KEY,
  tenant          NVARCHAR(64)     NOT NULL,
  code            NVARCHAR(32)     NOT NULL,
  supplier_id     UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_sg_po_supplier REFERENCES dbo.sg_supplier (id),
  store_id        UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_sg_po_store REFERENCES dbo.sg_store (id),  -- réception / hub
  status          NVARCHAR(20)     NOT NULL CONSTRAINT CK_sg_po_status CHECK (status IN
                   ('DRAFT','SENT','PARTIALLY_RECEIVED','RECEIVED','CANCELLED')),
  bl_number       NVARCHAR(64)     NULL,               -- bon de livraison (rapprochement BC/BL)
  created_at      DATETIME2        NOT NULL CONSTRAINT DF_sg_po_created DEFAULT (SYSUTCDATETIME()),
  expected_at     DATETIME2        NOT NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_sg_po_code' AND object_id = OBJECT_ID(N'dbo.sg_purchase_order'))
  CREATE UNIQUE INDEX UX_sg_po_code ON dbo.sg_purchase_order (tenant, code);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_sg_po_status' AND object_id = OBJECT_ID(N'dbo.sg_purchase_order'))
  CREATE INDEX IX_sg_po_status ON dbo.sg_purchase_order (tenant, status);
GO

IF OBJECT_ID(N'dbo.sg_purchase_order_item', N'U') IS NULL
CREATE TABLE dbo.sg_purchase_order_item (
  id                UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_sg_poi PRIMARY KEY,
  purchase_order_id UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_sg_poi_order REFERENCES dbo.sg_purchase_order (id) ON DELETE CASCADE,
  product_id        UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_sg_poi_product REFERENCES dbo.sg_product (id),
  quantity_ordered  DECIMAL(19,3)    NOT NULL CONSTRAINT CK_sg_poi_ord CHECK (quantity_ordered > 0),
  quantity_received DECIMAL(19,3)    NOT NULL CONSTRAINT DF_sg_poi_recv DEFAULT (0),
  unit_cost         DECIMAL(19,2)    NOT NULL            -- HT FCFA
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_sg_poi_order' AND object_id = OBJECT_ID(N'dbo.sg_purchase_order_item'))
  CREATE INDEX IX_sg_poi_order ON dbo.sg_purchase_order_item (purchase_order_id);
GO

/* ── 9. Ventes (tickets inaltérables : journal + audit, pas d'UPDATE) ─────── */
IF OBJECT_ID(N'dbo.sg_sale', N'U') IS NULL
CREATE TABLE dbo.sg_sale (
  id               UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_sg_sale PRIMARY KEY,
  tenant           NVARCHAR(64)     NOT NULL,
  ticket_number    NVARCHAR(32)     NOT NULL,
  store_id         UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_sg_sale_store REFERENCES dbo.sg_store (id),
  cashier          NVARCHAR(100)    NOT NULL,
  total            DECIMAL(19,2)    NOT NULL,            -- TTC FCFA
  total_vat        DECIMAL(19,2)    NOT NULL,
  total_ht         DECIMAL(19,2)    NOT NULL,
  margin           DECIMAL(19,2)    NOT NULL,
  change           DECIMAL(19,2)    NOT NULL CONSTRAINT DF_sg_sale_change DEFAULT (0),  -- monnaie rendue
  created_at       DATETIME2        NOT NULL CONSTRAINT DF_sg_sale_created DEFAULT (SYSUTCDATETIME()),
  synced_offline   BIT              NOT NULL CONSTRAINT DF_sg_sale_offline DEFAULT (0),
  status           NVARCHAR(12)     NOT NULL CONSTRAINT CK_sg_sale_status CHECK (status IN ('COMPLETED','RETURNED')),
  returned_ticket  NVARCHAR(32)     NULL                 -- pour un retour : ticket d'origine
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_sg_sale_ticket' AND object_id = OBJECT_ID(N'dbo.sg_sale'))
  CREATE UNIQUE INDEX UX_sg_sale_ticket ON dbo.sg_sale (tenant, ticket_number);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_sg_sale_status_date' AND object_id = OBJECT_ID(N'dbo.sg_sale'))
  CREATE INDEX IX_sg_sale_status_date ON dbo.sg_sale (tenant, status, created_at DESC);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_sg_sale_store_date' AND object_id = OBJECT_ID(N'dbo.sg_sale'))
  CREATE INDEX IX_sg_sale_store_date ON dbo.sg_sale (tenant, store_id, created_at DESC);
GO

IF OBJECT_ID(N'dbo.sg_sale_item', N'U') IS NULL
CREATE TABLE dbo.sg_sale_item (
  id          UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_sg_sale_item PRIMARY KEY,
  sale_id     UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_sg_si_sale REFERENCES dbo.sg_sale (id) ON DELETE CASCADE,
  product_id  UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_sg_si_product REFERENCES dbo.sg_product (id),
  sku         NVARCHAR(40)     NOT NULL,
  name        NVARCHAR(200)    NOT NULL,
  quantity    DECIMAL(19,3)    NOT NULL CONSTRAINT CK_sg_si_qty CHECK (quantity > 0),
  unit_price  DECIMAL(19,2)    NOT NULL,              -- TTC
  vat_rate    DECIMAL(5,4)     NOT NULL,
  cost_price  DECIMAL(19,2)    NOT NULL,              -- HT unitaire (marge)
  discount    DECIMAL(19,2)    NOT NULL CONSTRAINT DF_sg_si_discount DEFAULT (0)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_sg_si_sale' AND object_id = OBJECT_ID(N'dbo.sg_sale_item'))
  CREATE INDEX IX_sg_si_sale ON dbo.sg_sale_item (sale_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_sg_si_product' AND object_id = OBJECT_ID(N'dbo.sg_sale_item'))
  CREATE INDEX IX_sg_si_product ON dbo.sg_sale_item (product_id);
GO

IF OBJECT_ID(N'dbo.sg_sale_payment', N'U') IS NULL
CREATE TABLE dbo.sg_sale_payment (
  id       UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_sg_sale_payment PRIMARY KEY,
  sale_id  UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_sg_sp_sale REFERENCES dbo.sg_sale (id) ON DELETE CASCADE,
  method   NVARCHAR(16)     NOT NULL CONSTRAINT CK_sg_sp_method CHECK (method IN ('CASH','CARD','MOBILE_MONEY','VOUCHER')),
  amount   DECIMAL(19,2)    NOT NULL CONSTRAINT CK_sg_sp_amount CHECK (amount > 0)
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_sg_sp_sale' AND object_id = OBJECT_ID(N'dbo.sg_sale_payment'))
  CREATE INDEX IX_sg_sp_sale ON dbo.sg_sale_payment (sale_id);
GO

/* ── 10. Sessions de caisse X / Z ────────────────────────────────────────── */
IF OBJECT_ID(N'dbo.sg_cash_session', N'U') IS NULL
CREATE TABLE dbo.sg_cash_session (
  id             UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_sg_cash_session PRIMARY KEY,
  tenant         NVARCHAR(64)     NOT NULL,
  store_id       UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_sg_cs_store REFERENCES dbo.sg_store (id),
  opened_at      DATETIME2        NOT NULL CONSTRAINT DF_sg_cs_opened DEFAULT (SYSUTCDATETIME()),
  closed_at      DATETIME2        NULL,
  opening_float  DECIMAL(19,2)    NOT NULL,            -- fond de caisse FCFA
  counted_cash   DECIMAL(19,2)    NULL,                -- comptage physique (clôture Z)
  status         NVARCHAR(8)      NOT NULL CONSTRAINT CK_sg_cs_status CHECK (status IN ('OPEN','CLOSED')),
  closed_by      NVARCHAR(100)    NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_sg_cs_lookup' AND object_id = OBJECT_ID(N'dbo.sg_cash_session'))
  CREATE INDEX IX_sg_cs_lookup ON dbo.sg_cash_session (tenant, store_id, status);
GO

/* Rattachement tickets ↔ session (ex-ticketNumbers du modèle document) */
IF OBJECT_ID(N'dbo.sg_cash_session_ticket', N'U') IS NULL
CREATE TABLE dbo.sg_cash_session_ticket (
  id               UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_sg_cs_ticket PRIMARY KEY,
  cash_session_id  UNIQUEIDENTIFIER NOT NULL CONSTRAINT FK_sg_cst_session REFERENCES dbo.sg_cash_session (id) ON DELETE CASCADE,
  ticket_number    NVARCHAR(32)     NOT NULL,
  CONSTRAINT UX_sg_cst UNIQUE (cash_session_id, ticket_number)
);
GO

/* ── 11. Audit trail (inaltérabilité) ────────────────────────────────────── */
IF OBJECT_ID(N'dbo.sg_audit_log', N'U') IS NULL
CREATE TABLE dbo.sg_audit_log (
  id          UNIQUEIDENTIFIER NOT NULL CONSTRAINT PK_sg_audit PRIMARY KEY,
  tenant      NVARCHAR(64)     NOT NULL,
  action      NVARCHAR(40)     NOT NULL,               -- SALE, RETURN_VALIDATE, CASH_CLOSE, PRODUCT_*, TRANSFER_*, PO_*…
  entity      NVARCHAR(40)     NOT NULL,
  entity_id   NVARCHAR(64)     NOT NULL,
  user_id     NVARCHAR(100)    NOT NULL,
  detail      NVARCHAR(1000)   NOT NULL,
  created_at  DATETIME2        NOT NULL CONSTRAINT DF_sg_audit_created DEFAULT (SYSUTCDATETIME())
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_sg_audit_date' AND object_id = OBJECT_ID(N'dbo.sg_audit_log'))
  CREATE INDEX IX_sg_audit_date ON dbo.sg_audit_log (tenant, created_at DESC);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_sg_audit_entity' AND object_id = OBJECT_ID(N'dbo.sg_audit_log'))
  CREATE INDEX IX_sg_audit_entity ON dbo.sg_audit_log (tenant, entity, entity_id);
GO

PRINT N'Schéma SuperGestion vérifié/créé avec succès.';
GO
